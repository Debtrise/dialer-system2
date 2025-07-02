module.exports = function(sequelize, DataTypes) {
  if (sequelize.models.PBXConfig) {
    return { PBXConfig: sequelize.models.PBXConfig };
  }
  const PBXConfig = sequelize.define('PBXConfig', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    serverUrl: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'http://localhost'
    },
    websocketUrl: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'wss://localhost:8089/ws'
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false
    },
    domain: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'pbx.local'
    }
  });
  return { PBXConfig };
};
