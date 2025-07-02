const express = require('express');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();
  const Tenant = sequelize.models.Tenant;

  if (!Tenant) {
    throw new Error('Tenant model not found');
  }

  const authorize = (req, res, next) => {
    if (req.user.role === 'admin' || req.user.tenantId === req.params.id) {
      return next();
    }
    return res.status(403).json({ error: 'Access denied' });
  };

  router.get('/tenants/:id', authenticateToken, authorize, async (req, res) => {
    try {
      const tenant = await Tenant.findByPk(req.params.id.toString());
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      res.json(tenant);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/tenants/:id', authenticateToken, authorize, async (req, res) => {
    try {
      const targetId = req.params.id.toString();
      const tenant = await Tenant.findByPk(targetId);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      await Tenant.update(req.body, { where: { id: targetId } });
      const refreshed = await Tenant.findByPk(targetId);
      res.json(refreshed);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use('/api', router);
  return router;
};
