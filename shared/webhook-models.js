// shared/webhook-models.js
// Models for the webhook ingestion system with go/pause/stop/announcement configuration

module.exports = (sequelize, DataTypes) => {
  // Webhook endpoint configuration
  const WebhookEndpoint = sequelize.define('WebhookEndpoint', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    endpointKey: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    // UPDATED: Webhook type configuration with announcement support
    webhookType: {
      type: DataTypes.ENUM('go', 'pause', 'stop', 'announcement'),
      defaultValue: 'go',
      allowNull: false
    },
    brand: {
      type: DataTypes.STRING,
      allowNull: true
    },
    source: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Define how fields in the incoming webhook map to lead properties
    fieldMapping: {
      type: DataTypes.JSONB,
      defaultValue: {
        phone: 'phone',
        name: 'name',
        email: 'email'
      }
    },
    // Optional configuration for validating incoming data
    validationRules: {
      type: DataTypes.JSONB,
      defaultValue: {
        requirePhone: true,
        requireName: false,
        requireEmail: false,
        allowDuplicatePhone: false
      }
    },
    // Rules for automatically tagging leads
    autoTagRules: {
      type: DataTypes.JSONB,
      defaultValue: []
    },
    // Security token for webhook authentication
    securityToken: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Custom HTTP headers expected in the request
    requiredHeaders: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    // Sample payload for testing
    testPayload: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    // Optional auto-enrollment in a journey
    autoEnrollJourneyId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    // NEW: Announcement configuration for announcement webhooks
    announcementConfig: {
      type: DataTypes.JSONB,
      defaultValue: {
        enabled: false,
        // Content Creator Integration - UPDATED TO USE TEMPLATES
        contentCreator: {
          templateId: null, // Content creator TEMPLATE ID to use (changed from projectId)
          templateName: null, // Human-readable template name
          generateNewContent: true, // Whether to create new content or use existing
          // Map webhook payload fields to template variables
          variableMapping: {
            // Example: "rep_name": "rep_name"
            // Example: "deal_amount": "amount"
            // Example: "company_name": "company"
          },
          // Default values for variables if not found in payload
          defaultValues: {},
          // Content project settings (for generated projects)
          projectSettings: {
            name: "Webhook Announcement", // Default project name pattern
            addTimestamp: true, // Add timestamp to project name
            customNamePattern: null // Custom naming pattern with variables like "Deal Closed - {rep_name} - {company_name}"
          }
        },
        // OptiSigns Integration
        optisigns: {
          // Display selection
          displaySelection: {
            mode: 'all', // 'all', 'specific', 'group', 'conditional'
            displayIds: [], // Specific display IDs when mode is 'specific'
            displayGroups: [], // Display group names when mode is 'group'
            // Conditional display selection based on webhook data
            conditionalSelection: {
              enabled: false,
              conditions: [
                // Example: { field: 'location', operator: 'equals', value: 'office_main' }
              ]
            }
          },
          // Takeover configuration
          takeover: {
            priority: 'NORMAL', // 'LOW', 'NORMAL', 'HIGH', 'EMERGENCY'
            duration: 30, // Duration in seconds, null for permanent
            restoreAfter: true, // Restore original content after takeover
            interruptCurrent: true // Interrupt currently playing content
          },
          // Scheduling
          scheduling: {
            immediate: true, // Execute immediately
            delay: 0, // Delay in seconds before execution
            scheduledTime: null, // Specific time to execute (ISO string)
            timezone: 'UTC' // Timezone for scheduled execution
          }
        },
        // Advanced Configuration
        advanced: {
          // Trigger conditions
          triggerConditions: {
            enabled: false,
            // Time-based restrictions
            timeRestrictions: {
              enabled: false,
              allowedHours: { start: 9, end: 17 }, // 9 AM to 5 PM
              allowedDays: [1, 2, 3, 4, 5], // Monday to Friday (0 = Sunday)
              timezone: 'UTC'
            },
            // Rate limiting
            rateLimiting: {
              enabled: false,
              maxPerHour: 10,
              maxPerDay: 50,
              cooldownMinutes: 5 // Minimum time between announcements
            },
            // Payload-based conditions
            payloadConditions: {
              enabled: false,
              conditions: [
                // Example: { field: 'deal_amount', operator: 'greaterThan', value: 1000 }
              ]
            }
          },
          // Error handling
          errorHandling: {
            retryAttempts: 3,
            retryDelay: 5, // seconds
            fallbackTemplate: null, // Fallback template ID if primary fails
            notifyOnFailure: true
          },
          // Metrics and tracking
          metrics: {
            trackDisplayTime: true,
            trackViewCount: true,
            trackEngagement: false,
            customMetrics: {}
          }
        }
      }
    },
    // Enhanced conditional rules with action mapping
    conditionalRules: {
      type: DataTypes.JSONB,
      defaultValue: {
        enabled: false,
        logicOperator: 'AND', // AND | OR
        conditionSets: [
          // Example:
          // {
          //   name: 'High Value Deal',
          //   conditions: [
          //     { field: 'deal_amount', operator: 'greaterThan', value: 1000 }
          //   ],
          //   actions: [
          //     { type: 'create_lead', config: { brand: 'premium' } }
          //   ]
          // }
        ],
        defaultActions: [] // Actions to execute if no condition sets match
      }
    },
    // Enhanced pause/resume configuration for pause type webhooks
    pauseResumeConfig: {
      type: DataTypes.JSONB,
      defaultValue: {
        pauseConditions: {
          // When to pause leads
          leadStatus: [], // Pause leads with these statuses
          leadTags: [], // Pause leads with these tags
          fieldConditions: [] // Pause based on lead field values
        },
        resumeConditions: {
          // Automatic resume conditions
          timer: {
            enabled: false,
            duration: 24, // Hours
            units: 'hours' // hours, minutes, days
          },
          statusChange: {
            enabled: false,
            targetStatuses: [] // Resume when lead status changes to these
          },
          tagChange: {
            enabled: false,
            addedTags: [], // Resume when these tags are added
            removedTags: [] // Resume when these tags are removed
          },
          external: {
            enabled: true, // Allow manual resume via API
            webhookUrl: null // Optional webhook to call on resume
          }
        },
        pauseActions: {
          // What to do when pausing
          setStatus: null, // Set lead status to this
          addTags: [], // Add these tags
          removeFromJourneys: true, // Remove from active journeys
          notifyTeam: false // Send team notification
        }
      }
    },
    // Execution settings
    executionSettings: {
      type: DataTypes.JSONB,
      defaultValue: {
        stopOnFirstMatch: true, // Stop processing after first condition match
        executeDefaultOnNoMatch: true, // Execute default actions if no conditions match
        logExecution: true, // Log detailed execution steps
        timeoutMs: 30000 // Max execution time in milliseconds
      }
    }
  }, {
    tableName: 'WebhookEndpoints',
    indexes: [
      {
        fields: ['tenantId']
      },
      {
        fields: ['endpointKey'],
        unique: true
      },
      {
        fields: ['isActive']
      },
      {
        fields: ['webhookType']
      },
      {
        fields: ['tenantId', 'webhookType']
      }
    ]
  });

  // Webhook event log
  const WebhookEvent = sequelize.define('WebhookEvent', {
    webhookEndpointId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'WebhookEndpoints',
        key: 'id'
      }
    },
    status: {
      type: DataTypes.ENUM('success', 'partial_success', 'failed'),
      defaultValue: 'success'
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    createdLeadIds: {
      type: DataTypes.ARRAY(DataTypes.INTEGER),
      defaultValue: []
    },
    // Track affected leads for pause/stop actions
    affectedLeadIds: {
      type: DataTypes.ARRAY(DataTypes.INTEGER),
      defaultValue: []
    },
    // Track pause/resume actions
    pauseResumeActions: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    // Track stop actions
    stopActions: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    // NEW: Track announcement actions and results
    announcementActions: {
      type: DataTypes.JSONB,
      defaultValue: {
        contentCreated: false,
        contentProjectId: null,
        contentExportId: null,
        optisignsTakeoverId: null,
        displayIds: [],
        takeoverResults: [],
        announcementDuration: null,
        startTime: null,
        endTime: null,
        variablesInjected: {},
        errors: []
      }
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    receivedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    processingTime: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    executionLog: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    headers: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    tableName: 'WebhookEvents',
    indexes: [
      {
        fields: ['webhookEndpointId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['receivedAt']
      },
      {
        fields: ['webhookEndpointId', 'status']
      }
    ]
  });

  // Lead pause state tracking for pause/resume webhooks
  const LeadPauseState = sequelize.define('LeadPauseState', {
    leadId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Leads',
        key: 'id'
      }
    },
    webhookEndpointId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'WebhookEndpoints',
        key: 'id'
      }
    },
    pausedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    pauseReason: {
      type: DataTypes.STRING,
      allowNull: true
    },
    resumeConditions: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    scheduledResumeAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    resumedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    resumeReason: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'LeadPauseStates',
    indexes: [
      {
        fields: ['leadId']
      },
      {
        fields: ['webhookEndpointId']
      },
      {
        fields: ['isActive']
      },
      {
        fields: ['scheduledResumeAt']
      },
      {
        fields: ['leadId', 'isActive']
      }
    ]
  });

  // NEW: Announcement metrics tracking
  const AnnouncementMetric = sequelize.define('AnnouncementMetric', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    webhookEndpointId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'WebhookEndpoints',
        key: 'id'
      }
    },
    webhookEventId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'WebhookEvents',
        key: 'id'
      }
    },
    // Template and content tracking
    templateId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    contentProjectId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    contentExportId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    // OptiSigns integration tracking
    optisignsTakeoverId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    targetDisplayCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    successfulDisplayCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    failedDisplayCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    // Timing metrics
    announcementStartTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    announcementEndTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    totalDuration: {
      type: DataTypes.INTEGER, // Seconds
      allowNull: true
    },
    // Variable injection metrics
    variablesInjected: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    variablesMissing: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    // Performance metrics
    processingTime: {
      type: DataTypes.INTEGER, // Milliseconds
      allowNull: true
    },
    errors: {
      type: DataTypes.JSONB,
      defaultValue: []
    },
    // Additional metadata
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'AnnouncementMetrics',
    indexes: [
      {
        fields: ['tenantId']
      },
      {
        fields: ['webhookEndpointId']
      },
      {
        fields: ['webhookEventId']
      },
      {
        fields: ['announcementStartTime']
      },
      {
        fields: ['tenantId', 'webhookEndpointId']
      }
    ]
  });

  // Define relationships
  WebhookEndpoint.hasMany(WebhookEvent, { 
    foreignKey: 'webhookEndpointId',
    onDelete: 'CASCADE'
  });
  WebhookEvent.belongsTo(WebhookEndpoint, { 
    foreignKey: 'webhookEndpointId'
  });

  WebhookEndpoint.hasMany(LeadPauseState, {
    foreignKey: 'webhookEndpointId',
    onDelete: 'CASCADE'
  });
  LeadPauseState.belongsTo(WebhookEndpoint, {
    foreignKey: 'webhookEndpointId'
  });

  // NEW: Announcement metric relationships
  WebhookEndpoint.hasMany(AnnouncementMetric, {
    foreignKey: 'webhookEndpointId',
    onDelete: 'CASCADE'
  });
  AnnouncementMetric.belongsTo(WebhookEndpoint, {
    foreignKey: 'webhookEndpointId'
  });

  WebhookEvent.hasMany(AnnouncementMetric, {
    foreignKey: 'webhookEventId',
    onDelete: 'CASCADE'
  });
  AnnouncementMetric.belongsTo(WebhookEvent, {
    foreignKey: 'webhookEventId'
  });

  // ===== STATIC METHODS FOR MIGRATION AND VALIDATION =====

  /**
   * Migrate existing announcement configs from projectId to templateId
   * This should be run as a one-time migration
   */
  WebhookEndpoint.migrateAnnouncementConfigs = async function(sequelize) {
    try {
      console.log('🔄 Migrating announcement configurations from projectId to templateId...');
      
      const webhooks = await this.findAll({
        where: {
          webhookType: 'announcement',
          announcementConfig: {
            enabled: true
          }
        }
      });
      
      let migratedCount = 0;
      let errorCount = 0;
      
      for (const webhook of webhooks) {
        try {
          const config = webhook.announcementConfig;
          
          // Check if this webhook is using the old projectId format
          if (config.contentCreator?.projectId && !config.contentCreator?.templateId) {
            const projectId = config.contentCreator.projectId;
            
            // Try to find the template that was used to create this project
            const project = await sequelize.models.ContentProject?.findByPk(projectId);
            
            if (project && project.templateId) {
              // Update the configuration to use templateId
              config.contentCreator.templateId = project.templateId;
              config.contentCreator.templateName = project.template?.name || 'Migrated Template';
              
              // Remove the old projectId field
              delete config.contentCreator.projectId;
              
              // Save the updated configuration
              await webhook.update({
                announcementConfig: config
              });
              
              migratedCount++;
              console.log(`✅ Migrated webhook "${webhook.name}" from project ${projectId} to template ${project.templateId}`);
              
            } else {
              console.warn(`⚠️ Could not find template for project ${projectId} in webhook "${webhook.name}"`);
              errorCount++;
            }
          }
        } catch (error) {
          console.error(`❌ Error migrating webhook "${webhook.name}":`, error.message);
          errorCount++;
        }
      }
      
      console.log(`✅ Migration completed: ${migratedCount} migrated, ${errorCount} errors`);
      return { migratedCount, errorCount };
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  };

  /**
   * Validate announcement configuration
   */
  WebhookEndpoint.validateAnnouncementConfig = function(config) {
    const errors = [];
    
    if (!config || typeof config !== 'object') {
      errors.push('Announcement config must be an object');
      return errors;
    }
    
    // Validate content creator config
    if (config.contentCreator) {
      const cc = config.contentCreator;
      
      // Check for templateId (new required field)
      if (!cc.templateId) {
        errors.push('contentCreator.templateId is required');
      }
      
      // Check for old projectId field
      if (cc.projectId) {
        errors.push('contentCreator.projectId is deprecated, use templateId instead');
      }
      
      // Validate variable mapping
      if (cc.variableMapping && typeof cc.variableMapping !== 'object') {
        errors.push('contentCreator.variableMapping must be an object');
      }
      
      // Validate default values
      if (cc.defaultValues && typeof cc.defaultValues !== 'object') {
        errors.push('contentCreator.defaultValues must be an object');
      }
    }
    
    // Validate OptiSigns config
    if (config.optisigns) {
      const os = config.optisigns;
      
      // Validate display selection
      if (os.displaySelection) {
        const validModes = ['all', 'specific', 'group', 'conditional'];
        if (!validModes.includes(os.displaySelection.mode)) {
          errors.push(`Invalid displaySelection.mode, must be one of: ${validModes.join(', ')}`);
        }
        
        if (os.displaySelection.mode === 'specific' && (!os.displaySelection.displayIds || !Array.isArray(os.displaySelection.displayIds))) {
          errors.push('displaySelection.displayIds must be an array when mode is "specific"');
        }
      }
      
      // Validate takeover config
      if (os.takeover) {
        const validPriorities = ['LOW', 'NORMAL', 'HIGH', 'EMERGENCY'];
        if (os.takeover.priority && !validPriorities.includes(os.takeover.priority)) {
          errors.push(`Invalid takeover.priority, must be one of: ${validPriorities.join(', ')}`);
        }
        
        if (os.takeover.duration && (typeof os.takeover.duration !== 'number' || os.takeover.duration <= 0)) {
          errors.push('takeover.duration must be a positive number');
        }
      }
    }
    
    return errors;
  };

  /**
   * Get default announcement configuration for templates
   */
  WebhookEndpoint.getDefaultAnnouncementConfig = function() {
    return {
      enabled: false,
      contentCreator: {
        templateId: null,
        templateName: null,
        generateNewContent: true,
        variableMapping: {},
        defaultValues: {},
        projectSettings: {
          name: "Webhook Announcement",
          addTimestamp: true,
          customNamePattern: null
        }
      },
      optisigns: {
        displaySelection: {
          mode: 'all',
          displayIds: [],
          displayGroups: [],
          conditionalSelection: {
            enabled: false,
            conditions: []
          }
        },
        takeover: {
          priority: 'NORMAL',
          duration: 30,
          restoreAfter: true,
          interruptCurrent: true
        },
        scheduling: {
          immediate: true,
          delay: 0,
          scheduledTime: null,
          timezone: 'UTC'
        }
      },
      advanced: {
        triggerConditions: {
          enabled: false,
          timeRestrictions: {
            enabled: false,
            allowedHours: { start: 9, end: 17 },
            allowedDays: [1, 2, 3, 4, 5],
            timezone: 'UTC'
          },
          rateLimiting: {
            enabled: false,
            maxPerHour: 10,
            maxPerDay: 50,
            cooldownMinutes: 5
          },
          payloadConditions: {
            enabled: false,
            conditions: []
          }
        },
        errorHandling: {
          retryAttempts: 3,
          retryDelay: 5,
          fallbackTemplate: null,
          notifyOnFailure: true
        },
        metrics: {
          trackDisplayTime: true,
          trackViewCount: true,
          trackEngagement: false,
          customMetrics: {}
        }
      }
    };
  };

  return {
    WebhookEndpoint,
    WebhookEvent,
    LeadPauseState,
    AnnouncementMetric
  };
};