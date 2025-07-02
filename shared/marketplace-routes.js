const express = require('express');
const MarketplaceService = require('./marketplace-service');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();
  const models = require('./marketplace-models')(sequelize);
  const service = new MarketplaceService(models);

  router.post('/marketplace/providers', authenticateToken, async (req, res) => {
    try {
      const provider = await service.createProvider(req.user.tenantId, req.body);
      res.json(provider);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/marketplace/providers', authenticateToken, async (req, res) => {
    const providers = await service.listProviders();
    res.json(providers);
  });

  router.post('/marketplace/listings', authenticateToken, async (req, res) => {
    try {
      const listing = await service.createListing(req.body.providerId, req.body);
      res.json(listing);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/marketplace/listings', authenticateToken, async (req, res) => {
    const listings = await service.listListings();
    res.json(listings);
  });

  router.post('/marketplace/listings/:id/purchase', authenticateToken, async (req, res) => {
    try {
      const order = await service.purchaseLeads(req.user.tenantId, req.params.id, req.body.quantity);
      res.json(order);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/marketplace/orders', authenticateToken, async (req, res) => {
    const orders = await service.listOrders({ buyerTenantId: req.user.tenantId });
    res.json(orders);
  });

  // Update order performance (e.g. how many leads were closed)
  router.post('/marketplace/orders/:id/performance', authenticateToken, async (req, res) => {
    try {
      const order = await service.updateOrderPerformance(req.params.id, req.body.closedLeads);
      res.json(order);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get aggregated analytics for a provider
  router.get('/marketplace/providers/:id/analytics', authenticateToken, async (req, res) => {
    try {
      const data = await service.getProviderAnalytics(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.use('/api', router);
  return models;
};
