// dialplan-builder/controllers/projectController.js

/**
 * Project controller for dial plan projects
 * @param {Object} models - Database models
 * @returns {Object} Controller methods
 */
module.exports = (models) => {
  const { DialPlanProject, DialPlanContext, DialPlanNode, DialPlanConnection, DeploymentHistory } = models;

  return {
    /**
     * Get all projects for a tenant
     */
    getAllProjects: async (req, res) => {
      try {
        const tenantId = req.user.tenantId;
        
        const projects = await DialPlanProject.findAll({
          where: { tenantId },
          order: [['updatedAt', 'DESC']]
        });
        
        res.json(projects);
      } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Failed to fetch projects' });
      }
    },
    
    /**
     * Get a project by ID with complete structure
     */
    getProjectById: async (req, res) => {
      try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        
        const project = await DialPlanProject.findOne({
          where: { id, tenantId },
          include: [
            {
              model: DialPlanContext,
              as: 'contexts',
              include: [
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
                    }
                  ]
                }
              ]
            }
          ]
        });
        
        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        // Get deployment history
        const deployments = await DeploymentHistory.findAll({
          where: { projectId: id },
          order: [['deployedAt', 'DESC']],
          limit: 5
        });
        
        res.json({
          ...project.toJSON(),
          deployments
        });
      } catch (error) {
        console.error('Error fetching project:', error);
        res.status(500).json({ error: 'Failed to fetch project' });
      }
    },
    
    /**
     * Create a new project
     */
    createProject: async (req, res) => {
      try {
        const { name, description } = req.body;
        const tenantId = req.user.tenantId;
        
        if (!name) {
          return res.status(400).json({ error: 'Project name is required' });
        }
        
        const project = await DialPlanProject.create({
          name,
          description,
          tenantId,
          isActive: false
        });
        
        // Create a default context
        const defaultContext = await DialPlanContext.create({
          projectId: project.id,
          name: 'default',
          description: 'Default context'
        });
        
        res.status(201).json({
          ...project.toJSON(),
          contexts: [defaultContext]
        });
      } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: 'Failed to create project' });
      }
    },
    
    /**
     * Update a project
     */
    updateProject: async (req, res) => {
      try {
        const { id } = req.params;
        const { name, description, isActive, metadata } = req.body;
        const tenantId = req.user.tenantId;
        
        const project = await DialPlanProject.findOne({
          where: { id, tenantId }
        });
        
        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        const updatedProject = await project.update({
          name: name || project.name,
          description: description !== undefined ? description : project.description,
          isActive: isActive !== undefined ? isActive : project.isActive,
          metadata: metadata || project.metadata
        });
        
        res.json(updatedProject);
      } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({ error: 'Failed to update project' });
      }
    },
    
    /**
     * Delete a project
     */
    deleteProject: async (req, res) => {
      try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        
        const project = await DialPlanProject.findOne({
          where: { id, tenantId }
        });
        
        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        // Check if project is active
        if (project.isActive) {
          return res.status(400).json({ 
            error: 'Cannot delete an active project. Deactivate it first.' 
          });
        }
        
        await project.destroy();
        
        res.json({ message: 'Project deleted successfully' });
      } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Failed to delete project' });
      }
    },
    
    /**
     * Clone a project
     */
    cloneProject: async (req, res) => {
      try {
        const { id } = req.params;
        const { newName } = req.body;
        const tenantId = req.user.tenantId;
        
        if (!newName) {
          return res.status(400).json({ error: 'New project name is required' });
        }
        
        // Get the source project with full structure
        const sourceProject = await DialPlanProject.findOne({
          where: { id, tenantId },
          include: [
            {
              model: DialPlanContext,
              as: 'contexts',
              include: [
                {
                  model: DialPlanNode,
                  as: 'nodes',
                  include: [
                    {
                      model: DialPlanConnection,
                      as: 'outgoingConnections'
                    }
                  ]
                }
              ]
            }
          ]
        });
        
        if (!sourceProject) {
          return res.status(404).json({ error: 'Source project not found' });
        }
        
        // Create new project
        const newProject = await DialPlanProject.create({
          name: newName,
          description: `Clone of ${sourceProject.name}`,
          tenantId,
          isActive: false,
          metadata: sourceProject.metadata
        });
        
        // Map of old IDs to new IDs for linking
        const contextMap = new Map();
        const nodeMap = new Map();
        
        // Clone contexts
        for (const context of sourceProject.contexts) {
          const newContext = await DialPlanContext.create({
            projectId: newProject.id,
            name: context.name,
            description: context.description,
            position: context.position,
            metadata: context.metadata
          });
          
          contextMap.set(context.id, newContext.id);
          
          // Clone nodes
          for (const node of context.nodes) {
            const newNode = await DialPlanNode.create({
              contextId: newContext.id,
              nodeTypeId: node.nodeTypeId,
              name: node.name,
              label: node.label,
              position: node.position,
              priority: node.priority,
              properties: node.properties,
              metadata: node.metadata
            });
            
            nodeMap.set(node.id, newNode.id);
          }
        }
        
        // Clone connections (after all nodes are created)
        for (const context of sourceProject.contexts) {
          for (const node of context.nodes) {
            for (const conn of node.outgoingConnections) {
              await DialPlanConnection.create({
                sourceNodeId: nodeMap.get(conn.sourceNodeId),
                targetNodeId: nodeMap.get(conn.targetNodeId),
                condition: conn.condition,
                priority: conn.priority,
                metadata: conn.metadata
              });
            }
          }
        }
        
        // Return the new project
        const clonedProject = await DialPlanProject.findOne({
          where: { id: newProject.id },
          include: [
            {
              model: DialPlanContext,
              as: 'contexts'
            }
          ]
        });
        
        res.status(201).json(clonedProject);
      } catch (error) {
        console.error('Error cloning project:', error);
        res.status(500).json({ error: 'Failed to clone project' });
      }
    }
  };
};
