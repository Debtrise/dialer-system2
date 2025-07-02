const { DataTypes } = require('sequelize');

module.exports = function(sequelize) {
  if (sequelize.models.Stage) {
    return { Stage: sequelize.models.Stage };
  }

  const Stage = sequelize.define('Stage', {
    tenantId: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    catalysts: { type: DataTypes.JSONB, defaultValue: [] }
  });

  return { Stage };
};
