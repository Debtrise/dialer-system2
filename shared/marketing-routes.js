const express = require('express');
const MarketingService = require('./marketing-service');

module.exports = function(
  app,
  sequelize,
  authenticateToken,
  webhookService = null
) {
  const router = express.Router();
  const models = require('./marketing-models')(sequelize);
  const service = new MarketingService(
    models,
    webhookService,
    sequelize.models.Lead
  );

  router.post('/marketing/accounts', authenticateToken, async (req, res) => {
    try {
      const { platform, accountId, tokens, metadata } = req.body;
      const account = await service.linkAccount(req.user.tenantId, platform, accountId, tokens, metadata);
      res.json(account);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/marketing/accounts', authenticateToken, async (req, res) => {
    try {
      const accounts = await service.listAccounts(req.user.tenantId);
      res.json(accounts);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/marketing/campaigns', authenticateToken, async (req, res) => {
    try {
      const { adAccountId, data } = req.body;
      const campaign = await service.createCampaign(req.user.tenantId, adAccountId, data);
      res.json(campaign);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/marketing/campaigns/:id/metrics', authenticateToken, async (req, res) => {
    try {
      const metrics = await service.getCampaignMetrics(req.params.id);
      res.json(metrics);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/marketing/campaigns/:id/leads', authenticateToken, async (req, res) => {
    try {
      const campaignId = req.params.id;
      const leadData = req.body;
      const lead = await service.recordLead(
        req.user.tenantId,
        campaignId,
        leadData
      );
      res.json(lead);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.use('/api', router);
  return models;
};
