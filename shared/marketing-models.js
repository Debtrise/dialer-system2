const { DataTypes } = require('sequelize');

module.exports = function(sequelize) {
  const AdAccount = sequelize.define('AdAccount', {
    tenantId: { type: DataTypes.STRING, allowNull: false },
    platform: { type: DataTypes.ENUM('facebook', 'google', 'tiktok'), allowNull: false },
    accountId: { type: DataTypes.STRING, allowNull: false },
    accessToken: { type: DataTypes.TEXT, allowNull: true },
    refreshToken: { type: DataTypes.TEXT, allowNull: true },
    tokenExpiresAt: { type: DataTypes.DATE, allowNull: true },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
  });

  const AdCampaign = sequelize.define('AdCampaign', {
    tenantId: { type: DataTypes.STRING, allowNull: false },
    adAccountId: { type: DataTypes.INTEGER, allowNull: false },
    externalId: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    params: { type: DataTypes.JSONB, defaultValue: {} },
    cost: { type: DataTypes.DECIMAL(10,2), defaultValue: 0 },
    leads: { type: DataTypes.INTEGER, defaultValue: 0 },
    conversions: { type: DataTypes.INTEGER, defaultValue: 0 },
    startDate: { type: DataTypes.DATE, allowNull: true },
    endDate: { type: DataTypes.DATE, allowNull: true }
  });

  const AdLead = sequelize.define('AdLead', {
    tenantId: { type: DataTypes.STRING, allowNull: false },
    adCampaignId: { type: DataTypes.INTEGER, allowNull: false },
    externalLeadId: { type: DataTypes.STRING, allowNull: true },
    leadId: { type: DataTypes.INTEGER, allowNull: true },
    data: { type: DataTypes.JSONB, defaultValue: {} },
    importedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  });

  AdAccount.hasMany(AdCampaign, { foreignKey: 'adAccountId' });
  AdCampaign.belongsTo(AdAccount, { foreignKey: 'adAccountId' });

  AdCampaign.hasMany(AdLead, { foreignKey: 'adCampaignId' });
  AdLead.belongsTo(AdCampaign, { foreignKey: 'adCampaignId' });

  return { AdAccount, AdCampaign, AdLead };
};
