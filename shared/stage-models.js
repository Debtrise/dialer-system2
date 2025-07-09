const { DataTypes } = require('sequelize');

module.exports = function(sequelize) {
  if (sequelize.models.Stage) {
    return { Stage: sequelize.models.Stage };
  }

  // Complete Stage Model Definition - matches lead-models.js
  const Stage = sequelize.define('Stage', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    catalysts: {
      type: DataTypes.JSONB,
      defaultValue: []
    },
    order: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    color: {
      type: DataTypes.STRING,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'Stages',
    indexes: [
      {
        fields: ['tenantId']
      },
      {
        fields: ['tenantId', 'order']
      }
    ]
  });

  return { Stage };
};