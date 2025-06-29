// dialplan-builder/services/index.js

/**
 * Export all services
 * @param {Object} models - Database models
 * @returns {Object} Services
 */
module.exports = (models) => {
  const generatorService = require('./generatorService')(models);
  const validationService = require('./validationService')(models);
  const deploymentService = require('./deploymentService')(models);
  
  return {
    generatorService,
    validationService,
    deploymentService
  };
};
