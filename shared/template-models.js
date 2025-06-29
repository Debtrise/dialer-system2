// template-models.js
// Models for the template management system

module.exports = (sequelize, DataTypes) => {
  // Template Categories
  const TemplateCategory = sequelize.define('TemplateCategory', {
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
    type: {
      type: DataTypes.ENUM('sms', 'email', 'transfer', 'script', 'voicemail'),
      allowNull: false
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  });

  // Main Templates
  const Template = sequelize.define('Template', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    categoryId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    type: {
      type: DataTypes.ENUM('sms', 'email', 'transfer', 'script', 'voicemail'),
      allowNull: false
    },
    subject: {
      type: DataTypes.STRING,
      allowNull: true // For email templates
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    htmlContent: {
      type: DataTypes.TEXT,
      allowNull: true // For email templates
    },
    variables: {
      type: DataTypes.JSONB,
      defaultValue: [],
      // Example: [
      //   { name: 'firstName', description: 'Lead first name', defaultValue: 'Customer' },
      //   { name: 'companyName', description: 'Company name', defaultValue: 'Our Company' }
      // ]
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
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

const TransferGroup = sequelize.define('TransferGroup', {
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
  // Brand relationship - null means generic/all brands
  brand: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null
  },
  // Ingroup relationship - null means generic/all ingroups
  ingroup: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null
  },
  type: {
    type: DataTypes.ENUM('roundrobin', 'simultaneous', 'priority', 'percentage'),
    defaultValue: 'roundrobin'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  settings: {
    type: DataTypes.JSONB,
    defaultValue: {
      ringTimeout: 30,
      voicemailEnabled: false,
      voicemailTemplateId: null,
      callRecording: true,
      whisperMessage: null
    }
  },
  // API Configuration for agent status checking
  apiConfig: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: null,
    comment: 'API configuration for checking agent availability (url, user, password, source)'
  },
  // Dialer Context for AMI calls
  dialerContext: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
    comment: 'Asterisk dialer context to use for calls from this transfer group'
  }
}, {
  indexes: [
    {
      fields: ['tenantId', 'brand', 'ingroup'],
      unique: true,
      name: 'transfer_groups_tenant_brand_ingroup'
    },
    {
      fields: ['tenantId', 'isActive']
    }
  ]
});
  // Transfer Numbers
  const TransferNumber = sequelize.define('TransferNumber', {
    groupId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    weight: {
      type: DataTypes.INTEGER,
      defaultValue: 100 // For percentage-based routing
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    businessHours: {
      type: DataTypes.JSONB,
      defaultValue: {
        enabled: false,
        timezone: 'America/New_York',
        schedule: {
          monday: { enabled: true, start: '09:00', end: '17:00' },
          tuesday: { enabled: true, start: '09:00', end: '17:00' },
          wednesday: { enabled: true, start: '09:00', end: '17:00' },
          thursday: { enabled: true, start: '09:00', end: '17:00' },
          friday: { enabled: true, start: '09:00', end: '17:00' },
          saturday: { enabled: false, start: '09:00', end: '17:00' },
          sunday: { enabled: false, start: '09:00', end: '17:00' }
        }
      }
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {
        agentName: null,
        department: null,
        skills: [],
        maxConcurrentCalls: 1
      }
    },
    stats: {
      type: DataTypes.JSONB,
      defaultValue: {
        totalCalls: 0,
        answeredCalls: 0,
        missedCalls: 0,
        avgTalkTime: 0,
        lastCallAt: null
      }
    }
  });

  // Template Usage History
  const TemplateUsage = sequelize.define('TemplateUsage', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    templateId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    usedBy: {
      type: DataTypes.INTEGER,
      allowNull: true // User ID
    },
    usedFor: {
      type: DataTypes.ENUM('manual', 'journey', 'campaign', 'api'),
      allowNull: false
    },
    entityType: {
      type: DataTypes.STRING,
      allowNull: true // 'lead', 'sms', 'email', etc.
    },
    entityId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    variables: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    renderedContent: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  });

  // Email Settings (SMTP, SendGrid, etc.)
  const EmailConfig = sequelize.define('EmailConfig', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    provider: {
      type: DataTypes.ENUM('smtp', 'sendgrid', 'mailgun', 'ses'),
      defaultValue: 'smtp'
    },
    settings: {
      type: DataTypes.JSONB,
      defaultValue: {}
      // SMTP: { host, port, secure, user, pass }
      // SendGrid: { apiKey }
      // Mailgun: { apiKey, domain }
      // SES: { accessKeyId, secretAccessKey, region }
    },
    fromEmail: {
      type: DataTypes.STRING,
      allowNull: false
    },
    fromName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    replyToEmail: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    dailyLimit: {
      type: DataTypes.INTEGER,
      defaultValue: 1000
    },
    sentToday: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    lastResetDate: {
      type: DataTypes.DATEONLY,
      defaultValue: DataTypes.NOW
    }
  });

  // Define relationships with aliases
  Template.belongsTo(TemplateCategory, { foreignKey: 'categoryId', as: 'category' });
  TemplateCategory.hasMany(Template, { foreignKey: 'categoryId' });
  
  TransferNumber.belongsTo(TransferGroup, { foreignKey: 'groupId' });
  TransferGroup.hasMany(TransferNumber, { foreignKey: 'groupId', as: 'numbers' });
  
  Template.hasMany(TemplateUsage, { foreignKey: 'templateId' });
  TemplateUsage.belongsTo(Template, { foreignKey: 'templateId' });

  // Indexes
  // // Template.addIndex(['tenantId', 'type', 'isActive']);
  // // TransferGroup.addIndex(['tenantId', 'isActive']);
  // // TemplateUsage.addIndex(['tenantId', 'templateId', 'createdAt']);

  return {
    TemplateCategory,
    Template,
    TransferGroup,
    TransferNumber,
    TemplateUsage,
    EmailConfig
  };
};
