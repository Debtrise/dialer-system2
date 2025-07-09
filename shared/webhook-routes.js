// webhook-routes.js
// API routes for webhook management and ingestion with go/pause/stop support

const express = require('express');

module.exports = function(app, sequelize, authenticateToken, webhookModels, webhookService) {
  const router = express.Router();
  
  // ===== Authenticated Routes =====
  
  // List all webhooks for tenant
  router.get('/webhooks', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 50, isActive, webhookType } = req.query;
      const tenantId = req.user.tenantId;
      
      const options = {
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      };
      
      if (isActive !== undefined) {
        options.isActive = isActive === 'true';
      }
      
      if (webhookType) {
        options.webhookType = webhookType;
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
      
      res.json({
        ...webhook.toJSON(),
        // Generate full webhook URL for convenience
        webhookUrl: `${req.protocol}://${req.get('host')}/api/webhook-receiver/${webhook.endpointKey}`
      });
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
      
      // Validate webhook type
      if (webhookData.webhookType && !['go', 'pause', 'stop', 'announcement'].includes(webhookData.webhookType)) {
        return res.status(400).json({ error: 'Invalid webhook type. Must be go, pause, or stop' });
      }
      
      const webhook = await webhookService.createWebhookEndpoint(webhookData);
      
      res.status(201).json({
        ...webhook.toJSON(),
        webhookUrl: `${req.protocol}://${req.get('host')}/api/webhook-receiver/${webhook.endpointKey}`
      });
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
      
      // Validate webhook type if being updated
      if (webhookData.webhookType && !['go', 'pause', 'stop'].includes(webhookData.webhookType)) {
        return res.status(400).json({ error: 'Invalid webhook type. Must be go, pause, or stop' });
      }
      
      const webhook = await webhookService.updateWebhookEndpoint(webhookId, webhookData, tenantId);
      
      res.json({
        ...webhook.toJSON(),
        webhookUrl: `${req.protocol}://${req.get('host')}/api/webhook-receiver/${webhook.endpointKey}`
      });
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
  
  // ===== NEW: Webhook Type Management Routes =====
  
  // Get webhook type configuration options
  router.get('/webhooks/types/config-options', authenticateToken, async (req, res) => {
    try {
      const configOptions = {
        go: {
          name: 'Go',
          description: 'Create leads and process them through journeys',
          configFields: [
            'fieldMapping',
            'validationRules',
            'autoTagRules',
            'autoEnrollJourneyId',
            'conditionalRules'
          ],
          defaultActions: ['create_lead', 'enroll_journey']
        },
        pause: {
          name: 'Pause',
          description: 'Pause existing leads and their journeys',
          configFields: [
            'fieldMapping',
            'pauseResumeConfig'
          ],
          resumeConditions: [
            { type: 'timer', label: 'Timer-based Resume', description: 'Resume after specified time delay' },
            { type: 'status', label: 'Status Change Resume', description: 'Resume when lead status changes' },
            { type: 'tag', label: 'Tag Change Resume', description: 'Resume when specific tags are added/removed' },
            { type: 'external', label: 'Manual Resume', description: 'Resume via API or manual trigger' }
          ]
        },
        stop: {
          name: 'Stop',
          description: 'Stop leads and exit them from all journeys',
          configFields: [
            'fieldMapping',
            'stopConfig'
          ],
          stopActions: [
            { type: 'exit_journeys', label: 'Exit Journeys', description: 'Remove lead from all active journeys' },
            { type: 'mark_dnc', label: 'Mark as DNC', description: 'Add to do-not-call list' },
            { type: 'mark_sold', label: 'Mark as Sold', description: 'Mark lead as converted/sold' },
            { type: 'prevent_enrollment', label: 'Prevent Future Enrollment', description: 'Block future journey enrollments' }
          ]
        }
      };
      
      res.json(configOptions);
    } catch (error) {
      console.error('Error getting webhook type config options:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Pause/Resume Management Routes =====
  
  // Get paused leads for tenant
  router.get('/webhooks/paused-leads', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 50, status, webhookId } = req.query;
      const tenantId = req.user.tenantId;
      
      const whereClause = { tenantId };
      
      if (status) {
        whereClause.status = status;
      }
      
      if (webhookId) {
        whereClause.webhookEndpointId = webhookId;
      }
      
      const pausedLeads = await webhookModels.LeadPauseState.findAll({
        where: whereClause,
        include: [
          {
            model: webhookModels.WebhookEndpoint,
            attributes: ['id', 'name', 'webhookType']
          }
        ],
        order: [['pausedAt', 'DESC']],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      });
      
      const count = await webhookModels.LeadPauseState.count({ where: whereClause });
      
      res.json({
        pausedLeads,
        totalCount: count,
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / parseInt(limit))
      });
    } catch (error) {
      console.error('Error getting paused leads:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Resume a paused lead manually
  router.post('/webhooks/paused-leads/:pauseStateId/resume', authenticateToken, async (req, res) => {
    try {
      const pauseStateId = req.params.pauseStateId;
      const tenantId = req.user.tenantId;
      
      // Verify the pause state belongs to this tenant
      const pauseState = await webhookModels.LeadPauseState.findOne({
        where: {
          id: pauseStateId,
          tenantId
        }
      });
      
      if (!pauseState) {
        return res.status(404).json({ error: 'Paused lead not found' });
      }
      
      if (pauseState.status !== 'paused') {
        return res.status(400).json({ error: 'Lead is not in paused state' });
      }
      
      const result = await webhookService.resumeLead(pauseStateId, 'manual_resume');
      
      res.json({
        message: 'Lead resumed successfully',
        result
      });
    } catch (error) {
      console.error('Error resuming lead:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Bulk resume paused leads
  router.post('/webhooks/paused-leads/bulk-resume', authenticateToken, async (req, res) => {
    try {
      const { pauseStateIds } = req.body;
      const tenantId = req.user.tenantId;
      
      if (!pauseStateIds || !Array.isArray(pauseStateIds)) {
        return res.status(400).json({ error: 'pauseStateIds array is required' });
      }
      
      // Verify all pause states belong to this tenant
      const pauseStates = await webhookModels.LeadPauseState.findAll({
        where: {
          id: { [sequelize.Op.in]: pauseStateIds },
          tenantId,
          status: 'paused'
        }
      });
      
      const results = [];
      let successCount = 0;
      let errorCount = 0;
      
      for (const pauseState of pauseStates) {
        try {
          const result = await webhookService.resumeLead(pauseState.id, 'bulk_manual_resume');
          results.push({
            pauseStateId: pauseState.id,
            status: 'success',
            result
          });
          successCount++;
        } catch (error) {
          results.push({
            pauseStateId: pauseState.id,
            status: 'error',
            error: error.message
          });
          errorCount++;
        }
      }
      
      res.json({
        message: `Bulk resume completed: ${successCount} successful, ${errorCount} failed`,
        results,
        successCount,
        errorCount
      });
    } catch (error) {
      console.error('Error bulk resuming leads:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get pause/resume statistics
  router.get('/webhooks/pause-resume-stats', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const { startDate, endDate } = req.query;
      
      const whereClause = { tenantId };
      
      if (startDate || endDate) {
        whereClause.pausedAt = {};
        if (startDate) whereClause.pausedAt[sequelize.Op.gte] = new Date(startDate);
        if (endDate) whereClause.pausedAt[sequelize.Op.lte] = new Date(endDate);
      }
      
      const stats = await webhookModels.LeadPauseState.findAll({
        where: whereClause,
        attributes: [
          'status',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: ['status'],
        raw: true
      });
      
      const webhookStats = await webhookModels.LeadPauseState.findAll({
        where: whereClause,
        include: [{
          model: webhookModels.WebhookEndpoint,
          attributes: ['name', 'webhookType']
        }],
        attributes: [
          [sequelize.col('WebhookEndpoint.name'), 'webhookName'],
          [sequelize.col('WebhookEndpoint.webhookType'), 'webhookType'],
          [sequelize.fn('COUNT', sequelize.col('LeadPauseState.id')), 'count']
        ],
        group: ['WebhookEndpoint.id', 'WebhookEndpoint.name', 'WebhookEndpoint.webhookType'],
        raw: true
      });
      
      res.json({
        statusBreakdown: stats,
        webhookBreakdown: webhookStats
      });
    } catch (error) {
      console.error('Error getting pause/resume stats:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Existing Routes (Enhanced) =====
  
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
  
  // Generate new endpoint key for webhook
  router.post('/webhooks/:id/regenerate-key', authenticateToken, async (req, res) => {
    try {
      const webhookId = req.params.id;
      const tenantId = req.user.tenantId;
      
      const newEndpointKey = webhookService.generateEndpointKey();
      const webhook = await webhookService.updateWebhookEndpoint(webhookId, {
        endpointKey: newEndpointKey
      }, tenantId);
      
      res.json({
        message: 'Endpoint key regenerated successfully',
        endpointKey: newEndpointKey,
        webhookUrl: `${req.protocol}://${req.get('host')}/api/webhook-receiver/${newEndpointKey}`
      });
    } catch (error) {
      console.error('Error regenerating endpoint key:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Generate new security token for webhook
  router.post('/webhooks/:id/regenerate-token', authenticateToken, async (req, res) => {
    try {
      const webhookId = req.params.id;
      const tenantId = req.user.tenantId;
      
      const newSecurityToken = webhookService.generateSecurityToken();
      const webhook = await webhookService.updateWebhookEndpoint(webhookId, {
        securityToken: newSecurityToken
      }, tenantId);
      
      res.json({
        message: 'Security token regenerated successfully',
        securityToken: newSecurityToken
      });
    } catch (error) {
      console.error('Error regenerating security token:', error);
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
      
      console.log(`Webhook received for endpoint: ${endpointKey}`);
      console.log(`Payload:`, JSON.stringify(payload, null, 2));
      
      const result = await webhookService.processWebhook(endpointKey, payload, headers, ipAddress);
      
      res.status(200).json({
        message: 'Webhook processed successfully',
        webhookType: result.webhookType,
        leadsCreated: result.createdLeadIds?.length || 0,
        leadsAffected: result.affectedLeadIds?.length || 0,
        webhookEventId: result.webhookEventId
      });
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(400).json({ 
        error: error.message,
        message: 'Webhook processing failed'
      });
    }
  });
  
  // Health check endpoint for webhook testing
  router.get('/webhook-health/:endpointKey', async (req, res) => {
    try {
      const endpointKey = req.params.endpointKey;
      
      const webhook = await webhookService.getWebhookEndpointByKey(endpointKey);
      
      res.status(200).json({
        message: 'Webhook endpoint is active',
        name: webhook.name,
        endpointKey: webhook.endpointKey,
        webhookType: webhook.webhookType,
        isActive: webhook.isActive
      });
    } catch (error) {
      console.error('Webhook health check failed:', error);
      res.status(404).json({ 
        error: 'Webhook endpoint not found or inactive'
      });
    }
  });
  
  // ===== Conditional Rules Management (Enhanced) =====
  
  // Get conditional rules for a webhook
  router.get('/webhooks/:id/conditions', authenticateToken, async (req, res) => {
    try {
      const webhookId = req.params.id;
      const tenantId = req.user.tenantId;
      
      const webhook = await webhookService.getWebhookEndpoint(webhookId, tenantId);
      
      res.json({
        webhookId: webhook.id,
        webhookType: webhook.webhookType,
        conditionalRules: webhook.conditionalRules || {
          enabled: false,
          logicOperator: 'AND',
          conditionSets: [],
          defaultActions: []
        },
        executionSettings: webhook.executionSettings || {
          stopOnFirstMatch: true,
          executeDefaultOnNoMatch: true,
          logExecution: true,
          timeoutMs: 30000
        },
        // Type-specific configurations
        pauseResumeConfig: webhook.webhookType === 'pause' ? webhook.pauseResumeConfig : null,
        stopConfig: webhook.webhookType === 'stop' ? webhook.stopConfig : null
      });
    } catch (error) {
      console.error('Error getting webhook conditions:', error);
      res.status(404).json({ error: error.message });
    }
  });
  
  // Update conditional rules for a webhook
  router.put('/webhooks/:id/conditions', authenticateToken, async (req, res) => {
    try {
      const webhookId = req.params.id;
      const tenantId = req.user.tenantId;
      const { conditionalRules, executionSettings, pauseResumeConfig, stopConfig } = req.body;
      
      // Validate conditional rules structure
      if (conditionalRules && conditionalRules.conditionSets) {
        for (const conditionSet of conditionalRules.conditionSets) {
          if (!conditionSet.name || !conditionSet.conditions || !conditionSet.actions) {
            return res.status(400).json({
              error: 'Each condition set must have name, conditions, and actions'
            });
          }
          
          // Validate conditions
          for (const condition of conditionSet.conditions) {
            if (!condition.field || !condition.operator) {
              return res.status(400).json({
                error: 'Each condition must have field and operator'
              });
            }
          }
          
          // Validate actions
          for (const action of conditionSet.actions) {
            if (!action.type) {
              return res.status(400).json({
                error: 'Each action must have a type'
              });
            }
          }
        }
      }
      
      const updateData = {};
      if (conditionalRules) updateData.conditionalRules = conditionalRules;
      if (executionSettings) updateData.executionSettings = executionSettings;
      if (pauseResumeConfig) updateData.pauseResumeConfig = pauseResumeConfig;
      if (stopConfig) updateData.stopConfig = stopConfig;
      
      const webhook = await webhookService.updateWebhookEndpoint(webhookId, updateData, tenantId);
      
      res.json({
        message: 'Webhook configuration updated successfully',
        webhook: {
          id: webhook.id,
          name: webhook.name,
          webhookType: webhook.webhookType,
          conditionalRules: webhook.conditionalRules,
          executionSettings: webhook.executionSettings,
          pauseResumeConfig: webhook.pauseResumeConfig,
          stopConfig: webhook.stopConfig
        }
      });
    } catch (error) {
      console.error('Error updating webhook conditions:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Test conditional rules with sample data
  router.post('/webhooks/:id/test-conditions', authenticateToken, async (req, res) => {
    try {
      const webhookId = req.params.id;
      const tenantId = req.user.tenantId;
      const payload = req.body;
      
      const webhook = await webhookService.getWebhookEndpoint(webhookId, tenantId);
      
      if (!webhook.conditionalRules || !webhook.conditionalRules.enabled) {
        return res.status(400).json({
          error: 'Conditional rules are not enabled for this webhook'
        });
      }
      
      // Test the conditional logic without actually executing actions
      const testResult = await webhookService.testConditionalLogic(webhook, payload);
      
      res.json({
        success: true,
        webhookType: webhook.webhookType,
        testResult: {
          matchedConditionSets: testResult.matchedConditionSets,
          conditionsEvaluated: testResult.conditionsEvaluated,
          plannedActions: testResult.plannedActions,
          executionOrder: testResult.executionOrder,
          wouldExecuteDefault: testResult.wouldExecuteDefault
        }
      });
    } catch (error) {
      console.error('Error testing webhook conditions:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get available condition operators
  router.get('/webhooks/condition-operators', authenticateToken, async (req, res) => {
    try {
      const operators = [
        {
          value: 'equals',
          label: 'Equals',
          description: 'Field value equals specified value',
          dataTypes: ['string', 'number', 'boolean']
        },
        {
          value: 'not_equals',
          label: 'Not Equals',
          description: 'Field value does not equal specified value',
          dataTypes: ['string', 'number', 'boolean']
        },
        {
          value: 'contains',
          label: 'Contains',
          description: 'Field value contains specified text',
          dataTypes: ['string']
        },
        {
          value: 'not_contains',
          label: 'Does Not Contain',
          description: 'Field value does not contain specified text',
          dataTypes: ['string']
        },
        {
          value: 'starts_with',
          label: 'Starts With',
          description: 'Field value starts with specified text',
          dataTypes: ['string']
        },
        {
          value: 'ends_with',
          label: 'Ends With',
          description: 'Field value ends with specified text',
          dataTypes: ['string']
        },
        {
          value: 'greater_than',
          label: 'Greater Than',
          description: 'Field value is greater than specified value',
          dataTypes: ['number', 'date']
        },
        {
          value: 'greater_than_equal',
          label: 'Greater Than or Equal',
          description: 'Field value is greater than or equal to specified value',
          dataTypes: ['number', 'date']
        },
        {
          value: 'less_than',
          label: 'Less Than',
          description: 'Field value is less than specified value',
          dataTypes: ['number', 'date']
        },
        {
          value: 'less_than_equal',
          label: 'Less Than or Equal',
          description: 'Field value is less than or equal to specified value',
          dataTypes: ['number', 'date']
        },
        {
          value: 'exists',
          label: 'Field Exists',
          description: 'Field is present in the payload',
          dataTypes: ['any']
        },
        {
          value: 'not_exists',
          label: 'Field Does Not Exist',
          description: 'Field is not present in the payload',
          dataTypes: ['any']
        },
        {
          value: 'regex',
          label: 'Matches Regex',
          description: 'Field value matches regular expression pattern',
          dataTypes: ['string']
        },
        {
          value: 'in_array',
          label: 'In Array',
          description: 'Field value is in specified array of values',
          dataTypes: ['string', 'number']
        },
        {
          value: 'not_in_array',
          label: 'Not In Array',
          description: 'Field value is not in specified array of values',
          dataTypes: ['string', 'number']
        }
      ];
      
      res.json(operators);
    } catch (error) {
      console.error('Error getting condition operators:', error);
      res.status(400).json({ error: error.message });
    }
  });



// shared/webhook-routes.js - Updated routes for template-based announcements

// ===== TEMPLATE-SPECIFIC WEBHOOK ROUTES =====

// Get available templates for webhook configuration
router.get('/webhooks/templates', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { category, search, page = 1, limit = 20 } = req.query;
    
    // Get templates suitable for announcements
    const options = {
      category: category || 'announcement', // Default to announcement templates
      search,
      page: parseInt(page),
      limit: parseInt(limit),
      isPublic: undefined // Include both public and tenant-specific templates
    };
    
    // Assuming contentService is available through webhook service
    const templates = await webhookService.getTemplatesForWebhooks(tenantId, options);
    
    res.json({
      templates: templates.templates.map(template => ({
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        previewImage: template.previewImage,
        variables: template.variables,
        difficulty: template.difficulty,
        estimatedTime: template.estimatedTime,
        isPublic: template.isPublic
      })),
      pagination: templates.pagination,
      message: `Retrieved ${templates.templates.length} templates for webhooks`
    });
  } catch (error) {
    console.error('Error getting webhook templates:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get template details with variables for webhook configuration
router.get('/webhooks/templates/:templateId', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const templateId = req.params.templateId;
    
    const template = await webhookService.getTemplateForWebhook(templateId, tenantId);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Extract variable information from template
    const templateVariables = await webhookService.extractTemplateVariables(template);
    
    res.json({
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        previewImage: template.previewImage,
        variables: template.variables,
        templateData: template.templateData
      },
      extractedVariables: templateVariables,
      suggestedMapping: webhookService.generateSuggestedVariableMapping(templateVariables),
      message: 'Template details retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting template details:', error);
    res.status(404).json({ error: error.message });
  }
});

// Validate template configuration for webhook
router.post('/webhooks/templates/:templateId/validate', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const templateId = req.params.templateId;
    const { variableMapping, defaultValues, testPayload } = req.body;
    
    const validation = await webhookService.validateTemplateConfiguration(
      templateId,
      tenantId,
      {
        variableMapping: variableMapping || {},
        defaultValues: defaultValues || {},
        testPayload: testPayload || {}
      }
    );
    
    res.json({
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
      templateVariables: validation.templateVariables,
      mappedVariables: validation.mappedVariables,
      missingVariables: validation.missingVariables,
      testResults: validation.testResults
    });
  } catch (error) {
    console.error('Error validating template configuration:', error);
    res.status(400).json({ error: error.message });
  }
});

// Create webhook with template configuration
router.post('/webhooks/with-template', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const {
      name,
      description,
      templateId,
      variableMapping,
      defaultValues,
      displaySelection,
      takeover,
      scheduling,
      advanced
    } = req.body;
    
    // Validate template exists and is accessible
    const template = await webhookService.getTemplateForWebhook(templateId, tenantId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found or not accessible' });
    }
    
    // Create webhook configuration
    const webhookData = {
      name,
      description,
      webhookType: 'announcement',
      announcementConfig: {
        enabled: true,
        contentCreator: {
          templateId,
          templateName: template.name,
          generateNewContent: true,
          variableMapping: variableMapping || {},
          defaultValues: defaultValues || {},
          projectSettings: {
            name: `${name} - {system.timestamp}`,
            addTimestamp: true,
            customNamePattern: req.body.projectNamePattern || null
          }
        },
        optisigns: {
          displaySelection: displaySelection || { mode: 'all' },
          takeover: takeover || {
            priority: 'NORMAL',
            duration: 30,
            restoreAfter: true
          },
          scheduling: scheduling || { immediate: true }
        },
        advanced: advanced || webhookModels.WebhookEndpoint.getDefaultAnnouncementConfig().advanced
      },
      isActive: true
    };
    
    const webhook = await webhookService.createWebhookEndpoint({
      ...webhookData,
      tenantId
    });
    
    res.status(201).json({
      ...webhook.toJSON(),
      webhookUrl: `${req.protocol}://${req.get('host')}/api/webhook-receiver/${webhook.endpointKey}`,
      templateInfo: {
        id: template.id,
        name: template.name,
        category: template.category
      },
      message: 'Webhook created successfully with template configuration'
    });
  } catch (error) {
    console.error('Error creating webhook with template:', error);
    res.status(400).json({ error: error.message });
  }
});

// Test webhook with template
router.post('/webhooks/:id/test-with-template', authenticateToken, async (req, res) => {
  try {
    const webhookId = req.params.id;
    const tenantId = req.user.tenantId;
    const payload = req.body;
    
    const webhook = await webhookService.getWebhookEndpoint(webhookId, tenantId);
    
    if (!webhook || webhook.webhookType !== 'announcement') {
      return res.status(404).json({ error: 'Announcement webhook not found' });
    }
    
    const templateId = webhook.announcementConfig?.contentCreator?.templateId;
    if (!templateId) {
      return res.status(400).json({ error: 'Webhook does not have a template configured' });
    }
    
    // Test the template configuration with the payload
    const testResult = await webhookService.testTemplateWithPayload(
      templateId,
      webhook.announcementConfig,
      payload,
      tenantId
    );
    
    res.json({
      webhookId: webhook.id,
      webhookName: webhook.name,
      templateId,
      templateName: webhook.announcementConfig.contentCreator.templateName,
      testResult,
      message: 'Template test completed'
    });
  } catch (error) {
    console.error('Error testing webhook with template:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get webhook template preview
router.get('/webhooks/:id/template-preview', authenticateToken, async (req, res) => {
  try {
    const webhookId = req.params.id;
    const tenantId = req.user.tenantId;
    const { samplePayload } = req.query;
    
    const webhook = await webhookService.getWebhookEndpoint(webhookId, tenantId);
    
    if (!webhook || webhook.webhookType !== 'announcement') {
      return res.status(404).json({ error: 'Announcement webhook not found' });
    }
    
    const templateId = webhook.announcementConfig?.contentCreator?.templateId;
    if (!templateId) {
      return res.status(400).json({ error: 'Webhook does not have a template configured' });
    }
    
    // Generate preview with sample data
    const preview = await webhookService.generateTemplatePreview(
      templateId,
      webhook.announcementConfig,
      samplePayload ? JSON.parse(samplePayload) : {},
      tenantId
    );
    
    res.json({
      templateId,
      templateName: webhook.announcementConfig.contentCreator.templateName,
      preview,
      message: 'Template preview generated successfully'
    });
  } catch (error) {
    console.error('Error generating template preview:', error);
    res.status(400).json({ error: error.message });
  }
});

// ===== MIGRATION ENDPOINT =====

// Migrate existing announcement webhooks from projectId to templateId
router.post('/webhooks/migrate-to-templates', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    
    // Only allow this for admin users or specific tenants
    if (!req.user.isAdmin && req.user.tenantId !== 'system') {
      return res.status(403).json({ error: 'Migration endpoint requires admin access' });
    }
    
    const migrationResult = await webhookModels.WebhookEndpoint.migrateAnnouncementConfigs(
      sequelize
    );
    
    res.json({
      message: 'Migration completed',
      migratedCount: migrationResult.migratedCount,
      errorCount: migrationResult.errorCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error during migration:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== UPDATED WEBHOOK CONFIGURATION ENDPOINTS =====

// Get webhook type configuration options (updated for templates)
router.get('/webhooks/types/config-options', authenticateToken, async (req, res) => {
  try {
    const configOptions = {
      go: {
        name: 'Go',
        description: 'Create leads and process them through journeys',
        configFields: [
          'fieldMapping',
          'validationRules',
          'autoTagRules',
          'autoEnrollJourneyId',
          'conditionalRules'
        ],
        defaultActions: ['create_lead', 'enroll_journey']
      },
      pause: {
        name: 'Pause',
        description: 'Pause existing leads and their journeys',
        configFields: [
          'fieldMapping',
          'pauseResumeConfig'
        ],
        resumeConditions: [
          { type: 'timer', label: 'Timer-based Resume', description: 'Resume after specified time delay' },
          { type: 'status', label: 'Status Change Resume', description: 'Resume when lead status changes' },
          { type: 'tag', label: 'Tag Change Resume', description: 'Resume when specific tags are added/removed' },
          { type: 'external', label: 'Manual Resume', description: 'Resume via API or manual trigger' }
        ]
      },
      stop: {
        name: 'Stop',
        description: 'Stop leads and exit them from journeys',
        configFields: [
          'fieldMapping',
          'stopConfig'
        ]
      },
      announcement: {
        name: 'Announcement',
        description: 'Create dynamic announcements using templates',
        configFields: [
          'templateId', // UPDATED: Use templateId instead of projectId
          'variableMapping',
          'defaultValues',
          'displaySelection',
          'takeover',
          'scheduling',
          'triggerConditions'
        ],
        templateFields: [
          'templateId',
          'variableMapping',
          'defaultValues'
        ],
        displayFields: [
          'displaySelection',
          'takeover',
          'scheduling'
        ],
        advancedFields: [
          'triggerConditions',
          'errorHandling',
          'metrics'
        ]
      }
    };
    
    res.json(configOptions);
  } catch (error) {
    console.error('Error getting config options:', error);
    res.status(400).json({ error: error.message });
  }
});
  
  // Get available action types (enhanced for webhook types)
  router.get('/webhooks/action-types', authenticateToken, async (req, res) => {
    try {
      const { webhookType } = req.query;
      
      const baseActionTypes = [
        {
          value: 'create_lead',
          label: 'Create Lead',
          description: 'Create a new lead with specified configuration',
          applicableTypes: ['go'],
          configSchema: {
            fieldMapping: 'object',
            brand: 'string',
            source: 'string',
            validationRules: 'object'
          }
        },
        {
          value: 'update_lead',
          label: 'Update Existing Lead',
          description: 'Update an existing lead based on search criteria',
          applicableTypes: ['go', 'pause', 'stop'],
          configSchema: {
            searchBy: {
              field: 'string',
              leadField: 'string'
            },
            updateFields: 'object'
          }
        },
        {
          value: 'pause_lead',
          label: 'Pause Lead',
          description: 'Pause lead and their active journeys',
          applicableTypes: ['pause'],
          configSchema: {
            pauseJourneys: 'boolean',
            addPauseTag: 'boolean',
            pauseTagName: 'string'
          }
        },
        {
          value: 'stop_lead',
          label: 'Stop Lead',
          description: 'Stop lead and exit from all journeys',
          applicableTypes: ['stop'],
          configSchema: {
            exitJourneys: 'boolean',
            markAsDNC: 'boolean',
            markAsSold: 'boolean',
            preventFutureEnrollment: 'boolean'
          }
        },
        {
          value: 'send_notification',
          label: 'Send Notification',
          description: 'Send email or SMS notification',
          applicableTypes: ['go', 'pause', 'stop'],
          configSchema: {
            recipients: 'array',
            message: 'string',
            method: 'string'
          }
        },
        {
          value: 'enroll_journey',
          label: 'Enroll in Journey',
          description: 'Enroll lead in a specific journey',
          applicableTypes: ['go'],
          configSchema: {
            journeyId: 'number',
            priority: 'string'
          }
        },
        {
          value: 'call_webhook',
          label: 'Call External Webhook',
          description: 'Make HTTP request to external webhook',
          applicableTypes: ['go', 'pause', 'stop'],
          configSchema: {
            url: 'string',
            method: 'string',
            headers: 'object',
            includeOriginalPayload: 'boolean',
            additionalData: 'object'
          }
        },
        {
          value: 'set_tags',
          label: 'Set Tags',
          description: 'Add or remove tags from leads',
          applicableTypes: ['go', 'pause', 'stop'],
          configSchema: {
            tags: 'array',
            operation: 'string'
          }
        },
        {
          value: 'create_task',
          label: 'Create Task',
          description: 'Create a task or reminder',
          applicableTypes: ['go', 'pause', 'stop'],
          configSchema: {
            taskType: 'string',
            assignTo: 'string',
            description: 'string',
            priority: 'string'
          }
        }
      ];
      
      // Filter by webhook type if specified
      let actionTypes = baseActionTypes;
      if (webhookType) {
        actionTypes = baseActionTypes.filter(action => 
          action.applicableTypes.includes(webhookType)
        );
      }
      
      res.json(actionTypes);
    } catch (error) {
      console.error('Error getting action types:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get execution log for a webhook event
  router.get('/webhooks/events/:eventId/execution-log', authenticateToken, async (req, res) => {
    try {
      const eventId = req.params.eventId;
      const tenantId = req.user.tenantId;
      
      const event = await webhookModels.WebhookEvent.findOne({
        where: { id: eventId },
        include: [{
          model: webhookModels.WebhookEndpoint,
          where: { tenantId },
          attributes: ['id', 'name', 'webhookType']
        }]
      });
      
      if (!event) {
        return res.status(404).json({ error: 'Webhook event not found' });
      }
      
      res.json({
        eventId: event.id,
        webhookName: event.WebhookEndpoint.name,
        webhookType: event.WebhookEndpoint.webhookType,
        status: event.status,
        receivedAt: event.receivedAt,
        processingTime: event.processingTime,
        executionLog: event.executionLog || {},
        payload: event.payload,
        createdLeadIds: event.createdLeadIds || [],
        affectedLeadIds: event.affectedLeadIds || [],
        pauseResumeActions: event.pauseResumeActions || {},
        stopActions: event.stopActions || {}
      });
    } catch (error) {
      console.error('Error getting execution log:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Register routes with app
  app.use('/api', router);
  
  console.log('Enhanced webhook routes registered successfully');
};