// sms-routes.js
// Unified SMS routes for both Twilio and Meera

const express = require('express');
const TwilioService = require('./twilio-service');
const MeeraService = require('./meera-service');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();
  
  // Initialize models
  const twilioModels = require('./twilio-models')(sequelize, sequelize.Sequelize.DataTypes);
  const meeraModels = require('./meera-models')(sequelize, sequelize.Sequelize.DataTypes);
  
  // Update SmsMessage model to include provider field
  if (!twilioModels.SmsMessage.rawAttributes.provider) {
    sequelize.queryInterface.addColumn('SmsMessages', 'provider', {
      type: sequelize.Sequelize.DataTypes.ENUM('twilio', 'meera'),
      defaultValue: 'twilio',
      allowNull: false
    }).catch(err => console.log('Provider column might already exist:', err.message));
  }
  
  // Initialize services
  const twilioService = new TwilioService({
    ...twilioModels,
    Lead: sequelize.models.Lead,
    Template: sequelize.models.Template,
    TemplateUsage: sequelize.models.TemplateUsage
  });
  
  const meeraService = new MeeraService({
    ...meeraModels,
    ...twilioModels, // Share SmsMessage, SmsConversation models
    Lead: sequelize.models.Lead,
    Template: sequelize.models.Template,
    TemplateUsage: sequelize.models.TemplateUsage
  });
  
  // ===== Provider Configuration Routes =====
  
  // Get SMS provider settings
  router.get('/sms/providers', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      
      // Get both configurations
      const twilioConfig = await twilioModels.TwilioConfig.findOne({
        where: { tenantId }
      });
      
      const meeraConfig = await meeraModels.MeeraConfig.findOne({
        where: { tenantId }
      });
      
      // Hide sensitive data
      if (twilioConfig) {
        twilioConfig.authToken = '***HIDDEN***';
      }
      
      if (meeraConfig) {
        meeraConfig.apiKey = '***HIDDEN***';
        meeraConfig.apiSecret = '***HIDDEN***';
      }
      
      // Get tenant's default provider preference
      const tenant = await sequelize.models.Tenant.findByPk(tenantId);
      const defaultProvider = tenant?.smsProvider || 'twilio';
      
      res.json({
        providers: {
          twilio: {
            configured: !!twilioConfig,
            active: twilioConfig?.isActive || false,
            config: twilioConfig
          },
          meera: {
            configured: !!meeraConfig,
            active: meeraConfig?.isActive || false,
            config: meeraConfig
          }
        },
        defaultProvider
      });
    } catch (error) {
      console.error('Error getting SMS providers:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Set default SMS provider
  router.put('/sms/providers/default', authenticateToken, async (req, res) => {
    try {
      const { provider } = req.body;
      const tenantId = req.user.tenantId;
      
      if (!['twilio', 'meera'].includes(provider)) {
        return res.status(400).json({ error: 'Invalid provider. Must be twilio or meera' });
      }
      
      const tenant = await sequelize.models.Tenant.findByPk(tenantId);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      
      await tenant.update({ smsProvider: provider });
      
      res.json({
        message: 'Default SMS provider updated',
        provider
      });
    } catch (error) {
      console.error('Error setting default provider:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Twilio Configuration Routes =====
  
  // Get Twilio configuration
  router.get('/sms/twilio/config', authenticateToken, async (req, res) => {
    try {
      const config = await twilioModels.TwilioConfig.findOne({
        where: { tenantId: req.user.tenantId }
      });
      
      if (config) {
        config.authToken = '***HIDDEN***';
      }
      
      res.json(config || {});
    } catch (error) {
      console.error('Error getting Twilio config:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Save Twilio configuration
  router.post('/sms/twilio/config', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const { accountSid, authToken, defaultFromNumber, settings, rateLimits } = req.body;
      
      if (!accountSid || !authToken || !defaultFromNumber) {
        return res.status(400).json({ 
          error: 'Account SID, Auth Token, and Default From Number are required' 
        });
      }
      
      const [config, created] = await twilioModels.TwilioConfig.upsert({
        tenantId,
        accountSid,
        authToken,
        defaultFromNumber,
        settings: settings || {},
        rateLimits: rateLimits || {}
      });
      
      if (created || req.body.syncNumbers) {
        await twilioService.syncTwilioNumbers(tenantId);
      }
      
      twilioService.invalidateClient?.(tenantId);
      
      config.authToken = '***HIDDEN***';
      
      res.json({ 
        config, 
        created,
        message: created ? 'Twilio configuration created' : 'Twilio configuration updated'
      });
    } catch (error) {
      console.error('Error saving Twilio config:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Test Twilio connection
  router.post('/sms/twilio/test', authenticateToken, async (req, res) => {
    try {
      const numbers = await twilioService.getTwilioNumbers(req.user.tenantId);
      res.json({
        success: true,
        message: 'Twilio connection successful',
        numberCount: numbers.length
      });
    } catch (error) {
      console.error('Error testing Twilio connection:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // List synced Twilio numbers
  router.get('/sms/twilio/numbers', authenticateToken, async (req, res) => {
    try {
      const numbers = await twilioModels.SmsPhoneNumber.findAll({
        where: { tenantId: req.user.tenantId },
        order: [['phoneNumber', 'ASC']]
      });
      res.json(numbers);
    } catch (error) {
      console.error('Error fetching Twilio numbers:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Sync numbers from Twilio account
  router.post('/sms/twilio/numbers/sync', authenticateToken, async (req, res) => {
    try {
      const result = await twilioService.syncTwilioNumbers(req.user.tenantId);
      res.json(result);
    } catch (error) {
      console.error('Error syncing Twilio numbers:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Meera Configuration Routes =====
  
  // Get Meera configuration
  router.get('/sms/meera/config', authenticateToken, async (req, res) => {
    try {
      const config = await meeraModels.MeeraConfig.findOne({
        where: { tenantId: req.user.tenantId }
      });
      
      if (config) {
        config.apiKey = '***HIDDEN***';
        config.apiSecret = '***HIDDEN***';
      }
      
      res.json(config || {});
    } catch (error) {
      console.error('Error getting Meera config:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Save Meera configuration
  router.post('/sms/meera/config', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const { apiKey, apiSecret, baseUrl, defaultFromNumber, settings, rateLimits } = req.body;
      
      if (!apiKey || !defaultFromNumber) {
        return res.status(400).json({ 
          error: 'API Key and Default From Number are required' 
        });
      }
      
      const [config, created] = await meeraModels.MeeraConfig.upsert({
        tenantId,
        apiKey,
        apiSecret: apiSecret || '',
        baseUrl: baseUrl || 'https://api.meera.ai/v1',
        defaultFromNumber,
        settings: settings || {},
        rateLimits: rateLimits || {}
      });
      
      meeraService.invalidateClient(tenantId);
      
      config.apiKey = '***HIDDEN***';
      config.apiSecret = '***HIDDEN***';
      
      res.json({ 
        config, 
        created,
        message: created ? 'Meera configuration created' : 'Meera configuration updated'
      });
    } catch (error) {
      console.error('Error saving Meera config:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Test Meera connection
  router.post('/sms/meera/test', authenticateToken, async (req, res) => {
    try {
      const balance = await meeraService.checkBalance(req.user.tenantId);
      res.json({ 
        success: true, 
        message: 'Meera connection successful',
        balance: balance.balance,
        currency: balance.currency
      });
    } catch (error) {
      console.error('Error testing Meera connection:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Check Meera balance
  router.get('/sms/meera/balance', authenticateToken, async (req, res) => {
    try {
      const balance = await meeraService.checkBalance(req.user.tenantId);
      res.json(balance);
    } catch (error) {
      console.error('Error checking Meera balance:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Unified SMS Sending Routes =====
  
  // Send SMS (auto-detect provider)
  router.post('/sms/send', authenticateToken, async (req, res) => {
    try {
      const { to, body, from, leadId, metadata, provider } = req.body;
      const tenantId = req.user.tenantId;
      
      if (!to || !body) {
        return res.status(400).json({ error: 'To and body are required' });
      }
      
      // Determine which provider to use
      let smsProvider = provider;
      if (!smsProvider) {
        const tenant = await sequelize.models.Tenant.findByPk(tenantId);
        smsProvider = tenant?.smsProvider || 'twilio';
      }
      
      // Send via appropriate service
      let result;
      if (smsProvider === 'meera') {
        result = await meeraService.sendSms(tenantId, {
          to,
          from,
          body,
          leadId,
          metadata: {
            ...metadata,
            userId: req.user.id
          }
        });
      } else {
        result = await twilioService.sendSms(tenantId, {
          to,
          from,
          body,
          leadId,
          metadata: {
            ...metadata,
            userId: req.user.id
          }
        });
      }
      
      res.json(result);
    } catch (error) {
      console.error('Error sending SMS:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Send templated SMS
  router.post('/sms/send-template', authenticateToken, async (req, res) => {
    try {
      const { to, templateId, variables, leadId, from, metadata, provider } = req.body;
      const tenantId = req.user.tenantId;
      
      if (!to || !templateId) {
        return res.status(400).json({ error: 'To and templateId are required' });
      }
      
      // Get template to check for provider preference
      const template = await sequelize.models.Template.findOne({
        where: { id: templateId, tenantId, type: 'sms' }
      });
      
      if (!template) {
        return res.status(404).json({ error: 'SMS template not found' });
      }
      
      // Determine provider (template preference > request > tenant default)
      let smsProvider = provider;
      if (!smsProvider && template.metadata?.preferredProvider) {
        smsProvider = template.metadata.preferredProvider;
      }
      if (!smsProvider) {
        const tenant = await sequelize.models.Tenant.findByPk(tenantId);
        smsProvider = tenant?.smsProvider || 'twilio';
      }
      
      // Send via appropriate service
      let result;
      if (smsProvider === 'meera') {
        result = await meeraService.sendTemplatedSms(tenantId, {
          to,
          templateId,
          variables,
          leadId,
          from,
          metadata: {
            ...metadata,
            userId: req.user.id
          }
        });
      } else {
        result = await twilioService.sendTemplatedSms(tenantId, {
          to,
          templateId,
          variables,
          leadId,
          from,
          metadata: {
            ...metadata,
            userId: req.user.id
          }
        });
      }
      
      res.json(result);
    } catch (error) {
      console.error('Error sending templated SMS:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== SMS History & Conversations =====
  
  // Get SMS messages (from both providers)
  router.get('/sms/messages', authenticateToken, async (req, res) => {
    try {
      const { 
        page = 1, 
        limit = 50, 
        direction,
        status,
        leadId,
        provider,
        startDate,
        endDate
      } = req.query;
      
      const where = { tenantId: req.user.tenantId };
      
      if (direction) where.direction = direction;
      if (status) where.status = status;
      if (leadId) where.leadId = leadId;
      if (provider) where.provider = provider;
      
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt[Op.gte] = new Date(startDate);
        if (endDate) where.createdAt[Op.lte] = new Date(endDate);
      }
      
      const messages = await twilioModels.SmsMessage.findAll({
        where,
        include: [{
          model: sequelize.models.Lead,
          attributes: ['id', 'name', 'phone']
        }],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      });
      
      const count = await twilioModels.SmsMessage.count({ where });
      
      res.json({
        messages,
        totalCount: count,
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / parseInt(limit))
      });
    } catch (error) {
      console.error('Error getting SMS messages:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get conversation for a lead (aggregates all providers)
  router.get('/sms/conversations/:leadId', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 50, markAsRead } = req.query;
      const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        markAsRead: markAsRead === 'true'
      };

      const data = await twilioService.getConversation(
        req.user.tenantId,
        req.params.leadId,
        options
      );

      res.json(data);
    } catch (error) {
      console.error('Error fetching SMS conversation:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Webhook Routes (Public) =====
  
  // Twilio SMS webhook
  router.post('/webhooks/twilio/sms', async (req, res) => {
    try {
      const result = await twilioService.handleIncomingSms(req.body);
      res.type('text/xml');
      res.send('<Response></Response>');
    } catch (error) {
      console.error('Error handling Twilio SMS webhook:', error);
      res.status(500).send('<Response></Response>');
    }
  });
  
  // Twilio status webhook
  router.post('/webhooks/twilio/status', async (req, res) => {
    try {
      await twilioService.handleStatusWebhook(req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error('Error handling Twilio status webhook:', error);
      res.sendStatus(500);
    }
  });
  
  // Meera incoming SMS webhook
  router.post('/webhooks/meera/sms', async (req, res) => {
    try {
      const result = await meeraService.handleIncomingSms(req.body);
      res.json({ success: true });
    } catch (error) {
      console.error('Error handling Meera SMS webhook:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // Meera status webhook
  router.post('/webhooks/meera/status/:messageId', async (req, res) => {
    try {
      await meeraService.handleStatusWebhook(req.params.messageId, req.body);
      res.json({ success: true });
    } catch (error) {
      console.error('Error handling Meera status webhook:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // ===== Provider Statistics =====
  
  // Get SMS statistics by provider
  router.get('/sms/stats', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const { startDate, endDate } = req.query;
      
      const where = { tenantId };
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt[Op.gte] = new Date(startDate);
        if (endDate) where.createdAt[Op.lte] = new Date(endDate);
      }
      
      const stats = await twilioModels.SmsMessage.findAll({
        where,
        attributes: [
          'provider',
          'status',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM', sequelize.col('price')), 'totalCost']
        ],
        group: ['provider', 'status'],
        raw: true
      });
      
      res.json({ stats });
    } catch (error) {
      console.error('Error getting SMS stats:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Register routes
  app.use('/api', router);
  
  return { twilioModels, meeraModels };
};