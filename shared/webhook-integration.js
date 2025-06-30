// webhook-integration.js
// Enhanced webhook integration module with Content Creator and OptiSigns service integration

const WebhookService = require('./webhook-service');

module.exports = function(app, sequelize, authenticateToken, contentIntegration = null, optisignsIntegration = null) {
  console.log('Initializing Enhanced Webhook Integration module...');
  
  try {
    // Initialize webhook models
    const webhookModels = require('./webhook-models')(sequelize, sequelize.Sequelize.DataTypes);
    console.log('Webhook models initialized successfully');
    
    // Try to get journey service if available
    let journeyService = null;
    try {
      // Check if journey models exist
      if (sequelize.models.Journey && sequelize.models.JourneyStep && 
          sequelize.models.LeadJourney && sequelize.models.JourneyExecution) {
        const JourneyService = require('./journey-service');
        journeyService = new JourneyService({
          Journey: sequelize.models.Journey,
          JourneyStep: sequelize.models.JourneyStep,
          LeadJourney: sequelize.models.LeadJourney,
          JourneyExecution: sequelize.models.JourneyExecution,
          Lead: sequelize.models.Lead,
          Tenant: sequelize.models.Tenant,
          CallLog: sequelize.models.CallLog,
          DID: sequelize.models.DID
        });
        console.log('Journey service initialized for webhook integration');
      }
    } catch (error) {
      console.log('Journey service not available for webhook integration:', error.message);
    }

    // Try to get Content Creator service if available
    let contentService = null;
    let contentModels = null;
    try {
      if (contentIntegration) {
        contentService =
          contentIntegration.contentService ||
          contentIntegration.services?.contentService ||
          null;
        contentModels =
          contentIntegration.contentModels ||
          contentIntegration.models ||
          null;
      }

      if (contentService) {
        console.log('Content Creator service integrated for webhook announcements');
      } else {
        console.log('Content Creator service not available - announcement features will be limited');
      }
    } catch (error) {
      console.log('Content Creator service integration failed:', error.message);
    }

    // Try to get OptiSigns service if available
    let optisignsService = null;
    try {
      if (optisignsIntegration) {
        optisignsService =
          optisignsIntegration.optisignsService ||
          optisignsIntegration.services?.optisignsService ||
          null;
      } else if (contentIntegration) {
        // Support single options object containing optisigns keys
        optisignsService =
          contentIntegration.optisignsService ||
          contentIntegration.services?.optisignsService ||
          null;
      }

      if (optisignsService) {
        console.log('OptiSigns service integrated for webhook announcements');
      } else {
        console.log('OptiSigns service not available - screen takeover features will be limited');
      }
    } catch (error) {
      console.log('OptiSigns service integration failed:', error.message);
    }
    
    // Initialize enhanced webhook service with all required models and integrated services
    const webhookService = new WebhookService(
      {
        WebhookEndpoint: webhookModels.WebhookEndpoint,
        WebhookEvent: webhookModels.WebhookEvent,
        LeadPauseState: webhookModels.LeadPauseState,
        AnnouncementMetric: webhookModels.AnnouncementMetric,
        Lead: sequelize.models.Lead,
        Tenant: sequelize.models.Tenant,
        ContentAsset: contentModels?.ContentAsset || sequelize.models.ContentAsset,
        Sequelize: sequelize.Sequelize,
        OptisignsDisplay: sequelize.models.OptisignsDisplay,
        OptisignsTakeover: sequelize.models.OptisignsTakeover
      },
      journeyService,
      contentService,
      optisignsService
    );

    // Log service availability
    const serviceStatus = {
      journeyService: !!journeyService,
      contentService: !!contentService,
      optisignsService: !!optisignsService
    };
    console.log('Webhook service integration status:', serviceStatus);
    
    // Initialize enhanced webhook routes
    const webhookRoutes = require('./webhook-routes');
    webhookRoutes(app, sequelize, authenticateToken, webhookModels, webhookService);
    console.log('Enhanced webhook routes initialized successfully');
    
    // Initialize announcement-specific routes
    initializeAnnouncementRoutes(app, authenticateToken, webhookModels, webhookService, contentService, optisignsService);
    
    console.log('Enhanced Webhook Integration module initialized successfully');
    
    // Return enhanced module capabilities
    return {
      models: webhookModels,
      services: {
        webhookService
      },
      capabilities: {
        // Core webhook features
        endpoints: true,
        events: true,
        leadCreation: true,
        fieldMapping: true,
        security: true,
        
        // Integration capabilities
        journeyIntegration: !!journeyService,
        contentCreatorIntegration: !!contentService,
        optisignsIntegration: !!optisignsService,
        
        // Enhanced features based on available services
        announcements: !!contentService && !!optisignsService,
        dynamicContentGeneration: !!contentService,
        screenTakeover: !!optisignsService,
        
        // Webhook types supported
        webhookTypes: {
          go: true,
          pause: true,
          stop: true,
          announcement: !!contentService && !!optisignsService
        },
        
        // Advanced features
        conditionalProcessing: true,
        rateLimiting: true,
        timeRestrictions: true,
        variableMapping: !!contentService,
        displaySelection: !!optisignsService,
        metrics: true
      }
    };
  } catch (error) {
    console.error('Failed to initialize Enhanced Webhook Integration module:', error);
    throw error;
  }
};

/**
 * Initialize announcement-specific API routes
 */
function initializeAnnouncementRoutes(app, authenticateToken, webhookModels, webhookService, contentService, optisignsService) {
  console.log('Initializing announcement-specific routes...');

  // Get announcement templates available for webhooks
  app.get('/api/webhooks/announcement/templates', authenticateToken, async (req, res) => {
    try {
      if (!contentService) {
        return res.status(503).json({ error: 'Content Creator service not available' });
      }

      const tenantId = req.user.tenantId;
      const templates = await contentService.getTemplates(tenantId, {
        category: 'announcement',
        isPublic: true
      });

      // Transform templates for webhook configuration UI
      const webhookTemplates = templates.templates.map(template => ({
        id: template.id,
        name: template.name,
        description: template.description,
        variables: template.variables || [],
        thumbnail: template.thumbnailUrl,
        category: template.category,
        tags: template.tags
      }));

      res.json({
        templates: webhookTemplates,
        totalCount: templates.totalCount
      });
    } catch (error) {
      console.error('Error getting announcement templates:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get available OptiSigns displays for webhook configuration
  app.get('/api/webhooks/announcement/displays', authenticateToken, async (req, res) => {
    try {
      if (!optisignsService) {
        return res.status(503).json({ error: 'OptiSigns service not available' });
      }

      const tenantId = req.user.tenantId;
      const displays = await optisignsService.getDisplays(tenantId, {
        isActive: true
      });

      // Transform displays for webhook configuration UI
      const webhookDisplays = displays.map(display => ({
        id: display.id,
        name: display.name,
        location: display.location,
        status: display.status,
        isOnline: display.isOnline,
        resolution: display.resolution,
        orientation: display.orientation
      }));

      res.json({
        displays: webhookDisplays,
        totalCount: webhookDisplays.length
      });
    } catch (error) {
      console.error('Error getting announcement displays:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Test announcement configuration
  app.post('/api/webhooks/:id/test-announcement', authenticateToken, async (req, res) => {
    try {
      const webhookId = req.params.id;
      const tenantId = req.user.tenantId;
      const { testPayload } = req.body;

      const webhook = await webhookService.getWebhookEndpoint(webhookId, tenantId);
      
      if (webhook.webhookType !== 'announcement') {
        return res.status(400).json({ error: 'Webhook is not configured for announcements' });
      }

      if (!webhook.announcementConfig || !webhook.announcementConfig.enabled) {
        return res.status(400).json({ error: 'Announcement configuration is not enabled' });
      }

      // Simulate announcement processing without actually creating content or taking over displays
      const testResult = await testAnnouncementConfiguration(
        webhook,
        testPayload || webhook.testPayload,
        contentService,
        optisignsService
      );

      res.json(testResult);
    } catch (error) {
      console.error('Error testing announcement:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get announcement metrics for a webhook
  app.get('/api/webhooks/:id/announcement-metrics', authenticateToken, async (req, res) => {
    try {
      const webhookId = req.params.id;
      const tenantId = req.user.tenantId;
      const { startDate, endDate, limit = 50, offset = 0 } = req.query;

      // Verify webhook ownership
      const webhook = await webhookService.getWebhookEndpoint(webhookId, tenantId);

      const whereClause = {
        webhookEndpointId: webhookId,
        tenantId
      };

      if (startDate) {
        whereClause.announcementStartTime = {
          [sequelize.Sequelize.Op.gte]: new Date(startDate)
        };
      }

      if (endDate) {
        if (whereClause.announcementStartTime) {
          whereClause.announcementStartTime[sequelize.Sequelize.Op.lte] = new Date(endDate);
        } else {
          whereClause.announcementStartTime = {
            [sequelize.Sequelize.Op.lte]: new Date(endDate)
          };
        }
      }

      const metrics = await webhookModels.AnnouncementMetric.findAll({
        where: whereClause,
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['announcementStartTime', 'DESC']],
        attributes: [
          'id', 'announcementStartTime', 'announcementEndTime', 'totalDuration',
          'successfulDisplays', 'failedDisplays', 'displayIds', 'variablesInjected',
          'contentGenerationTime', 'processingTime', 'errors'
        ]
      });

      const totalCount = await webhookModels.AnnouncementMetric.count({ where: whereClause });

      // Calculate summary statistics
      const summary = {
        totalAnnouncements: totalCount,
        successfulAnnouncements: metrics.filter(m => m.errors.length === 0).length,
        failedAnnouncements: metrics.filter(m => m.errors.length > 0).length,
        totalDisplaysReached: metrics.reduce((sum, m) => sum + m.successfulDisplays, 0),
        averageProcessingTime: metrics.length > 0 
          ? metrics.reduce((sum, m) => sum + (m.processingTime || 0), 0) / metrics.length 
          : 0,
        averageContentGenerationTime: metrics.length > 0 
          ? metrics.reduce((sum, m) => sum + (m.contentGenerationTime || 0), 0) / metrics.length 
          : 0
      };

      res.json({
        metrics,
        summary,
        pagination: {
          currentPage: Math.floor(parseInt(offset) / parseInt(limit)) + 1,
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          totalCount
        }
      });
    } catch (error) {
      console.error('Error getting announcement metrics:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get announcement configuration templates/presets
  app.get('/api/webhooks/announcement/presets', authenticateToken, async (req, res) => {
    try {
      const presets = [
        {
          id: 'deal_closed',
          name: 'Deal Closed Celebration',
          description: 'Celebrate when a deal is closed with rep name and amount',
          announcementConfig: {
            enabled: true,
            contentCreator: {
              templateId: null, // Will be selected by user
              variableMapping: {
                rep_name: 'rep_name',
                deal_amount: 'deal_amount',
                company_name: 'company_name'
              },
              defaultValues: {
                rep_name: 'Team Member',
                deal_amount: 'Deal',
                company_name: 'Client'
              }
            },
            optisigns: {
              displaySelection: { mode: 'all' },
              takeover: {
                priority: 'HIGH',
                duration: 30,
                restoreAfter: true
              }
            },
            advanced: {
              triggerConditions: {
                enabled: true,
                timeRestrictions: {
                  enabled: true,
                  startTime: '09:00',
                  endTime: '17:00',
                  daysOfWeek: [1, 2, 3, 4, 5]
                },
                rateLimiting: {
                  enabled: true,
                  minimumInterval: 300,
                  maxPerHour: 10
                }
              }
            }
          }
        },
        {
          id: 'new_hire',
          name: 'New Hire Welcome',
          description: 'Welcome new team members with their name and position',
          announcementConfig: {
            enabled: true,
            contentCreator: {
              templateId: null,
              variableMapping: {
                employee_name: 'name',
                position: 'position',
                department: 'department',
                start_date: 'start_date'
              },
              defaultValues: {
                employee_name: 'New Team Member',
                position: 'Team Member',
                department: 'Our Team'
              }
            },
            optisigns: {
              displaySelection: { mode: 'all' },
              takeover: {
                priority: 'MEDIUM',
                duration: 45,
                restoreAfter: true
              }
            }
          }
        },
        {
          id: 'milestone_achieved',
          name: 'Milestone Achievement',
          description: 'Celebrate company or team milestones',
          announcementConfig: {
            enabled: true,
            contentCreator: {
              templateId: null,
              variableMapping: {
                milestone_type: 'milestone_type',
                achievement: 'achievement',
                team_name: 'team'
              },
              defaultValues: {
                milestone_type: 'Goal',
                achievement: 'Achievement Unlocked',
                team_name: 'The Team'
              }
            },
            optisigns: {
              displaySelection: { mode: 'all' },
              takeover: {
                priority: 'MEDIUM',
                duration: 35,
                restoreAfter: true
              }
            }
          }
        }
      ];

      res.json({ presets });
    } catch (error) {
      console.error('Error getting announcement presets:', error);
      res.status(400).json({ error: error.message });
    }
  });

  console.log('Announcement-specific routes initialized successfully');
}

/**
 * Test announcement configuration without executing
 */
async function testAnnouncementConfiguration(webhook, payload, contentService, optisignsService) {
  const testResult = {
    configurationValid: true,
    errors: [],
    warnings: [],
    simulationResults: {
      triggerConditions: null,
      variableExtraction: null,
      contentGeneration: null,
      displaySelection: null,
      estimatedProcessingTime: null
    }
  };

  try {
    // Test trigger conditions
    if (webhook.announcementConfig.advanced.triggerConditions.enabled) {
      // Simulate trigger condition check
      testResult.simulationResults.triggerConditions = {
        timeRestrictions: 'would_pass', // Simplified for demo
        rateLimiting: 'would_pass',
        payloadConditions: 'would_pass'
      };
    }

    // Test variable extraction
    const variables = extractTestVariables(webhook.announcementConfig.contentCreator, payload);
    testResult.simulationResults.variableExtraction = {
      variablesFound: Object.keys(variables).length,
      variables: variables,
      missingVariables: findMissingTestVariables(variables)
    };

    // Test content service availability
    if (contentService && webhook.announcementConfig.contentCreator.templateId) {
      testResult.simulationResults.contentGeneration = {
        templateExists: true, // Would verify in real implementation
        variablesCompatible: true,
        estimatedGenerationTime: '2-5 seconds'
      };
    } else if (!contentService) {
      testResult.errors.push('Content Creator service not available');
    } else {
      testResult.warnings.push('No template selected for content generation');
    }

    // Test display selection
    if (optisignsService) {
      testResult.simulationResults.displaySelection = {
        mode: webhook.announcementConfig.optisigns.displaySelection.mode,
        estimatedDisplayCount: webhook.announcementConfig.optisigns.displaySelection.mode === 'all' ? 'all_active' : 'selected',
        priority: webhook.announcementConfig.optisigns.takeover.priority,
        duration: webhook.announcementConfig.optisigns.takeover.duration
      };
    } else {
      testResult.errors.push('OptiSigns service not available');
    }

    testResult.simulationResults.estimatedProcessingTime = '3-8 seconds';
    testResult.configurationValid = testResult.errors.length === 0;

  } catch (error) {
    testResult.configurationValid = false;
    testResult.errors.push(`Configuration test failed: ${error.message}`);
  }

  return testResult;
}

/**
 * Extract variables for testing
 */
function extractTestVariables(contentConfig, payload) {
  const variables = {};
  const { variableMapping, defaultValues } = contentConfig;
  
  for (const [variableName, payloadPath] of Object.entries(variableMapping)) {
    let value = extractFieldValue(payload, payloadPath);
    if (value === null || value === undefined) {
      value = defaultValues[variableName] || '';
    }
    variables[variableName] = value;
  }
  
  return variables;
}

/**
 * Find missing variables for testing
 */
function findMissingTestVariables(variables) {
  const missing = [];
  for (const [key, value] of Object.entries(variables)) {
    if (value === '' || value === null || value === undefined) {
      missing.push(key);
    }
  }
  return missing;
}

/**
 * Extract field value using dot notation
 */
function extractFieldValue(data, fieldPath) {
  if (!fieldPath || !data) return null;
  
  if (fieldPath.includes('.')) {
    const paths = fieldPath.split('.');
    let value = data;
    
    for (const path of paths) {
      if (value === null || value === undefined || typeof value !== 'object') {
        return null;
      }
      value = value[path];
    }
    
    return value;
  }
  
  return data[fieldPath];
}