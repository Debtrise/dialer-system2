const express = require('express');
const StageService = require('./stage-service');
const modelsInit = require('./lead-models');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();
  const models = { ...modelsInit(sequelize) };
  const service = new StageService(models);

  router.post('/stages', authenticateToken, async (req, res) => {
    try {
      const stage = await service.createStage(req.user.tenantId, req.body);
      res.status(201).json(stage);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/stages', authenticateToken, async (req, res) => {
    try {
      const stages = await service.listStages(req.user.tenantId);
      res.json(stages);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/stages/:id', authenticateToken, async (req, res) => {
    try {
      const stage = await service.updateStage(req.params.id, req.user.tenantId, req.body);
      res.json(stage);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/stages/:id', authenticateToken, async (req, res) => {
    try {
      await service.deleteStage(req.params.id, req.user.tenantId);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/leads/:id/stage', authenticateToken, async (req, res) => {
    try {
      const lead = await service.assignLeadStage(req.params.id, req.user.tenantId, req.body.stageId);
      res.json(lead);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.use('/api', router);
  return router;
};
