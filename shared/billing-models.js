const { DataTypes } = require('sequelize');

module.exports = function(sequelize) {
  // Prevent redefining models
  if (sequelize.models.Plan && sequelize.models.Subscription) {
    return {
      Plan: sequelize.models.Plan,
      Subscription: sequelize.models.Subscription,
      PaymentMethod: sequelize.models.PaymentMethod,
      Transaction: sequelize.models.Transaction
    };
  }

  const Plan = sequelize.define('Plan', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true
    }
  });

  const Subscription = sequelize.define('Subscription', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    planId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('active', 'canceled', 'trial'),
      defaultValue: 'active'
    },
    startDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    endDate: {
      type: DataTypes.DATE,
      allowNull: true
    }
  });

  const PaymentMethod = sequelize.define('PaymentMethod', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false
    },
    details: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  });

  const Transaction = sequelize.define('Transaction', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    subscriptionId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'paid', 'failed'),
      defaultValue: 'pending'
    },
    details: {
      type: DataTypes.JSONB,
      allowNull: true
    }
  });

  // Associations
  Plan.hasMany(Subscription, { foreignKey: 'planId' });
  Subscription.belongsTo(Plan, { foreignKey: 'planId' });

  Subscription.belongsTo(PaymentMethod, {
    foreignKey: 'paymentMethodId'
  });
  PaymentMethod.hasMany(Subscription, {
    foreignKey: 'paymentMethodId'
  });

  Subscription.hasMany(Transaction, { foreignKey: 'subscriptionId' });
  Transaction.belongsTo(Subscription, { foreignKey: 'subscriptionId' });

  return { Plan, Subscription, PaymentMethod, Transaction };
};
