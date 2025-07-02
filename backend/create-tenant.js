require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/dialer-system');

// Import the Schemas
const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  apiConfig: {
    source: { type: String, enum: ['BTR', 'BDS'], default: 'BTR' },
    endpoint: { type: String, default: 'test' },
    user: { type: String, default: 'Ytel2618231' },
    password: { type: String, default: '4USz9PfeiV8' }
  },
  amiConfig: {
    host: { type: String, default: '34.29.105.211' },
    port: { type: Number, default: 5038 },
    username: { type: String, default: 'admin' },
    password: { type: String, default: 'admin' },
    trunk: { type: String, default: 'MC' },
    context: { type: String, default: 'p1Dialer' }
  },
  schedule: {
    monday: { enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } },
    tuesday: { enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } },
    wednesday: { enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } },
    thursday: { enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } },
    friday: { enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } },
    saturday: { enabled: { type: Boolean, default: false }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } },
    sunday: { enabled: { type: Boolean, default: false }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } }
  },
  dialerConfig: {
    speed: { type: Number, default: 1.5 },
    minAgentsAvailable: { type: Number, default: 2 },
    autoDelete: { type: Boolean, default: false },
    sortOrder: { type: String, enum: ['oldest', 'fewest'], default: 'oldest' },
    didDistribution: { type: String, enum: ['even', 'local'], default: 'even' }
  }
});

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true },
  tenantId: { type: String, required: true },
  role: { type: String, enum: ['admin', 'agent'], default: 'agent' },
  permissions: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now }
});

// Models
const Tenant = mongoose.model('Tenant', tenantSchema);
const User = mongoose.model('User', userSchema);

async function createTenantAndUser() {
  try {
    // Create new tenant
    const tenant = new Tenant({
      name: "Test Company",
    });

    const savedTenant = await tenant.save();
    console.log('Tenant created:', savedTenant);

    // Create admin user for this tenant
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password123', salt);

    const user = new User({
      username: 'admin',
      password: hashedPassword,
      email: 'admin@testcompany.com',
      tenantId: savedTenant._id,
      role: 'admin',
      permissions: {}
    });

    const savedUser = await user.save();
    console.log('Admin user created:', savedUser);
    
    console.log('\nLogin credentials:');
    console.log('Username: admin');
    console.log('Password: password123');
    console.log('Tenant ID:', savedTenant._id);

    mongoose.connection.close();
  } catch (error) {
    console.error('Error creating tenant and user:', error);
    mongoose.connection.close();
  }
}

// Run the function
createTenantAndUser();
