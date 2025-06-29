// dialplan-builder/services/validationService.js

/**
 * Service for validating dial plans
 * @param {Object} models - Database models
 * @returns {Object} Validation service methods
 */
module.exports = (models) => {
  const { DialPlanProject, DialPlanContext, DialPlanNode, DialPlanConnection, NodeType } = models;

  /**
   * Validate a complete dialplan project
   * @param {number} projectId - Project ID
   * @param {string} tenantId - Tenant ID
   * @returns {Object} Validation results
   */
  const validateProject = async (projectId, tenantId) => {
    try {
      // Verify the project belongs to the tenant
      const project = await DialPlanProject.findOne({
        where: { id: projectId, tenantId },
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
                    model: NodeType,
                    as: 'type'
                  },
                  {
                    model: DialPlanConnection,
                    as: 'outgoingConnections',
                    include: [
                      {
                        model: DialPlanNode,
                        as: 'targetNode',
                        include: [
                          {
                            model: NodeType,
                            as: 'type'
                          }
                        ]
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
                        include: [
                          {
                            model: NodeType,
                            as: 'type'
                          }
                        ]
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
        throw new Error('Project not found');
      }
      
      const validationErrors = [];
      const warnings = [];
      
      // Project-level validations
      if (project.contexts.length === 0) {
        validationErrors.push({
          level: 'project',
          message: 'Project has no contexts',
          severity: 'error'
        });
      }
      
      // Context-level validations
      for (const context of project.contexts) {
        // Check if context has at least one node
        if (context.nodes.length === 0) {
          validationErrors.push({
            level: 'context',
            contextId: context.id,
            contextName: context.name,
            message: `Context "${context.name}" has no nodes`,
            severity: 'error'
          });
          continue; // Skip further validations for this empty context
        }
        
        // Check if context has at least one extension
        const hasExtension = context.nodes.some(node => node.type.name === 'Extension');
        if (!hasExtension) {
          validationErrors.push({
            level: 'context',
            contextId: context.id,
            contextName: context.name,
            message: `Context "${context.name}" has no extension nodes`,
            severity: 'error'
          });
        }
        
        // Check for include loops
        const includeNodes = context.nodes.filter(node => node.type.name === 'Include');
        for (const includeNode of includeNodes) {
          const includedContextName = includeNode.properties.context;
          
          // Check if the included context exists
          const includedContext = project.contexts.find(c => c.name === includedContextName);
          if (!includedContext) {
            validationErrors.push({
              level: 'node',
              nodeId: includeNode.id,
              nodeName: includeNode.name,
              contextId: context.id,
              contextName: context.name,
              message: `Include references non-existent context "${includedContextName}"`,
              severity: 'error'
            });
            continue;
          }
          
          // Check for circular includes
          const circularCheck = (currentContext, visited = new Set()) => {
            if (visited.has(currentContext.name)) {
              return true; // Circular dependency found
            }
            
            visited.add(currentContext.name);
            
            const currentIncludes = currentContext.nodes.filter(node => node.type.name === 'Include');
            
            for (const include of currentIncludes) {
              const targetName = include.properties.context;
              const targetContext = project.contexts.find(c => c.name === targetName);
              
              if (targetContext && circularCheck(targetContext, new Set(visited))) {
                return true;
              }
            }
            
            return false;
          };
          
          if (circularCheck(includedContext)) {
            validationErrors.push({
              level: 'node',
              nodeId: includeNode.id,
              nodeName: includeNode.name,
              contextId: context.id,
              contextName: context.name,
              message: `Circular include detected for context "${includedContextName}"`,
              severity: 'error'
            });
          }
        }
        
        // Node-level validations
        for (const node of context.nodes) {
          // Check required properties
          if (node.type.name === 'Extension') {
            if (!node.properties.exten) {
              validationErrors.push({
                level: 'node',
                nodeId: node.id,
                nodeName: node.name,
                contextId: context.id,
                contextName: context.name,
                message: `Extension node "${node.name}" has no extension number`,
                severity: 'error'
              });
            }
          }
          
          // Check for Hangup or Goto nodes with outgoing connections
          if ((node.type.name === 'Hangup' || node.type.name === 'Goto') && 
              node.outgoingConnections && node.outgoingConnections.length > 0) {
            validationErrors.push({
              level: 'node',
              nodeId: node.id,
              nodeName: node.name,
              contextId: context.id,
              contextName: context.name,
              message: `${node.type.name} node "${node.name}" has outgoing connections that will never be executed`,
              severity: 'warning'
            });
          }
          
          // Check for terminal nodes without outgoing connections
          if (node.type.name !== 'Hangup' && 
              node.type.name !== 'Goto' && 
              (!node.outgoingConnections || node.outgoingConnections.length === 0) &&
              node.incomingConnections && node.incomingConnections.length > 0) {
            warnings.push({
              level: 'node',
              nodeId: node.id,
              nodeName: node.name,
              contextId: context.id,
              contextName: context.name,
              message: `Node "${node.name}" has no outgoing connections and is not a terminal node`,
              severity: 'warning'
            });
          }
          
          // Check for orphaned nodes (no incoming or outgoing connections)
          if ((!node.incomingConnections || node.incomingConnections.length === 0) &&
              (!node.outgoingConnections || node.outgoingConnections.length === 0) &&
              node.type.name !== 'Extension' && 
              node.type.name !== 'Include') {
            warnings.push({
              level: 'node',
              nodeId: node.id,
              nodeName: node.name,
              contextId: context.id,
              contextName: context.name,
              message: `Node "${node.name}" is isolated with no connections`,
              severity: 'warning'
            });
          }
          
          // Check specific node types
          if (node.type.name === 'Dial') {
            if (!node.properties.destination) {
              validationErrors.push({
                level: 'node',
                nodeId: node.id,
                nodeName: node.name,
                contextId: context.id,
                contextName: context.name,
                message: `Dial node "${node.name}" has no destination`,
                severity: 'error'
              });
            }
          } else if (node.type.name === 'Playback' || node.type.name === 'BackGround') {
            if (!node.properties.filename) {
              validationErrors.push({
                level: 'node',
                nodeId: node.id,
                nodeName: node.name,
                contextId: context.id,
                contextName: context.name,
                message: `${node.type.name} node "${node.name}" has no filename`,
                severity: 'error'
              });
            }
          } else if (node.type.name === 'Queue') {
            if (!node.properties.queuename) {
              validationErrors.push({
                level: 'node',
                nodeId: node.id,
                nodeName: node.name,
                contextId: context.id,
                contextName: context.name,
                message: `Queue node "${node.name}" has no queue name`,
                severity: 'error'
              });
            }
          } else if (node.type.name === 'Voicemail') {
            if (!node.properties.mailbox) {
              validationErrors.push({
                level: 'node',
                nodeId: node.id,
                nodeName: node.name,
                contextId: context.id,
                contextName: context.name,
                message: `Voicemail node "${node.name}" has no mailbox`,
                severity: 'error'
              });
            }
          } else if (node.type.name === 'Set') {
            if (!node.properties.variable || !node.properties.value) {
              validationErrors.push({
                level: 'node',
                nodeId: node.id,
                nodeName: node.name,
                contextId: context.id,
                contextName: context.name,
                message: `Set node "${node.name}" has missing variable or value`,
                severity: 'error'
              });
            }
          } else if (node.type.name === 'Goto') {
            if (!node.properties.extension) {
              validationErrors.push({
                level: 'node',
                nodeId: node.id,
                nodeName: node.name,
                contextId: context.id,
                contextName: context.name,
                message: `Goto node "${node.name}" has no target extension`,
                severity: 'error'
              });
            }
          } else if (node.type.name === 'AGI') {
            if (!node.properties.command) {
              validationErrors.push({
                level: 'node',
                nodeId: node.id,
                nodeName: node.name,
                contextId: context.id,
                contextName: context.name,
                message: `AGI node "${node.name}" has no command`,
                severity: 'error'
              });
            }
          } else if (node.type.name === 'IVR Menu') {
            if (!node.properties.prompt) {
              validationErrors.push({
                level: 'node',
                nodeId: node.id,
                nodeName: node.name,
                contextId: context.id,
                contextName: context.name,
                message: `IVR Menu node "${node.name}" has no prompt`,
                severity: 'error'
              });
            }
            
            if (!node.properties.options || node.properties.options.length === 0) {
              validationErrors.push({
                level: 'node',
                nodeId: node.id,
                nodeName: node.name,
                contextId: context.id,
                contextName: context.name,
                message: `IVR Menu node "${node.name}" has no options`,
                severity: 'error'
              });
            } else {
              // Check if all options have corresponding connections
              const options = node.properties.options;
              const connections = node.outgoingConnections || [];
              
              for (const option of options) {
                const hasConnection = connections.some(conn => 
                  conn.condition === option.digit || 
                  (conn.metadata && conn.metadata.ivrOption === option.digit)
                );
                
                if (!hasConnection) {
                  warnings.push({
                    level: 'node',
                    nodeId: node.id,
                    nodeName: node.name,
                    contextId: context.id,
                    contextName: context.name,
                    message: `IVR Menu option "${option.digit}" (${option.label}) has no corresponding connection`,
                    severity: 'warning'
                  });
                }
              }
            }
          }
        }
        
        // Check for duplicate extensions
        const extensionNodes = context.nodes.filter(node => node.type.name === 'Extension');
        const extensionMap = new Map();
        
        for (const node of extensionNodes) {
          const exten = node.properties.exten;
          if (!exten) continue;
          
          if (!extensionMap.has(exten)) {
            extensionMap.set(exten, []);
          }
          
          extensionMap.get(exten).push(node);
        }
        
        for (const [exten, nodes] of extensionMap.entries()) {
          // Check for duplicate priorities within the same extension
          const priorityMap = new Map();
          
          for (const node of nodes) {
            const priority = node.properties.priority || 1;
            
            if (!priorityMap.has(priority)) {
              priorityMap.set(priority, []);
            }
            
            priorityMap.get(priority).push(node);
          }
          
          for (const [priority, priorityNodes] of priorityMap.entries()) {
            if (priorityNodes.length > 1) {
              validationErrors.push({
                level: 'context',
                contextId: context.id,
                contextName: context.name,
                message: `Duplicate priority ${priority} for extension ${exten}`,
                severity: 'error',
                nodes: priorityNodes.map(n => ({ id: n.id, name: n.name }))
              });
            }
          }
        }
      }
      
      // Check connectivity: every context should be reachable
      const reachableContexts = new Set();
      
      // Start with the default context
      const defaultContext = project.contexts.find(c => c.name === 'default');
      if (defaultContext) {
        reachableContexts.add(defaultContext.name);
      }
      
      // Traverse through includes and Goto nodes
      const traverseContexts = (contextName) => {
        const currentContext = project.contexts.find(c => c.name === contextName);
        if (!currentContext) return;
        
        // Check includes
        const includeNodes = currentContext.nodes.filter(node => node.type.name === 'Include');
        for (const includeNode of includeNodes) {
          const includedContextName = includeNode.properties.context;
          if (!reachableContexts.has(includedContextName)) {
            reachableContexts.add(includedContextName);
            traverseContexts(includedContextName);
          }
        }
        
        // Check Goto nodes
        const gotoNodes = currentContext.nodes.filter(node => node.type.name === 'Goto');
        for (const gotoNode of gotoNodes) {
          if (gotoNode.properties.context && !reachableContexts.has(gotoNode.properties.context)) {
            reachableContexts.add(gotoNode.properties.context);
            traverseContexts(gotoNode.properties.context);
          }
        }
      };
      
      // Start traversal
      if (defaultContext) {
        traverseContexts('default');
      } else if (project.contexts.length > 0) {
        // If no default context, start with the first one
        reachableContexts.add(project.contexts[0].name);
        traverseContexts(project.contexts[0].name);
      }
      
      // Check for unreachable contexts
      for (const context of project.contexts) {
        if (!reachableContexts.has(context.name)) {
          warnings.push({
            level: 'context',
            contextId: context.id,
            contextName: context.name,
            message: `Context "${context.name}" appears to be unreachable`,
            severity: 'warning'
          });
        }
      }
      
      // Return validation results
      return {
        valid: validationErrors.length === 0,
        errors: validationErrors,
        warnings,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error validating project:', error);
      throw error;
    }
  };
  
  return {
    validateProject
  };
};
