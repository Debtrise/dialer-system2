const { DataTypes } = require('sequelize');

module.exports = function(sequelize) {
  const LeadProvider = sequelize.define('LeadProvider', {
    tenantId: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    contact: { type: DataTypes.JSONB, defaultValue: {} },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
  });

  const LeadListing = sequelize.define('LeadListing', {
    providerId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    pricePerLead: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    deliveryMethod: { type: DataTypes.ENUM('csv', 'webhook', 'live_call'), allowNull: false },
    availableLeads: { type: DataTypes.INTEGER, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
  });

  const LeadOrder = sequelize.define('LeadOrder', {
    buyerTenantId: { type: DataTypes.STRING, allowNull: false },
    listingId: { type: DataTypes.INTEGER, allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    pricePerLead: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    totalCost: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'completed', 'cancelled'), defaultValue: 'pending' },
    // Number of leads from this order that were eventually closed by the buyer.
    closedLeads: { type: DataTypes.INTEGER, defaultValue: 0 }
  });

  LeadProvider.hasMany(LeadListing, { foreignKey: 'providerId' });
  LeadListing.belongsTo(LeadProvider, { foreignKey: 'providerId' });

  LeadListing.hasMany(LeadOrder, { foreignKey: 'listingId' });
  LeadOrder.belongsTo(LeadListing, { foreignKey: 'listingId' });

  return { LeadProvider, LeadListing, LeadOrder };
};
