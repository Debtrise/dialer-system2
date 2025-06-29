// models/sms.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  // SMS Template Model
  const SmsTemplate = sequelize.define('SmsTemplate', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  });

  // SMS Campaign Model
  const SmsCampaign = sequelize.define('SmsCampaign', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('draft', 'active', 'paused', 'completed', 'cancelled'),
      defaultValue: 'draft'
    },
    templateId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    rateLimit: {
      type: DataTypes.INTEGER,
      defaultValue: 60, // SMS per hour
      allowNull: false
    },
    scheduledStartTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    scheduledEndTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    targetLeadCount: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    sentCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    deliveredCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    failedCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    }
  });

  // SMS Message Model
  const SmsMessage = sequelize.define('SmsMessage', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    leadId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    campaignId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'sent', 'delivered', 'failed'),
      defaultValue: 'pending'
    },
    messageId: {
      type: DataTypes.STRING,
      allowNull: true // Will be populated after sending via Twilio
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    deliveredAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  });
  
  // SMS Settings Model
  const SmsSettings = sequelize.define('SmsSettings', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    defaultSenderName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    twilioAccountSid: {
      type: DataTypes.STRING,
      allowNull: true
    },
    twilioAuthToken: {
      type: DataTypes.STRING,
      allowNull: true
    },
    twilioPhoneNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    rateLimit: {
      type: DataTypes.INTEGER,
      defaultValue: 60, // SMS per hour
      allowNull: false
    },
    concurrentJobs: {
      type: DataTypes.INTEGER,
      defaultValue: 5,
      allowNull: false
    },
    cooldownPeriod: {
      type: DataTypes.INTEGER,
      defaultValue: 24, // Hours
      allowNull: false
    },
    useSystemTwilioCredentials: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  });
  
  // Lead SMS Fields (to be merged with the Lead model)
  const LeadSmsFields = {
    smsAttempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    lastSmsAttempt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    smsStatus: {
      type: DataTypes.ENUM('pending', 'sent', 'delivered', 'failed'),
      defaultValue: 'pending'
    },
    smsOptOut: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  };

  // Create associations between models
  SmsCampaign.belongsTo(SmsTemplate, { foreignKey: 'templateId' });
  SmsTemplate.hasMany(SmsCampaign, { foreignKey: 'templateId' });
  
  SmsMessage.belongsTo(SmsCampaign, { foreignKey: 'campaignId' });
  SmsCampaign.hasMany(SmsMessage, { foreignKey: 'campaignId' });

  return {
    SmsTemplate,
    SmsCampaign,
    SmsMessage,
    SmsSettings,
    LeadSmsFields
  };
};
