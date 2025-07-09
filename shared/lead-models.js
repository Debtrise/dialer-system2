const { DataTypes } = require('sequelize');
// shared/lead-models.js
// Fixed models with proper CallLog definition

module.exports = function(sequelize) {
  const { DataTypes } = require('sequelize');

  // Stage Model
  const Stage = sequelize.define('Stage', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    catalysts: {
      type: DataTypes.JSONB,
      defaultValue: []
    },
    order: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    color: {
      type: DataTypes.STRING,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'Stages',
    indexes: [
      {
        fields: ['tenantId']
      },
      {
        fields: ['tenantId', 'order']
      }
    ]
  });

  // Lead Model (UPDATED with stageId field)
  const Lead = sequelize.define('Lead', {
    name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('new', 'contacted', 'qualified', 'converted', 'unqualified', 'dnc', 'callback', 'connected', 'transferred', 'pending'),
      defaultValue: 'new'
    },
    brand: {
      type: DataTypes.STRING,
      allowNull: true
    },
    source: {
      type: DataTypes.STRING,
      allowNull: true
    },
    campaign: {
      type: DataTypes.STRING,
      allowNull: true
    },
    priority: {
      type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
      defaultValue: 'medium'
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true
    },
    // ADDED: Stage relationship
    stageId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Stages',
        key: 'id'
      }
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    additionalData: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    lastAttempt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastContact: {
      type: DataTypes.DATE,
      allowNull: true
    },
    timezone: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    scheduledCallback: {
      type: DataTypes.DATE,
      allowNull: true
    },
    assignedTo: {
      type: DataTypes.STRING,
      allowNull: true
    },
    leadScore: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    convertedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'Leads',
    paranoid: true,
    indexes: [
      {
        fields: ['tenantId']
      },
      {
        fields: ['phone']
      },
      {
        fields: ['status']
      },
      {
        fields: ['tenantId', 'status']
      },
      {
        fields: ['tenantId', 'phone']
      },
      {
        fields: ['brand']
      },
      {
        fields: ['source']
      }
    ]
  });

  // FIXED CallLog Model - Removed problematic USING clause
  const CallLog = sequelize.define('CallLog', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true
    },
    leadId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Leads',
        key: 'id'
      }
    },
    didId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'DIDs',
        key: 'id'
      }
    },
    from: {
      type: DataTypes.STRING,
      allowNull: false
    },
    to: {
      type: DataTypes.STRING,
      allowNull: false
    },
    transferNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // FIXED: Proper enum definition without USING clause
    callDirection: {
      type: DataTypes.ENUM('inbound', 'outbound'),
      allowNull: false,
      defaultValue: 'outbound',
      comment: 'Direction of the call'
    },
    status: {
      type: DataTypes.ENUM('initiated', 'ringing', 'answered', 'completed', 'failed', 'busy', 'no_answer', 'transferred'),
      defaultValue: 'initiated'
    },
    startTime: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    endTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Duration in seconds'
    },
    ringDuration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Ring duration in seconds'
    },
    talkDuration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Talk duration in seconds'
    },
    hangupCause: {
      type: DataTypes.STRING,
      allowNull: true
    },
    recording: {
      type: DataTypes.STRING,
      allowNull: true
    },
    ingroup: {
      type: DataTypes.STRING,
      allowNull: true
    },
    disposition: {
      type: DataTypes.STRING,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    lastStatusUpdate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    amiData: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'CallLogs',
    indexes: [
      {
        fields: ['tenantId']
      },
      {
        fields: ['leadId']
      },
      {
        fields: ['didId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['startTime']
      },
      {
        fields: ['tenantId', 'status']
      },
      {
        fields: ['tenantId', 'leadId']
      },
      {
        fields: ['callDirection']
      }
    ]
  });

  // DID Model
  const DID = sequelize.define('DID', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true
    },
    areaCode: {
      type: DataTypes.STRING,
      allowNull: true
    },
    state: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    usageCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    lastUsed: {
      type: DataTypes.DATE,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'DIDs',
    indexes: [
      {
        fields: ['tenantId']
      },
      {
        fields: ['phoneNumber'],
        unique: true
      },
      {
        fields: ['isActive']
      },
      {
        fields: ['areaCode']
      },
      {
        fields: ['state']
      },
      {
        fields: ['tenantId', 'isActive']
      }
    ]
  });

  // Define relationships AFTER model definitions
  
  // Lead -> Stage relationship
  Lead.belongsTo(Stage, {
    foreignKey: 'stageId',
    as: 'stage',
    onDelete: 'SET NULL'
  });

  Stage.hasMany(Lead, {
    foreignKey: 'stageId',
    as: 'leads'
  });

  // Lead -> CallLog relationship
  Lead.hasMany(CallLog, {
    foreignKey: 'leadId',
    as: 'callLogs',
    onDelete: 'SET NULL'
  });

  CallLog.belongsTo(Lead, {
    foreignKey: 'leadId',
    as: 'lead'
  });

  // DID -> CallLog relationship
  DID.hasMany(CallLog, {
    foreignKey: 'didId',
    as: 'callLogs',
    onDelete: 'SET NULL'
  });

  CallLog.belongsTo(DID, {
    foreignKey: 'didId',
    as: 'did'
  });

  return {
    Lead,
    CallLog,
    DID,
    Stage
  };
};