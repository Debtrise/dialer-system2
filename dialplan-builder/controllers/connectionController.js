// dialplan-builder/controllers/connectionController.js

/**
 * Connection controller for dial plan node connections
 * @param {Object} models - Database models
 * @returns {Object} Controller methods
 */
module.exports = (models) => {
  const { DialPlanProject, DialPlanContext, DialPlanNode, DialPlanConnection, NodeType } = models;

  return {
    /**
     * Get all connections for a context
     */
    getConnectionsByContext: async (req, res) => {
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
        
        // Get all nodes in this context
        const nodes = await DialPlanNode.findAll({
          where: { contextId },
          attributes: ['id']
        });
        
        const nodeIds = nodes.map(node => node.id);
        
        // Get connections where either source or target is in this context
        const connections = await DialPlanConnection.findAll({
          where: {
            [models.Sequelize.Op.or]: [
              { sourceNodeId: { [models.Sequelize.Op.in]: nodeIds } },
              { targetNodeId: { [models.Sequelize.Op.in]: nodeIds } }
            ]
          },
          include: [
            {
              model: DialPlanNode,
              as: 'sourceNode',
              attributes: ['id', 'name', 'label', 'nodeTypeId', 'contextId'],
              include: [
                {
                  model: NodeType,
                  as: 'type',
                  attributes: ['id', 'name', 'category']
                }
              ]
            },
            {
              model: DialPlanNode,
              as: 'targetNode',
              attributes: ['id', 'name', 'label', 'nodeTypeId', 'contextId'],
              include: [
                {
                  model: NodeType,
                  as: 'type',
                  attributes: ['id', 'name', 'category']
                }
              ]
            }
          ]
        });
        
        res.json(connections);
      } catch (error) {
        console.error('Error fetching connections:', error);
        res.status(500).json({ error: 'Failed to fetch connections' });
      }
    },
    
    /**
     * Create a new connection
     */
    createConnection: async (req, res) => {
      try {
        const { sourceNodeId, targetNodeId, condition, priority } = req.body;
        const tenantId = req.user.tenantId;
        
        if (!sourceNodeId || !targetNodeId) {
          return res.status(400).json({ error: 'Source and target nodes are required' });
        }
        
        // Verify both nodes exist and belong to the tenant
        const sourceNode = await DialPlanNode.findOne({
          where: { id: sourceNodeId },
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
              as: 'type'
            }
          ]
        });
        
        if (!sourceNode) {
          return res.status(404).json({ error: 'Source node not found' });
        }
        
        const targetNode = await DialPlanNode.findOne({
          where: { id: targetNodeId },
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
              as: 'type'
            }
          ]
        });
        
        if (!targetNode) {
          return res.status(404).json({ error: 'Target node not found' });
        }
        
        // Check if both nodes are in the same project
        if (sourceNode.context.projectId !== targetNode.context.projectId) {
          return res.status(400).json({ 
            error: 'Cannot connect nodes from different projects' 
          });
        }
        
        // Check if the connection is valid based on node types
        if (sourceNode.type.validConnections && 
            sourceNode.type.validConnections.length > 0 && 
            !sourceNode.type.validConnections.includes(targetNode.type.category)) {
          return res.status(400).json({ 
            error: `Cannot connect ${sourceNode.type.name} to ${targetNode.type.name}` 
          });
        }
        
        // Check if this connection already exists
        const existingConnection = await DialPlanConnection.findOne({
          where: {
            sourceNodeId,
            targetNodeId
          }
        });
        
        if (existingConnection) {
          return res.status(400).json({ error: 'Connection already exists' });
        }
        
        // For some node types like Hangup, no outgoing connections are allowed
        if (sourceNode.type.validConnections && sourceNode.type.validConnections.length === 0) {
          return res.status(400).json({ 
            error: `${sourceNode.type.name} nodes cannot have outgoing connections` 
          });
        }
        
        // Create the connection
        const connection = await DialPlanConnection.create({
          sourceNodeId,
          targetNodeId,
          condition: condition || null,
          priority: priority || 1,
          metadata: {}
        });
        
        // Return the connection with node info
        const createdConnection = await DialPlanConnection.findByPk(connection.id, {
          include: [
            {
              model: DialPlanNode,
              as: 'sourceNode',
              attributes: ['id', 'name', 'label', 'nodeTypeId'],
              include: [
                {
                  model: NodeType,
                  as: 'type',
                  attributes: ['id', 'name', 'category']
                }
              ]
            },
            {
              model: DialPlanNode,
              as: 'targetNode',
              attributes: ['id', 'name', 'label', 'nodeTypeId'],
              include: [
                {
                  model: NodeType,
                  as: 'type',
                  attributes: ['id', 'name', 'category']
                }
              ]
            }
          ]
        });
        
        res.status(201).json(createdConnection);
      } catch (error) {
        console.error('Error creating connection:', error);
        res.status(500).json({ error: 'Failed to create connection' });
      }
    },
    
    /**
     * Update a connection
     */
    updateConnection: async (req, res) => {
      try {
        const { id } = req.params;
        const { condition, priority, metadata } = req.body;
        const tenantId = req.user.tenantId;
        
        // Verify the connection exists and belongs to the tenant
        const connection = await DialPlanConnection.findOne({
          where: { id },
          include: [
            {
              model: DialPlanNode,
              as: 'sourceNode',
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
            }
          ]
        });
        
        if (!connection) {
          return res.status(404).json({ error: 'Connection not found' });
        }
        
        const updatedConnection = await connection.update({
          condition: condition !== undefined ? condition : connection.condition,
          priority: priority || connection.priority,
          metadata: metadata || connection.metadata
        });
        
        res.json(updatedConnection);
      } catch (error) {
        console.error('Error updating connection:', error);
        res.status(500).json({ error: 'Failed to update connection' });
      }
    },
    
    /**
     * Delete a connection
     */
    deleteConnection: async (req, res) => {
      try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        
        // Verify the connection exists and belongs to the tenant
        const connection = await DialPlanConnection.findOne({
          where: { id },
          include: [
            {
              model: DialPlanNode,
              as: 'sourceNode',
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
            }
          ]
        });
        
        if (!connection) {
          return res.status(404).json({ error: 'Connection not found' });
        }
        
        await connection.destroy();
        
        res.json({ message: 'Connection deleted successfully' });
      } catch (error) {
        console.error('Error deleting connection:', error);
        res.status(500).json({ error: 'Failed to delete connection' });
      }
    }
  };
};
