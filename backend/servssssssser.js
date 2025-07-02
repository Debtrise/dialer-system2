6
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const AmiClient = require('asterisk-ami-client');
const { Readable } = require('stream');
const csv = require('csv-parser');
const { Sequelize, DataTypes } = require('sequelize');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Middleware
app.use(cors({
  origin: '*',  // Or specify your frontend URL
  credentials: true
}));

app.use(express.json());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));


// PostgreSQL connection
const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
  host: 'localhost',
  dialect: 'postgres',
  logging: false
});

// Models
const User = sequelize.define('User', {
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tenantId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('admin', 'agent'),
    defaultValue: 'agent'
  },
  permissions: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
});

const Tenant = sequelize.define('Tenant', {
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  apiConfig: {
    type: DataTypes.JSONB,
    defaultValue: {
      source: 'BTR',
      endpoint: 'test',
      user: 'Ytel2618231',
      password: '4USz9PfeiV8'
    }
  },
  amiConfig: {
    type: DataTypes.JSONB,
    defaultValue: {
      host: '34.29.105.211',
      port: 5038,
      username: 'admin',
      password: 'admin',
      trunk: 'MC',
      context: 'p1Dialer'
    }
  },
  schedule: {
    type: DataTypes.JSONB,
    defaultValue: {
      monday: { enabled: true, start: '09:00', end: '17:00' },
      tuesday: { enabled: true, start: '09:00', end: '17:00' },
      wednesday: { enabled: true, start: '09:00', end: '17:00' },
      thursday: { enabled: true, start: '09:00', end: '17:00' },
      friday: { enabled: true, start: '09:00', end: '17:00' },
      saturday: { enabled: false, start: '09:00', end: '17:00' },
      sunday: { enabled: false, start: '09:00', end: '17:00' }
    }
  },
  dialerConfig: {
    type: DataTypes.JSONB,
    defaultValue: {
      speed: 1.5,
      minAgentsAvailable: 2,
      autoDelete: false,
      sortOrder: 'oldest',
      didDistribution: 'even'
    }
  }
});

const Lead = sequelize.define('Lead', {
  tenantId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true
  },
  additionalData: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lastAttempt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  callDurations: {
    type: DataTypes.ARRAY(DataTypes.INTEGER),
    defaultValue: []
  },
  status: {
    type: DataTypes.ENUM('pending', 'contacted', 'transferred', 'completed', 'failed'),
    defaultValue: 'pending'
  }
});

const CallLog = sequelize.define('CallLog', {
  tenantId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  leadId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: Lead,
      key: 'id'
    }
  },
  from: {
    type: DataTypes.STRING,
    allowNull: false
  },
  to: {
    type: DataTypes.STRING,
    allowNull: false
  },
  transferNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  startTime: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  endTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  duration: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('initiated', 'answered', 'transferred', 'completed', 'failed'),
    defaultValue: 'initiated'
  }
});

const DID = sequelize.define('DID', {
  tenantId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  phoneNumber: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true
  },
  areaCode: {
    type: DataTypes.STRING,
    allowNull: true
  },
  state: {
    type: DataTypes.STRING,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  usageCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lastUsed: {
    type: DataTypes.DATE,
    allowNull: true
  }
});

// Define relationships
Lead.hasMany(CallLog, { foreignKey: 'leadId' });
CallLog.belongsTo(Lead, { foreignKey: 'leadId' });

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access denied' });
  
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid token' });
  }
};

// Auth routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email, tenantId, role } = req.body;
    
    const userExists = await User.findOne({ where: { username } });
    if (userExists) return res.status(400).json({ error: 'User already exists' });
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const user = await User.create({
      username,
      password: hashedPassword,
      email,
      tenantId,
      role,
      permissions: {}
    });
    
    res.status(201).json({ message: 'User created successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log("Login attempt for:", username);
    
    const user = await User.findOne({ where: { username } });
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid username or password' });
    
    const token = jwt.sign(
      { id: user.id, username: user.username, tenantId: user.tenantId, role: user.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );
    
    console.log("Login successful for:", username);
    res.json({ token, userId: user.id, username: user.username, tenantId: user.tenantId, role: user.role });
  } catch (err) {
    console.error("Login error:", err);
    res.status(400).json({ error: err.message });
  }
});

// Tenant routes
app.post('/api/tenants', async (req, res) => {
  try {
    const tenant = await Tenant.create(req.body);
    res.status(201).json(tenant);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/tenants/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.tenantId !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const tenant = await Tenant.findByPk(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    
    res.json(tenant);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/tenants/:id', authenticateToken, async (req, res) => {
  try {
    const targetId = req.params.id;
    const requester = req.user;

    // Only allow admin or the tenant itself
    if (requester.tenantId !== targetId && requester.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Load the tenant
    const tenant = await Tenant.findByPk(targetId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Build a merge-patch for apiConfig
    const incoming = req.body;
    let apiConfigUpdate = { ...tenant.apiConfig };

    // If they passed a top-level "ingroups" key, merge it in
    if (typeof incoming.ingroups === 'string') {
      apiConfigUpdate.ingroups = incoming.ingroups;
      delete incoming.ingroups;
    }

    // If they passed an "apiConfig" object, merge any of its keys too
    if (incoming.apiConfig && typeof incoming.apiConfig === 'object') {
      apiConfigUpdate = {
        ...apiConfigUpdate,
        ...incoming.apiConfig
      };
      delete incoming.apiConfig;
    }

    // Now perform the update: all other incoming fields + the merged apiConfig
    const [updatedCount] = await Tenant.update(
      {
        ...incoming,         // e.g. name, endpoint, etc.
        apiConfig: apiConfigUpdate
      },
      { where: { id: targetId } }
    );

    if (!updatedCount) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Return the refreshed tenant
    const refreshed = await Tenant.findByPk(targetId);
    res.json(refreshed);

  } catch (err) {
    console.error('Error updating tenant:', err);
    res.status(400).json({ error: err.message });
  }
});



// Lead routes
app.post('/api/leads/upload', authenticateToken, async (req, res) => {
  try {
    const { fileContent, options } = req.body;
    const tenantId = req.user.tenantId;
    
    const results = [];
    const stream = Readable.from(fileContent);
    
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });
    
    const leads = results.map(row => {
      const lead = {
        tenantId,
        phone: row.phone || row.Phone || row.PhoneNumber || row.phone_number || '',
        name: row.name || row.Name || row.FullName || row.full_name || '',
        email: row.email || row.Email || '',
        additionalData: {}
      };
      
      Object.keys(row).forEach(key => {
        if (!['phone', 'Phone', 'PhoneNumber', 'phone_number', 'name', 'Name', 'FullName', 'full_name', 'email', 'Email'].includes(key)) {
          lead.additionalData[key] = row[key];
        }
      });
      
      return lead;
    });
    
    const validLeads = leads.filter(lead => lead.phone);
    
    if (validLeads.length === 0) {
      return res.status(400).json({ error: 'No valid leads found' });
    }
    
    await Lead.bulkCreate(validLeads);
    
    res.status(201).json({ message: `${validLeads.length} leads imported successfully` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/leads', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const tenantId = req.user.tenantId;
    
    const query = { where: { tenantId } };
    if (status) query.where.status = status;
    
    const leads = await Lead.findAll({
      ...query,
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
      order: [['createdAt', 'DESC']]
    });
    
    const count = await Lead.count(query);
    
    res.json({
      leads,
      totalPages: Math.ceil(count / parseInt(limit)),
      currentPage: parseInt(page)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


app.get('/api/agent-status', authenticateToken, async (req, res) => {
  const { url, ingroups, user, pass } = req.query;

  // Validate required query params
  if (!url || !ingroups || !user || !pass) {
    return res.status(400).json({
      error: 'Missing required query parameters: url, ingroups, user, pass'
    });
  }

  // Extract subdomain (e.g. "btr" from "btr.ytel.com")
  let subdomain;
  try {
    const { hostname } = new URL(url);
    subdomain = hostname.split('.')[0];
  } catch (err) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  try {
    // Build the Ytel API params
    const apiParams = {
      source:    subdomain,
      user,
      pass,
      stage:     'csv',
      function:  'in_group_status',
      header:    'YES',
      in_groups: ingroups
    };

    // Call the Ytel endpoint
    const response = await axios.get(url, { params: apiParams });

    // Parse the CSV response
    const results = [];
    const stream = Readable.from(response.data);
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', row => results.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    // Shape the agent-status objects
    const agentStatuses = results.map(row => ({
      ingroup:           row.ingroup || ingroups,
      agents_logged_in:  parseInt(row.agents_logged_in, 10) || 0,
      agents_waiting:    parseInt(row.agents_waiting, 10) || 0,
      total_calls:       parseInt(row.total_calls, 10) || 0,
      calls_waiting:     parseInt(row.calls_waiting, 10) || 0,
      brand:             'Tax',
      source:            subdomain
    }));

    // Return everything
    return res.json({
      subdomain,   // e.g. "btr"
      user,        // e.g. "Ytel2618231"
      pass,        // e.g. "4USz9PfeiV8"
      ingroups,    // e.g. "TaxSales"
      data: agentStatuses
    });

  } catch (error) {
    console.error('Agent status error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});


app.post('/api/make-call', authenticateToken, async (req, res) => {
  try {
    const { to, transfer_number, from, trunk, context, exten, priority, timeout, variables } = req.body;
    const asyncParam = req.body.async || 'true';
    const tenantId = req.user.tenantId;

    if (!to || !transfer_number || !from) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // Validate AMI config
    if (!tenant.amiConfig || !tenant.amiConfig.host || !tenant.amiConfig.port) {
      return res.status(400).json({ error: 'Invalid AMI configuration' });
    }

    // Create call log
    const callLog = await CallLog.create({
      tenantId,
      to,
      from,
      transferNumber: transfer_number,
      status: 'initiated',
      startTime: new Date()
    });

    // Build variable string
    let variableString = `transfer_number=${transfer_number},to=${to}`;
    if (variables && typeof variables === 'object') {
      Object.entries(variables).forEach(([key, value]) => {
        variableString += `,${key}=${value}`;
      });
    }

    // Construct AMI action
    const action = {
      Action: 'Originate',
      Channel: `PJSIP/${to}@${trunk || tenant.amiConfig.trunk}`,
      Context: context || tenant.amiConfig.context,
      Exten: exten || 's',
      Priority: priority || 1,
      CallerID: from,
      Timeout: timeout || 40000,
      Async: asyncParam,
      Variable: variableString
    };

    try {
      console.log("Connecting to AMI:", {
        host: tenant.amiConfig.host,
        port: tenant.amiConfig.port,
        username: tenant.amiConfig.username,
        password: '***'
      });

      // Create AMI client
      const ami = new AmiClient();

      // === Corrected connect signature ===
      await ami.connect(
        tenant.amiConfig.username,                     // AMI username
        tenant.amiConfig.password,                     // AMI secret/password
        {
          host: tenant.amiConfig.host,                 // Asterisk host or IP
          port: parseInt(tenant.amiConfig.port, 10)    // AMI port (usually 5038)
        }
      );

      console.log("Sending AMI action:", {
        ...action,
        Variable: variableString.substring(0, 20) + '...'
      });

      // Send the originate action
      const response = await ami.action(action, true);

      // Disconnect from AMI
      await ami.disconnect();

      // Return success
      res.json({
        message: 'Call initiated successfully',
        callId: callLog.id,
        amiResponse: response
      });
    } catch (error) {
      console.error("AMI error:", error);
      await callLog.update({ status: 'failed' });
      res.status(500).json({
        error: 'AMI connection failed',
        details: error.message
      });
    }
  } catch (err) {
    console.error("Call error:", err);
    res.status(400).json({ error: err.message });
  }
});


// DID routes
app.get('/api/dids', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, isActive } = req.query;
    const tenantId = req.user.tenantId;
    
    const query = { where: { tenantId } };
    if (isActive !== undefined) query.where.isActive = isActive === 'true';
    
    const dids = await DID.findAll({
      ...query,
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
      order: [['phoneNumber', 'ASC']]
    });
    
    const count = await DID.count(query);
    
    res.json({
      dids,
      totalPages: Math.ceil(count / parseInt(limit)),
      currentPage: parseInt(page)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/dids', authenticateToken, async (req, res) => {
  try {
    const { phoneNumber, description, areaCode, state } = req.body;
    const tenantId = req.user.tenantId;
    
    if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber.replace(/\D/g, ''))) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
    
    const did = await DID.create({
      tenantId,
      phoneNumber,
      description,
      areaCode: areaCode || phoneNumber.replace(/\D/g, '').substring(0, 3),
      state,
      isActive: true
    });
    
    res.status(201).json(did);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/dids/:id', authenticateToken, async (req, res) => {
  try {
    const { description, isActive } = req.body;
    const tenantId = req.user.tenantId;
    
    const did = await DID.findByPk(req.params.id);
    if (!did) return res.status(404).json({ error: 'DID not found' });
    
    if (did.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    await did.update({ description, isActive });
    
    res.json(did);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reports routes
app.get('/api/reports/daily', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { date } = req.query;
    
    const startDate = date ? new Date(date) : new Date();
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);
    
    const calls = await CallLog.findAll({
      where: {
        tenantId,
        startTime: {
          [Sequelize.Op.between]: [startDate, endDate]
        }
      }
    });
    
    const totalCalls = calls.length;
    const answeredCalls = calls.filter(call => call.status !== 'failed' && call.status !== 'initiated').length;
    const transfers = calls.filter(call => call.status === 'transferred').length;
    
    const callsOver1Min = calls.filter(call => call.duration && call.duration >= 60).length;
    const callsOver5Min = calls.filter(call => call.duration && call.duration >= 300).length;
    const callsOver15Min = calls.filter(call => call.duration && call.duration >= 900).length;
    
    const connectionRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0;
    const transferRate = answeredCalls > 0 ? (transfers / answeredCalls) * 100 : 0;
    
    res.json({
      date: startDate,
      totalCalls,
      answeredCalls,
      transfers,
      callsOver1Min,
      callsOver5Min,
      callsOver15Min,
      connectionRate: connectionRate.toFixed(2),
      transferRate: transferRate.toFixed(2)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Initialize database and start server
async function startServer() {
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    
    // Sync models with database
    await sequelize.sync({ alter: true });
    console.log('Database models synchronized.');

    // Create a default tenant and user if none exist
    const tenantsCount = await Tenant.count();
    if (tenantsCount === 0) {
      console.log('Creating default tenant and admin user...');
      const tenant = await Tenant.create({
        name: "Default Company"
      });
      
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('admin123', salt);
      
      await User.create({
        username: 'admin',
        password: hashedPassword,
        email: 'admin@example.com',
        tenantId: tenant.id.toString(),
        role: 'admin',
        permissions: {}
      });
      
      console.log('Default tenant and admin user created successfully');
      console.log('Login with username: admin, password: admin123');
    }
    
    // Start Express server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
  }
}

startServer();
