// verify-database.js
// Run this script to check and fix your database schema

const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');

// Database connection (update with your credentials)
const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
  host: 'localhost',
  dialect: 'postgres',
  logging: console.log // Enable logging to see queries
});

// User model definition
const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  username: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  tenantId: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('admin', 'agent'),
    defaultValue: 'agent'
  },
  firstName: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  lastName: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  lastLogin: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'Users',
  timestamps: true
});

// Tenant model definition
const Tenant = sequelize.define('Tenant', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  companyName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  apiConfig: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  timezone: {
    type: DataTypes.STRING,
    defaultValue: 'America/Los_Angeles'
  }
}, {
  tableName: 'Tenants',
  timestamps: true
});

// Billing models
const Plan = sequelize.define('Plan', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  price: { type: DataTypes.DECIMAL(10,2), allowNull: false },
  description: { type: DataTypes.TEXT },
  metadata: { type: DataTypes.JSONB }
}, { tableName: 'Plans', timestamps: true });

const Subscription = sequelize.define('Subscription', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  tenantId: { type: DataTypes.STRING, allowNull: false },
  planId: { type: DataTypes.UUID, allowNull: false },
  paymentMethodId: { type: DataTypes.UUID },
  status: { type: DataTypes.ENUM('active','canceled','trial'), defaultValue: 'active' },
  startDate: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  endDate: { type: DataTypes.DATE }
}, { tableName: 'Subscriptions', timestamps: true });

const PaymentMethod = sequelize.define('PaymentMethod', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  tenantId: { type: DataTypes.STRING, allowNull: false },
  type: { type: DataTypes.STRING, allowNull: false },
  details: { type: DataTypes.JSONB },
  isDefault: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { tableName: 'PaymentMethods', timestamps: true });

const Transaction = sequelize.define('Transaction', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  tenantId: { type: DataTypes.STRING, allowNull: false },
  subscriptionId: { type: DataTypes.UUID, allowNull: false },
  amount: { type: DataTypes.DECIMAL(10,2), allowNull: false },
  status: { type: DataTypes.ENUM('pending','paid','failed'), defaultValue: 'pending' },
  details: { type: DataTypes.JSONB }
}, { tableName: 'Transactions', timestamps: true });

async function verifyAndFixDatabase() {
  try {
    console.log('🔍 Checking database connection...');
    await sequelize.authenticate();
    console.log('✅ Database connection successful');

    console.log('\n🔍 Checking table schema...');
    
    // Check if tables exist
    const [userTableExists] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'Users'
      );
    `);
    
    const [tenantTableExists] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'Tenants'
      );
    `);

    console.log('Users table exists:', userTableExists[0].exists);
    console.log('Tenants table exists:', tenantTableExists[0].exists);

    console.log('\n🔧 Syncing database schema...');
    await sequelize.sync({ alter: true });
    console.log('✅ Database schema synchronized');

    console.log('\n🔍 Checking for default tenant...');
    let defaultTenant = await Tenant.findByPk('default-tenant');
    
    if (!defaultTenant) {
      console.log('Creating default tenant...');
      defaultTenant = await Tenant.create({
        id: 'default-tenant',
        name: 'Default Tenant',
        companyName: 'Default Company',
        apiConfig: {
          url: 'https://btr.ytel.com/api.php'
        },
        timezone: 'America/Los_Angeles'
      });
      console.log('✅ Default tenant created');
    } else {
      console.log('✅ Default tenant exists');
    }

    console.log('\n🔍 Checking for admin user...');
    let adminUser = await User.findOne({ where: { username: 'admin' } });
    
    if (!adminUser) {
      console.log('Creating admin user...');
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('admin123', salt);

      adminUser = await User.create({
        username: 'admin',
        password: hashedPassword,
        email: 'admin@example.com',
        tenantId: defaultTenant.id,
        role: 'admin',
        firstName: 'System',
        lastName: 'Administrator',
        isActive: true
      });
      console.log('✅ Admin user created');
    } else {
      console.log('✅ Admin user exists');
    }

    console.log('\n🔍 Testing login query...');
    const testUser = await User.findOne({
      where: {
        username: 'admin',
        isActive: true
      }
    });

    if (testUser) {
      console.log('✅ Login query test successful');
      console.log('User found:', {
        id: testUser.id,
        username: testUser.username,
        email: testUser.email,
        role: testUser.role,
        isActive: testUser.isActive
      });
    } else {
      console.log('❌ Login query test failed');
    }

    console.log('\n📋 Database verification complete!');
    console.log('Login credentials: username=admin, password=admin123');

  } catch (error) {
    console.error('❌ Database verification failed:', error);
    
    if (error.name === 'SequelizeConnectionError') {
      console.log('\n🔧 Connection troubleshooting:');
      console.log('1. Check if PostgreSQL is running');
      console.log('2. Verify database credentials');
      console.log('3. Ensure database "dialer_system" exists');
    } else if (error.name === 'SequelizeDatabaseError') {
      console.log('\n🔧 Database error details:', error.original?.message);
    }
  } finally {
    await sequelize.close();
  }
}

// Run the verification
verifyAndFixDatabase();