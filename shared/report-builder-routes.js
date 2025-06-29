const express = require('express');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();
  const ReportBuilderService = require('./report-builder-service');

  const reportingModels = require('./reporting-models')(sequelize, sequelize.Sequelize.DataTypes);
  const reportBuilderService = new ReportBuilderService(reportingModels, sequelize);

  // List all report builders
  router.get('/report-builders', authenticateToken, async (req, res) => {
    try {
      const builders = await reportingModels.ReportBuilder.findAll({
        where: { tenantId: req.user.tenantId },
        include: [{ model: reportingModels.ReportWidget, as: 'widgets', order: [['order', 'ASC']] }]
      });
      res.json(builders);
    } catch (error) {
      console.error('Error listing report builders:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get single report builder
  router.get('/report-builders/:id', authenticateToken, async (req, res) => {
    try {
      const builder = await reportingModels.ReportBuilder.findOne({
        where: { id: req.params.id, tenantId: req.user.tenantId },
        include: [{ model: reportingModels.ReportWidget, as: 'widgets', order: [['order', 'ASC']] }]
      });
      if (!builder) {
        return res.status(404).json({ error: 'Report not found' });
      }
      res.json(builder);
    } catch (error) {
      console.error('Error getting report builder:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Create report builder
  router.post('/report-builders', authenticateToken, async (req, res) => {
    try {
      const report = await reportBuilderService.createReport(req.user.tenantId, req.body, req.user.id);
      res.status(201).json(report);
    } catch (error) {
      console.error('Error creating report builder:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Update report builder
  router.put('/report-builders/:id', authenticateToken, async (req, res) => {
    try {
      const report = await reportBuilderService.updateReport(req.params.id, req.body, req.user.tenantId, req.user.id);
      res.json(report);
    } catch (error) {
      console.error('Error updating report builder:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Delete report builder
  router.delete('/report-builders/:id', authenticateToken, async (req, res) => {
    try {
      const count = await reportingModels.ReportBuilder.destroy({ where: { id: req.params.id, tenantId: req.user.tenantId } });
      if (!count) {
        return res.status(404).json({ error: 'Report not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting report builder:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Add widget to report
  router.post('/report-builders/:id/widgets', authenticateToken, async (req, res) => {
    try {
      const widget = await reportBuilderService.addWidget(req.params.id, req.body, req.user.tenantId);
      res.status(201).json(widget);
    } catch (error) {
      console.error('Error adding widget:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Update widget
  router.put('/widgets/:id', authenticateToken, async (req, res) => {
    try {
      const widget = await reportBuilderService.updateWidget(req.params.id, req.body, req.user.tenantId);
      res.json(widget);
    } catch (error) {
      console.error('Error updating widget:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Delete widget
  router.delete('/widgets/:id', authenticateToken, async (req, res) => {
    try {
      const success = await reportBuilderService.deleteWidget(req.params.id, req.user.tenantId);
      if (!success) {
        return res.status(404).json({ error: 'Widget not found' });
      }
      res.json({ success });
    } catch (error) {
      console.error('Error deleting widget:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Reorder widgets
  router.post('/report-builders/:id/widgets/reorder', authenticateToken, async (req, res) => {
    try {
      await reportBuilderService.reorderWidgets(req.params.id, req.body.orders, req.user.tenantId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error reordering widgets:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Public access by token
  router.get('/public/report-builders/:token', async (req, res) => {
    try {
      const report = await reportBuilderService.getReportByToken(req.params.token);
      res.json(report);
    } catch (error) {
      console.error('Error getting public report:', error);
      res.status(400).json({ error: error.message });
    }
  });

  app.use('/api', router);
  console.log('Report builder routes registered successfully');

  return reportingModels;
};
