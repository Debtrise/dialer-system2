// dialplan-builder/controllers/nodeController.js

/**
 * Node controller for dial plan nodes
 * @param {Object} models - Database models
 * @returns {Object} Controller methods
 */
module.exports = (models) => {
  const { DialPlanProject, DialPlanContext, DialPlanNode, DialPlanConnection, NodeType, NodeProperty } = models;

  return {
    /**
     * Get all nodes for a context
     */
    getNodesByContext: async (req, res) => {
      try {
        const { contextId } = req.params;
        const tenantId = req.user.tenantId;
        
        // Verify the context belongs to the tenant
        const context = await DialPlanContext.findOne({
          where: { id: contextId },
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
        
        const nodes = await DialPlanNode.findAll({
          where: { contextId },
          include: [
            {
              model: NodeType,
              as: 'type'
            }
          ],
          order: [['priority', 'ASC'], ['name', 'ASC']]
        });
        
        res.json(nodes);
      } catch (error) {
        console.error('Error fetching nodes:', error);
        res.status(500).json({ error: 'Failed to fetch nodes' });
      }
    },
    
    /**
     * Get a node by ID with connections
     */
    getNodeById: async (req, res) => {
      try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        
        const node = await DialPlanNode.findOne({
          where: { id },
          include: [
            {
              model: DialPlanContext,
              as: 'context',
              include: [
                {
                  model: DialPlanProject,
                  as: 'project',
                  where: { tenantId },
                  attributes: ['id', 'name', 'tenantId']
                }
              ]
            },
            {
              model: NodeType,
              as: 'type',
              include: [
                {
                  model: NodeProperty,
                  as: 'properties'
                }
              ]
            },
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
        });
        
        if (!node) {
          return res.status(404).json({ error: 'Node not found' });
        }
        
        res.json(node);
      } catch (error) {
        console.error('Error fetching node:', error);
        res.status(500).json({ error: 'Failed to fetch node' });
      }
    },
    
    /**
     * Create a new node
     */
    createNode: async (req, res) => {
      try {
        const { contextId } = req.params;
        const { nodeTypeId, name, label, position, priority, properties } = req.body;
        const tenantId = req.user.tenantId;
        
        // Validate required fields
        if (!nodeTypeId) {
          return res.status(400).json({ error: 'Node type is required' });
        }
        
        if (!name) {
          return res.status(400).json({ error: 'Node name is required' });
        }
        
        // Verify the context belongs to the tenant
        const context = await DialPlanContext.findOne({
          where: { id: contextId },
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
        
        // Verify the node type exists
        const nodeType = await NodeType.findByPk(nodeTypeId, {
          include: [
            {
              model: NodeProperty,
              as: 'properties'
            }
          ]
        });
        
        if (!nodeType) {
          return res.status(404).json({ error: 'Node type not found' });
        }
        
        // Validate properties against node type properties
        if (properties) {
          const requiredProperties = nodeType.properties.filter(prop => prop.required);
          
          for (const prop of requiredProperties) {
            if (properties[prop.name] === undefined) {
              return res.status(400).json({ 
                error: `Required property "${prop.name}" is missing` 
              });
            }
          }
          
          // Additional property validation could go here
        }
        
        // For Extension type nodes, check if the extension already exists in this context
        if (nodeType.name === 'Extension' && properties && properties.exten) {
          const existingNode = await DialPlanNode.findOne({
            where: { 
              contextId,
              nodeTypeId,
              properties: {
                exten: properties.exten
              }
            }
          });
          
          if (existingNode) {
            return res.status(400).json({ 
              error: `Extension "${properties.exten}" already exists in this context` 
            });
          }
        }
        
        // Calculate next priority if not provided
        let nodePriority = priority;
        if (!nodePriority) {
          const maxPriorityNode = await DialPlanNode.findOne({
            where: { contextId },
            order: [['priority', 'DESC']]
          });
          
          nodePriority = maxPriorityNode ? maxPriorityNode.priority + 1 : 1;
        }
        
        const node = await DialPlanNode.create({
          contextId,
          nodeTypeId,
          name,
          label,
          position: position || { x: 0, y: 0 },
          priority: nodePriority,
          properties: properties || {},
          metadata: {}
        });
        
        // Return the created node with type info
        const createdNode = await DialPlanNode.findByPk(node.id, {
          include: [
            {
              model: NodeType,
              as: 'type'
            }
          ]
        });
        
        res.status(201).json(createdNode);
      } catch (error) {
        console.error('Error creating node:', error);
        res.status(500).json({ error: 'Failed to create node' });
      }
    },
    
    /**
     * Update a node
     */
    updateNode: async (req, res) => {
      try {
        const { id } = req.params;
        const { name, label, position, priority, properties, metadata } = req.body;
        const tenantId = req.user.tenantId;
        
        // Verify the node exists and belongs to the tenant
        const node = await DialPlanNode.findOne({
          where: { id },
          include: [
            {
              model: DialPlanContext,
              as: 'context',
              include: [
                {
                  model: DialPlanProject,
                  as: 'project',
                  where: { tenantId }
                }
              ]
            },
            {
              model: NodeType,
              as: 'type',
              include: [
                {
                  model: NodeProperty,
                  as: 'properties'
                }
              ]
            }
          ]
        });
        
        if (!node) {
          return res.status(404).json({ error: 'Node not found' });
        }
        
        // Validate properties against node type properties
        if (properties) {
          const requiredProperties = node.type.properties.filter(prop => prop.required);
          
          for (const prop of requiredProperties) {
            if (properties[prop.name] === undefined && node.properties[prop.name] === undefined) {
              return res.status(400).json({ 
                error: `Required property "${prop.name}" is missing` 
              });
            }
          }
          
          // For Extension type nodes, check if the extension is being changed and if it already exists
          if (node.type.name === 'Extension' && 
              properties.exten && 
              properties.exten !== node.properties.exten) {
            
            const existingNode = await DialPlanNode.findOne({
              where: { 
                contextId: node.contextId,
                nodeTypeId: node.nodeTypeId,
                properties: {
                  exten: properties.exten
                },
                id: { [models.Sequelize.Op.ne]: id } // Exclude current node
              }
            });
            
            if (existingNode) {
              return res.status(400).json({ 
                error: `Extension "${properties.exten}" already exists in this context` 
              });
            }
          }
        }
        
        // Merge properties instead of replacing
        const mergedProperties = {
          ...node.properties,
          ...(properties || {})
        };
        
        const updatedNode = await node.update({
          name: name || node.name,
          label: label !== undefined ? label : node.label,
          position: position || node.position,
          priority: priority || node.priority,
          properties: mergedProperties,
          metadata: metadata || node.metadata
        });
        
        res.json(updatedNode);
      } catch (error) {
        console.error('Error updating node:', error);
        res.status(500).json({ error: 'Failed to update node' });
      }
    },
    
    /**
     * Delete a node
     */
    deleteNode: async (req, res) => {
      try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        
        // Verify the node exists and belongs to the tenant
        const node = await DialPlanNode.findOne({
          where: { id },
          include: [
            {
              model: DialPlanContext,
              as: 'context',
              include: [
                {
                  model: DialPlanProject,
                  as: 'project',
                  where: { tenantId }
                }
              ]
            }
          ]
        });
        
        if (!node) {
          return res.status(404).json({ error: 'Node not found' });
        }
        
        // Delete the node (connections will be cascaded)
        await node.destroy();
        
        res.json({ message: 'Node deleted successfully' });
      } catch (error) {
        console.error('Error deleting node:', error);
        res.status(500).json({ error: 'Failed to delete node' });
      }
    },
    
    /**
     * Get all available node types
     */
    getNodeTypes: async (req, res) => {
      try {
        const nodeTypes = await NodeType.findAll({
          order: [['category', 'ASC'], ['name', 'ASC']],
          include: [
            {
              model: NodeProperty,
              as: 'properties',
              order: [['order', 'ASC']]
            }
          ]
        });
        
        res.json(nodeTypes);
      } catch (error) {
        console.error('Error fetching node types:', error);
        res.status(500).json({ error: 'Failed to fetch node types' });
      }
    }
  };
};
