// meera-models.js
// Models for Meera SMS integration

module.exports = (sequelize, DataTypes) => {
  // Meera configuration per tenant
  const MeeraConfig = sequelize.define('MeeraConfig', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    apiKey: {
      type: DataTypes.STRING,
      allowNull: false
    },
    apiSecret: {
      type: DataTypes.STRING,
      allowNull: true
    },
    baseUrl: {
      type: DataTypes.STRING,
      defaultValue: 'https://api.meera.ai/v1'
    },
    defaultFromNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    // Additional Meera settings
    settings: {
      type: DataTypes.JSONB,
      defaultValue: {
        enableDeliveryReports: true,
        enableIncomingSms: false,
        incomingWebhookUrl: null,
        messageType: 'promotional', // promotional, transactional
        enableUnicode: true,
        enableFlashMessage: false,
        maxSegments: 4
      }
    },
    // SMS sending limits
    rateLimits: {
      type: DataTypes.JSONB,
      defaultValue: {
        messagesPerSecond: 10,
        messagesPerMinute: 300,
        messagesPerHour: 5000,
        messagesPerDay: 50000
      }
    },
    // Usage tracking
    usage: {
      type: DataTypes.JSONB,
      defaultValue: {
        totalSent: 0,
        totalDelivered: 0,
        totalFailed: 0,
        lastReset: new Date(),
        balance: 0,
        lastBalanceCheck: null
      }
    }
  });

  return {
    MeeraConfig
  };
};