// dialplan-builder/controllers/contextController.js

/**
 * Context controller for dial plan contexts
 * @param {Object} models - Database models
 * @returns {Object} Controller methods
 */
module.exports = (models) => {
  const { DialPlanProject, DialPlanContext, DialPlanNode, DialPlanConnection } = models;

  return {
    /**
     * Get all contexts for a project
     */
    getContextsByProject: async (req, res) => {
      try {
        const { projectId } = req.params;
        const tenantId = req.user.tenantId;
        
        // Verify the project belongs to the tenant
        const project = await DialPlanProject.findOne({
          where: { id: projectId, tenantId }
        });
        
        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        const contexts = await DialPlanContext.findAll({
          where: { projectId },
          order: [['name', 'ASC']]
        });
        
        res.json(contexts);
      } catch (error) {
        console.error('Error fetching contexts:', error);
        res.status(500).json({ error: 'Failed to fetch contexts' });
      }
    },
    
    /**
     * Get a context by ID with complete node structure
     */
    getContextById: async (req, res) => {
      try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        
        const context = await DialPlanContext.findOne({
          where: { id },
          include: [
            {
              model: DialPlanProject,
              as: 'project',
              where: { tenantId },
              attributes: ['id', 'name', 'tenantId']
            },
            {
              model: DialPlanNode,
              as: 'nodes',
              include: [
                {
                  model: DialPlanConnection,
                  as: 'outgoingConnections',
                  include: [
                    {
                      model: DialPlanNode,
                      as: 'targetNode',
                      attributes: ['id', 'name', 'label', 'nodeTypeId']
                    }
                  ]
                },
                {
                  model: DialPlanConnection,
                  as: 'incomingConnections',
                  include: [
                    {
                      model: DialPlanNode,
                      as: 'sourceNode',
                      attributes: ['id', 'name', 'label', 'nodeTypeId']
                    }
                  ]
                }
              ]
            }
          ]
        });
        
        if (!context) {
          return res.status(404).json({ error: 'Context not found' });
        }
        
        res.json(context);
      } catch (error) {
        console.error('Error fetching context:', error);
        res.status(500).json({ error: 'Failed to fetch context' });
      }
    },
    
    /**
     * Create a new context
     */
    createContext: async (req, res) => {
      try {
        const { projectId } = req.params;
        const { name, description, position } = req.body;
        const tenantId = req.user.tenantId;
        
        if (!name) {
          return res.status(400).json({ error: 'Context name is required' });
        }
        
        // Check if name contains only valid characters for Asterisk contexts
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          return res.status(400).json({ 
            error: 'Context name can only contain letters, numbers, underscores, and hyphens' 
          });
        }
        
        // Verify the project belongs to the tenant
        const project = await DialPlanProject.findOne({
          where: { id: projectId, tenantId }
        });
        
        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        // Check if context name already exists in this project
        const existingContext = await DialPlanContext.findOne({
          where: { projectId, name }
        });
        
        if (existingContext) {
          return res.status(400).json({ error: 'Context name already exists in this project' });
        }
        
        const context = await DialPlanContext.create({
          projectId,
          name,
          description,
          position: position || { x: 0, y: 0 },
          metadata: {}
        });
        
        res.status(201).json(context);
      } catch (error) {
        console.error('Error creating context:', error);
        res.status(500).json({ error: 'Failed to create context' });
      }
    },
    
    /**
     * Update a context
     */
    updateContext: async (req, res) => {
      try {
        const { id } = req.params;
        const { name, description, position, metadata } = req.body;
        const tenantId = req.user.tenantId;
        
        // Verify the context exists and belongs to the tenant
        const context = await DialPlanContext.findOne({
          where: { id },
          include: [
            {
              model: DialPlanProject,
              as: 'project',
              where: { tenantId }
            }
          ]
        });
        
        if (!context) {
          return res.status(404).json({ error: 'Context not found' });
        }
        
        // If name is being changed, check if it's valid and unique
        if (name && name !== context.name) {
          // Check if name contains only valid characters for Asterisk contexts
          if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            return res.status(400).json({ 
              error: 'Context name can only contain letters, numbers, underscores, and hyphens' 
            });
          }
          
          // Check if name already exists in this project
          const existingContext = await DialPlanContext.findOne({
            where: { 
              projectId: context.projectId, 
              name,
              id: { [models.Sequelize.Op.ne]: id } // Exclude current context
            }
          });
          
          if (existingContext) {
            return res.status(400).json({ error: 'Context name already exists in this project' });
          }
        }
        
        const updatedContext = await context.update({
          name: name || context.name,
          description: description !== undefined ? description : context.description,
          position: position || context.position,
          metadata: metadata || context.metadata
        });
        
        res.json(updatedContext);
      } catch (error) {
        console.error('Error updating context:', error);
        res.status(500).json({ error: 'Failed to update context' });
      }
    },
    
    /**
     * Delete a context
     */
    deleteContext: async (req, res) => {
      try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        
        // Verify the context exists and belongs to the tenant
        const context = await DialPlanContext.findOne({
          where: { id },
          include: [
            {
              model: DialPlanProject,
              as: 'project',
              where: { tenantId }
            }
          ]
        });
        
        if (!context) {
          return res.status(404).json({ error: 'Context not found' });
        }
        
        // Check if this is the only context in the project
        const contextCount = await DialPlanContext.count({
          where: { projectId: context.projectId }
        });
        
        if (contextCount === 1) {
          return res.status(400).json({ 
            error: 'Cannot delete the only context in a project. A project must have at least one context.' 
          });
        }
        
        // Check for references from other contexts
        const nodeReferences = await DialPlanNode.findOne({
          where: {
            [models.Sequelize.Op.and]: [
              { nodeTypeId: 2 }, // Assuming NodeType id=2 is "Include"
              { properties: { context: context.name } }
            ]
          }
        });
        
        if (nodeReferences) {
          return res.status(400).json({ 
            error: `This context is referenced by other contexts and cannot be deleted.` 
          });
        }
        
        await context.destroy();
        
        res.json({ message: 'Context deleted successfully' });
      } catch (error) {
        console.error('Error deleting context:', error);
        res.status(500).json({ error: 'Failed to delete context' });
      }
    }
  };
};
