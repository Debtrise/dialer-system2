// twilio-models.js
// Models for Twilio SMS integration

module.exports = (sequelize, DataTypes) => {
  // Twilio configuration per tenant
  const TwilioConfig = sequelize.define('TwilioConfig', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    accountSid: {
      type: DataTypes.STRING,
      allowNull: false
    },
    authToken: {
      type: DataTypes.STRING,
      allowNull: false
    },
    defaultFromNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    // Additional Twilio settings
    settings: {
      type: DataTypes.JSONB,
      defaultValue: {
        statusCallbackUrl: null,
        messagingServiceSid: null,
        useMessagingService: false,
        enableDeliveryReports: true,
        enableIncomingSms: false,
        incomingWebhookUrl: null
      }
    },
    // SMS sending limits
    rateLimits: {
      type: DataTypes.JSONB,
      defaultValue: {
        messagesPerMinute: 60,
        messagesPerHour: 1000,
        messagesPerDay: 10000
      }
    },
    // Usage tracking
    usage: {
      type: DataTypes.JSONB,
      defaultValue: {
        totalSent: 0,
        totalDelivered: 0,
        totalFailed: 0,
        lastReset: new Date()
      }
    }
  });

  // SMS Phone Numbers (Twilio numbers)
  const SmsPhoneNumber = sequelize.define('SmsPhoneNumber', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    friendlyName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    capabilities: {
      type: DataTypes.JSONB,
      defaultValue: {
        sms: true,
        mms: true,
        voice: false
      }
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
    }
  });

  // SMS Messages log
  const SmsMessage = sequelize.define('SmsMessage', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    leadId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    from: {
      type: DataTypes.STRING,
      allowNull: false
    },
    to: {
      type: DataTypes.STRING,
      allowNull: false
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    direction: {
      type: DataTypes.ENUM('outbound', 'inbound'),
      defaultValue: 'outbound'
    },
    status: {
      type: DataTypes.ENUM('queued', 'sending', 'sent', 'delivered', 'failed', 'undelivered'),
      defaultValue: 'queued'
    },
    twilioSid: {
      type: DataTypes.STRING,
      allowNull: true
    },
    twilioStatus: {
      type: DataTypes.STRING,
      allowNull: true
    },
    errorCode: {
      type: DataTypes.STRING,
      allowNull: true
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    price: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: true
    },
    priceUnit: {
      type: DataTypes.STRING,
      allowNull: true
    },
    templateId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
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

  // SMS Conversations (thread view)
  const SmsConversation = sequelize.define('SmsConversation', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    leadId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    unreadCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    status: {
      type: DataTypes.ENUM('active', 'archived', 'blocked'),
      defaultValue: 'active'
    },
    assignedTo: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  });

  // Define indexes
  SmsMessage.addIndex(['tenantId', 'leadId']);
  SmsMessage.addIndex(['tenantId', 'status']);
  SmsMessage.addIndex(['tenantId', 'createdAt']);
  SmsConversation.addIndex(['tenantId', 'status']);
  SmsConversation.addIndex(['tenantId', 'lastMessageAt']);

  return {
    TwilioConfig,
    SmsPhoneNumber,
    SmsMessage,
    SmsConversation
  };
};
