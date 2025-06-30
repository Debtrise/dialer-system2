// shared/billing-routes.js
// Basic billing and subscription management API
const express = require('express');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();

  const { Plan, Subscription, PaymentMethod } = sequelize.models;

  // ===== Public Plan Endpoints =====
  router.get('/api/billing/plans', async (req, res) => {
    try {
      const plans = await Plan.findAll();
      res.json(plans);
    } catch (error) {
      console.error('Error fetching plans:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Subscription Endpoints =====
  router.get('/api/billing/subscription', authenticateToken, async (req, res) => {
    try {
      const subscription = await Subscription.findOne({
        where: { tenantId: req.user.tenantId, status: 'active' },
        include: Plan
      });
      if (!subscription) {
        return res.status(404).json({ error: 'No active subscription' });
      }
      res.json(subscription);
    } catch (error) {
      console.error('Error fetching subscription:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/billing/subscription', authenticateToken, async (req, res) => {
    try {
      const { planId, paymentMethodId } = req.body;
      const existing = await Subscription.findOne({ where: { tenantId: req.user.tenantId, status: 'active' } });
      if (existing) {
        return res.status(400).json({ error: 'Tenant already has an active subscription' });
      }
      const subscription = await Subscription.create({
        tenantId: req.user.tenantId,
        planId,
        paymentMethodId,
        status: 'active'
      });
      res.status(201).json(subscription);
    } catch (error) {
      console.error('Error creating subscription:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Payment Method Management =====
  router.post('/api/billing/payment-methods', authenticateToken, async (req, res) => {
    try {
      const { type, details, isDefault } = req.body;
      if (isDefault) {
        await PaymentMethod.update({ isDefault: false }, { where: { tenantId: req.user.tenantId } });
      }
      const method = await PaymentMethod.create({
        tenantId: req.user.tenantId,
        type,
        details,
        isDefault: !!isDefault
      });
      res.status(201).json(method);
    } catch (error) {
      console.error('Error adding payment method:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.use(router);
  return router;
};
