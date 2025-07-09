// shared/stage-routes.js
// FIXED: Proper integration with lead models

const express = require('express');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();
  
  // Get models from sequelize (they should be initialized by lead-models.js)
  const getModels = () => {
    const models = require('./lead-models')(sequelize);
    return models;
  };

  // Initialize StageService with models
  const StageService = require('./stage-service');

  // Stage CRUD Operations
  
  // Create a new stage
  router.post('/stages', authenticateToken, async (req, res) => {
    try {
      const models = getModels();
      const service = new StageService(models);
      
      const stageData = {
        ...req.body,
        tenantId: req.user.tenantId
      };
      
      const stage = await service.createStage(req.user.tenantId, stageData);
      res.status(201).json({
        success: true,
        message: 'Stage created successfully',
        stage
      });
    } catch (error) {
      console.error('Error creating stage:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  // List all stages for tenant
  router.get('/stages', authenticateToken, async (req, res) => {
    try {
      const models = getModels();
      const service = new StageService(models);
      
      const stages = await service.listStages(req.user.tenantId);
      
      // Get lead counts for each stage
      const stagesWithCounts = await Promise.all(stages.map(async (stage) => {
        const leadCount = await models.Lead.count({
          where: {
            stageId: stage.id,
            tenantId: req.user.tenantId,
            isActive: true
          }
        });
        
        return {
          ...stage.toJSON(),
          leadCount
        };
      }));
      
      res.json({
        success: true,
        stages: stagesWithCounts,
        totalCount: stages.length
      });
    } catch (error) {
      console.error('Error listing stages:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  // Get single stage with details
  router.get('/stages/:id', authenticateToken, async (req, res) => {
    try {
      const models = getModels();
      const service = new StageService(models);
      
      const stage = await service.getStage(req.params.id, req.user.tenantId);
      
      if (!stage) {
        return res.status(404).json({
          success: false,
          error: 'Stage not found'
        });
      }
      
      // Get leads in this stage
      const leads = await models.Lead.findAll({
        where: {
          stageId: stage.id,
          tenantId: req.user.tenantId,
          isActive: true
        },
        attributes: ['id', 'name', 'phone', 'email', 'status', 'createdAt'],
        order: [['createdAt', 'DESC']],
        limit: 50
      });
      
      res.json({
        success: true,
        stage: {
          ...stage.toJSON(),
          leads,
          leadCount: leads.length
        }
      });
    } catch (error) {
      console.error('Error getting stage:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  // Update a stage
  router.put('/stages/:id', authenticateToken, async (req, res) => {
    try {
      const models = getModels();
      const service = new StageService(models);
      
      const stage = await service.updateStage(req.params.id, req.user.tenantId, req.body);
      
      res.json({
        success: true,
        message: 'Stage updated successfully',
        stage
      });
    } catch (error) {
      console.error('Error updating stage:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  // Delete a stage
  router.delete('/stages/:id', authenticateToken, async (req, res) => {
    try {
      const models = getModels();
      const service = new StageService(models);
      
      // Check if stage has leads
      const leadCount = await models.Lead.count({
        where: {
          stageId: req.params.id,
          tenantId: req.user.tenantId,
          isActive: true
        }
      });
      
      if (leadCount > 0 && !req.query.force) {
        return res.status(400).json({
          success: false,
          error: `Cannot delete stage with ${leadCount} leads. Use force=true to delete anyway.`,
          leadCount
        });
      }
      
      await service.deleteStage(req.params.id, req.user.tenantId, req.query.force === 'true');
      
      res.json({
        success: true,
        message: 'Stage deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting stage:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  // Lead Stage Management
  
  // Assign lead to stage
  router.put('/leads/:leadId/stage', authenticateToken, async (req, res) => {
    try {
      const models = getModels();
      const service = new StageService(models);
      
      const { stageId } = req.body;
      
      if (!stageId) {
        return res.status(400).json({
          success: false,
          error: 'stageId is required'
        });
      }
      
      const lead = await service.assignLeadStage(req.params.leadId, req.user.tenantId, stageId);
      
      res.json({
        success: true,
        message: 'Lead stage updated successfully',
        lead: {
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          stageId: lead.stageId
        }
      });
    } catch (error) {
      console.error('Error assigning lead stage:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  // Remove lead from stage
  router.delete('/leads/:leadId/stage', authenticateToken, async (req, res) => {
    try {
      const models = getModels();
      const service = new StageService(models);
      
      const lead = await service.removeLeadStage(req.params.leadId, req.user.tenantId);
      
      res.json({
        success: true,
        message: 'Lead removed from stage successfully',
        lead: {
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          stageId: lead.stageId
        }
      });
    } catch (error) {
      console.error('Error removing lead from stage:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  // Bulk assign leads to stage
  router.post('/stages/:stageId/leads/bulk-assign', authenticateToken, async (req, res) => {
    try {
      const models = getModels();
      const service = new StageService(models);
      
      const { leadIds } = req.body;
      
      if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'leadIds array is required'
        });
      }
      
      const results = await service.bulkAssignLeadsToStage(
        leadIds, 
        req.params.stageId, 
        req.user.tenantId
      );
      
      res.json({
        success: true,
        message: `Bulk assignment completed: ${results.successful} successful, ${results.failed} failed`,
        results
      });
    } catch (error) {
      console.error('Error bulk assigning leads to stage:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  // Move leads between stages
  router.post('/stages/:fromStageId/move-to/:toStageId', authenticateToken, async (req, res) => {
    try {
      const models = getModels();
      const service = new StageService(models);
      
      const { leadIds } = req.body; // Optional - if not provided, move all leads
      
      const result = await service.moveLeadsBetweenStages(
        req.params.fromStageId,
        req.params.toStageId,
        req.user.tenantId,
        leadIds
      );
      
      res.json({
        success: true,
        message: `Moved ${result.movedCount} leads from stage to stage`,
        result
      });
    } catch (error) {
      console.error('Error moving leads between stages:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  // Stage Analytics
  
  // Get stage analytics
  router.get('/stages/analytics/overview', authenticateToken, async (req, res) => {
    try {
      const models = getModels();
      const service = new StageService(models);
      
      const analytics = await service.getStageAnalytics(req.user.tenantId);
      
      res.json({
        success: true,
        analytics
      });
    } catch (error) {
      console.error('Error getting stage analytics:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  // Get stage conversion funnel
  router.get('/stages/analytics/funnel', authenticateToken, async (req, res) => {
    try {
      const models = getModels();
      const service = new StageService(models);
      
      const { startDate, endDate } = req.query;
      
      const funnel = await service.getStageFunnel(req.user.tenantId, {
        startDate,
        endDate
      });
      
      res.json({
        success: true,
        funnel
      });
    } catch (error) {
      console.error('Error getting stage funnel:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  app.use('/api', router);
  
  console.log('✅ Stage routes initialized successfully');
  console.log('📋 Available stage endpoints:');
  console.log('   📊 CRUD: GET/POST/PUT/DELETE /api/stages');
  console.log('   🔄 Lead Assignment: PUT /api/leads/:id/stage');
  console.log('   📈 Analytics: GET /api/stages/analytics/overview');
  console.log('   🔀 Bulk Operations: POST /api/stages/:id/leads/bulk-assign');

  return router;
};