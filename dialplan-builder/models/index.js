const { Sequelize, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  // Define models and their relationships
  
  // DialPlanProject - represents a complete dial plan project
  const DialPlanProject = sequelize.define('DialPlanProject', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    lastDeployed: {
      type: DataTypes.DATE,
      allowNull: true
    }
  });

  // DialPlanContext - represents an Asterisk context
  const DialPlanContext = sequelize.define('DialPlanContext', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'DialPlanProjects',
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    position: {
      type: DataTypes.JSONB,
      defaultValue: { x: 0, y: 0 }
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  });

  // NodeType - represents a type of node (extension, application, etc.)
  const NodeType = sequelize.define('NodeType', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    icon: {
      type: DataTypes.STRING,
      allowNull: true
    },
    backgroundColor: {
      type: DataTypes.STRING,
      allowNull: true
    },
    asteriskApp: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isSystem: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    validConnections: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  });

  // NodeProperty - represents a configurable property of a node type
  const NodeProperty = sequelize.define('NodeProperty', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    nodeTypeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'NodeTypes',
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    displayName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('string', 'number', 'boolean', 'select', 'multiselect', 'template'),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    defaultValue: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    required: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    options: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    validation: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    order: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    }
  });

  // DialPlanNode - represents a node in the dial plan (extension, application call, etc.)
  const DialPlanNode = sequelize.define('DialPlanNode', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    contextId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'DialPlanContexts',
        key: 'id'
      }
    },
    nodeTypeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'NodeTypes',
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    label: {
      type: DataTypes.STRING,
      allowNull: true
    },
    position: {
      type: DataTypes.JSONB,
      defaultValue: { x: 0, y: 0 }
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    },
    properties: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  });

  // DialPlanConnection - represents a connection between nodes
  const DialPlanConnection = sequelize.define('DialPlanConnection', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    sourceNodeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'DialPlanNodes',
        key: 'id'
      }
    },
    targetNodeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'DialPlanNodes',
        key: 'id'
      }
    },
    condition: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  });

  // Define relationships
  DialPlanProject.hasMany(DialPlanContext, { foreignKey: 'projectId', as: 'contexts', onDelete: 'CASCADE' });
  DialPlanContext.belongsTo(DialPlanProject, { foreignKey: 'projectId', as: 'project' });

  DialPlanContext.hasMany(DialPlanNode, { foreignKey: 'contextId', as: 'nodes', onDelete: 'CASCADE' });
  DialPlanNode.belongsTo(DialPlanContext, { foreignKey: 'contextId', as: 'context' });

  NodeType.hasMany(NodeProperty, { foreignKey: 'nodeTypeId', as: 'properties', onDelete: 'CASCADE' });
  NodeProperty.belongsTo(NodeType, { foreignKey: 'nodeTypeId', as: 'nodeType' });

  NodeType.hasMany(DialPlanNode, { foreignKey: 'nodeTypeId', as: 'nodes' });
  DialPlanNode.belongsTo(NodeType, { foreignKey: 'nodeTypeId', as: 'type' });

  DialPlanNode.hasMany(DialPlanConnection, { foreignKey: 'sourceNodeId', as: 'outgoingConnections' });
  DialPlanNode.hasMany(DialPlanConnection, { foreignKey: 'targetNodeId', as: 'incomingConnections' });
  DialPlanConnection.belongsTo(DialPlanNode, { foreignKey: 'sourceNodeId', as: 'sourceNode' });
  DialPlanConnection.belongsTo(DialPlanNode, { foreignKey: 'targetNodeId', as: 'targetNode' });

  // Deploy History - tracks deployments
  const DeploymentHistory = sequelize.define('DeploymentHistory', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'DialPlanProjects',
        key: 'id'
      }
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    deployedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    status: {
      type: DataTypes.ENUM('success', 'failed'),
      allowNull: false
    },
    serverResponse: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    configSnapshot: {
      type: DataTypes.JSONB,
      allowNull: true
    }
  });

  DialPlanProject.hasMany(DeploymentHistory, { foreignKey: 'projectId', as: 'deployments' });
  DeploymentHistory.belongsTo(DialPlanProject, { foreignKey: 'projectId', as: 'project' });

  return {
    DialPlanProject,
    DialPlanContext,
    DialPlanNode,
    DialPlanConnection,
    NodeType,
    NodeProperty,
    DeploymentHistory
  };
};
