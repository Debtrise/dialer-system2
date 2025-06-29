// recording-models.js
// Updated database models for centralized FreePBX recording system

module.exports = function(sequelize, DataTypes) {
  
  // Main Recording model
  const Recording = sequelize.define('Recording', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    type: {
      type: DataTypes.ENUM('tts', 'upload', 'template'),
      defaultValue: 'tts'
    },
    // Audio file information
    fileName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    fileUrl: {
      type: DataTypes.STRING,
      allowNull: true
    },
    fileSize: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    generatedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // Eleven Labs configuration
    elevenLabsVoiceId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Centralized FreePBX tracking (simplified)
    freepbxStatus: {
      type: DataTypes.ENUM('not_uploaded', 'pending', 'uploaded', 'failed'),
      defaultValue: 'not_uploaded'
    },
    freepbxUploadedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    freepbxRecordingId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Tenant-prefixed recording name in FreePBX (e.g., tenant_123_recording_name)'
    },
    freepbxError: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    // Status and metadata
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    tags: {
      type: DataTypes.JSONB,
      defaultValue: []
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    // Usage tracking
    usageCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    lastUsed: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // Template association
    templateId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'RecordingTemplates',
        key: 'id'
      }
    }
  }, {
    indexes: [
      { fields: ['tenantId'] },
      { fields: ['tenantId', 'type'] },
      { fields: ['tenantId', 'isActive'] },
      { fields: ['freepbxStatus'] },
      { fields: ['freepbxRecordingId'] }
    ]
  });

  // Recording Templates model
  const RecordingTemplate = sequelize.define('RecordingTemplate', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    textTemplate: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Template with variables like {{name}}, {{company}}, etc.'
    },
    variables: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Array of variable names used in template'
    },
    category: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    defaultVoiceId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    tags: {
      type: DataTypes.JSONB,
      defaultValue: []
    }
  }, {
    indexes: [
      { fields: ['tenantId'] },
      { fields: ['tenantId', 'category'] },
      { fields: ['tenantId', 'isActive'] }
    ]
  });

  // Eleven Labs Configuration model (per tenant)
  const ElevenLabsConfig = sequelize.define('ElevenLabsConfig', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      primaryKey: true
    },
    apiKey: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    defaultVoiceId: {
      type: DataTypes.STRING,
      defaultValue: '21m00Tcm4TlvDq8ikWAM'
    },
    // Usage limits and tracking
    monthlyCharacterLimit: {
      type: DataTypes.INTEGER,
      defaultValue: 10000
    },
    charactersUsedThisMonth: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    lastResetDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    // Settings
    voiceSettings: {
      type: DataTypes.JSONB,
      defaultValue: {
        stability: 0.5,
        similarity_boost: 0.8
      }
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  });

  // Recording Analytics model for tracking performance
  const RecordingAnalytics = sequelize.define('RecordingAnalytics', {
    recordingId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Recordings',
        key: 'id'
      }
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    // IVR specific metrics
    totalPlays: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    completePlays: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    partialPlays: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    // User actions during/after recording
    pressedKey: {
      type: DataTypes.JSONB,
      defaultValue: {} // { "1": 10, "2": 5, "#": 3 }
    },
    transferredCalls: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    hungUpCalls: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    // Average metrics
    averageListenDuration: {
      type: DataTypes.FLOAT,
      defaultValue: 0.0
    },
    // Conversion metrics
    conversionRate: {
      type: DataTypes.FLOAT,
      defaultValue: 0.0
    }
  }, {
    indexes: [
      { fields: ['recordingId'] },
      { fields: ['tenantId'] },
      { fields: ['date'] },
      { fields: ['tenantId', 'date'] },
      { fields: ['recordingId', 'date'] }
    ]
  });

  // Recording Usage Log model for detailed tracking
  const RecordingUsageLog = sequelize.define('RecordingUsageLog', {
    recordingId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Recordings',
        key: 'id'
      }
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    usedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    context: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Context where recording was used (e.g., ivr, outbound_call, preview)'
    },
    // Call/Lead context
    callId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    leadId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    // User context
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    ip: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Performance metrics
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'How long the recording was played (in seconds)'
    },
    completed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Whether the recording was played to completion'
    },
    // Additional metadata
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    indexes: [
      { fields: ['recordingId'] },
      { fields: ['tenantId'] },
      { fields: ['usedAt'] },
      { fields: ['tenantId', 'usedAt'] },
      { fields: ['recordingId', 'usedAt'] },
      { fields: ['context'] },
      { fields: ['callId'] },
      { fields: ['leadId'] }
    ]
  });

  // FreePBX System Status model (for monitoring)
  const FreePBXSystemStatus = sequelize.define('FreePBXSystemStatus', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    serverUrl: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'https://dial.knittt.com'
    },
    serverIp: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '34.29.105.211'
    },
    isOnline: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    lastChecked: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    responseTime: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Response time in milliseconds'
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    // System info
    systemInfo: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional system information from FreePBX'
    },
    // Upload statistics
    totalUploadsToday: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    successfulUploadsToday: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    failedUploadsToday: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    }
  });

  // Recording Queue model (for batch processing)
  const RecordingQueue = sequelize.define('RecordingQueue', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    recordingId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Recordings',
        key: 'id'
      }
    },
    action: {
      type: DataTypes.ENUM('upload_to_freepbx', 'generate_audio', 'delete_from_freepbx'),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
      defaultValue: 'pending'
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Higher number = higher priority'
    },
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    maxAttempts: {
      type: DataTypes.INTEGER,
      defaultValue: 3
    },
    scheduledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'When to process this queue item'
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    indexes: [
      { fields: ['status'] },
      { fields: ['tenantId'] },
      { fields: ['recordingId'] },
      { fields: ['action'] },
      { fields: ['priority', 'scheduledAt'] },
      { fields: ['status', 'scheduledAt'] }
    ]
  });

  // Define associations
  Recording.belongsTo(RecordingTemplate, { 
    foreignKey: 'templateId', 
    as: 'RecordingTemplate' 
  });
  
  RecordingTemplate.hasMany(Recording, { 
    foreignKey: 'templateId', 
    as: 'Recordings' 
  });

  Recording.hasMany(RecordingAnalytics, { 
    foreignKey: 'recordingId', 
    as: 'Analytics' 
  });

  Recording.hasMany(RecordingUsageLog, { 
    foreignKey: 'recordingId', 
    as: 'UsageLogs' 
  });

  RecordingAnalytics.belongsTo(Recording, { 
    foreignKey: 'recordingId', 
    as: 'Recording' 
  });

  RecordingUsageLog.belongsTo(Recording, { 
    foreignKey: 'recordingId', 
    as: 'Recording' 
  });

  RecordingQueue.belongsTo(Recording, { 
    foreignKey: 'recordingId', 
    as: 'Recording' 
  });

  // Return all models
  return {
    Recording,
    RecordingTemplate,
    ElevenLabsConfig,
    RecordingAnalytics,
    RecordingUsageLog,
    FreePBXSystemStatus,
    RecordingQueue,
    // Sequelize instance for transactions
    sequelize
  };
};