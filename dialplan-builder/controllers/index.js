// dialplan-builder/controllers/index.js

/**
 * Export all controllers
 * @param {Object} models - Database models
 * @returns {Object} Controllers
 */
module.exports = (models) => {
  const projectController = require('./projectController')(models);
  const contextController = require('./contextController')(models);
  const nodeController = require('./nodeController')(models);
  const connectionController = require('./connectionController')(models);
  
  return {
    projectController,
    contextController,
    nodeController,
    connectionController
  };
};
