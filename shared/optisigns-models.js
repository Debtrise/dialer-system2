// shared/optisigns-models.js
// Enhanced database models for OptiSigns integration with takeover support

module.exports = function(sequelize, DataTypes) {
  
  // Configuration table
  const OptisignsConfig = sequelize.define('OptisignsConfig', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true,
      field: 'tenant_id'
    },
    apiToken: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: 'api_token'
    },
    settings: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active'
    },
    lastValidated: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_validated'
    }
  }, {
    tableName: 'optisigns_configs',
    timestamps: true,
    underscored: true
  });

  // Displays table
  const OptisignsDisplay = sequelize.define('OptisignsDisplay', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    optisignsDisplayId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'optisigns_display_id'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    uuid: {
      type: DataTypes.STRING,
      allowNull: true
    },
    location: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING,
      allowNull: true
    },
    resolution: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    orientation: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active'
    },
    lastSeen: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_seen'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    currentContentId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'current_content_id'
    },
    // currentPlaylistId comes directly from OptiSigns and is not a UUID in
    // their API.  Using STRING here avoids schema migrations attempting to
    // cast existing values to UUID which caused startup errors when syncing
    // the models.
    currentPlaylistId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'current_playlist_id'
    },
    currentAssetId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'current_asset_id'
    },
    currentType: {
      type: DataTypes.ENUM('ASSET', 'PLAYLIST'),
      allowNull: true,
      field: 'current_type'
    },
    optisignsId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'optisigns_id'
    },
    isOnline: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_online'
    },
    // Takeover-related fields
    isUnderTakeover: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_under_takeover'
    },
    currentTakeoverId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'current_takeover_id'
    },
    previousContentType: {
      type: DataTypes.ENUM('ASSET', 'PLAYLIST'),
      allowNull: true,
      field: 'previous_content_type'
    },
    previousContentId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'previous_content_id'
    }
  }, {
    tableName: 'optisigns_displays',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['tenant_id', 'optisigns_display_id']
      },
      {
        fields: ['tenant_id', 'status']
      },
      {
        fields: ['tenant_id', 'is_online']
      },
      {
        fields: ['tenant_id', 'is_under_takeover']
      }
    ]
  });

  // Content/Assets table
  const OptisignsContent = sequelize.define('OptisignsContent', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    optisignsId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'optisigns_id'
    },
    // ADD THIS MISSING FIELD:
    projectId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'project_id',
      references: {
        model: 'content_projects',
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'asset'
    },
    fileType: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'file_type'
    },
    fileSize: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'file_size'
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    url: {
      type: DataTypes.STRING,
      allowNull: true
    },
    webLink: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'web_link'
    },
    status: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'created'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
   tableName: 'optisigns_content',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['tenant_id', 'optisigns_id']
      },
      {
        fields: ['tenant_id', 'status']
      },
      {
        fields: ['project_id'] // Add index for the new field
      }
    ]
  });
  // Playlists table
  const OptisignsPlaylist = sequelize.define('OptisignsPlaylist', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    optisignsId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'optisigns_id'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    assetCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'asset_count'
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'optisigns_playlists',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['tenant_id', 'optisigns_id']
      },
      {
        fields: ['tenant_id', 'is_active']
      }
    ]
  });

  // Playlist Assets junction table
  const OptisignsPlaylistAsset = sequelize.define('OptisignsPlaylistAsset', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    playlistId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'playlist_id',
      references: {
        model: 'optisigns_playlists',
        key: 'id'
      }
    },
    contentId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'content_id',
      references: {
        model: 'optisigns_content',
        key: 'id'
      }
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    tableName: 'optisigns_playlist_assets',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['playlist_id', 'content_id']
      },
      {
        fields: ['playlist_id', 'position']
      }
    ]
  });

  // Takeovers table - NEW
  const OptisignsTakeover = sequelize.define('OptisignsTakeover', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    displayId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'display_id',
      references: {
        model: 'optisigns_displays',
        key: 'id'
      }
    },
    contentType: {
      type: DataTypes.ENUM('ASSET', 'PLAYLIST'),
      allowNull: false,
      field: 'content_type'
    },
    contentId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'content_id'
    },
    optisignsContentId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'optisigns_content_id'
    },
    // Using STRING instead of ENUM avoids type casting issues when the
    // column schema changes. Priority values are still validated at the
    // application level.
    priority: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'NORMAL'
    },
    status: {
      type: DataTypes.ENUM('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED'),
      allowNull: false,
      defaultValue: 'SCHEDULED'
    },
    startTime: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'start_time'
    },
    endTime: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'end_time'
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Duration in seconds, null for permanent'
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Reason or message for the takeover'
    },
    restoreAfter: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'restore_after'
    },
    previousContentType: {
      type: DataTypes.ENUM('ASSET', 'PLAYLIST'),
      allowNull: true,
      field: 'previous_content_type'
    },
    previousContentId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'previous_content_id'
    },
    initiatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'initiated_by'
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'completed_at'
    },
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'cancelled_at'
    },
    cancelledBy: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'cancelled_by'
    },
    emergencyBroadcastId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'emergency_broadcast_id'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional data like user agent, IP, etc.'
    }
  }, {
    tableName: 'optisigns_takeovers',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['tenant_id', 'status']
      },
      {
        fields: ['display_id', 'status']
      },
      {
        fields: ['priority', 'status']
      },
      {
        fields: ['start_time', 'end_time']
      },
      {
        fields: ['emergency_broadcast_id']
      },
      {
        fields: ['initiated_by']
      }
    ]
  });

  // Emergency Broadcasts table - NEW
  const OptisignsEmergencyBroadcast = sequelize.define('OptisignsEmergencyBroadcast', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    contentType: {
      type: DataTypes.ENUM('ASSET', 'PLAYLIST'),
      allowNull: false,
      field: 'content_type'
    },
    contentId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'content_id'
    },
    // Stored as a simple string to prevent migration errors when new
    // priority levels are introduced. Values are constrained in code.
    priority: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'EMERGENCY'
    },
    status: {
      type: DataTypes.ENUM('ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED'),
      allowNull: false,
      defaultValue: 'ACTIVE'
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Duration in seconds, null for permanent'
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Emergency message or reason'
    },
    criteria: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Device selection criteria (locations, tags, etc.)'
    },
    targetDeviceCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'target_device_count'
    },
    successfulTakeovers: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'successful_takeovers'
    },
    failedTakeovers: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'failed_takeovers'
    },
    initiatedBy: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'initiated_by'
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'completed_at'
    },
    stoppedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'stopped_at'
    },
    stoppedBy: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'stopped_by'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'optisigns_emergency_broadcasts',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['tenant_id', 'status']
      },
      {
        fields: ['priority', 'status']
      },
      {
        fields: ['initiated_by']
      },
      {
        fields: ['created_at']
      }
    ]
  });

  // Tags table
  const OptisignsTag = sequelize.define('OptisignsTag', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    optisignsId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'optisigns_id'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    color: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active'
    }
  }, {
    tableName: 'optisigns_tags',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['tenant_id', 'optisigns_id']
      },
      {
        unique: true,
        fields: ['tenant_id', 'name']
      }
    ]
  });

  // Resource Tags junction table (for displays, content, playlists)
  const OptisignsResourceTag = sequelize.define('OptisignsResourceTag', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tagId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'tag_id',
      references: {
        model: 'optisigns_tags',
        key: 'id'
      }
    },
    resourceType: {
      type: DataTypes.ENUM('DISPLAY', 'CONTENT', 'PLAYLIST'),
      allowNull: false,
      field: 'resource_type'
    },
    resourceId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'resource_id'
    },
    appliedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'applied_at'
    }
  }, {
    tableName: 'optisigns_resource_tags',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['tag_id', 'resource_type', 'resource_id']
      },
      {
        fields: ['resource_type', 'resource_id']
      }
    ]
  });

  // Schedules table
  const OptisignsSchedule = sequelize.define('OptisignsSchedule', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    optisignsId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'optisigns_id'
    },
    displayId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'display_id',
      references: {
        model: 'optisigns_displays',
        key: 'id'
      }
    },
    playlistId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'playlist_id',
      references: {
        model: 'optisigns_playlists',
        key: 'id'
      }
    },
    contentId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'content_id',
      references: {
        model: 'optisigns_content',
        key: 'id'
      }
    },
    contentType: {
      type: DataTypes.ENUM('PLAYLIST', 'ASSET'),
      allowNull: false,
      field: 'content_type'
    },
    startTime: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'start_time'
    },
    endTime: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'end_time'
    },
    status: {
      type: DataTypes.ENUM('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED'),
      defaultValue: 'SCHEDULED'
    },
    isRecurring: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_recurring'
    },
    recurrencePattern: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'recurrence_pattern'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'optisigns_schedules',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['tenant_id', 'status']
      },
      {
        fields: ['display_id', 'start_time']
      },
      {
        fields: ['start_time', 'end_time']
      }
    ]
  });

  // Analytics/Events table
  const OptisignsEvent = sequelize.define('OptisignsEvent', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    displayId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'display_id',
      references: {
        model: 'optisigns_displays',
        key: 'id'
      }
    },
    contentId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'content_id',
      references: {
        model: 'optisigns_content',
        key: 'id'
      }
    },
    playlistId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'playlist_id',
      references: {
        model: 'optisigns_playlists',
        key: 'id'
      }
    },
    takeoverId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'takeover_id',
      references: {
        model: 'optisigns_takeovers',
        key: 'id'
      }
    },
    eventType: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'event_type'
    },
    eventData: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'event_data'
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'optisigns_events',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['tenant_id', 'event_type']
      },
      {
        fields: ['display_id', 'timestamp']
      },
      {
        fields: ['takeover_id']
      },
      {
        fields: ['timestamp']
      }
    ]
  });

  // Set up associations
  
  // Display associations
  OptisignsDisplay.hasMany(OptisignsSchedule, { 
    foreignKey: 'displayId', 
    as: 'schedules',
    onDelete: 'CASCADE'
  });
  OptisignsDisplay.hasMany(OptisignsEvent, { 
    foreignKey: 'displayId', 
    as: 'events',
    onDelete: 'CASCADE'
  });
  OptisignsDisplay.hasMany(OptisignsTakeover, {
    foreignKey: 'displayId',
    as: 'takeovers',
    onDelete: 'CASCADE'
  });
  OptisignsDisplay.belongsTo(OptisignsTakeover, {
    foreignKey: 'currentTakeoverId',
    as: 'currentTakeover'
  });

  // Takeover associations
  OptisignsTakeover.belongsTo(OptisignsDisplay, {
    foreignKey: 'displayId',
    as: 'display'
  });
  OptisignsTakeover.belongsTo(OptisignsContent, {
    foreignKey: 'contentId',
    as: 'content'
  });
  OptisignsTakeover.belongsTo(OptisignsPlaylist, {
    foreignKey: 'contentId',
    as: 'playlist'
  });
  OptisignsTakeover.belongsTo(OptisignsEmergencyBroadcast, {
    foreignKey: 'emergencyBroadcastId',
    as: 'emergencyBroadcast'
  });
  OptisignsTakeover.hasMany(OptisignsEvent, {
    foreignKey: 'takeoverId',
    as: 'events',
    onDelete: 'CASCADE'
  });

  // Emergency Broadcast associations
  OptisignsEmergencyBroadcast.hasMany(OptisignsTakeover, {
    foreignKey: 'emergencyBroadcastId',
    as: 'takeovers',
    onDelete: 'CASCADE'
  });
  OptisignsEmergencyBroadcast.belongsTo(OptisignsContent, {
    foreignKey: 'contentId',
    as: 'content'
  });

  // Playlist associations
  OptisignsPlaylist.hasMany(OptisignsPlaylistAsset, { 
    foreignKey: 'playlistId', 
    as: 'playlistAssets',
    onDelete: 'CASCADE'
  });
  OptisignsPlaylist.hasMany(OptisignsSchedule, { 
    foreignKey: 'playlistId', 
    as: 'schedules',
    onDelete: 'CASCADE'
  });
  OptisignsPlaylist.hasMany(OptisignsEvent, { 
    foreignKey: 'playlistId', 
    as: 'events',
    onDelete: 'CASCADE'
  });

  // Content associations
  OptisignsContent.hasMany(OptisignsPlaylistAsset, { 
    foreignKey: 'contentId', 
    as: 'playlistAssets',
    onDelete: 'CASCADE'
  });
  OptisignsContent.hasMany(OptisignsSchedule, { 
    foreignKey: 'contentId', 
    as: 'schedules',
    onDelete: 'CASCADE'
  });
  OptisignsContent.hasMany(OptisignsEvent, { 
    foreignKey: 'contentId', 
    as: 'events',
    onDelete: 'CASCADE'
  });
  OptisignsContent.hasMany(OptisignsTakeover, {
    foreignKey: 'contentId',
    as: 'takeovers',
    onDelete: 'CASCADE'
  });

  // Playlist Asset associations
  OptisignsPlaylistAsset.belongsTo(OptisignsPlaylist, { 
    foreignKey: 'playlistId', 
    as: 'playlist'
  });
  OptisignsPlaylistAsset.belongsTo(OptisignsContent, { 
    foreignKey: 'contentId', 
    as: 'content'
  });

  // Schedule associations
  OptisignsSchedule.belongsTo(OptisignsDisplay, { 
    foreignKey: 'displayId', 
    as: 'display'
  });
  OptisignsSchedule.belongsTo(OptisignsPlaylist, { 
    foreignKey: 'playlistId', 
    as: 'playlist'
  });
  OptisignsSchedule.belongsTo(OptisignsContent, { 
    foreignKey: 'contentId', 
    as: 'content'
  });

  // Tag associations
  OptisignsTag.hasMany(OptisignsResourceTag, { 
    foreignKey: 'tagId', 
    as: 'resourceTags',
    onDelete: 'CASCADE'
  });
  OptisignsResourceTag.belongsTo(OptisignsTag, { 
    foreignKey: 'tagId', 
    as: 'tag'
  });

  // Event associations
  OptisignsEvent.belongsTo(OptisignsDisplay, { 
    foreignKey: 'displayId', 
    as: 'display'
  });
  OptisignsEvent.belongsTo(OptisignsContent, { 
    foreignKey: 'contentId', 
    as: 'content'
  });
  OptisignsEvent.belongsTo(OptisignsPlaylist, { 
    foreignKey: 'playlistId', 
    as: 'playlist'
  });
  OptisignsEvent.belongsTo(OptisignsTakeover, {
    foreignKey: 'takeoverId',
    as: 'takeover'
  });

  // Add useful instance methods

  // Display methods
  OptisignsDisplay.prototype.getTags = function() {
    return OptisignsResourceTag.findAll({
      where: {
        resource_type: 'DISPLAY',
        resource_id: this.id
      },
      include: [{
        model: OptisignsTag,
        as: 'tag'
      }]
    }).then(resourceTags => resourceTags.map(rt => rt.tag));
  };

  OptisignsDisplay.prototype.getActiveSchedules = function() {
    const now = new Date();
    return this.getSchedules({
      where: {
        status: 'ACTIVE',
        start_time: { [sequelize.Sequelize.Op.lte]: now },
        end_time: { [sequelize.Sequelize.Op.gte]: now }
      }
    });
  };

  OptisignsDisplay.prototype.getActiveTakeover = function() {
    return OptisignsTakeover.findOne({
      where: {
        display_id: this.id,
        status: 'ACTIVE'
      },
      include: [
        {
          model: OptisignsContent,
          as: 'content'
        },
        {
          model: OptisignsEmergencyBroadcast,
          as: 'emergencyBroadcast'
        }
      ]
    });
  };

  OptisignsDisplay.prototype.canBeTakenOver = function(priority = 'NORMAL') {
    if (!this.isOnline) return false;
    if (!this.isActive) return false;
    
    // If no current takeover, can be taken over
    if (!this.isUnderTakeover) return true;
    
    // Check if new priority is higher than current
    const priorityLevels = { 'NORMAL': 1, 'HIGH': 2, 'EMERGENCY': 3 };
    return this.getCurrentTakeover().then(currentTakeover => {
      if (!currentTakeover) return true;
      return priorityLevels[priority] > priorityLevels[currentTakeover.priority];
    });
  };

  // Takeover methods
  OptisignsTakeover.prototype.isActive = function() {
    return this.status === 'ACTIVE';
  };

  OptisignsTakeover.prototype.getTimeRemaining = function() {
    if (!this.endTime) return null;
    const now = new Date();
    const remaining = Math.max(0, Math.floor((this.endTime - now) / 1000));
    return remaining;
  };

  OptisignsTakeover.prototype.canBeExtended = function() {
    return this.status === 'ACTIVE' && this.endTime;
  };

  OptisignsTakeover.prototype.canBeCancelled = function() {
    return ['SCHEDULED', 'ACTIVE'].includes(this.status);
  };

  // Playlist methods
  OptisignsPlaylist.prototype.getAssets = function() {
    return this.getPlaylistAssets({
      include: [{
        model: OptisignsContent,
        as: 'content'
      }],
      order: [['position', 'ASC']]
    }).then(playlistAssets => playlistAssets.map(pa => pa.content));
  };

  OptisignsPlaylist.prototype.getTags = function() {
    return OptisignsResourceTag.findAll({
      where: {
        resource_type: 'PLAYLIST',
        resource_id: this.id
      },
      include: [{
        model: OptisignsTag,
        as: 'tag'
      }]
    }).then(resourceTags => resourceTags.map(rt => rt.tag));
  };

  // Content methods
  OptisignsContent.prototype.getTags = function() {
    return OptisignsResourceTag.findAll({
      where: {
        resource_type: 'CONTENT',
        resource_id: this.id
      },
      include: [{
        model: OptisignsTag,
        as: 'tag'
      }]
    }).then(resourceTags => resourceTags.map(rt => rt.tag));
  };

  return {
    OptisignsConfig,
    OptisignsDisplay,
    OptisignsContent,
    OptisignsPlaylist,
    OptisignsPlaylistAsset,
    OptisignsTakeover,
    OptisignsEmergencyBroadcast,
    OptisignsTag,
    OptisignsResourceTag,
    OptisignsSchedule,
    OptisignsEvent
  };
};