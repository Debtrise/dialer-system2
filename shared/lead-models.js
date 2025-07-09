const { DataTypes } = require('sequelize');

module.exports = function (sequelize) {
  // Avoid redefining models if they already exist
  if (sequelize.models.Lead && sequelize.models.CallLog && sequelize.models.DID && sequelize.models.Stage) {
    return {
      Lead: sequelize.models.Lead,
      CallLog: sequelize.models.CallLog,
      DID: sequelize.models.DID,
      Stage: sequelize.models.Stage,
    };
  }

  // Define Stage model if not present
  const Stage = sequelize.models.Stage || sequelize.define('Stage', {
    tenantId: { type: DataTypes.STRING, allowNull: false },
    title:    { type: DataTypes.STRING, allowNull: false },
    catalysts:{ type: DataTypes.JSONB, defaultValue: [] }
  });

  const Lead = sequelize.define('Lead', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    brand: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    source: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    stageId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: Stage, key: 'id' }
    },
    additionalData: {
      type: DataTypes.JSONB,
      defaultValue: {},
    },
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    lastAttempt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    callDurations: {
      type: DataTypes.ARRAY(DataTypes.INTEGER),
      defaultValue: [],
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: 'pending',
    },
    smsAttempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    lastSmsAttempt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    smsStatus: {
      type: DataTypes.STRING,
      defaultValue: 'pending',
    },
    smsHistory: {
      type: DataTypes.JSONB,
      defaultValue: [],
    },
    journeyEnrollments: {
      type: DataTypes.JSONB,
      defaultValue: [],
    },
    dialerAssignment: {
      type: DataTypes.STRING,
      defaultValue: 'auto_dialer',
      allowNull: true,
    },
    // Enhanced lead fields for DID integration
    preferredAreaCode: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Preferred area code for outbound calls'
    },
    state: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'State for geographic DID matching'
    },
    timezone: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Lead timezone for call scheduling'
    }
  });

  const CallLog = sequelize.define('CallLog', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    leadId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: Lead,
        key: 'id',
      },
    },
    // NEW: DID Integration
    didId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'DID used for this call'
    },
    from: { type: DataTypes.STRING, allowNull: false },
    to: { type: DataTypes.STRING, allowNull: false },
    transferNumber: { type: DataTypes.STRING, allowNull: true },
    ingroup: { type: DataTypes.STRING, allowNull: true },
    startTime: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    endTime: { type: DataTypes.DATE, allowNull: true },
    duration: { type: DataTypes.INTEGER, allowNull: true },
    status: {
      type: DataTypes.STRING,
      defaultValue: 'initiated',
    },
    recordingUrl: { type: DataTypes.STRING, allowNull: true },
    agentId: { type: DataTypes.INTEGER, allowNull: true },
    lastStatusUpdate: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    // Enhanced call tracking fields
    callDirection: {
      type: DataTypes.ENUM('inbound', 'outbound'),
      defaultValue: 'outbound',
      comment: 'Direction of the call'
    },
    dialResult: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Detailed dial result from dialer'
    },
    hangupCause: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Reason for call termination'
    },
    callQuality: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Call quality metrics (jitter, packet loss, etc.)'
    }
  });

  const DID = sequelize.define('DID', {
    tenantId: { type: DataTypes.STRING, allowNull: false },
    phoneNumber: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.STRING, allowNull: true },
    areaCode: { type: DataTypes.STRING, allowNull: true },
    state: { type: DataTypes.STRING, allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    usageCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    lastUsed: { type: DataTypes.DATE, allowNull: true },
    // Enhanced DID management fields
    provider: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'DID provider (Twilio, Telnyx, etc.)'
    },
    costPerMinute: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: true,
      comment: 'Cost per minute for this DID'
    },
    monthlyFee: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Monthly fee for this DID'
    },
    capabilities: {
      type: DataTypes.JSONB,
      defaultValue: {
        voice: true,
        sms: false,
        mms: false,
        fax: false
      },
      comment: 'DID capabilities'
    },
    routingConfig: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Routing configuration for this DID'
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: [],
      comment: 'Tags for categorizing DIDs'
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      comment: 'Priority for DID selection (1 = highest)'
    },
    maxConcurrentCalls: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      comment: 'Maximum concurrent calls for this DID'
    },
    currentCalls: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Current active calls using this DID'
    }
  });

  // ===== MODEL ASSOCIATIONS =====

  // Stage - Lead relationships
  Stage.hasMany(Lead, { foreignKey: 'stageId', as: 'leads' });
  Lead.belongsTo(Stage, { foreignKey: 'stageId', as: 'stage' });

  // Lead - CallLog relationships
  Lead.hasMany(CallLog, { foreignKey: 'leadId', as: 'callLogs' });
  CallLog.belongsTo(Lead, { foreignKey: 'leadId', as: 'lead' });

  // DID - CallLog relationships (NEW)
  DID.hasMany(CallLog, { foreignKey: 'didId', as: 'callLogs' });
  CallLog.belongsTo(DID, { foreignKey: 'didId', as: 'did' });

  // Add indexes for performance
  CallLog.addHook('afterSync', async () => {
    try {
      // Index for DID-related queries
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS "call_logs_did_id_idx" 
        ON "CallLogs" ("didId") 
        WHERE "didId" IS NOT NULL;
      `);

      // Index for active calls per DID
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS "call_logs_active_did_idx" 
        ON "CallLogs" ("didId", "status", "endTime") 
        WHERE "didId" IS NOT NULL AND "endTime" IS NULL;
      `);

      // Index for tenant-specific DID queries
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS "dids_tenant_active_idx" 
        ON "DIDs" ("tenantId", "isActive") 
        WHERE "isActive" = true;
      `);

      // Index for DID distribution queries
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS "dids_distribution_idx" 
        ON "DIDs" ("tenantId", "isActive", "usageCount", "lastUsed") 
        WHERE "isActive" = true;
      `);

      console.log('✅ DID-related database indexes created');
    } catch (error) {
      console.error('⚠️ Error creating DID indexes:', error.message);
    }
  });

  // Add instance methods for DID management
  DID.prototype.incrementUsage = async function() {
    await this.update({
      usageCount: this.usageCount + 1,
      lastUsed: new Date()
    });
  };

  DID.prototype.decrementCurrentCalls = async function() {
    if (this.currentCalls > 0) {
      await this.update({
        currentCalls: this.currentCalls - 1
      });
    }
  };

  DID.prototype.incrementCurrentCalls = async function() {
    await this.update({
      currentCalls: this.currentCalls + 1
    });
  };

  DID.prototype.isAvailable = function() {
    return this.isActive && this.currentCalls < this.maxConcurrentCalls;
  };

  // Add class methods for DID management
  DID.getAvailableForTenant = async function(tenantId, options = {}) {
    const where = {
      tenantId,
      isActive: true
    };

    if (options.areaCode) where.areaCode = options.areaCode;
    if (options.state) where.state = options.state;
    if (options.tags && options.tags.length > 0) {
      where.tags = { [sequelize.Sequelize.Op.overlap]: options.tags };
    }

    return await this.findAll({
      where,
      having: sequelize.literal('"currentCalls" < "maxConcurrentCalls"'),
      order: [['priority', 'ASC'], ['usageCount', 'ASC']]
    });
  };

  // Add instance methods for enhanced lead functionality
  Lead.prototype.getPreferredDIDCriteria = function() {
    return {
      areaCode: this.preferredAreaCode || this.extractAreaCodeFromPhone(),
      state: this.state,
      leadData: {
        phone: this.phone,
        state: this.state,
        timezone: this.timezone
      }
    };
  };

  Lead.prototype.extractAreaCodeFromPhone = function() {
    if (!this.phone) return null;
    const digits = this.phone.replace(/\D/g, '');
    if (digits.length === 10) return digits.substring(0, 3);
    if (digits.length === 11 && digits.startsWith('1')) return digits.substring(1, 4);
    return null;
  };

  // Add instance methods for call log enhancements
  CallLog.prototype.assignDID = async function(didId) {
    const DID = sequelize.models.DID;
    const did = await DID.findByPk(didId);
    
    if (!did || !did.isAvailable()) {
      throw new Error('DID not available for assignment');
    }

    await this.update({ didId });
    await did.incrementCurrentCalls();
    await did.incrementUsage();

    return did;
  };

  CallLog.prototype.releaseDID = async function() {
    if (this.didId) {
      const DID = sequelize.models.DID;
      const did = await DID.findByPk(this.didId);
      if (did) {
        await did.decrementCurrentCalls();
      }
    }
  };

  // Add hooks for automatic DID management
  CallLog.addHook('afterCreate', async (callLog) => {
    console.log(`📞 Call created: ${callLog.id} (Lead: ${callLog.leadId})`);
  });

  CallLog.addHook('afterUpdate', async (callLog) => {
    // Release DID when call ends
    if (callLog.changed('endTime') && callLog.endTime && callLog.didId) {
      await callLog.releaseDID();
      console.log(`📞 Call ended, DID released: ${callLog.didId}`);
    }
  });

  CallLog.addHook('beforeDestroy', async (callLog) => {
    // Release DID when call log is deleted
    if (callLog.didId) {
      await callLog.releaseDID();
    }
  });

  console.log('✅ Enhanced lead models with DID integration initialized');

  return { Lead, CallLog, DID, Stage };
};