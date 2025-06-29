// dialplan-builder/index.js
const path = require('path');
const fs = require('fs');
const { Router } = require('express');

/**
 * Initialize the Dial Plan Builder module
 * @param {Object} app - Express application instance
 * @param {Object} sequelize - Sequelize instance
 * @param {Function} authenticateToken - Authentication middleware
 * @returns {Object} Module API and models
 */
function initDialPlanBuilder(app, sequelize, authenticateToken) {
  // Initialize models
  const models = require('./models/index')(sequelize);
  
  // Init routes with authentication
  const router = Router();
  
  // Import controllers
  const controllers = require('./controllers')(models);
  
  // Import routes and apply authentication middleware
  router.use(authenticateToken);
  require('./routes')(router, controllers);
  
  // Add routes to the main app
  app.use('/api/dialplan', router);
  
  // Initialize services
  const services = require('./services')(models);
  
  // Initialize default node types if they don't exist
  initializeDefaultNodeTypes(models);
  
  // Return module API
  return {
    models,
    services,
    controllers
  };
}

/**
 * Initialize default node types in the database
 * @param {Object} models - Database models
 */
async function initializeDefaultNodeTypes(models) {
  try {
    const { NodeType, NodeProperty } = models;
    
    // Check if node types already exist
    const count = await NodeType.count();
    if (count > 0) {
      console.log('Node types already initialized');
      return;
    }
    
    console.log('Initializing default node types...');
    
    // Load default node types from JSON file
    const defaultTypesPath = path.join(__dirname, 'data', 'default-node-types.json');
    const defaultNodeTypes = JSON.parse(fs.readFileSync(defaultTypesPath, 'utf8'));
    
    // Create node types and their properties
    for (const typeData of defaultNodeTypes) {
      const { properties, ...nodeType } = typeData;
      
      const createdType = await NodeType.create({
        ...nodeType,
        isSystem: true
      });
      
      if (properties && Array.isArray(properties)) {
        for (const prop of properties) {
          await NodeProperty.create({
            ...prop,
            nodeTypeId: createdType.id
          });
        }
      }
    }
    
    console.log('Default node types initialized successfully');
  } catch (error) {
    console.error('Failed to initialize default node types:', error);
  }
}

module.exports = initDialPlanBuilder;
