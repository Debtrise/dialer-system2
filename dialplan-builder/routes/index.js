// dialplan-builder/routes/index.js

/**
 * Set up all routes
 * @param {Object} router - Express router
 * @param {Object} controllers - Controllers
 */
module.exports = (router, controllers) => {
  const { projectController, contextController, nodeController, connectionController } = controllers;
  
  // Project routes
  router.get('/projects', projectController.getAllProjects);
  router.get('/projects/:id', projectController.getProjectById);
  router.post('/projects', projectController.createProject);
  router.put('/projects/:id', projectController.updateProject);
  router.delete('/projects/:id', projectController.deleteProject);
  router.post('/projects/:id/clone', projectController.cloneProject);
  
  // Context routes
  router.get('/projects/:projectId/contexts', contextController.getContextsByProject);
  router.get('/contexts/:id', contextController.getContextById);
  router.post('/projects/:projectId/contexts', contextController.createContext);
  router.put('/contexts/:id', contextController.updateContext);
  router.delete('/contexts/:id', contextController.deleteContext);
  
  // Node routes
  router.get('/contexts/:contextId/nodes', nodeController.getNodesByContext);
  router.get('/nodes/:id', nodeController.getNodeById);
  router.post('/contexts/:contextId/nodes', nodeController.createNode);
  router.put('/nodes/:id', nodeController.updateNode);
  router.delete('/nodes/:id', nodeController.deleteNode);
  
  // Node type routes
  router.get('/node-types', nodeController.getNodeTypes);
  
  // Connection routes
  router.get('/contexts/:contextId/connections', connectionController.getConnectionsByContext);
  router.post('/connections', connectionController.createConnection);
  router.put('/connections/:id', connectionController.updateConnection);
  router.delete('/connections/:id', connectionController.deleteConnection);
};
