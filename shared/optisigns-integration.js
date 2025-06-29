// shared/optisigns-integration.js
// Main OptiSigns integration module using SDK

const OptisignsService = require('./optisigns-service');

module.exports = function(app, sequelize, authenticateToken) {
  console.log('Initializing OptiSigns Integration module with SDK...');
  
  try {
    // Initialize optisigns models
    const optisignsModels = require('./optisigns-models')(sequelize, sequelize.Sequelize.DataTypes);
    console.log('OptiSigns models initialized successfully');
    
    // Initialize SDK-based optisigns service
    const optisignsService = new OptisignsService(optisignsModels);
    console.log('OptiSigns SDK service initialized successfully');
    
    // Verify service methods
    if (optisignsService.verifyRequiredMethods) {
      const methodsValid = optisignsService.verifyRequiredMethods();
      if (!methodsValid) {
        throw new Error('OptiSigns service missing required methods');
      }
    }
    
    // Initialize optisigns routes with SDK service
    const optisignsRoutes = require('./optisigns-routes');
    const routeResult = optisignsRoutes(app, sequelize, authenticateToken, optisignsModels, optisignsService);
    console.log('OptiSigns routes initialized successfully');
    
    console.log('OptiSigns Integration module initialized successfully');
    
    // Return module capabilities
    return {
      models: optisignsModels,
      services: {
        optisignsService
      },
      routes: routeResult.router,
      capabilities: {
        // Core Features
        digitalSignage: true,
        contentManagement: true,
        displaySync: true,
        deviceControl: true,
        
        // SDK Features
        sdkBased: true,
        realtimePush: true,
        assetUpload: true,
        tagManagement: true,
        
        // Advanced Features
        takeover: true,
        scheduling: true,
        analytics: true,
        multiTenant: true,
        
        // Content Types
        imageAssets: true,
        videoAssets: true,
        websiteAssets: true,
        playlistSupport: true
      },
      sdkMethods: {
        devices: [
          'listAllDevices',
          'getDeviceById', 
          'updateDevice'
         
        ],
        assets: [
          'uploadFileAsset'
        ],
        tags: [
          'addTags',
          'removeTags'
        ]
      }
    };
  } catch (error) {
    console.error('Failed to initialize OptiSigns Integration module:', error);
    throw error;
  }
};