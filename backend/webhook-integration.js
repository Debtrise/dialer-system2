// webhook-integration.js
// Module to integrate webhook functionality into the existing server

const initWebhooks = (app, sequelize, authenticateToken) => {
  console.log('Initializing webhook integration module...');
  
  // Import the webhook models - note these are local imports now
  const webhookModels = require('./webhook-models')(sequelize, sequelize.Sequelize.DataTypes);
  
  // Initialize the webhook service
  const WebhookService = require('./webhook-service');
  const JourneyService = require('./journey-service');
  
  const journeyService = new JourneyService({
    // We need to pass all the models that journeyService requires
    Journey: sequelize.models.Journey,
    JourneyStep: sequelize.models.JourneyStep,
    LeadJourney: sequelize.models.LeadJourney,
    JourneyExecution: sequelize.models.JourneyExecution,
    Lead: sequelize.models.Lead,
    Tenant: sequelize.models.Tenant,
    CallLog: sequelize.models.CallLog,
    DID: sequelize.models.DID
  });
  
  const webhookService = new WebhookService(
    {
      WebhookEndpoint: webhookModels.WebhookEndpoint,
      WebhookEvent: webhookModels.WebhookEvent,
      ContentAsset: sequelize.models.ContentAsset,
      OptisignsDisplay: sequelize.models.OptisignsDisplay,
      OptisignsTakeover: sequelize.models.OptisignsTakeover,
      Lead: sequelize.models.Lead,
      Tenant: sequelize.models.Tenant
    },
    journeyService
  );
  
  // Register webhook routes - local import
  require('./webhook-routes')(app, sequelize, authenticateToken);
  
  console.log('Webhook integration module initialized successfully');
  
  // Return the webhook models and service for potential external use
  return {
    models: webhookModels,
    service: webhookService
  };
};

module.exports = initWebhooks;
