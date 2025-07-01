// tracers-routes.js
// API routes for TracersAPI integration

const express = require('express');
const TracersService = require('./tracers-service');
const { Op } = require('sequelize');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();
  
  // Initialize models
  const tracersModels = require('./tracers-models')(sequelize, sequelize.Sequelize.DataTypes);
  
  // Initialize service
  const tracersService = new TracersService({
    ...tracersModels,
    Lead: sequelize.models.Lead
  });
  
  // ===== Search Routes =====
  
  // Search by phone number
  router.post('/tracers/search/phone', authenticateToken, async (req, res) => {
    try {
      const { phone, leadId, skipCache } = req.body;
      const tenantId = req.user.tenantId;
      const userId = req.user.id;
      
      if (!phone) {
        return res.status(400).json({ error: 'Phone number is required' });
      }
      
      const result = await tracersService.searchByPhone(tenantId, phone, {
        leadId,
        userId,
        skipCache
      });
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error in phone search:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Comprehensive search
  router.post('/tracers/search', authenticateToken, async (req, res) => {
    try {
      const { searchCriteria, leadId, skipCache } = req.body;
      const tenantId = req.user.tenantId;
      const userId = req.user.id;
      
      if (!searchCriteria || typeof searchCriteria !== 'object') {
        return res.status(400).json({ error: 'Search criteria is required' });
      }
      
      const result = await tracersService.searchComprehensive(tenantId, searchCriteria, {
        leadId,
        userId,
        skipCache
      });
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error in comprehensive search:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Lead Enrichment Routes =====
  
  // Enrich a single lead
  router.post('/tracers/enrich-lead/:leadId', authenticateToken, async (req, res) => {
    try {
      const leadId = parseInt(req.params.leadId);
      const { forceRefresh } = req.body;
      const tenantId = req.user.tenantId;
      const userId = req.user.id;
      
      const enrichment = await tracersService.enrichLead(tenantId, leadId, {
        userId,
        forceRefresh
      });
      
      res.json({
        success: true,
        enrichment
      });
    } catch (error) {
      console.error('Error enriching lead:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Bulk enrich leads
  router.post('/tracers/bulk-enrich', authenticateToken, async (req, res) => {
    try {
      const { leadIds } = req.body;
      const tenantId = req.user.tenantId;
      const userId = req.user.id;
      
      if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({ error: 'Lead IDs array is required' });
      }
      
      if (leadIds.length > 50) {
        return res.status(400).json({ error: 'Maximum 50 leads can be enriched at once' });
      }
      
      const results = await tracersService.bulkEnrichLeads(tenantId, leadIds, { userId });
      
      const summary = {
        total: results.length,
        successful: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'error').length
      };
      
      res.json({
        success: true,
        summary,
        results
      });
    } catch (error) {
      console.error('Error in bulk enrichment:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get lead enrichment status
  router.get('/tracers/enrichment/:leadId', authenticateToken, async (req, res) => {
    try {
      const leadId = parseInt(req.params.leadId);
      const tenantId = req.user.tenantId;
      
      const enrichment = await tracersModels.LeadEnrichment.findOne({
        where: {
          leadId,
          tenantId
        },
        include: [{
          model: tracersModels.TracersSearch,
          as: 'tracersSearch',
          attributes: ['id', 'searchType', 'status', 'createdAt']
        }]
      });
      
      if (!enrichment) {
        return res.json({
          enriched: false,
          message: 'Lead has not been enriched'
        });
      }
      
      res.json({
        enriched: true,
        enrichment
      });
    } catch (error) {
      console.error('Error getting enrichment status:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== History & Usage Routes =====
  
  // Get search history
  router.get('/tracers/search-history', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const { page, limit, leadId, status, startDate, endDate } = req.query;
      
      const history = await tracersService.getSearchHistory(tenantId, {
        page,
        limit,
        leadId,
        status,
        startDate,
        endDate
      });
      
      res.json(history);
    } catch (error) {
      console.error('Error getting search history:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get usage statistics
  router.get('/tracers/usage', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const { startDate, endDate } = req.query;
      
      const stats = await tracersService.getUsageStats(tenantId, {
        startDate,
        endDate
      });
      
      res.json(stats);
    } catch (error) {
      console.error('Error getting usage stats:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Configuration Routes =====
  
  // Get tenant access status
  router.get('/tracers/status', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      
      const access = await tracersModels.TracersAccess.findByPk(tenantId);
      
      if (!access) {
        return res.json({
          enabled: false,
          message: 'TracersAPI not enabled for this tenant'
        });
      }
      
      // Get today's usage
      const today = new Date().toISOString().split('T')[0];
      const todayUsage = await tracersModels.TracersUsage.findOne({
        where: {
          tenantId,
          date: today
        }
      });
      
      res.json({
        enabled: access.isEnabled,
        limits: {
          daily: access.dailyLimit,
          monthly: access.monthlyLimit
        },
        usage: {
          today: todayUsage?.searchCount || 0,
          todayRemaining: Math.max(0, access.dailyLimit - (todayUsage?.searchCount || 0))
        },
        costPerSearch: access.costPerSearch
      });
    } catch (error) {
      console.error('Error getting TracersAPI status:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Test API connection (admin only)
  router.post('/tracers/test-connection', authenticateToken, async (req, res) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      
      const result = await tracersService.testConnection();
      
      res.json(result);
    } catch (error) {
      console.error('Error testing TracersAPI connection:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Admin Routes =====
  
  // Enable/disable TracersAPI for a tenant (admin only)
  router.put('/tracers/access/:tenantId', authenticateToken, async (req, res) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      
      const targetTenantId = req.params.tenantId;
      const { isEnabled, dailyLimit, monthlyLimit, costPerSearch } = req.body;
      
      const [access, created] = await tracersModels.TracersAccess.upsert({
        tenantId: targetTenantId,
        isEnabled,
        dailyLimit,
        monthlyLimit,
        costPerSearch
      }, {
        returning: true
      });
      
      res.json({
        success: true,
        access,
        created
      });
    } catch (error) {
      console.error('Error updating TracersAPI access:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get all tenant access (admin only)
  router.get('/tracers/access', authenticateToken, async (req, res) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      
      const accesses = await tracersModels.TracersAccess.findAll({
        order: [['tenantId', 'ASC']]
      });
      
      res.json(accesses);
    } catch (error) {
      console.error('Error getting TracersAPI accesses:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get system-wide usage stats (admin only)
  router.get('/tracers/system-usage', authenticateToken, async (req, res) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      
      const { startDate, endDate } = req.query;
      
      const where = {};
      if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date[Op.gte] = startDate;
        if (endDate) where.date[Op.lte] = endDate;
      }
      
      // Get aggregated stats
      const totalSearches = await tracersModels.TracersUsage.sum('searchCount', { where });
      const totalCost = await tracersModels.TracersUsage.sum('totalCost', { where });
      const totalCacheHits = await tracersModels.TracersUsage.sum('cacheHits', { where });
      
      // Get per-tenant breakdown
      const tenantUsage = await sequelize.query(`
        SELECT 
          "tenantId",
          SUM("searchCount") as "totalSearches",
          SUM("successfulSearches") as "successfulSearches",
          SUM("failedSearches") as "failedSearches",
          SUM("cacheHits") as "cacheHits",
          SUM("totalCost") as "totalCost"
        FROM "TracersUsage"
        ${where.date ? 'WHERE date >= :startDate AND date <= :endDate' : ''}
        GROUP BY "tenantId"
        ORDER BY "totalSearches" DESC
      `, {
        replacements: {
          startDate: where.date?.[Op.gte],
          endDate: where.date?.[Op.lte]
        },
        type: sequelize.QueryTypes.SELECT
      });
      
      res.json({
        totals: {
          searches: totalSearches || 0,
          cost: totalCost || 0,
          cacheHits: totalCacheHits || 0,
          cacheHitRate: totalSearches > 0 ? (totalCacheHits / totalSearches * 100).toFixed(2) : 0
        },
        byTenant: tenantUsage
      });
    } catch (error) {
      console.error('Error getting system usage:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Clear cache (admin only)
  router.post('/tracers/clear-cache', authenticateToken, async (req, res) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      
      const deleted = await tracersService.cleanupCache();
      
      res.json({
        success: true,
        message: `Cleared ${deleted} cache entries`
      });
    } catch (error) {
      console.error('Error clearing cache:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Register routes
  app.use('/api', router);
  
  // Schedule cache cleanup
  const cron = require('node-cron');
  cron.schedule('0 3 * * *', async () => {
    try {
      console.log('Running TracersAPI cache cleanup...');
      await tracersService.cleanupCache();
    } catch (error) {
      console.error('Error in TracersAPI cache cleanup:', error);
    }
  });
  
  return tracersModels;
};
