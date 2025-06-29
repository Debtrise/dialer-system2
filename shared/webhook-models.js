// webhook-models.js
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
        // Content Creator Integration
        contentCreator: {
          templateId: null, // Content creator template ID to use
          templateName: null, // Human-readable template name
          generateNewContent: true, // Whether to create new content or use existing
          // Map webhook payload fields to content variables
          variableMapping: {
            // Example: "rep_name": "payload.rep_name"
            // Example: "deal_amount": "payload.amount"
            // Example: "company_name": "payload.company"
          },
          // Default values for variables if not found in payload
          defaultValues: {},
          // Content project settings
          projectSettings: {
            name: "Webhook Announcement", // Default project name pattern
            addTimestamp: true, // Add timestamp to project name
            customNamePattern: null // Custom naming pattern with variables
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
            conditionalRules: {
              enabled: false,
              conditions: [
                // Example: { field: "region", operator: "equals", value: "west", displayIds: ["display1", "display2"] }
              ]
            }
          },
          // Takeover settings
          takeover: {
            priority: 'HIGH', // 'LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'
            duration: 30, // Duration in seconds (null for indefinite)
            restoreAfter: true, // Restore previous content after duration
            immediateDisplay: true, // Display immediately or queue
            // Override existing takeovers
            overrideTakeovers: {
              enabled: false,
              allowedPriorities: ['LOW', 'MEDIUM'] // Only override these priority levels
            }
          },
          // Content display settings
          display: {
            fadeTransition: true, // Use fade transition
            transitionDuration: 1000, // Transition duration in milliseconds
            backgroundMusic: false, // Play background music/sound
            soundEffects: {
              enabled: false,
              playOnStart: null, // Sound file to play when announcement starts
              playOnEnd: null // Sound file to play when announcement ends
            }
          }
        },
        // Advanced announcement settings
        advanced: {
          // Conditions for triggering announcement
          triggerConditions: {
            enabled: false,
            // Only trigger during certain hours
            timeRestrictions: {
              enabled: false,
              startTime: "09:00", // Format: "HH:MM"
              endTime: "17:00",
              timezone: "America/New_York",
              daysOfWeek: [1, 2, 3, 4, 5] // Monday = 1, Sunday = 7
            },
            // Minimum time between announcements
            rateLimiting: {
              enabled: false,
              minimumInterval: 300, // Seconds between announcements
              maxPerHour: 10, // Maximum announcements per hour
              maxPerDay: 50 // Maximum announcements per day
            },
            // Field-based conditions
            payloadConditions: {
              enabled: false,
              conditions: [
                // Example: { field: "deal_amount", operator: "greater_than", value: 10000 }
              ]
            }
          },
          // Post-announcement actions
          postAnnouncementActions: {
            enabled: false,
            actions: [
              // Example: { type: "create_lead", config: {...} }
              // Example: { type: "send_notification", config: {...} }
              // Example: { type: "log_event", config: {...} }
            ]
          },
          // Logging and analytics
          analytics: {
            trackViews: true, // Track how many displays showed the announcement
            trackDuration: true, // Track how long announcement was displayed
            trackEngagement: false, // Track user interaction (if applicable)
            saveMetrics: true // Save metrics to database
          }
        }
      }
    },
    // Pause/Resume configuration for pause webhooks
    pauseResumeConfig: {
      type: DataTypes.JSONB,
      defaultValue: {
        enabled: false,
        resumeConditions: {
          // Timer-based resume
          timerResume: {
            enabled: false,
            delayMinutes: 60,
            delayHours: 0,
            delayDays: 0
          },
          // Status change resume
          statusResume: {
            enabled: false,
            targetStatuses: [], // ['contacted', 'qualified', etc.]
            checkInterval: 300 // Check every 5 minutes
          },
          // Tag-based resume
          tagResume: {
            enabled: false,
            requiredTags: [], // Resume when lead has these tags
            excludeTags: [], // Don't resume if lead has these tags
            checkInterval: 300
          },
          // Custom field resume
          customFieldResume: {
            enabled: false,
            conditions: [
              // { field: 'status', operator: 'equals', value: 'qualified' }
            ],
            checkInterval: 300
          }
        },
        // Actions to execute on pause
        pauseActions: {
          stopCalls: true,
          stopSms: true,
          stopEmails: false, // Often want to keep emails going
          addTags: [], // Tags to add when paused
          updateCustomFields: {} // Custom fields to update
        },
        // Actions to execute on resume
        resumeActions: {
          resumeCalls: true,
          resumeSms: true,
          resumeEmails: true,
          removeTags: [], // Tags to remove when resumed
          addTags: [], // Tags to add when resumed
          triggerJourney: null, // Journey ID to trigger on resume
          updateCustomFields: {} // Custom fields to update
        }
      }
    },
    // Enhanced conditional execution with multiple condition sets
    conditionalExecution: {
      type: DataTypes.JSONB,
      defaultValue: {
        enabled: false,
        logicOperator: 'AND', // AND/OR for multiple condition sets
        conditionSets: [],
        defaultActions: [
          {
            type: "create_lead",
            config: {}
          }
        ]
      }
    },
    // Execution settings
    executionSettings: {
      type: DataTypes.JSONB,
      defaultValue: {
        stopOnFirstMatch: true, // Stop processing after first condition set matches
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
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true
    },
    processingTime: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Processing time in milliseconds'
    },
    // Detailed execution log for debugging
    executionLog: {
      type: DataTypes.JSONB,
      defaultValue: {}
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

  // Track lead pause states for pause/resume functionality
  const LeadPauseState = sequelize.define('LeadPauseState', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    leadId: {
      type: DataTypes.INTEGER,
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
    status: {
      type: DataTypes.ENUM('paused', 'scheduled_resume', 'resumed', 'stopped'),
      allowNull: false
    },
    pausedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    resumeScheduledAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    resumedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    pauseReason: {
      type: DataTypes.STRING,
      allowNull: true
    },
    resumeReason: {
      type: DataTypes.STRING,
      allowNull: true
    },
    pauseMetadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    // Track which journeys were affected
    affectedJourneyIds: {
      type: DataTypes.ARRAY(DataTypes.INTEGER),
      defaultValue: []
    },
    // Resume conditions tracking
    resumeConditionsCheck: {
      type: DataTypes.JSONB,
      defaultValue: {
        lastStatusCheck: null,
        lastTagCheck: null,
        conditionsMet: false,
        checkAttempts: 0
      }
    }
  }, {
    tableName: 'LeadPauseStates',
    indexes: [
      {
        fields: ['tenantId']
      },
      {
        fields: ['leadId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['resumeScheduledAt']
      },
      {
        fields: ['tenantId', 'status']
      }
    ]
  });

  // NEW: Track announcement analytics and metrics
  const AnnouncementMetric = sequelize.define('AnnouncementMetric', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
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
    // Content creator metrics
    contentProjectId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    contentExportId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    contentGenerationTime: {
      type: DataTypes.INTEGER, // Milliseconds
      allowNull: true
    },
    // OptiSigns metrics
    displayIds: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    takeoverIds: {
      type: DataTypes.ARRAY(DataTypes.UUID),
      defaultValue: []
    },
    successfulDisplays: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    failedDisplays: {
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

  return {
    WebhookEndpoint,
    WebhookEvent,
    LeadPauseState,
    AnnouncementMetric
  };
};