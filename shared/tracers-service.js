// tracers-service.js
// Service layer for TracersAPI integration

const axios = require('axios');
const crypto = require('crypto');
const { Op } = require('sequelize');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid');

class TracersService {
  constructor(models) {
    this.models = models;
    // Add sequelize reference if available
    this.models.sequelize = models.TracersAccess?.sequelize || models.TracersSearch?.sequelize;
    
    // API Configuration from environment or defaults
    this.apiConfig = {
      apName: process.env.GALAXY_AP_NAME || process.env.TRACERS_PROFILE_NAME || 'cardinallaw1',
      apPassword: process.env.GALAXY_AP_PASSWORD || process.env.TRACERS_PROFILE_PASSWORD || '15ec1c331e44430f853f25fe50469244',
      baseUrl: process.env.GALAXY_API_URL || process.env.TRACERS_API_URL || 'https://api.tracersapi.com',
      cacheHours: parseInt(process.env.TRACERS_CACHE_HOURS || '24'),
      rateLimit: parseInt(process.env.TRACERS_RATE_LIMIT || '100'),
      timeout: parseInt(process.env.TRACERS_TIMEOUT || '30000')
    };
    
    // Generate API token from credentials
    this.apiToken = this.generateApiToken();
    
    // Initialize axios client
    this.apiClient = axios.create({
      baseURL: this.apiConfig.baseUrl,
      timeout: this.apiConfig.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    // Add request interceptor to try different auth header formats
    this.apiClient.interceptors.request.use((config) => {
      // Try different authentication header formats based on environment variable
      // Default to HTTP Basic auth which is what the Tracers API expects
      const authMethod = process.env.GALAXY_AUTH_METHOD || 'basic';
      
      switch (authMethod) {
        case 'galaxy-token':
          config.headers['galaxy-token'] = this.apiToken;
          break;
        case 'basic':
          // Standard HTTP basic authentication header
          config.headers['Authorization'] = `Basic ${this.apiToken}`;
          break;
        case 'bearer':
          config.headers['Authorization'] = `Bearer ${this.apiToken}`;
          break;
        case 'api-key':
          config.headers['X-API-Key'] = this.apiConfig.apPassword;
          break;
        case 'password-only':
          config.headers['galaxy-token'] = this.apiConfig.apPassword;
          break;
        default:
          config.headers['galaxy-token'] = this.apiToken;
      }
      
      return config;
    });
  }

  /**
   * Generate API token from credentials
   * This might be a base64 encoding or other format
   */
  generateApiToken() {
    // Try base64 encoding of credentials
    const credentials = `${this.apiConfig.apName}:${this.apiConfig.apPassword}`;
    return Buffer.from(credentials).toString('base64');
  }

  /**
   * Check if tenant has access to TracersAPI
   */
  async checkTenantAccess(tenantId) {
    const access = await this.models.TracersAccess.findByPk(tenantId);
    
    if (!access || !access.isEnabled) {
      throw new Error('TracersAPI access not enabled for this tenant');
    }
    
    // Check daily limit
    const today = moment().format('YYYY-MM-DD');
    const todayUsage = await this.models.TracersUsage.findOne({
      where: {
        tenantId,
        date: today
      }
    });
    
    if (todayUsage && todayUsage.searchCount >= access.dailyLimit) {
      throw new Error(`Daily search limit of ${access.dailyLimit} reached`);
    }
    
    // Check monthly limit
    const startOfMonth = moment().startOf('month').format('YYYY-MM-DD');
    const monthlyUsage = await this.models.TracersUsage.sum('searchCount', {
      where: {
        tenantId,
        date: {
          [Op.gte]: startOfMonth
        }
      }
    });
    
    if (monthlyUsage >= access.monthlyLimit) {
      throw new Error(`Monthly search limit of ${access.monthlyLimit} reached`);
    }
    
    return access;
  }

  /**
   * Search for a person using TracersAPI
   */
  async searchPerson(tenantId, searchCriteria, options = {}) {
    const { leadId, userId, skipCache = false, searchType = 'comprehensive' } = options;
    
    // Check tenant access
    const access = await this.checkTenantAccess(tenantId);
    
    // Build the search request - no auth needed in body as it's in headers
    const searchRequest = {
      ...searchCriteria
    };
    
    // Normalize phone if provided
    if (searchRequest.Phone) {
      searchRequest.Phone = this.normalizePhone(searchRequest.Phone);
    }
    
    // Format dates to MM/DD/YYYY if provided
    if (searchRequest.DOB) {
      searchRequest.DOB = this.formatDateForAPI(searchRequest.DOB);
    }
    
    // Check cache first
    if (!skipCache) {
      const cached = await this.checkCache(searchType, searchRequest);
      if (cached) {
        await this.recordSearch(tenantId, {
          searchType,
          searchCriteria: searchRequest,
          searchPhone: searchRequest.Phone,
          apiResponse: cached.responseData,
          resultCount: cached.resultCount,
          status: 'success',
          cost: 0, // No cost for cached results
          userId,
          leadId,
          cacheHit: true
        });
        
        return cached.responseData;
      }
    }
    
    // Make API call
    const startTime = Date.now();
    let response;
    let status = 'success';
    let errorMessage = null;
    
    try {
      // Always use PersonSearch endpoint
      response = await this.apiClient.post('/PersonSearch', searchRequest);
      
      if (!response.data) {
        status = 'error';
        errorMessage = 'No response data';
      } else if (response.data.isError || response.data.error) {
        status = 'error';
        errorMessage = response.data.error?.message || response.data.error?.code || 'Unknown error';
      } else if (!response.data.Results || response.data.Results.length === 0) {
        status = 'no_results';
      }
      
      // Cache successful responses
      if (status === 'success' && response.data.Results) {
        await this.cacheResponse(searchType, searchRequest, response.data);
      }
      
    } catch (error) {
      status = 'error';
      errorMessage = error.response?.data?.error?.message || error.message;
      
      if (error.response?.status === 429) {
        status = 'rate_limited';
      } else if (error.response?.status === 401 || error.response?.status === 403) {
        errorMessage = 'Invalid API credentials or token';
      } else if (error.response?.status === 400) {
        errorMessage = error.response.data?.error?.message || 'Bad request';
      }
      
      response = { data: null };
    }
    
    const apiCallDuration = Date.now() - startTime;
    
    // Record the search
    await this.recordSearch(tenantId, {
      searchType,
      searchCriteria: searchRequest,
      searchPhone: searchRequest.Phone,
      apiResponse: response.data,
      resultCount: response.data?.Results?.length || 0,
      status,
      errorMessage,
      apiCallDuration,
      cost: status === 'success' ? access.costPerSearch : 0,
      userId,
      leadId,
      cacheHit: false
    });
    
    // Update usage statistics
    await this.updateUsageStats(tenantId, {
      searchType,
      status,
      cost: status === 'success' ? access.costPerSearch : 0
    });
    
    if (status === 'error') {
      throw new Error(errorMessage);
    }
    
    return response.data;
  }

  /**
   * Search by phone number using TracersAPI
   */
  async searchByPhone(tenantId, phone, options = {}) {
    if (!phone) {
      throw new Error('Phone number is required');
    }
    
    // For phone searches, just pass the Phone parameter
    return this.searchPerson(tenantId, { Phone: phone }, {
      ...options,
      searchType: 'phone'
    });
  }

  /**
   * Comprehensive search with multiple criteria
   */
  async searchComprehensive(tenantId, criteria, options = {}) {
    if (!criteria || Object.keys(criteria).length === 0) {
      throw new Error('Search criteria is required');
    }
    
    // If only phone is provided, use phone search
    if (criteria.Phone && Object.keys(criteria).length === 1) {
      return this.searchByPhone(tenantId, criteria.Phone, options);
    }
    
    return this.searchPerson(tenantId, criteria, {
      ...options,
      searchType: 'comprehensive'
    });
  }

  /**
   * Enrich a lead with TracersAPI data
   */
  async enrichLead(tenantId, leadId, options = {}) {
    const lead = await this.models.Lead.findOne({
      where: {
        id: leadId,
        tenantId
      }
    });
    
    if (!lead) {
      throw new Error('Lead not found');
    }
    
    // Check if already enriched recently
    const existingEnrichment = await this.models.LeadEnrichment.findOne({
      where: {
        leadId,
        tenantId,
        enrichmentSource: 'tracers',
        status: 'enriched',
        lastEnrichedAt: {
          [Op.gte]: moment().subtract(30, 'days').toDate()
        }
      }
    });
    
    if (existingEnrichment && !options.force) {
      return existingEnrichment;
    }
    
    // Search by phone
    let enrichmentData = {};
    let confidence = 0;
    let status = 'pending';
    
    try {
      const phoneData = await this.searchByPhone(tenantId, lead.phone, {
        leadId,
        userId: options.userId
      });
      
      if (phoneData.Results && phoneData.Results.length > 0) {
        const bestMatch = phoneData.Results[0]; // Assuming first result is best match
        
        enrichmentData = this.extractEnrichmentData(bestMatch);
        confidence = this.calculateConfidence(lead, bestMatch);
        status = 'enriched';
      } else {
        status = 'no_data';
      }
    } catch (error) {
      status = 'error';
      enrichmentData.error = error.message;
    }
    
    // Map enriched fields
    const enrichedFields = {};
    if (enrichmentData.person) {
      const person = enrichmentData.person;
      enrichedFields.firstName = !lead.firstName && person.FirstName;
      enrichedFields.lastName = !lead.lastName && person.LastName;
      enrichedFields.email = !lead.email && person.EmailAddresses?.length > 0;
      enrichedFields.demographics = {
        hasName: !!(person.FirstName || person.LastName),
        age: !!person.Age,
        emails: person.EmailAddresses?.length > 0,
        phones: person.PhoneNumbers?.length > 1, // More than the searched phone
        addresses: person.Addresses?.length > 0,
        relatives: person.Relatives?.length > 0,
        associates: person.Associates?.length > 0,
        akas: person.AKAs?.length > 0
      };
      
      status = 'enriched';
    }
    
    // Get the search record
    const lastSearch = await this.models.TracersSearch.findOne({
      where: {
        leadId,
        tenantId,
        status: 'success'
      },
      order: [['createdAt', 'DESC']]
    });
    
    // Create or update enrichment record
    const [enrichment, created] = await this.models.LeadEnrichment.upsert({
      leadId,
      tenantId,
      lastEnrichedAt: new Date(),
      enrichmentSource: 'tracers',
      tracersSearchId: lastSearch?.id,
      enrichedFields,
      enrichmentData,
      confidence,
      status,
      nextEnrichmentDate: moment().add(90, 'days').toDate() // Re-enrich after 90 days
    }, {
      returning: true
    });
    
    // Update lead's additional data with enrichment
    if (status === 'enriched') {
      const additionalData = lead.additionalData || {};
      additionalData.enrichment = {
        ...additionalData.enrichment,
        tracers: {
          enrichedAt: new Date(),
          confidence,
          data: enrichmentData
        }
      };
      
      await lead.update({ additionalData });
    }
    
    return enrichment;
  }

  /**
   * Test API connection with TracersAPI
   */
  async testConnection() {
    try {
      // Make a simple search to test credentials - auth is in headers
      const testRequest = {
        FirstName: 'Test',
        LastName: 'Test',
        DOB: '01/01/1970'
      };
      
      console.log('Testing TracersAPI connection...');
      console.log('URL:', this.apiConfig.baseUrl);
      console.log('Auth Method:', process.env.GALAXY_AUTH_METHOD || 'basic');
      
      const response = await this.apiClient.post('/PersonSearch', testRequest);
      
      // Check for authentication errors
      if (response.data?.isError || response.data?.error) {
        const error = response.data.error;
        console.error('API Error:', error);
        
        return {
          success: false,
          message: error?.message || error?.code || 'Unknown error',
          authenticated: !error?.code?.toLowerCase().includes('token'),
          errorDetails: error,
          authMethod: process.env.GALAXY_AUTH_METHOD || 'basic',
          apiUrl: this.apiConfig.baseUrl
        };
      }
      
      return {
        success: true,
        message: 'TracersAPI connection successful',
        authenticated: true,
        profileName: this.apiConfig.apName,
        authMethod: process.env.GALAXY_AUTH_METHOD || 'basic',
        apiUrl: this.apiConfig.baseUrl
      };
    } catch (error) {
      console.error('Connection test error:', error.response?.data || error.message);
      
      // Extract error details
      const errorData = error.response?.data;
      const isTokenError = errorData?.error?.code?.toLowerCase().includes('token') ||
                          errorData?.error?.message?.toLowerCase().includes('token');
      
      return {
        success: false,
        message: errorData?.error?.message || error.message,
        status: error.response?.status,
        authenticated: !isTokenError,
        error: errorData?.error || { message: error.message },
        authMethod: process.env.GALAXY_AUTH_METHOD || 'basic',
        apiUrl: this.apiConfig.baseUrl,
        fullError: errorData // Include full error for debugging
      };
    }
  }

  // ===== Helper Methods =====

  /**
   * Normalize phone number
   */
  normalizePhone(phone) {
    if (!phone) return null;
    
    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    
    // Remove leading 1 if 11 digits
    if (digits.length === 11 && digits.startsWith('1')) {
      return digits.substring(1);
    }
    
    return digits;
  }

  /**
   * Format date for API (MM/DD/YYYY format)
   */
  formatDateForAPI(date) {
    if (!date) return null;
    
    // Parse the date using moment
    const parsed = moment(date);
    
    if (!parsed.isValid()) return date; // Return as-is if can't parse
    
    // Format as MM/DD/YYYY
    return parsed.format('MM/DD/YYYY');
  }

  /**
   * Generate cache key
   */
  generateCacheKey(searchType, criteria) {
    // Sort criteria for consistent cache keys
    const sortedCriteria = Object.keys(criteria)
      .sort()
      .reduce((obj, key) => {
        obj[key] = criteria[key];
        return obj;
      }, {});
    
    const criteriaString = JSON.stringify(sortedCriteria);
    return crypto.createHash('md5').update(`${searchType}:${criteriaString}`).digest('hex');
  }

  /**
   * Check cache for results
   */
  async checkCache(searchType, criteria) {
    const cacheKey = this.generateCacheKey(searchType, criteria);
    
    const cached = await this.models.TracersCache.findOne({
      where: {
        cacheKey,
        expiresAt: {
          [Op.gt]: new Date()
        }
      }
    });
    
    if (cached) {
      // Update hit count and last accessed
      await cached.update({
        hitCount: cached.hitCount + 1,
        lastAccessedAt: new Date()
      });
      
      return cached;
    }
    
    return null;
  }

  /**
   * Cache API response
   */
  async cacheResponse(searchType, criteria, responseData) {
    const cacheKey = this.generateCacheKey(searchType, criteria);
    const expiresAt = moment().add(this.apiConfig.cacheHours, 'hours').toDate();
    
    await this.models.TracersCache.upsert({
      cacheKey,
      searchType,
      searchCriteria: criteria,
      responseData,
      resultCount: responseData.Results?.length || 0,
      expiresAt,
      hitCount: 0,
      lastAccessedAt: new Date()
    });
  }

  /**
   * Record search in database
   */
  async recordSearch(tenantId, searchData) {
    const enrichmentData = searchData.status === 'success' && searchData.apiResponse?.Results?.length > 0
      ? this.extractEnrichmentData(searchData.apiResponse.Results[0])
      : {};
    
    return this.models.TracersSearch.create({
      tenantId,
      ...searchData,
      enrichmentData
    });
  }

  /**
   * Extract enrichment data from API response
   */
  extractEnrichmentData(result) {
    if (!result) return {};
    
    const data = {
      person: {
        FirstName: result.FirstName,
        MiddleName: result.MiddleName,
        LastName: result.LastName,
        Age: result.Age,
        DateOfBirth: result.DateOfBirth,
        DateOfDeath: result.DateOfDeath
      }
    };
    
    // Extract email addresses
    if (result.EmailAddresses?.length > 0) {
      data.emails = result.EmailAddresses.map(email => ({
        email: email.Email,
        type: email.Type
      }));
    }
    
    // Extract phone numbers
    if (result.PhoneNumbers?.length > 0) {
      data.phones = result.PhoneNumbers.map(phone => ({
        number: phone.Number,
        type: phone.Type,
        carrier: phone.Carrier,
        lineType: phone.LineType
      }));
    }
    
    // Extract addresses
    if (result.Addresses?.length > 0) {
      data.addresses = result.Addresses.map(addr => ({
        street: addr.Street,
        city: addr.City,
        state: addr.State,
        zip: addr.Zip,
        type: addr.Type,
        dateFirstSeen: addr.DateFirstSeen,
        dateLastSeen: addr.DateLastSeen
      }));
    }
    
    // Extract relatives
    if (result.Relatives?.length > 0) {
      data.relatives = result.Relatives.map(rel => ({
        firstName: rel.FirstName,
        lastName: rel.LastName,
        relationship: rel.Relationship
      }));
    }
    
    // Extract associates
    if (result.Associates?.length > 0) {
      data.associates = result.Associates.map(assoc => ({
        firstName: assoc.FirstName,
        lastName: assoc.LastName
      }));
    }
    
    // Extract AKAs
    if (result.AKAs?.length > 0) {
      data.akas = result.AKAs;
    }
    
    return data;
  }

  /**
   * Calculate confidence score for enrichment match
   */
  calculateConfidence(lead, apiResult) {
    let score = 0;
    let factors = 0;
    
    // Phone match (already verified by search)
    score += 30;
    factors++;
    
    // Name match
    if (lead.firstName || lead.lastName) {
      const nameMatch = this.calculateNameMatch(
        lead.firstName,
        lead.lastName,
        apiResult.FirstName,
        apiResult.LastName
      );
      score += nameMatch * 40;
      factors++;
    }
    
    // Age/DOB match if available
    if (lead.additionalData?.dateOfBirth && apiResult.DateOfBirth) {
      const dobMatch = lead.additionalData.dateOfBirth === apiResult.DateOfBirth;
      score += dobMatch ? 30 : 0;
      factors++;
    }
    
    return Math.round(score / factors);
  }

  /**
   * Calculate name match percentage
   */
  calculateNameMatch(firstName1, lastName1, firstName2, lastName2) {
    if (!firstName1 && !lastName1) return 0;
    if (!firstName2 && !lastName2) return 0;
    
    let matchScore = 0;
    let totalComparisons = 0;
    
    if (firstName1 && firstName2) {
      const fnMatch = this.fuzzyMatch(firstName1, firstName2);
      matchScore += fnMatch;
      totalComparisons++;
    }
    
    if (lastName1 && lastName2) {
      const lnMatch = this.fuzzyMatch(lastName1, lastName2);
      matchScore += lnMatch;
      totalComparisons++;
    }
    
    return totalComparisons > 0 ? matchScore / totalComparisons : 0;
  }

  /**
   * Simple fuzzy match for names
   */
  fuzzyMatch(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    
    if (s1 === s2) return 1;
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;
    
    // Simple character match
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.getEditDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate edit distance between two strings
   */
  getEditDistance(s1, s2) {
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  }

  /**
   * Get search history for a tenant
   */
  async getSearchHistory(tenantId, options = {}) {
    const {
      leadId = null,
      limit = 50,
      page = 1,
      startDate = null,
      endDate = null,
      status = null,
      searchType = null,
      includeStats = false
    } = options;
    
    // Calculate offset from page
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build where clause
    const where = { tenantId };
    
    if (leadId) {
      where.leadId = leadId;
    }
    
    if (status) {
      where.status = status;
    }
    
    if (searchType) {
      where.searchType = searchType;
    }
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt[Op.gte] = startDate;
      }
      if (endDate) {
        where.createdAt[Op.lte] = endDate;
      }
    }

    // Get search history
    const searches = await this.models.TracersSearch.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset,
      order: [['createdAt', 'DESC']],
      include: this.models.Lead ? [{
        model: this.models.Lead,
        as: 'lead',
        attributes: ['id', 'name', 'phone', 'email'],
        required: false
      }] : []
    });

    // Get usage stats if requested
    let stats = null;
    if (includeStats) {
      stats = await this.getUsageStats(tenantId, { startDate, endDate });
    }

    return {
      searches: searches.rows.map(search => ({
        ...search.get({ plain: true }),
        lead: search.lead || null // Ensure lead is included even if null
      })),
      total: searches.count,
      currentPage: parseInt(page),
      totalPages: Math.ceil(searches.count / parseInt(limit)),
      stats
    };
  }

  /**
   * Get usage statistics for a tenant
   */
  async getUsageStats(tenantId, options = {}) {
    const { startDate = null, endDate = null } = options;
    
    const where = { tenantId };
    
    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date[Op.gte] = moment(startDate).format('YYYY-MM-DD');
      }
      if (endDate) {
        where.date[Op.lte] = moment(endDate).format('YYYY-MM-DD');
      }
    }

    const usage = await this.models.TracersUsage.findAll({
      where,
      attributes: [
        [this.models.sequelize.fn('SUM', this.models.sequelize.col('searchCount')), 'totalSearches'],
        [this.models.sequelize.fn('SUM', this.models.sequelize.col('successCount')), 'totalSuccess'],
        [this.models.sequelize.fn('SUM', this.models.sequelize.col('errorCount')), 'totalErrors'],
        [this.models.sequelize.fn('SUM', this.models.sequelize.col('noResultsCount')), 'totalNoResults'],
        [this.models.sequelize.fn('SUM', this.models.sequelize.col('cacheHitCount')), 'totalCacheHits'],
        [this.models.sequelize.fn('SUM', this.models.sequelize.col('totalCost')), 'totalCost']
      ],
      raw: true
    });

    const dailyUsage = await this.models.TracersUsage.findAll({
      where,
      order: [['date', 'DESC']],
      limit: 30
    });

    return {
      summary: usage[0] || {
        totalSearches: 0,
        totalSuccess: 0,
        totalErrors: 0,
        totalNoResults: 0,
        totalCacheHits: 0,
        totalCost: 0
      },
      daily: dailyUsage
    };
  }

  /**
   * Update usage statistics
   */
  async updateUsageStats(tenantId, { searchType, status, cost }) {
    const today = moment().format('YYYY-MM-DD');
    
    const [usage, created] = await this.models.TracersUsage.findOrCreate({
      where: {
        tenantId,
        date: today
      },
      defaults: {
        searchCount: 0,
        successCount: 0,
        errorCount: 0,
        noResultsCount: 0,
        cacheHitCount: 0,
        totalCost: 0
      }
    });
    
    const updates = {
      searchCount: usage.searchCount + 1,
      totalCost: usage.totalCost + (cost || 0)
    };
    
    if (status === 'success') {
      updates.successCount = usage.successCount + 1;
    } else if (status === 'error' || status === 'rate_limited') {
      updates.errorCount = usage.errorCount + 1;
    } else if (status === 'no_results') {
      updates.noResultsCount = usage.noResultsCount + 1;
    }
    
    await usage.update(updates);
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupCache() {
    const deleted = await this.models.TracersCache.destroy({
      where: {
        expiresAt: {
          [Op.lt]: new Date()
        }
      }
    });
    
    console.log(`Cleaned up ${deleted} expired cache entries`);
    return deleted;
  }
}

module.exports = TracersService;