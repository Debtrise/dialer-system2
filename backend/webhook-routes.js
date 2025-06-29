// webhook-routes.js
// API routes for webhook management and ingestion

const express = require('express');
const WebhookService = require('./webhook-service');
const JourneyService = require('./journey-service');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();
  
  // Initialize models
  const webhookModels = require('./webhook-models')(sequelize, sequelize.Sequelize.DataTypes);
  
  // Initialize services
  const journeyService = new JourneyService(
    // We need to pass all the models that journeyService requires
    {
      Journey: sequelize.models.Journey,
      JourneyStep: sequelize.models.JourneyStep,
      LeadJourney: sequelize.models.LeadJourney,
      JourneyExecution: sequelize.models.JourneyExecution,
      Lead: sequelize.models.Lead,
      Tenant: sequelize.models.Tenant,
      CallLog: sequelize.models.CallLog,
      DID: sequelize.models.DID
    }
  );
  
  const webhookService = new WebhookService(
    {
      WebhookEndpoint: webhookModels.WebhookEndpoint,
      WebhookEvent: webhookModels.WebhookEvent,
      Lead: sequelize.models.Lead,
      Tenant: sequelize.models.Tenant
    },
    journeyService
  );
  
  // ===== Authenticated Routes =====
  
  // List all webhooks for tenant
  router.get('/webhooks', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 50, isActive } = req.query;
      const tenantId = req.user.tenantId;
      
      const options = {
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      };
      
      if (isActive !== undefined) {
        options.isActive = isActive === 'true';
      }
      
      const result = await webhookService.listWebhookEndpoints(tenantId, options);
      
      res.json(result);
    } catch (error) {
      console.error('Error listing webhooks:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get webhook details
  router.get('/webhooks/:id', authenticateToken, async (req, res) => {
    try {
      const webhookId = req.params.id;
      const tenantId = req.user.tenantId;
      
      const webhook = await webhookService.getWebhookEndpoint(webhookId, tenantId);
      
      res.json(webhook);
    } catch (error) {
      console.error('Error getting webhook:', error);
      res.status(404).json({ error: error.message });
    }
  });
  
  // Create a new webhook
  router.post('/webhooks', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const webhookData = {
        ...req.body,
        tenantId
      };
      
      const webhook = await webhookService.createWebhookEndpoint(webhookData);
      
      res.status(201).json(webhook);
    } catch (error) {
      console.error('Error creating webhook:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Update a webhook
  router.put('/webhooks/:id', authenticateToken, async (req, res) => {
    try {
      const webhookId = req.params.id;
      const tenantId = req.user.tenantId;
      const webhookData = req.body;
      
      const webhook = await webhookService.updateWebhookEndpoint(webhookId, webhookData, tenantId);
      
      res.json(webhook);
    } catch (error) {
      console.error('Error updating webhook:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Delete a webhook
  router.delete('/webhooks/:id', authenticateToken, async (req, res) => {
    try {
      const webhookId = req.params.id;
      const tenantId = req.user.tenantId;
      
      const result = await webhookService.deleteWebhookEndpoint(webhookId, tenantId);
      
      res.json({
        message: 'Webhook deleted successfully',
        id: webhookId
      });
    } catch (error) {
      console.error('Error deleting webhook:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get webhook events
  router.get('/webhooks/:id/events', authenticateToken, async (req, res) => {
    try {
      const webhookId = req.params.id;
      const tenantId = req.user.tenantId;
      const { page = 1, limit = 50, status } = req.query;
      
      const options = {
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        status
      };
      
      const result = await webhookService.getWebhookEvents(webhookId, tenantId, options);
      
      res.json(result);
    } catch (error) {
      console.error('Error getting webhook events:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Test a webhook
  router.post('/webhooks/:id/test', authenticateToken, async (req, res) => {
    try {
      const webhookId = req.params.id;
      const tenantId = req.user.tenantId;
      const payload = req.body;
      
      const result = await webhookService.testWebhook(webhookId, payload, tenantId);
      
      res.json(result);
    } catch (error) {
      console.error('Error testing webhook:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Public Webhook Receiver =====
  
  // Receive webhook data (public endpoint)
  router.post('/webhook-receiver/:endpointKey', async (req, res) => {
    try {
      const endpointKey = req.params.endpointKey;
      const payload = req.body;
      const headers = req.headers;
      const ipAddress = req.ip || req.connection.remoteAddress;
      
      const result = await webhookService.processWebhook(endpointKey, payload, headers, ipAddress);
      
      res.status(200).json({
        message: 'Webhook processed successfully',
        leadsCreated: result.createdLeadIds.length
      });
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Register routes
  app.use('/api', router);
  
  // Add webhook models to the exported models
  return webhookModels;
};
