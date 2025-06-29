// journey-routes.js
// Journey management routes

module.exports = (app, sequelize, authenticateToken, existingModels) => {
  const { Op } = require('sequelize');
  const express = require('express');
  const router = express.Router();
  
  // Initialize journey models if not already passed
  let journeyModels;
  let Journey, JourneyStep, LeadJourney, JourneyExecution;
  
  if (existingModels && existingModels.Journey) {
    journeyModels = existingModels;
    Journey = existingModels.Journey;
    JourneyStep = existingModels.JourneyStep;
    LeadJourney = existingModels.LeadJourney;
    JourneyExecution = existingModels.JourneyExecution;
  } else {
    // Check if models already exist in sequelize
    if (sequelize.models.Journey && sequelize.models.JourneyStep && 
        sequelize.models.LeadJourney && sequelize.models.JourneyExecution) {
      Journey = sequelize.models.Journey;
      JourneyStep = sequelize.models.JourneyStep;
      LeadJourney = sequelize.models.LeadJourney;
      JourneyExecution = sequelize.models.JourneyExecution;
      journeyModels = {
        Journey,
        JourneyStep,
        LeadJourney,
        JourneyExecution
      };
    } else {
      const initJourneyModels = require('./journey-models');
      journeyModels = initJourneyModels(sequelize);
      Journey = journeyModels.Journey;
      JourneyStep = journeyModels.JourneyStep;
      LeadJourney = journeyModels.LeadJourney;
      JourneyExecution = journeyModels.JourneyExecution;
    }
  }
  
  // Check if models are properly initialized
  if (!Journey || !JourneyStep || !LeadJourney || !JourneyExecution) {
    console.error('Journey models not properly initialized');
    throw new Error('Journey models initialization failed');
  }
  
  // Get Lead model from sequelize
  const Lead = sequelize.models.Lead;
  
  // Initialize journey service
  const JourneyService = require('./journey-service');
  const journeyService = new JourneyService({
    ...journeyModels,
    Lead: sequelize.models.Lead,
    Tenant: sequelize.models.Tenant,
    CallLog: sequelize.models.CallLog,
    DID: sequelize.models.DID,
    SmsMessage: sequelize.models.SmsMessage || null,
    Template: sequelize.models.Template || null
  });

  // Journey Management Routes
  
  // List all journeys for tenant - FIXED VERSION
  router.get('/journeys', authenticateToken, async (req, res) => {
    try {
      // First, get all journeys without the problematic include
      const journeys = await Journey.findAll({
        where: { tenantId: req.user.tenantId.toString() },
        order: [['createdAt', 'DESC']]
      });
      
      // Add counts for each journey
      const journeysWithCounts = await Promise.all(journeys.map(async (journey) => {
        const counts = await LeadJourney.findAll({
          where: { journeyId: journey.id },
          attributes: [
            'status',
            [sequelize.fn('COUNT', sequelize.col('status')), 'count']
          ],
          group: ['status'],
          raw: true
        });
        
        const countMap = counts.reduce((acc, c) => {
          acc[c.status] = parseInt(c.count);
          return acc;
        }, {});
        
        return {
          ...journey.toJSON(),
          activeLeadsCount: countMap.active || 0,
          completedLeadsCount: countMap.completed || 0,
          failedLeadsCount: countMap.failed || 0
        };
      }));
      
      res.json(journeysWithCounts);
    } catch (error) {
      console.error('Error fetching journeys:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get single journey with steps
  router.get('/journeys/:id', authenticateToken, async (req, res) => {
    try {
      const journey = await Journey.findOne({
        where: { 
          id: req.params.id,
          tenantId: req.user.tenantId.toString() 
        },
        include: [
          {
            model: JourneyStep,
            as: 'steps',
            order: [['stepOrder', 'ASC']]
          }
        ]
      });
      
      if (!journey) {
        return res.status(404).json({ error: 'Journey not found' });
      }
      
      // Get lead counts
      const counts = await LeadJourney.findAll({
        where: { journeyId: journey.id },
        attributes: [
          'status',
          [sequelize.fn('COUNT', sequelize.col('status')), 'count']
        ],
        group: ['status'],
        raw: true
      });
      
      const countMap = counts.reduce((acc, c) => {
        acc[c.status] = parseInt(c.count);
        return acc;
      }, {});
      
      // Get step completion counts
      const stepCompletions = await sequelize.query(`
        SELECT 
          je."stepId",
          COUNT(*) as completions
        FROM "JourneyExecutions" je
        INNER JOIN "LeadJourneys" lj ON je."leadJourneyId" = lj.id
        WHERE je.status = 'completed' 
          AND lj."journeyId" = :journeyId
        GROUP BY je."stepId"
      `, {
        replacements: { journeyId: journey.id },
        type: sequelize.QueryTypes.SELECT
      });
      
      res.json({
        ...journey.toJSON(),
        activeLeadsCount: countMap.active || 0,
        completedLeadsCount: countMap.completed || 0,
        failedLeadsCount: countMap.failed || 0,
        stepCompletionCounts: stepCompletions
      });
    } catch (error) {
      console.error('Error fetching journey:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Create new journey
  router.post('/journeys', authenticateToken, async (req, res) => {
    try {
      const journey = await Journey.create({
        ...req.body,
        tenantId: req.user.tenantId.toString()
      });
      
      res.status(201).json(journey);
    } catch (error) {
      console.error('Error creating journey:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Update journey
  router.put('/journeys/:id', authenticateToken, async (req, res) => {
    try {
      const journey = await Journey.findOne({
        where: { 
          id: req.params.id,
          tenantId: req.user.tenantId.toString() 
        }
      });
      
      if (!journey) {
        return res.status(404).json({ error: 'Journey not found' });
      }
      
      await journey.update(req.body);
      res.json(journey);
    } catch (error) {
      console.error('Error updating journey:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Delete journey
  router.delete('/journeys/:id', authenticateToken, async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const journey = await Journey.findOne({
        where: { 
          id: req.params.id,
          tenantId: req.user.tenantId.toString() 
        },
        transaction
      });
      
      if (!journey) {
        await transaction.rollback();
        return res.status(404).json({ error: 'Journey not found' });
      }
      
      // Check for active leads
      const activeLeads = await LeadJourney.count({
        where: {
          journeyId: journey.id,
          status: 'active'
        },
        transaction
      });
      
      if (activeLeads > 0 && !req.query.force) {
        await transaction.rollback();
        return res.status(400).json({ 
          error: 'Journey has active leads. Use force=true to delete anyway.',
          activeLeads 
        });
      }
      
      console.log(`Starting deletion process for journey ${journey.id}`);
      
      // Delete in correct order to avoid foreign key constraints
      
      // 1. First, get all LeadJourney IDs for this journey
      const leadJourneyIds = await LeadJourney.findAll({
        where: { journeyId: journey.id },
        attributes: ['id'],
        transaction,
        raw: true
      });
      
      const leadJourneyIdList = leadJourneyIds.map(lj => lj.id);
      
      if (leadJourneyIdList.length > 0) {
        // 2. Delete all JourneyExecutions that reference these LeadJourneys
        const deletedExecutions = await JourneyExecution.destroy({
          where: {
            leadJourneyId: {
              [Op.in]: leadJourneyIdList
            }
          },
          transaction
        });
        console.log(`Deleted ${deletedExecutions} journey executions`);
      }
      
      // 3. Now delete LeadJourneys
      const deletedLeadJourneys = await LeadJourney.destroy({
        where: { journeyId: journey.id },
        transaction
      });
      console.log(`Deleted ${deletedLeadJourneys} lead journeys`);
      
      // 4. Delete JourneySteps (should be safe now as all executions are gone)
      const deletedSteps = await JourneyStep.destroy({
        where: { journeyId: journey.id },
        transaction
      });
      console.log(`Deleted ${deletedSteps} journey steps`);
      
      // 5. Finally delete the Journey itself
      await journey.destroy({ transaction });
      console.log(`Deleted journey ${journey.id}`);
      
      await transaction.commit();
      
      res.json({ 
        message: 'Journey deleted successfully', 
        id: req.params.id,
        deletedRelations: {
          steps: deletedSteps,
          leadJourneys: deletedLeadJourneys,
          executions: leadJourneyIdList.length > 0 ? 'deleted' : 0
        }
      });
    } catch (error) {
      await transaction.rollback();
      console.error('Error deleting journey:', error);
      res.status(500).json({ 
        error: error.message,
        details: error.stack
      });
    }
  });
  
  // Journey Step Routes
  
  // Get journey steps
  router.get('/journeys/:id/steps', authenticateToken, async (req, res) => {
    try {
      const journey = await Journey.findOne({
        where: { 
          id: req.params.id,
          tenantId: req.user.tenantId.toString() 
        }
      });
      
      if (!journey) {
        return res.status(404).json({ error: 'Journey not found' });
      }
      
      const steps = await JourneyStep.findAll({
        where: { journeyId: journey.id },
        order: [['stepOrder', 'ASC']]
      });
      
      res.json(steps);
    } catch (error) {
      console.error('Error fetching journey steps:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Create journey step
  router.post('/journeys/:id/steps', authenticateToken, async (req, res) => {
    try {
      const journey = await Journey.findOne({
        where: { 
          id: req.params.id,
          tenantId: req.user.tenantId.toString() 
        }
      });
      
      if (!journey) {
        return res.status(404).json({ error: 'Journey not found' });
      }
      
      const step = await JourneyStep.create({
        ...req.body,
        journeyId: journey.id
      });
      
      res.status(201).json(step);
    } catch (error) {
      console.error('Error creating journey step:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Update journey step
  router.put('/journeys/:journeyId/steps/:id', authenticateToken, async (req, res) => {
    try {
      const journey = await Journey.findOne({
        where: { 
          id: req.params.journeyId,
          tenantId: req.user.tenantId.toString() 
        }
      });
      
      if (!journey) {
        return res.status(404).json({ error: 'Journey not found' });
      }
      
      const step = await JourneyStep.findOne({
        where: { 
          id: req.params.id,
          journeyId: journey.id 
        }
      });
      
      if (!step) {
        return res.status(404).json({ error: 'Journey step not found' });
      }
      
      await step.update(req.body);
      res.json(step);
    } catch (error) {
      console.error('Error updating journey step:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Delete journey step
  router.delete('/journeys/:journeyId/steps/:id', authenticateToken, async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const journey = await Journey.findOne({
        where: { 
          id: req.params.journeyId,
          tenantId: req.user.tenantId.toString() 
        },
        transaction
      });
      
      if (!journey) {
        await transaction.rollback();
        return res.status(404).json({ error: 'Journey not found' });
      }
      
      const step = await JourneyStep.findOne({
        where: { 
          id: req.params.id,
          journeyId: journey.id 
        },
        transaction
      });
      
      if (!step) {
        await transaction.rollback();
        return res.status(404).json({ error: 'Journey step not found' });
      }
      
      // Check for active executions
      const activeExecutions = await JourneyExecution.count({
        where: {
          stepId: step.id,
          status: {
            [Op.in]: ['pending', 'processing']
          }
        },
        transaction
      });
      
      if (activeExecutions > 0 && !req.query.force) {
        await transaction.rollback();
        return res.status(400).json({ 
          error: 'Step has active executions. Use force=true to delete anyway.',
          activeExecutions
        });
      }
      
      // Delete all executions for this step
      const deletedExecutions = await JourneyExecution.destroy({
        where: { stepId: step.id },
        transaction
      });
      
      console.log(`Deleted ${deletedExecutions} executions for step ${step.id}`);
      
      // Now delete the step
      await step.destroy({ transaction });
      
      await transaction.commit();
      
      res.json({ 
        message: 'Journey step deleted successfully', 
        id: req.params.id,
        deletedExecutions
      });
    } catch (error) {
      await transaction.rollback();
      console.error('Error deleting journey step:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Lead Journey Routes
  

router.get('/journeys/:id/leads', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const journeyId = req.params.id;
    const tenantId = req.user.tenantId.toString();
    
    // First verify the journey exists and belongs to the tenant
    const journey = await Journey.findOne({
      where: { 
        id: journeyId,
        tenantId: tenantId
      }
    });
    
    if (!journey) {
      return res.status(404).json({ error: 'Journey not found' });
    }
    
    // Build the query for LeadJourneys
    const whereClause = {
      journeyId: journey.id
    };
    
    // Add tenantId filter if the column exists
    const columns = await sequelize.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = 'LeadJourneys' AND column_name = 'tenantId'`,
      { type: sequelize.QueryTypes.SELECT }
    );
    
    if (columns.length > 0) {
      whereClause.tenantId = tenantId;
    }
    
    if (status) {
      whereClause.status = status;
    }
    
    console.log('Fetching lead journeys with where clause:', whereClause);
    
    // Get the lead journeys with pagination
    const leadJourneys = await LeadJourney.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Lead,
          as: 'lead', // Make sure this matches the association alias
          attributes: ['id', 'name', 'phone', 'email', 'status', 'brand', 'source', 'createdAt'],
          required: true,
          where: {
            tenantId: tenantId // Ensure lead belongs to same tenant
          }
        },
        {
          model: JourneyStep,
          as: 'currentStep',
          attributes: ['id', 'name', 'actionType', 'stepOrder'],
          required: false
        }
      ],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
      order: [['startedAt', 'DESC']],
      distinct: true // Important for correct count with includes
    });
    
    console.log(`Found ${leadJourneys.count} total lead journeys, returning ${leadJourneys.rows.length} for this page`);
    
    // Get pending executions for these lead journeys
    if (leadJourneys.rows.length > 0) {
      const leadJourneyIds = leadJourneys.rows.map(lj => lj.id);
      
      const executions = await JourneyExecution.findAll({
        where: {
          leadJourneyId: { [Op.in]: leadJourneyIds },
          status: 'pending'
        },
        include: [{
          model: JourneyStep,
          as: 'step',
          attributes: ['id', 'name', 'actionType']
        }],
        order: [['scheduledTime', 'ASC']]
      });
      
      // Map executions to lead journeys
      const executionMap = {};
      executions.forEach(exec => {
        if (!executionMap[exec.leadJourneyId]) {
          executionMap[exec.leadJourneyId] = [];
        }
        executionMap[exec.leadJourneyId].push(exec);
      });
      
      // Add execution info to response
      leadJourneys.rows = leadJourneys.rows.map(lj => ({
        ...lj.toJSON(),
        pendingExecutions: executionMap[lj.id] || [],
        nextExecution: executionMap[lj.id]?.[0] || null
      }));
    }
    
    res.json({
      success: true,
      journey: {
        id: journey.id,
        name: journey.name,
        isActive: journey.isActive
      },
      leads: leadJourneys.rows,
      pagination: {
        totalCount: leadJourneys.count,
        totalPages: Math.ceil(leadJourneys.count / parseInt(limit)),
        currentPage: parseInt(page),
        pageSize: parseInt(limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching journey leads:', error);
    console.error('Error details:', error.stack);
    
    // Check if it's an association error
    if (error.message.includes('is not associated')) {
      return res.status(500).json({ 
        error: 'Database association error. Please check model relationships.',
        details: error.message 
      });
    }
    
    res.status(500).json({ 
      error: error.message,
      type: error.constructor.name 
    });
  }
});

  
  // Enroll leads in journey
  router.post('/journeys/:id/enroll', authenticateToken, async (req, res) => {
    try {
      const { leadIds, restart = false } = req.body;
      
      if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({ error: 'No lead IDs provided' });
      }
      
      const journey = await Journey.findOne({
        where: { 
          id: req.params.id,
          tenantId: req.user.tenantId.toString(),
          isActive: true
        }
      });
      
      if (!journey) {
        return res.status(404).json({ error: 'Active journey not found' });
      }
      
      const results = [];
      
      for (const leadId of leadIds) {
        try {
          const lead = await Lead.findOne({
            where: {
              id: leadId,
              tenantId: req.user.tenantId.toString()
            }
          });
          
          if (!lead) {
            results.push({
              leadId,
              status: 'error',
              message: 'Lead not found'
            });
            continue;
          }
          
          const leadJourney = await journeyService.enrollLeadInJourney(leadId, journey.id, { restart });
          
          results.push({
            leadId,
            journeyId: journey.id,
            leadJourneyId: leadJourney.id,
            status: 'enrolled'
          });
        } catch (error) {
          results.push({
            leadId,
            status: 'error',
            message: error.message
          });
        }
      }
      
      res.json({
        message: `Enrolled ${results.filter(r => r.status === 'enrolled').length} leads in journey`,
        results
      });
    } catch (error) {
      console.error('Error enrolling leads:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get lead's journeys
  router.get('/leads/:id/journeys', authenticateToken, async (req, res) => {
    try {
      const lead = await Lead.findOne({
        where: {
          id: req.params.id,
          tenantId: req.user.tenantId.toString()
        }
      });
      
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      
      const leadJourneys = await LeadJourney.findAll({
        where: { leadId: lead.id },
        include: [
          {
            model: Journey,
            as: 'journey',  // Add the alias
            attributes: ['id', 'name', 'description']
          },
          {
            model: JourneyStep,
            as: 'currentStep',
            attributes: ['id', 'name', 'actionType'],
            required: false
          }
        ],
        order: [['startedAt', 'DESC']]
      });
      
      const pendingExecutions = await JourneyExecution.findAll({
        where: {
          status: 'pending'
        },
        include: [
          {
            model: LeadJourney,
            as: 'leadJourney',  // Add the alias
            where: { leadId: lead.id },
            attributes: []
          },
          {
            model: JourneyStep,
            as: 'step',
            attributes: ['id', 'name', 'actionType']
          }
        ],
        order: [['scheduledTime', 'ASC']]
      });
      
      res.json({
        leadJourneys,
        pendingExecutions
      });
    } catch (error) {
      console.error('Error fetching lead journeys:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Update lead journey status
  router.put('/leads/:leadId/journeys/:journeyId/status', authenticateToken, async (req, res) => {
    try {
      const { status } = req.body;
      
      if (!['active', 'paused', 'completed', 'failed', 'exited'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      
      const leadJourney = await LeadJourney.findOne({
        where: {
          leadId: req.params.leadId,
          journeyId: req.params.journeyId
        },
        include: [
          {
            model: Lead,
            as: 'lead',  // Add the alias here
            where: { tenantId: req.user.tenantId.toString() }
          }
        ]
      });
      
      if (!leadJourney) {
        return res.status(404).json({ error: 'Lead journey not found' });
      }
      
      await leadJourney.update({ status });
      
      // Cancel pending executions if pausing or exiting
      if (['paused', 'exited', 'completed', 'failed'].includes(status)) {
        await JourneyExecution.update(
          { status: 'cancelled' },
          {
            where: {
              leadJourneyId: leadJourney.id,
              status: 'pending'
            }
          }
        );
      }
      
      res.json({
        message: `Lead journey status updated to ${status}`,
        leadJourney
      });
    } catch (error) {
      console.error('Error updating lead journey status:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Manually execute journey step
  router.post('/leads/:leadId/journeys/:journeyId/execute', authenticateToken, async (req, res) => {
    try {
      const { stepId } = req.body;
      
      if (!stepId) {
        return res.status(400).json({ error: 'Step ID required' });
      }
      
      const leadJourney = await LeadJourney.findOne({
        where: {
          leadId: req.params.leadId,
          journeyId: req.params.journeyId,
          status: 'active'
        },
        include: [
          {
            model: Lead,
            as: 'lead',  // Add the alias here
            where: { tenantId: req.user.tenantId.toString() }
          }
        ]
      });
      
      if (!leadJourney) {
        return res.status(404).json({ error: 'Active lead journey not found' });
      }
      
      const step = await JourneyStep.findOne({
        where: {
          id: stepId,
          journeyId: leadJourney.journeyId
        }
      });
      
      if (!step) {
        return res.status(404).json({ error: 'Journey step not found' });
      }
      
      // Create execution record
      const execution = await JourneyExecution.create({
        leadJourneyId: leadJourney.id,
        stepId: step.id,
        scheduledTime: new Date(),
        status: 'processing'
      });
      
      // Execute the step
      const tenant = await sequelize.models.Tenant.findByPk(req.user.tenantId);
      const lead = await Lead.findByPk(leadJourney.leadId);
      
      const result = await journeyService.executeAction(step, lead, tenant, leadJourney);
      
      await execution.update({
        status: 'completed',
        result
      });
      
      res.json({
        message: 'Step executed successfully',
        execution,
        result
      });
    } catch (error) {
      console.error('Error executing journey step:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Statistics Routes
  
  // Get journey statistics
  router.get('/stats/journeys', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId.toString();
      
      const activeJourneys = await Journey.count({
        where: {
          tenantId,
          isActive: true
        }
      });
      
      const activeLeadJourneys = await sequelize.query(`
        SELECT COUNT(*) as count
        FROM "LeadJourneys" lj
        INNER JOIN "Journeys" j ON lj."journeyId" = j.id
        WHERE lj.status = 'active' 
          AND j."tenantId" = :tenantId
      `, {
        replacements: { tenantId },
        type: sequelize.QueryTypes.SELECT
      });
      
      const completedLeadJourneys = await sequelize.query(`
        SELECT COUNT(*) as count
        FROM "LeadJourneys" lj
        INNER JOIN "Journeys" j ON lj."journeyId" = j.id
        WHERE lj.status = 'completed' 
          AND j."tenantId" = :tenantId
      `, {
        replacements: { tenantId },
        type: sequelize.QueryTypes.SELECT
      });
      
      const topJourneys = await sequelize.query(`
        SELECT 
          j.id,
          j.name,
          COUNT(lj.id) as "leadCount"
        FROM "Journeys" j
        LEFT JOIN "LeadJourneys" lj ON j.id = lj."journeyId"
        WHERE j."tenantId" = :tenantId
        GROUP BY j.id, j.name
        ORDER BY COUNT(lj.id) DESC
        LIMIT 5
      `, {
        replacements: { tenantId },
        type: sequelize.QueryTypes.SELECT
      });
      
      res.json({
        activeJourneys,
        activeLeadJourneys: parseInt(activeLeadJourneys[0]?.count || 0),
        completedLeadJourneys: parseInt(completedLeadJourneys[0]?.count || 0),
        topJourneys
      });
    } catch (error) {
      console.error('Error fetching journey statistics:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get upcoming executions
  router.get('/executions/upcoming', authenticateToken, async (req, res) => {
    try {
      const { limit = 50 } = req.query;
      const tenantId = req.user.tenantId.toString();
      
      const executions = await sequelize.query(`
        SELECT 
          je.*,
          lj."leadId",
          l.name as "leadName",
          l.phone as "leadPhone",
          l.email as "leadEmail",
          j.id as "journeyId",
          j.name as "journeyName",
          js.name as "stepName",
          js."actionType" as "stepActionType"
        FROM "JourneyExecutions" je
        INNER JOIN "LeadJourneys" lj ON je."leadJourneyId" = lj.id
        INNER JOIN "Journeys" j ON lj."journeyId" = j.id
        INNER JOIN "Leads" l ON lj."leadId" = l.id
        INNER JOIN "JourneySteps" js ON je."stepId" = js.id
        WHERE je.status = 'pending'
          AND je."scheduledTime" >= NOW()
          AND j."tenantId" = :tenantId
        ORDER BY je."scheduledTime" ASC
        LIMIT :limit
      `, {
        replacements: { tenantId, limit: parseInt(limit) },
        type: sequelize.QueryTypes.SELECT
      });
      
      res.json(executions);
    } catch (error) {
      console.error('Error fetching upcoming executions:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Apply routes to app
  app.use('/api', router);
  
  // Return the models and service for use in other parts of the application
  return {
    models: journeyModels,
    service: journeyService
  };
};