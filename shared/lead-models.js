const { DataTypes } = require('sequelize');

module.exports = function (sequelize) {
  // Avoid redefining models if they already exist
  if (sequelize.models.Lead && sequelize.models.CallLog && sequelize.models.DID) {
    return {
      Lead: sequelize.models.Lead,
      CallLog: sequelize.models.CallLog,
      DID: sequelize.models.DID,
    };
  }

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
  });

  return { Lead, CallLog, DID };
};
