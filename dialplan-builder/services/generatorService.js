// dialplan-builder/services/generatorService.js

/**
 * Service for generating Asterisk dialplan configurations
 * @param {Object} models - Database models
 * @returns {Object} Generator service methods
 */
module.exports = (models) => {
  const { DialPlanProject, DialPlanContext, DialPlanNode, DialPlanConnection, NodeType } = models;
  
  // Helper function to sort nodes by priority
  const sortNodesByPriority = (nodes) => {
    return [...nodes].sort((a, b) => a.priority - b.priority);
  };
  
  // Helper to convert node properties to Asterisk format
  const formatNodeProperties = (node, nodeType) => {
    let result = '';
    
    switch (nodeType.name) {
      case 'Extension':
        return `exten => ${node.properties.exten},${node.properties.priority}${node.properties.label ? '(' + node.properties.label + ')' : ''}`;
        
      case 'Include':
        return `include => ${node.properties.context}`;
        
      case 'Dial':
        let dialString = `${node.properties.technology}/${node.properties.destination}`;
        if (node.properties.timeout) {
          dialString += `,${node.properties.timeout}`;
        }
        if (node.properties.options) {
          dialString += `,${node.properties.options}`;
        }
        return `Dial(${dialString})`;
        
      case 'Answer':
        return node.properties.delay ? `Answer(${node.properties.delay})` : 'Answer()';
        
      case 'Hangup':
        return node.properties.cause ? `Hangup(${node.properties.cause})` : 'Hangup()';
        
      case 'Playback':
        return `Playback(${node.properties.filename}${node.properties.options ? ',' + node.properties.options : ''})`;
        
      case 'BackGround':
        return `Background(${node.properties.filename}${node.properties.options ? ',' + node.properties.options : ''})`;
        
      case 'Queue':
        let queueString = node.properties.queuename;
        if (node.properties.options) {
          queueString += `,${node.properties.options}`;
        }
        if (node.properties.timeout) {
          queueString += `,${node.properties.timeout}`;
        }
        return `Queue(${queueString})`;
        
      case 'Voicemail':
        return `Voicemail(${node.properties.mailbox}${node.properties.options ? ',' + node.properties.options : ''})`;
        
      case 'Set':
        return `Set(${node.properties.variable}=${node.properties.value})`;
        
      case 'Goto':
        let gotoString = '';
        if (node.properties.context) {
          gotoString += `${node.properties.context},`;
        }
        gotoString += `${node.properties.extension},${node.properties.priority}`;
        return `Goto(${gotoString})`;
        
      case 'WaitExten':
        return node.properties.timeout ? `WaitExten(${node.properties.timeout})` : 'WaitExten()';
        
      case 'AGI':
        return `AGI(${node.properties.command})`;
        
      // Handle complex node types
      case 'IVR Menu':
        return formatIvrMenu(node);
        
      case 'TimeCondition':
        return formatTimeCondition(node);
        
      default:
        return '';
    }
  };
  
  // Format IVR Menu node
  const formatIvrMenu = (node) => {
    const { prompt, timeout, options, invalidOption, maxRetries } = node.properties;
    
    let result = '';
    
    // Play the prompt
    result += `Background(${prompt})\n`;
    
    // Wait for input
    result += `  WaitExten(${timeout})`;
    
    // Options will be handled by connections
    
    return result;
  };
  
  // Format Time Condition node
  const formatTimeCondition = (node) => {
    // Time conditions will be handled by connections
    return 'GotoIfTime()';
  };
  
  // Generate complete dialplan for a project
  const generateDialplan = async (projectId, tenantId) => {
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
      
      let dialplanContent = '';
      const dialplanSections = [];
      
      // Process each context
      for (const context of project.contexts) {
        let contextContent = '';
        
        // Start context definition
        contextContent += `[${context.name}]\n`;
        
        // Get includes first
        const includeNodes = context.nodes.filter(node => node.type.name === 'Include');
        for (const includeNode of includeNodes) {
          contextContent += `${formatNodeProperties(includeNode, includeNode.type)}\n`;
        }
        
        // Group nodes by extension
        const extensionNodes = context.nodes.filter(node => 
          node.type.name === 'Extension'
        );
        
        // Map of extension name to array of nodes + their outgoing connections
        const extensionMap = new Map();
        
        // Map extension nodes to their dialplan sections
        for (const extNode of extensionNodes) {
          const exten = extNode.properties.exten;
          if (!extensionMap.has(exten)) {
            extensionMap.set(exten, []);
          }
          
          // For extension nodes, we need to follow the outgoing connections
          // to build the dialplan chain
          const extensionChain = [];
          
          // Start with the extension node itself
          extensionChain.push({
            node: extNode,
            nodeType: extNode.type,
            priority: extNode.properties.priority || 1
          });
          
          // Follow the chain
          let currentNode = extNode;
          let priority = 1;
          
          while (currentNode.outgoingConnections && currentNode.outgoingConnections.length > 0) {
            priority++;
            
            // Find the next connection with the lowest priority
            const nextConnections = sortNodesByPriority(currentNode.outgoingConnections);
            const nextConnection = nextConnections[0];
            
            // If the next node is in a different context, use Goto
            if (nextConnection.targetNode.contextId !== context.id) {
              const targetContext = project.contexts.find(c => c.id === nextConnection.targetNode.contextId);
              
              extensionChain.push({
                node: {
                  properties: {
                    context: targetContext.name,
                    extension: nextConnection.targetNode.properties.exten || 's',
                    priority: 1
                  }
                },
                nodeType: { name: 'Goto' },
                priority
              });
              
              // End the chain since we're jumping to another context
              break;
            }
            
            // For IVR Menus, handle the options
            if (currentNode.type.name === 'IVR Menu') {
              const ivrOptions = currentNode.properties.options || [];
              
              // For each option, add an extension pattern
              ivrOptions.forEach((option, index) => {
                const matchingConnection = currentNode.outgoingConnections.find(conn => 
                  conn.condition === option.digit || conn.metadata.ivrOption === option.digit
                );
                
                if (matchingConnection) {
                  extensionMap.get(exten).push({
                    node: {
                      properties: {
                        exten: option.digit,
                        priority: 1
                      }
                    },
                    nodeType: { name: 'Extension' },
                    nextNode: matchingConnection.targetNode
                  });
                }
              });
              
              // Also handle timeout and invalid options
              // (add these patterns as needed for your use case)
            }
            
            // Add the target node to the chain
            extensionChain.push({
              node: nextConnection.targetNode,
              nodeType: nextConnection.targetNode.type,
              priority
            });
            
            // Move to the next node in the chain
            currentNode = nextConnection.targetNode;
          }
          
          // Add the complete chain to the extension map
          extensionMap.set(exten, extensionChain);
        }
        
        // Now format the extensions
        for (const [exten, chain] of extensionMap.entries()) {
          // Sort by priority
          chain.sort((a, b) => a.priority - b.priority);
          
          // Format each step in the chain
          for (const step of chain) {
            if (step.nodeType.name === 'Extension') {
              contextContent += `${formatNodeProperties(step.node, step.nodeType)}`;
            } else {
              contextContent += `exten => ${exten},${step.priority},`;
              contextContent += formatNodeProperties(step.node, step.nodeType);
            }
            contextContent += '\n';
          }
          
          contextContent += '\n';
        }
        
        // Handle standalone nodes not attached to extensions
        const standaloneNodes = context.nodes.filter(node => 
          node.type.name !== 'Extension' && 
          node.type.name !== 'Include' &&
          !node.incomingConnections?.length
        );
        
        if (standaloneNodes.length > 0) {
          contextContent += '; Standalone nodes (not attached to extensions)\n';
          
          for (const node of standaloneNodes) {
            contextContent += `; ${node.name}\n`;
            contextContent += `; ${formatNodeProperties(node, node.type)}\n`;
          }
          
          contextContent += '\n';
        }
        
        dialplanSections.push(contextContent);
      }
      
      // Combine all sections
      dialplanContent = dialplanSections.join('\n');
      
      // Add header comment
      const header = `; Asterisk Dialplan Configuration\n`;
      const timestamp = `; Generated: ${new Date().toISOString()}\n`;
      const projectInfo = `; Project: ${project.name}\n\n`;
      
      dialplanContent = header + timestamp + projectInfo + dialplanContent;
      
      return {
        dialplan: dialplanContent,
        project: project.name,
        contexts: project.contexts.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error generating dialplan:', error);
      throw error;
    }
  };
  
  return {
    generateDialplan
  };
};
