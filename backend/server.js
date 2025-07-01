require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const AmiClient = require('asterisk-ami-client');
const { Readable } = require('stream');
const csv = require('csv-parser');
const { Sequelize, DataTypes, Op } = require('sequelize');
const cron = require('node-cron');
const path = require('path');
const moment = require('moment-timezone');
const crypto = require('crypto');
const fs = require('fs').promises;

const initWebhookIntegration = require('../shared/webhook-integration');

// Import the DialPlan Builder module
const initDialPlanBuilder = require('../dialplan-builder');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
console.log('✅ Static file serving enabled for /uploads');

app.use('/uploads/content/thumbnails', express.static(path.join(__dirname, 'uploads/content/thumbnails')));
app.use('/uploads/content/previews', express.static(path.join(__dirname, 'uploads/content/previews')));
app.use('/uploads/content/assets', express.static(path.join(__dirname, 'uploads/content/assets')));
app.use('/uploads/content/sales-rep-thumbnails', express.static(path.join(__dirname, 'uploads/content/sales-rep-thumbnails')));
app.use('/uploads/content/sales-rep-previews', express.static(path.join(__dirname, 'uploads/content/sales-rep-previews')));
console.log('✅ Content creation static file serving configured');

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// PostgreSQL connection
const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
  host: 'localhost',
  dialect: 'postgres',
  logging: false
});

// Global AMI client for event listening
let globalAmiClient = null;
let amiConnected = false;
let activeCallMap = new Map();
let knownContexts = new Set();

// Global module references - FIXED: Initialize early with proper declarations
let journeyModels = null;
let journeyService = null;
let webhookModels = null;
let twilioModels = null;
let templateModels = null;
let reportingModels = null;
let reportBuilderModels = null;
let recordingModels = null;
let tracersModels = null;
let optisignsModels = null;
let contentModels = null;
let contentService = null;
let optisignsService = null; // FIXED: Properly declared as global
let billingModels = null;

// Utility: ensure optisigns_displays.current_playlist_id column uses UUID type
async function fixCurrentPlaylistColumn(sequelize) {
  try {
    const [info] = await sequelize.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'optisigns_displays'
        AND column_name = 'current_playlist_id';
    `);
    const type = info[0]?.data_type;
    if (type && type !== 'uuid') {
      console.log('🔧 Converting optisigns_displays.current_playlist_id to UUID');
      await sequelize.query(`
        UPDATE "optisigns_displays"
        SET "current_playlist_id" = NULL
        WHERE "current_playlist_id" IS NOT NULL
          AND "current_playlist_id" !~* '^[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}$';
      `);
      await sequelize.query(`
        ALTER TABLE "optisigns_displays"
        ALTER COLUMN "current_playlist_id" TYPE UUID
        USING current_playlist_id::uuid;
      `);
      console.log('✅ Column converted to UUID');
    }
  } catch (err) {
    console.error('⚠️ Column conversion failed:', err.message);
  }
}

// Remove takeover records referencing displays that no longer exist
async function removeOrphanTakeovers(sequelize) {
  try {
    const [_, metadata] = await sequelize.query(`
      DELETE FROM "optisigns_takeovers" t
      WHERE NOT EXISTS (
        SELECT 1 FROM "optisigns_displays" d WHERE d.id = t.display_id
      );
    `);
    const removed = metadata?.rowCount || metadata || 0;
    if (removed > 0) {
      console.log(`🧹 Removed ${removed} orphaned optisigns_takeovers records`);
    }
  } catch (err) {
    console.error('⚠️ Failed to clean up orphaned takeovers:', err.message);
  }
}

// Database Models
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
  firstName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  timezone: {
    type: DataTypes.STRING,
    defaultValue: 'America/New_York'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  lastLogin: {
    type: DataTypes.DATE,
    allowNull: true
  },
  passwordChangedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  preferences: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  deletedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  deletedBy: {
    type: DataTypes.INTEGER,
    allowNull: true
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
      password: '4USz9PfeiV8',
      ingroup: 'TaxSales',
      url: ''
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
      context: 'BDS_Prime_Dialer'
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
      enabled: true,
      speed: 1.5,
      minAgentsAvailable: 2,
      autoDelete: false,
      sortOrder: 'oldest',
      didDistribution: 'even'
    }
  },
  timezone: {
    type: DataTypes.STRING,
    defaultValue: 'America/Los_Angeles'
  }
});

// Models from shared folder
const {
  Lead,
  CallLog,
  DID
} = require('../shared/lead-models')(sequelize);

// JWT Middleware
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

// Function to initialize and maintain AMI connection for event listening
const initializeAmiConnection = async (tenant) => {
  if (amiConnected && globalAmiClient) {
    if (tenant && tenant.amiConfig && tenant.amiConfig.context) {
      knownContexts.add(tenant.amiConfig.context);
      console.log(`Added context ${tenant.amiConfig.context} to known contexts`);
    }
    return globalAmiClient;
  }

  if (!tenant || !tenant.amiConfig) {
    console.warn('Cannot initialize AMI connection: missing tenant or AMI config');
    return null;
  }

  try {
    console.log('Initializing AMI connection for event listening...');
    
    globalAmiClient = new AmiClient({
      host: tenant.amiConfig.host,
      port: tenant.amiConfig.port,
      username: tenant.amiConfig.username,
      password: tenant.amiConfig.password,
      reconnect: true,
      reconnectTimeout: 5000,
      maxReconnectCount: 10
    });

    globalAmiClient.connect()
      .then(() => {
        console.log('✅ AMI connected successfully for event listening');
        amiConnected = true;
        
        if (tenant.amiConfig.context) {
          knownContexts.add(tenant.amiConfig.context);
          console.log(`Added context ${tenant.amiConfig.context} to known contexts`);
        }

        // Listen for Newchannel events (call initiation)
        globalAmiClient.on('newchannel', (event) => {
          console.log('📞 New channel created:', event);
          
          if (knownContexts.has(event.context)) {
            const callId = event.uniqueid;
            activeCallMap.set(callId, {
              channel: event.channel,
              context: event.context,
              calleridnum: event.calleridnum,
              startTime: new Date(),
              status: 'initiated'
            });
            console.log(`📊 Tracking new call: ${callId} in context ${event.context}`);
          }
        });

        // Listen for Hangup events (call termination)
        globalAmiClient.on('hangup', (event) => {
          console.log('📴 Channel hangup:', event);
          
          const callId = event.uniqueid;
          if (activeCallMap.has(callId)) {
            const callData = activeCallMap.get(callId);
            callData.endTime = new Date();
            callData.hangupCause = event.cause;
            callData.status = 'ended';
            
            console.log(`📊 Call ${callId} ended. Duration: ${(callData.endTime - callData.startTime) / 1000}s`);
            
            activeCallMap.delete(callId);
          }
        });

        // Listen for DialBegin events
        globalAmiClient.on('dialbegin', (event) => {
          console.log('📞 Dial begin:', event);
        });

        // Listen for DialEnd events
        globalAmiClient.on('dialend', (event) => {
          console.log('📞 Dial end:', event);
        });

      })
      .catch((error) => {
        console.error('❌ AMI connection failed:', error);
        amiConnected = false;
        globalAmiClient = null;
      });

    return globalAmiClient;
  } catch (error) {
    console.error('❌ Error initializing AMI connection:', error);
    amiConnected = false;
    globalAmiClient = null;
    return null;
  }
};

// FIXED: Initialize all modules with corrected order and service passing
async function initializeModules() {
  console.log('Initializing modules...');

  // Ensure optisigns_displays.current_playlist_id uses UUID type
  await fixCurrentPlaylistColumn(sequelize);
  // Clean up orphaned takeovers before syncing
  await removeOrphanTakeovers(sequelize);
  
  // FIXED: Initialize OptisignsService FIRST before other modules that depend on it
  try {
    console.log('Initializing Optisigns module...');
    const initOptisigns = require('../shared/optisigns-integration');
    const optisignsIntegration = initOptisigns(app, sequelize, authenticateToken);
    optisignsModels = optisignsIntegration.models;
    optisignsService = optisignsIntegration.services?.optisignsService;
    
    // FIXED: Add verification that optisignsService is properly initialized
    if (optisignsService) {
      console.log('✅ OptiSigns service successfully initialized and available');
      console.log('🔧 OptiSigns service methods available:', Object.getOwnPropertyNames(Object.getPrototypeOf(optisignsService)));
    } else {
      console.error('❌ OptiSigns service failed to initialize properly');
    }
    
    console.log('Optisigns module initialized successfully');
  } catch (error) {
    console.error('Error initializing Optisigns module:', error);
  }

  // Initialize the DialPlan Builder module
  console.log('Initializing DialPlan Builder module...');
  const dialplanBuilder = initDialPlanBuilder(app, sequelize, authenticateToken);
  console.log('DialPlan Builder module initialized successfully');
  
  // Initialize journey module
  try {
    console.log('Initializing Journey module...');
    const initJourneyModels = require('../shared/journey-models');
    journeyModels = initJourneyModels(sequelize);
    
    // Sync journey models
    await sequelize.sync({ force: false, alter: false });
    
    const initJourneyRoutes = require('../shared/journey-routes');
    const journeyInit = initJourneyRoutes(app, sequelize, authenticateToken, journeyModels);
    journeyService = journeyInit.service;
    
    console.log('Journey module initialized successfully');
  } catch (error) {
    console.error('Error initializing journey module:', error);
  }

  // Initialize Content Creator module
  try {
    console.log('Initializing Content Creation module...');
    const initContentCreation = require('../shared/content-creation-integration');
    const contentIntegration = initContentCreation(app, sequelize, authenticateToken, optisignsModels);
    contentModels = contentIntegration.models;
    contentService = contentIntegration.services?.contentService;
    console.log('Content Creation module initialized successfully');
  } catch (error) {
    console.error('Error initializing Content Creation module:', error);
  }

  // Initialize Sales Rep Photo module
  try {
    console.log('Initializing Sales Rep Photo module...');
    
    if (contentService) {
      const initSalesRepPhotos = require('../shared/sales-rep-photo-routes');
      initSalesRepPhotos(app, sequelize, authenticateToken, contentService);
      console.log('Sales Rep Photo module initialized successfully');
      setTimeout(async () => {
        try {
          const existingTemplate = await sequelize.models.ContentTemplate?.findOne({
            where: { 
              name: 'Deal Closed Celebration',
              tenantId: 'system'
            }
          });

          if (!existingTemplate) {
            console.log('🚀 Setting up Sales Rep Photo template...');
            const { setupSalesRepPhotoFeature } = require('../shared/setup/setup-sales-rep-photos');
            await setupSalesRepPhotoFeature(sequelize, contentService);
            console.log('✅ Sales Rep Photo template created!');
          }
        } catch (error) {
          console.error('⚠️ Template setup error:', error.message);
        }
      }, 5000);
    }
  } catch (error) {
    console.error('Error initializing Sales Rep Photo module:', error);
  }

  // Initialize User Routes
  console.log('Initializing User Routes module...');
  const userRoutes = require('../shared/user-routes');
  userRoutes(app, sequelize, authenticateToken);
  console.log('User Routes module initialized successfully');

  console.log('Initializing Lead Routes module...');
  const leadRoutes = require('../shared/lead-routes');
  leadRoutes(app, sequelize, authenticateToken);
  console.log('Lead Routes module initialized successfully');

  // FIXED: Initialize the Webhook Integration module AFTER optisignsService is available
  console.log('Initializing Webhook Integration module...');
  
  // FIXED: Add service availability checks before passing to webhook integration
  console.log('🔍 Service availability check before webhook integration:');
  console.log('   - contentService:', !!contentService);
  console.log('   - optisignsService:', !!optisignsService);
  
  if (!optisignsService) {
    console.error('❌ WARNING: optisignsService is not available for webhook integration');
  }
  
  // FIXED: Pass the actual service objects directly, not wrapped in services objects
  const webhookIntegration = initWebhookIntegration(
    app,
    sequelize,
    authenticateToken,
    { 
      contentService: contentService,      // Direct reference
      services: { contentService },        // Also keep services wrapper for compatibility
      models: contentModels 
    },
    { 
      optisignsService: optisignsService,  // Direct reference  
      services: { optisignsService },      // Also keep services wrapper for compatibility
      models: optisignsModels 
    }
  );
  
  // FIXED: Store webhook models globally for cron jobs
  webhookModels = webhookIntegration.models;
  
  console.log('Webhook Integration module initialized successfully');
  console.log('🎯 Webhook capabilities:', webhookIntegration.capabilities);

  // Initialize Twilio module
  try {
    const initSms = require('../shared/sms-routes');
    const smsModels = initSms(app, sequelize, authenticateToken);
    twilioModels = smsModels.twilioModels;
    console.log('SMS module initialized successfully (Twilio + Meera)');
  } catch (error) {
    console.error('Error initializing SMS module:', error);
  }

  // Initialize template module
  try {
    const initTemplates = require('../shared/template-routes');
    templateModels = initTemplates(app, sequelize, authenticateToken, contentService);
    console.log('Template module initialized successfully');
  } catch (error) {
    console.error('Error initializing template module:', error);
  }

  // Initialize reporting module
  try {
    const initReporting = require('../shared/reporting-routes');
    reportingModels = initReporting(app, sequelize, authenticateToken);
    console.log('Reporting module initialized successfully');
  } catch (error) {
    console.error('Error initializing reporting module:', error);
  }

  // Initialize report builder module
  try {
    const initReportBuilder = require('../shared/report-builder-routes');
    reportBuilderModels = initReportBuilder(app, sequelize, authenticateToken);
    console.log('Report builder module initialized successfully');
  } catch (error) {
    console.error('Error initializing report builder module:', error);
  }

  // Initialize billing module
  try {
    const initBillingModels = require('../shared/billing-models');
    billingModels = initBillingModels(sequelize);
    const initBillingRoutes = require('../shared/billing-routes');
    initBillingRoutes(app, sequelize, authenticateToken);
    console.log('Billing module initialized successfully');
  } catch (error) {
    console.error('Error initializing billing module:', error);
  }

  try {
    const initRecordings = require('../shared/recording-routes');
    recordingModels = initRecordings(app, sequelize, authenticateToken);
    console.log('Recording module initialized successfully');
  } catch (error) {
    console.error('Error initializing recording module:', error);
  }

  // Initialize TracersAPI module
  try {
    const initTracers = require('../shared/tracers-routes');
    tracersModels = initTracers(app, sequelize, authenticateToken);
    console.log('TracersAPI module initialized successfully');
  } catch (error) {
    console.error('Error initializing TracersAPI module:', error);
  }
  
  return {
    dialplanBuilder,
    recordingModels,
    reportBuilderModels
  };
}

// Define routes after module initialization
async function defineRoutes(dialplanBuilder) {
  const router = express.Router();

  // Auth routes
  app.post('/api/register', async (req, res) => {
    try {
      const { username, password, email, tenantId, role, firstName, lastName } = req.body;
      
      const userExists = await User.findOne({ where: { username } });
      if (userExists) return res.status(400).json({ error: 'User already exists' });
      
      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      
      // Password validation
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
      }
      
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      
      const user = await User.create({
        username,
        password: hashedPassword,
        email,
        tenantId,
        role: role || 'agent',
        firstName,
        lastName,
        isActive: true
      });
      
      res.status(201).json({ message: 'User created successfully' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/login', async (req, res) => {
    console.log('🔥 LOGIN ROUTE HIT - START');
    
    try {
      const { username, password } = req.body;
      console.log("Login attempt for:", username);
      console.log("Request body received:", { username, password: password ? '[PROVIDED]' : '[MISSING]' });
      
      // Validate input
      if (!username || !password) {
        console.log('❌ Missing username or password');
        return res.status(400).json({ error: 'Username and password are required' });
      }
      
      console.log('🔍 Searching for user in database...');
      
      // Find user with explicit error handling
      let user;
      try {
        user = await User.findOne({ 
          where: { 
            username,
            isActive: true
          } 
        });
        console.log('✅ Database query completed');
      } catch (dbError) {
        console.error('❌ Database error during user lookup:', dbError);
        return res.status(500).json({ error: 'Database error during login' });
      }
      
      if (!user) {
        console.log('❌ User not found or inactive');
        return res.status(400).json({ error: 'Invalid username or password' });
      }
      
      console.log('✅ User found:', user.username);
      console.log('🔍 Comparing password...');
      
      // Compare password with explicit error handling
      let validPassword;
      try {
        validPassword = await bcrypt.compare(password, user.password);
        console.log('✅ Password comparison completed');
      } catch (bcryptError) {
        console.error('❌ Bcrypt error during password comparison:', bcryptError);
        return res.status(500).json({ error: 'Password verification error' });
      }
      
      if (!validPassword) {
        console.log('❌ Invalid password');
        return res.status(400).json({ error: 'Invalid username or password' });
      }
      
      console.log('✅ Password valid');
      console.log('🔍 Updating last login...');
      
      // Update last login with error handling
      try {
        await user.update({ lastLogin: new Date() });
        console.log('✅ Last login updated');
      } catch (updateError) {
        console.error('❌ Error updating last login:', updateError);
        // Don't fail login for this, just log it
      }
      
      console.log('🔍 Generating JWT token...');
      
      // Generate JWT with error handling
      let token;
      try {
        token = jwt.sign({ 
          id: user.id, 
          username: user.username, 
          tenantId: user.tenantId, 
          role: user.role 
        }, JWT_SECRET || 'your-secret-key', { expiresIn: '1d' });
        console.log('✅ JWT token generated successfully');
      } catch (jwtError) {
        console.error('❌ JWT generation error:', jwtError);
        return res.status(500).json({ error: 'Token generation error' });
      }
      
      console.log('🔥 LOGIN SUCCESSFUL - SENDING RESPONSE');
      
      res.json({ 
        token, 
        user: { 
          id: user.id, 
          username: user.username, 
          tenantId: user.tenantId, 
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName
        } 
      });
      
    } catch (err) {
      console.error('❌ FATAL LOGIN ERROR:', err);
      res.status(400).json({ error: 'Login failed due to server error' });
    }
  });

  // Add the service status endpoint with service details
  app.get('/api/service-status', authenticateToken, async (req, res) => {
    try {
      const serviceStatus = {
        database: true,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        services: {
          dialplanBuilder: !!dialplanBuilder,
          contentService: !!contentService,
          optisignsService: !!optisignsService, // FIXED: Now properly shows optisignsService status
          journeyService: !!journeyModels,
          twilioService: !!twilioModels,
          reportingService: !!reportingModels,
          billingService: !!billingModels,
          recordingService: !!recordingModels,
          tracersService: !!tracersModels,
          webhookService: !!webhookModels
        },
        capabilities: {
          announcements: !!contentService && !!optisignsService, // FIXED: This should now work properly
          journeyManagement: !!journeyModels,
          contentGeneration: !!contentService,
          displayControl: !!optisignsService,
          generator: !!dialplanBuilder?.services?.generatorService,
          validator: !!dialplanBuilder?.services?.validationService,
          deployment: !!dialplanBuilder?.services?.deploymentService
        }
      };
      
      res.json(serviceStatus);
    } catch (error) {
      res.status(500).json({ error: 'Error retrieving service status' });
    }
  });

  // Test endpoint to verify OptisignsService integration
  app.get('/api/test-optisigns', authenticateToken, async (req, res) => {
    try {
      if (!optisignsService) {
        return res.status(503).json({ 
          error: 'OptiSigns service not available',
          debug: {
            optisignsModels: !!optisignsModels,
            optisignsService: !!optisignsService
          }
        });
      }
      
      // Test basic service functionality
      const isConfigured = await optisignsService.isConfigured(req.user.tenantId);
      
      res.json({
        message: 'OptiSigns service is working',
        configured: isConfigured,
        tenantId: req.user.tenantId,
        serviceMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(optisignsService)),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('OptiSigns test error:', error);
      res.status(500).json({ 
        error: error.message,
        debug: {
          optisignsService: !!optisignsService,
          errorType: error.constructor.name
        }
      });
    }
  });

  // Image proxy endpoint
  app.get('/api/proxy-image', async (req, res) => {
    try {
      const { url, w, h, q } = req.query;
      
      if (!url) {
        return res.status(400).json({ error: 'Image URL is required' });
      }

      // Validate URL format
      let imageUrl;
      try {
        imageUrl = new URL(url);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid URL format' });
      }

      // Security: Only allow HTTP/HTTPS
      if (!['http:', 'https:'].includes(imageUrl.protocol)) {
        return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are allowed' });
      }

      // Generate cache key
      const cacheKey = crypto.createHash('md5').update(url).digest('hex');
      const cachePath = path.join(__dirname, 'cache', `${cacheKey}.img`);
      const metaPath = path.join(__dirname, 'cache', `${cacheKey}.meta`);

      // Ensure cache directory exists
      await fs.mkdir(path.join(__dirname, 'cache'), { recursive: true });

      // Check cache first
      try {
        const stats = await fs.stat(cachePath);
        const age = Date.now() - stats.mtime.getTime();
        
        if (age < 24 * 60 * 60 * 1000) { // 24 hours
          // Serve from cache
          const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
          
          res.set({
            'Content-Type': meta.contentType,
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
            'X-Proxy-Cache': 'HIT'
          });
          
          const fileStream = require('fs').createReadStream(cachePath);
          return fileStream.pipe(res);
        }
      } catch (cacheError) {
        // Cache miss, continue to fetch
      }

      // Fetch fresh image
      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 10000,
        headers: {
          'User-Agent': 'Knittt-Image-Proxy/1.0'
        }
      });

      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        return res.status(400).json({ error: 'URL does not point to an image' });
      }

      // Save to cache and stream to response
      const writeStream = require('fs').createWriteStream(cachePath);
      const metaData = { contentType, cachedAt: new Date().toISOString() };
      
      await fs.writeFile(metaPath, JSON.stringify(metaData));

      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
        'X-Proxy-Cache': 'MISS'
      });

      // Pipe to both cache and response
      response.data.pipe(writeStream);
      response.data.pipe(res);

    } catch (error) {
      console.error('Cached image proxy error:', error.message);
      res.status(500).json({ error: 'Failed to proxy image' });
    }
  });
}

// Helper function to match lead against criteria
function matchesLeadCriteria(lead, criteria) {
  if (criteria.statuses && criteria.statuses.length > 0) {
    if (!criteria.statuses.includes(lead.status)) {
      return false;
    }
  }
  
  if (criteria.priorities && criteria.priorities.length > 0) {
    if (!criteria.priorities.includes(lead.priority)) {
      return false;
    }
  }
  
  if (criteria.tags && criteria.tags.length > 0) {
    if (!lead.tags || !criteria.tags.some(tag => lead.tags.includes(tag))) {
      return false;
    }
  }
  
  if (criteria.campaigns && criteria.campaigns.length > 0) {
    if (!lead.campaign || !criteria.campaigns.includes(lead.campaign)) {
      return false;
    }
  }
  
  if (criteria.brands && criteria.brands.length > 0) {
    if (!lead.brand || !criteria.brands.includes(lead.brand)) {
      return false;
    }
  }
  
  if (criteria.sources && criteria.sources.length > 0) {
    if (!lead.source || !criteria.sources.includes(lead.source)) {
      return false;
    }
  }
  
  return true;
}

async function setupModelRelationships() {
  console.log('Setting up enhanced model relationships...');
  
  // Get all models
  const { Lead, Tenant, CallLog, DID, Plan, Subscription, PaymentMethod } = sequelize.models;
  
  // Core Lead relationships
  if (Lead && CallLog) {
    // Clear any existing associations to prevent duplicates
    if (Lead.associations.callLogs) {
      delete Lead.associations.callLogs;
    }
    if (CallLog.associations.lead) {
      delete CallLog.associations.lead;
    }
    
    Lead.hasMany(CallLog, { 
      foreignKey: 'leadId',
      as: 'callLogs',
      onDelete: 'CASCADE'
    });
    CallLog.belongsTo(Lead, {
      foreignKey: 'leadId',
      as: 'lead'
    });
    console.log('✅ Lead-CallLog relationships established');
  }

  // Billing relationships
  if (Tenant && Subscription) {
    Tenant.hasMany(Subscription, { foreignKey: 'tenantId' });
    Subscription.belongsTo(Tenant, { foreignKey: 'tenantId' });
  }
  if (Plan && Subscription) {
    Plan.hasMany(Subscription, { foreignKey: 'planId' });
    Subscription.belongsTo(Plan, { foreignKey: 'planId' });
  }
  if (PaymentMethod && Subscription) {
    PaymentMethod.hasMany(Subscription, { foreignKey: 'paymentMethodId' });
    Subscription.belongsTo(PaymentMethod, { foreignKey: 'paymentMethodId' });
  }

  // Journey relationships - only add instance methods since associations are already set up
  if (journeyModels && Lead) {
    const { Journey, JourneyStep, LeadJourney, JourneyExecution } = journeyModels;
    
    // Add instance methods to Lead
    if (!Lead.prototype.getActiveJourneys) {
      Lead.prototype.getActiveJourneys = async function() {
        return await LeadJourney.findAll({
          where: {
            leadId: this.id,
            status: 'active'
          },
          include: [{
            model: Journey,
            include: [JourneyStep]
          }]
        });
      };
    }
    
    if (!Lead.prototype.getCurrentJourneyStep) {
      Lead.prototype.getCurrentJourneyStep = async function() {
        const activeJourney = await LeadJourney.findOne({
          where: {
            leadId: this.id,
            status: 'active'
          },
          include: [{
            model: Journey,
            include: [JourneyStep]
          }]
        });
        
        if (!activeJourney) return null;
        
        return await JourneyStep.findByPk(activeJourney.currentStepId);
      };
    }
    
    // Add static methods to Journey model
    if (!Journey.getActiveLeadCount) {
      Journey.getActiveLeadCount = async function() {
        return await LeadJourney.count({
          where: {
            journeyId: this.id,
            status: 'active'
          }
        });
      };
    }
    
    if (!Journey.prototype.getCompletionRate) {
      Journey.prototype.getCompletionRate = async function() {
        const total = await LeadJourney.count({
          where: { journeyId: this.id }
        });
        
        if (total === 0) return 0;
        
        const completed = await LeadJourney.count({
          where: {
            journeyId: this.id,
            status: 'completed'
          }
        });
        
        return (completed / total) * 100;
      };
    }
    
    console.log('✅ Journey instance and class methods added');
  } else {
    console.log('⚠️  Journey models not available, skipping journey enhancements');
  }
}

async function createSampleDialplan(tenantId, dialplanBuilder) {
  try {
    const { DialPlanProject, DialPlanContext, DialPlanNode } = dialplanBuilder.models;
    
    const project = await DialPlanProject.create({
      name: "Sample IVR",
      description: "A sample IVR project",
      tenantId,
      isActive: false
    });
    
    const context = await DialPlanContext.create({
      projectId: project.id,
      name: "default",
      description: "Main IVR context"
    });
    
    await DialPlanNode.create({
      contextId: context.id,
      nodeTypeId: 1,
      name: "Main Entry",
      position: { x: 50, y: 50 },
      properties: {
        exten: "s",
        priority: 1
      }
    });
    
    console.log(`Created sample dialplan for tenant ${tenantId}`);
    return project.id;
  } catch (error) {
    console.error(`Error creating sample dialplan: ${error.message}`);
    return null;
  }
}

// Initialize database and start server
async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    // Ensure schema compatibility before syncing
    await fixCurrentPlaylistColumn(sequelize);
    // Remove any takeovers referencing missing displays
    await removeOrphanTakeovers(sequelize);

    await sequelize.sync({ alter: false });
    console.log('Database models synchronized.');
    
    // Initialize modules before defining routes
    const { dialplanBuilder, recordingModels, reportBuilderModels } = await initializeModules();
    
    // Define all routes
    await defineRoutes(dialplanBuilder);

    // Set up enhanced model relationships
    await setupModelRelationships();

    // FIXED: Update cron jobs to use the correct webhook integration
    // Process scheduled webhook resumes every 2 minutes
    cron.schedule('*/2 * * * *', async () => {
      try {
        if (webhookModels && optisignsService && contentService) {
          // FIXED: Create webhook service instance with proper services
          const WebhookService = require('../shared/webhook-service');
          const webhookService = new WebhookService(
            {
              WebhookEndpoint: webhookModels.WebhookEndpoint,
              WebhookEvent: webhookModels.WebhookEvent,
              LeadPauseState: webhookModels.LeadPauseState,
              AnnouncementMetric: webhookModels.AnnouncementMetric,
              Lead: sequelize.models.Lead,
              Tenant: sequelize.models.Tenant,
              ContentAsset: contentModels?.ContentAsset || sequelize.models.ContentAsset,
              Sequelize: sequelize.Sequelize,
              OptisignsDisplay: sequelize.models.OptisignsDisplay,
              OptisignsTakeover: sequelize.models.OptisignsTakeover,
            },
            null, // journeyService
            contentService,
            optisignsService // FIXED: Now properly passes optisignsService
          );
          
          const processedCount = await webhookService.processScheduledResumes();
          if (processedCount > 0) {
            console.log(`Processed ${processedCount} scheduled webhook resumes`);
          }
        }
      } catch (error) {
        console.error('Error in webhook scheduled resume processor:', error);
      }
    });

    // Check webhook resume conditions every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      try {
        if (webhookModels && optisignsService && contentService) {
          // FIXED: Create webhook service instance with proper services
          const WebhookService = require('../shared/webhook-service');
          const webhookService = new WebhookService(
            {
              WebhookEndpoint: webhookModels.WebhookEndpoint,
              WebhookEvent: webhookModels.WebhookEvent,
              LeadPauseState: webhookModels.LeadPauseState,
              AnnouncementMetric: webhookModels.AnnouncementMetric,
              Lead: sequelize.models.Lead,
              Tenant: sequelize.models.Tenant,
              ContentAsset: contentModels?.ContentAsset || sequelize.models.ContentAsset,
              Sequelize: sequelize.Sequelize,
              OptisignsDisplay: sequelize.models.OptisignsDisplay,
              OptisignsTakeover: sequelize.models.OptisignsTakeover,
            },
            null, // journeyService
            contentService,
            optisignsService // FIXED: Now properly passes optisignsService
          );
          
          const resumedCount = await webhookService.checkAndResumeLeads();
          if (resumedCount > 0) {
            console.log(`Resumed ${resumedCount} leads from webhook conditions`);
          }
        }
      } catch (error) {
        console.error('Error in webhook resume condition checker:', error);
      }
    });

    // Start the Express server
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log('✅ All modules initialized successfully');
      console.log('🚀 Knittt application ready with enhanced OptiSigns integration');
      
      // FIXED: Add final verification logging
      console.log('🔧 Final service verification:');
      console.log('   - contentService:', !!contentService ? '✅ Available' : '❌ Missing');
      console.log('   - optisignsService:', !!optisignsService ? '✅ Available' : '❌ Missing');
      console.log('   - webhookModels:', !!webhookModels ? '✅ Available' : '❌ Missing');
      console.log('   - Announcements capability:', (!!contentService && !!optisignsService) ? '✅ Ready' : '❌ Not available');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down gracefully...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Unable to start server:', error);
    process.exit(1);
  }
}

startServer();