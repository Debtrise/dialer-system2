// webhook-service.js
// Service for processing webhook requests and managing webhook endpoints

const crypto = require('crypto');
const { Op } = require('sequelize');

class WebhookService {
  constructor(models, journeyService = null) {
    this.models = models;
    this.journeyService = journeyService;
  }

  /**
   * Generate a secure random endpoint key
   */
  generateEndpointKey() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate a security token for webhook authentication
   */
  generateSecurityToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a new webhook endpoint
   */
  async createWebhookEndpoint(data) {
    try {
      // Generate endpoint key and security token if not provided
      const endpointKey = data.endpointKey || this.generateEndpointKey();
      const securityToken = data.securityToken || this.generateSecurityToken();

      const webhook = await this.models.WebhookEndpoint.create({
        ...data,
        endpointKey,
        securityToken
      });

      return webhook;
    } catch (error) {
      console.error('Error creating webhook endpoint:', error);
      throw error;
    }
  }

  /**
   * Update a webhook endpoint
   */
  async updateWebhookEndpoint(id, data, tenantId) {
    try {
      const [updated] = await this.models.WebhookEndpoint.update(data, {
        where: {
          id,
          tenantId
        }
      });

      if (!updated) {
        throw new Error('Webhook endpoint not found or access denied');
      }

      return this.getWebhookEndpoint(id, tenantId);
    } catch (error) {
      console.error('Error updating webhook endpoint:', error);
      throw error;
    }
  }

  /**
   * Get a webhook endpoint by ID
   */
  async getWebhookEndpoint(id, tenantId) {
    try {
      const webhook = await this.models.WebhookEndpoint.findOne({
        where: {
          id,
          tenantId
        }
      });

      if (!webhook) {
        throw new Error('Webhook endpoint not found or access denied');
      }

      return webhook;
    } catch (error) {
      console.error('Error getting webhook endpoint:', error);
      throw error;
    }
  }

  /**
   * Get a webhook endpoint by endpoint key
   */
  async getWebhookEndpointByKey(endpointKey) {
    try {
      const webhook = await this.models.WebhookEndpoint.findOne({
        where: {
          endpointKey,
          isActive: true
        }
      });

      if (!webhook) {
        throw new Error('Webhook endpoint not found or is inactive');
      }

      return webhook;
    } catch (error) {
      console.error('Error getting webhook endpoint by key:', error);
      throw error;
    }
  }

  /**
   * List webhook endpoints for a tenant
   */
  async listWebhookEndpoints(tenantId, options = {}) {
    try {
      const { limit = 50, offset = 0, isActive } = options;
      
      const query = {
        where: { tenantId },
        limit,
        offset,
        order: [['createdAt', 'DESC']]
      };
      
      if (isActive !== undefined) {
        query.where.isActive = isActive;
      }
      
      const webhooks = await this.models.WebhookEndpoint.findAll(query);
      const count = await this.models.WebhookEndpoint.count({ where: query.where });
      
      return {
        webhooks,
        totalCount: count,
        currentPage: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(count / limit)
      };
    } catch (error) {
      console.error('Error listing webhook endpoints:', error);
      throw error;
    }
  }

  /**
   * Delete a webhook endpoint
   */
  async deleteWebhookEndpoint(id, tenantId) {
    try {
      const result = await this.models.WebhookEndpoint.destroy({
        where: {
          id,
          tenantId
        }
      });

      if (!result) {
        throw new Error('Webhook endpoint not found or access denied');
      }

      return { success: true, id };
    } catch (error) {
      console.error('Error deleting webhook endpoint:', error);
      throw error;
    }
  }

  /**
   * Process an incoming webhook request
   */
  async processWebhook(endpointKey, payload, headers, ipAddress) {
    const startTime = Date.now();
    let webhookEndpoint;
    
    try {
      // Retrieve the webhook configuration
      webhookEndpoint = await this.getWebhookEndpointByKey(endpointKey);
      
      // Validate security token if configured
      if (webhookEndpoint.securityToken) {
        const authHeader = headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
        
        if (token !== webhookEndpoint.securityToken) {
          throw new Error('Invalid security token');
        }
      }
      
      // Validate required headers if configured
      if (webhookEndpoint.requiredHeaders && Object.keys(webhookEndpoint.requiredHeaders).length > 0) {
        for (const [key, value] of Object.entries(webhookEndpoint.requiredHeaders)) {
          if (headers[key.toLowerCase()] !== value) {
            throw new Error(`Missing or invalid required header: ${key}`);
          }
        }
      }
      
      // Process the payload to create leads
      const createdLeadIds = await this.createLeadsFromPayload(webhookEndpoint, payload);
      
      // Log the webhook event
      const event = await this.models.WebhookEvent.create({
        webhookEndpointId: webhookEndpoint.id,
        status: createdLeadIds.length > 0 ? 'success' : 'failed',
        payload,
        createdLeadIds,
        errorMessage: createdLeadIds.length === 0 ? 'No valid leads could be created' : null,
        receivedAt: new Date(),
        ipAddress,
        processingTime: Date.now() - startTime
      });
      
      return {
        success: true,
        createdLeadIds,
        webhookEventId: event.id
      };
    } catch (error) {
      console.error('Error processing webhook:', error);
      
      // Log the failed event if possible
      if (webhookEndpoint) {
        await this.models.WebhookEvent.create({
          webhookEndpointId: webhookEndpoint.id,
          status: 'failed',
          payload,
          errorMessage: error.message,
          receivedAt: new Date(),
          ipAddress,
          processingTime: Date.now() - startTime
        });
      }
      
      throw error;
    }
  }

  /**
   * Create leads from webhook payload
   */
  async createLeadsFromPayload(webhookEndpoint, payload) {
    const { tenantId, fieldMapping, brand, source, validationRules, autoTagRules, autoEnrollJourneyId } = webhookEndpoint;
    
    // Handle the payload (could be a single object or array of leads)
    const dataArray = Array.isArray(payload) ? payload : [payload];
    const createdLeadIds = [];
    
    for (const data of dataArray) {
      try {
        // Extract lead fields using the field mapping
        const phone = this.extractField(data, fieldMapping.phone);
        const name = this.extractField(data, fieldMapping.name);
        const email = this.extractField(data, fieldMapping.email);
        
        // Apply validation rules
        if (validationRules.requirePhone && !phone) {
          console.log('Skipping lead: Missing required phone number');
          continue;
        }
        
        if (validationRules.requireName && !name) {
          console.log('Skipping lead: Missing required name');
          continue;
        }
        
        if (validationRules.requireEmail && !email) {
          console.log('Skipping lead: Missing required email');
          continue;
        }
        
        // Format phone number
        const formattedPhone = this.formatPhoneNumber(phone);
        if (!this.isValidPhoneNumber(formattedPhone)) {
          console.log(`Skipping lead: Invalid phone number format: ${phone}`);
          continue;
        }
        
        // Check for duplicates if needed
        if (!validationRules.allowDuplicatePhone) {
          const existingLead = await this.models.Lead.findOne({
            where: {
              tenantId,
              phone: formattedPhone
            }
          });
          
          if (existingLead) {
            console.log(`Skipping lead: Duplicate phone number: ${formattedPhone}`);
            continue;
          }
        }
        
        // Prepare additional data and tags
        const additionalData = {};
        const tags = [];
        
        // Copy all fields from payload to additionalData
        for (const [key, value] of Object.entries(data)) {
          if (!['phone', 'name', 'email'].includes(key)) {
            additionalData[key] = value;
          }
        }
        
        // Apply auto-tagging rules
        if (autoTagRules && autoTagRules.length > 0) {
          for (const rule of autoTagRules) {
            const fieldValue = this.extractField(data, rule.field);
            
            if (fieldValue !== undefined) {
              if (rule.operator === 'equals' && fieldValue === rule.value) {
                tags.push(rule.tag);
              } else if (rule.operator === 'contains' && String(fieldValue).includes(rule.value)) {
                tags.push(rule.tag);
              } else if (rule.operator === 'exists') {
                tags.push(rule.tag);
              }
            }
          }
        }
        
        if (tags.length > 0) {
          additionalData.tags = tags;
        }
        
        // Create the lead
        const lead = await this.models.Lead.create({
          tenantId,
          phone: formattedPhone,
          name: name || 'Unknown',
          email: email || '',
          brand: brand || null,
          source: source || null,
          additionalData,
          status: 'pending'
        });
        
        createdLeadIds.push(lead.id);
        
        // Auto-enroll in journey if configured
        if (autoEnrollJourneyId && this.journeyService) {
          try {
            await this.journeyService.enrollLeadInJourney(lead.id, autoEnrollJourneyId);
          } catch (error) {
            console.error(`Error auto-enrolling lead ${lead.id} in journey:`, error);
          }
        }
      } catch (error) {
        console.error('Error creating lead from webhook data:', error);
      }
    }
    
    return createdLeadIds;
  }

  /**
   * Extract a field from the data using dot notation
   */
  extractField(data, fieldPath) {
    if (!fieldPath) return null;
    
    if (fieldPath.includes('.')) {
      const paths = fieldPath.split('.');
      let value = data;
      
      for (const path of paths) {
        if (value === null || value === undefined || typeof value !== 'object') {
          return null;
        }
        value = value[path];
      }
      
      return value;
    }
    
    return data[fieldPath];
  }

  /**
   * Format a phone number to E.164 format
   */
  formatPhoneNumber(phone, countryCode = '1') {
    if (!phone) return null;
    
    // Remove all non-numeric characters
    let cleaned = String(phone).replace(/\D/g, '');
    
    // Handle country code
    if (cleaned.startsWith('1') && cleaned.length === 11) {
      return '+' + cleaned;
    } else if (cleaned.length === 10) {
      return '+' + countryCode + cleaned;
    }
    
    // Return original if cannot be formatted properly
    return phone;
  }

  /**
   * Validate phone number format
   */
  isValidPhoneNumber(phone) {
    if (!phone) return false;
    
    // Basic validation - ensure it's a string with 10-15 digits
    const cleaned = String(phone).replace(/\D/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15;
  }

  /**
   * Get webhook events for an endpoint
   */
  async getWebhookEvents(webhookEndpointId, tenantId, options = {}) {
    try {
      const { limit = 50, offset = 0, status } = options;
      
      // First verify the webhook belongs to the tenant
      const webhook = await this.models.WebhookEndpoint.findOne({
        where: {
          id: webhookEndpointId,
          tenantId
        }
      });
      
      if (!webhook) {
        throw new Error('Webhook endpoint not found or access denied');
      }
      
      // Prepare query
      const query = {
        where: { webhookEndpointId },
        limit,
        offset,
        order: [['receivedAt', 'DESC']]
      };
      
      if (status) {
        query.where.status = status;
      }
      
      const events = await this.models.WebhookEvent.findAll(query);
      const count = await this.models.WebhookEvent.count({ where: query.where });
      
      return {
        events,
        totalCount: count,
        currentPage: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(count / limit)
      };
    } catch (error) {
      console.error('Error getting webhook events:', error);
      throw error;
    }
  }

  /**
   * Test a webhook with a sample payload
   */
  async testWebhook(webhookEndpointId, payload, tenantId) {
    try {
      const webhook = await this.getWebhookEndpoint(webhookEndpointId, tenantId);
      
      // Process the test payload but don't create actual leads
      const processedLeads = [];
      const errors = [];
      
      // Use the same logic as createLeadsFromPayload but don't persist to DB
      const dataArray = Array.isArray(payload) ? payload : [payload];
      
      for (const data of dataArray) {
        try {
          const { fieldMapping, validationRules } = webhook;
          
          // Extract lead fields
          const phone = this.extractField(data, fieldMapping.phone);
          const name = this.extractField(data, fieldMapping.name);
          const email = this.extractField(data, fieldMapping.email);
          
          // Apply validation
          if (validationRules.requirePhone && !phone) {
            errors.push(`Missing required phone number in record`);
            continue;
          }
          
          if (validationRules.requireName && !name) {
            errors.push(`Missing required name in record`);
            continue;
          }
          
          if (validationRules.requireEmail && !email) {
            errors.push(`Missing required email in record`);
            continue;
          }
          
          // Format phone
          const formattedPhone = this.formatPhoneNumber(phone);
          if (!this.isValidPhoneNumber(formattedPhone)) {
            errors.push(`Invalid phone number format: ${phone}`);
            continue;
          }
          
          // Check for duplicates if needed
          if (!validationRules.allowDuplicatePhone) {
            const existingLead = await this.models.Lead.findOne({
              where: {
                tenantId,
                phone: formattedPhone
              }
            });
            
            if (existingLead) {
              errors.push(`Duplicate phone number: ${formattedPhone}`);
              continue;
            }
          }
          
          // Build the lead preview
          const additionalData = {};
          for (const [key, value] of Object.entries(data)) {
            if (!['phone', 'name', 'email'].includes(key)) {
              additionalData[key] = value;
            }
          }
          
          processedLeads.push({
            phone: formattedPhone,
            name: name || 'Unknown',
            email: email || '',
            brand: webhook.brand || null,
            source: webhook.source || null,
            additionalData
          });
        } catch (error) {
          errors.push(`Error processing record: ${error.message}`);
        }
      }
      
      // Save the test payload for future reference
      await webhook.update({ testPayload: payload });
      
      return {
        success: true,
        processedLeads,
        errors,
        validCount: processedLeads.length,
        errorCount: errors.length
      };
    } catch (error) {
      console.error('Error testing webhook:', error);
      throw error;
    }
  }
}

module.exports = WebhookService;
