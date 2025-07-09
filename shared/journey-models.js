/// journey-models.js
// FIXED: Proper model initialization and relationships

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  // Check if models already exist to prevent duplicate declarations
  if (sequelize.models.Journey && sequelize.models.JourneyStep && 
      sequelize.models.LeadJourney && sequelize.models.JourneyExecution) {
    console.log('Journey models already initialized, returning existing models');
    return {
      Journey: sequelize.models.Journey,
      JourneyStep: sequelize.models.JourneyStep,
      LeadJourney: sequelize.models.LeadJourney,
      JourneyExecution: sequelize.models.JourneyExecution
    };
  }

  // Journey Model - Template for lead progression
  const Journey = sequelize.define('Journey', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    // Number of days to repeat the journey. If null or 0, no repetition
    repeatDays: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null
    },
    triggerCriteria: {
      type: DataTypes.JSONB,
      defaultValue: {
        leadStatus: ['pending'],
        leadTags: [],
        leadAgeDays: {
          min: 0,
          max: null
        },
        brands: [],
        sources: [],
        autoEnroll: false
      }
    }
  }, {
    tableName: 'Journeys',
    indexes: [
      {
        fields: ['tenantId', 'isActive']
      }
    ]
  });

  // Journey Step Model - Individual actions in a journey
  const JourneyStep = sequelize.define('JourneyStep', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    journeyId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Journeys',
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    stepOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    actionType: {
      // Supported actions currently implemented by JourneyService
      type: DataTypes.ENUM(
        'call',
        'sms',
        'email',
        'status_change',
        'tag_update',
        'webhook',
        'delay'
      ),
      allowNull: false
    },
    actionConfig: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    delayType: {
      type: DataTypes.ENUM('immediate', 'fixed_time', 'delay_after_previous', 
                           'delay_after_enrollment', 'specific_days'),
      defaultValue: 'immediate'
    },
    delayConfig: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    conditions: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    isExitPoint: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    // Marks the end of a logical day within the journey
    isDayEnd: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  }, {
    tableName: 'JourneySteps',
    indexes: [
      {
        fields: ['journeyId', 'stepOrder']
      }
    ]
  });

  // Lead Journey Model - Tracks lead progress through journeys
  const LeadJourney = sequelize.define('LeadJourney', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    leadId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Leads',
        key: 'id'
      }
    },
    journeyId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Journeys',
        key: 'id'
      }
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true
    },
    status: {
      type: DataTypes.ENUM('active', 'paused', 'completed', 'failed', 'exited'),
      defaultValue: 'active'
    },
    currentStepId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'JourneySteps',
        key: 'id'
      }
    },
    startedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    nextExecutionTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastExecutionTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    executionHistory: {
      type: DataTypes.JSONB,
      defaultValue: []
    },
    contextData: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'LeadJourneys',
    indexes: [
      {
        fields: ['leadId', 'journeyId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['nextExecutionTime']
      },
      {
        fields: ['tenantId']
      }
    ]
  });

  // Journey Execution Model - Scheduled actions  
  const JourneyExecution = sequelize.define('JourneyExecution', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    leadJourneyId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'LeadJourneys',
        key: 'id'
      }
    },
    stepId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'JourneySteps',
        key: 'id'
      }
    },
    scheduledTime: {
      type: DataTypes.DATE,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed', 'cancelled'),
      defaultValue: 'pending'
    },
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    lastAttempt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    result: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'JourneyExecutions',
    indexes: [
      {
        fields: ['leadJourneyId', 'status']
      },
      {
        fields: ['scheduledTime', 'status']
      }
    ]
  });

  // FIXED: Define relationships in correct order with proper error handling
  try {
    // Journey -> JourneyStep relationship
    Journey.hasMany(JourneyStep, { 
      foreignKey: 'journeyId',
      as: 'steps',
      onDelete: 'CASCADE'
    });

    JourneyStep.belongsTo(Journey, { 
      foreignKey: 'journeyId',
      as: 'journey'
    });

    // Journey -> LeadJourney relationship
    Journey.hasMany(LeadJourney, { 
      foreignKey: 'journeyId',
      as: 'leadJourneys',
      onDelete: 'CASCADE'
    });

    LeadJourney.belongsTo(Journey, { 
      foreignKey: 'journeyId',
      as: 'journey'
    });

    // LeadJourney -> JourneyStep relationship (current step)
    LeadJourney.belongsTo(JourneyStep, { 
      as: 'currentStep', 
      foreignKey: 'currentStepId'
    });

    // LeadJourney -> JourneyExecution relationship
    LeadJourney.hasMany(JourneyExecution, { 
      foreignKey: 'leadJourneyId',
      as: 'executions',
      onDelete: 'CASCADE'
    });

    // FIXED: Correct relationship definitions
    JourneyExecution.belongsTo(LeadJourney, { 
      foreignKey: 'leadJourneyId',
      as: 'leadJourney'
    });

    JourneyExecution.belongsTo(JourneyStep, { 
      foreignKey: 'stepId',
      as: 'step'
    });

    JourneyStep.hasMany(JourneyExecution, { 
      foreignKey: 'stepId',
      as: 'executions'
    });

    console.log('✅ Journey model relationships defined successfully');

  } catch (relationshipError) {
    console.error('❌ Error defining journey model relationships:', relationshipError);
  }

  // FIXED: Set up Lead associations with proper deferred loading
  const setupLeadRelationships = () => {
    try {
      if (sequelize.models.Lead) {
        const Lead = sequelize.models.Lead;
        
        // Check if associations already exist
        if (!Lead.associations.leadJourneys) {
          LeadJourney.belongsTo(Lead, {
            foreignKey: 'leadId',
            as: 'lead'
          });
          
          Lead.hasMany(LeadJourney, {
            foreignKey: 'leadId',
            as: 'leadJourneys'
          });
          
          console.log('✅ Lead-Journey relationships established');
        } else {
          console.log('ℹ️ Lead-Journey relationships already exist');
        }
      } else {
        console.log('⚠️ Lead model not found, will retry after models are loaded');
        // Retry after a short delay
        setTimeout(setupLeadRelationships, 1000);
      }
    } catch (leadRelationshipError) {
      console.error('❌ Error setting up Lead relationships:', leadRelationshipError);
    }
  };

  // Setup relationships now or later
  setupLeadRelationships();

  return {
    Journey,
    JourneyStep,
    LeadJourney,
    JourneyExecution
  };
};