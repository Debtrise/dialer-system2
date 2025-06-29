// webhook-models.js
// Models for the webhook ingestion system

module.exports = (sequelize, DataTypes) => {
  // Webhook endpoint configuration
  const WebhookEndpoint = sequelize.define('WebhookEndpoint', {
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
    endpointKey: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    brand: {
      type: DataTypes.STRING,
      allowNull: true
    },
    source: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Define how fields in the incoming webhook map to lead properties
    fieldMapping: {
      type: DataTypes.JSONB,
      defaultValue: {
        phone: 'phone',
        name: 'name',
        email: 'email'
      }
    },
    // Optional configuration for validating incoming data
    validationRules: {
      type: DataTypes.JSONB,
      defaultValue: {
        requirePhone: true,
        requireName: false,
        requireEmail: false,
        allowDuplicatePhone: false
      }
    },
    // Rules for automatically tagging leads
    autoTagRules: {
      type: DataTypes.JSONB,
      defaultValue: []
    },
    // Security token for webhook authentication
    securityToken: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Custom HTTP headers expected in the request
    requiredHeaders: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    // Sample payload for testing
    testPayload: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    // Optional auto-enrollment in a journey
    autoEnrollJourneyId: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  });

  // Webhook event log
  const WebhookEvent = sequelize.define('WebhookEvent', {
    webhookEndpointId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('success', 'partial_success', 'failed'),
      defaultValue: 'success'
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    createdLeadIds: {
      type: DataTypes.ARRAY(DataTypes.INTEGER),
      defaultValue: []
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    receivedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true
    },
    processingTime: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  });

  // Define relationships
  WebhookEndpoint.hasMany(WebhookEvent, { foreignKey: 'webhookEndpointId' });
  WebhookEvent.belongsTo(WebhookEndpoint, { foreignKey: 'webhookEndpointId' });

  return {
    WebhookEndpoint,
    WebhookEvent
  };
};
