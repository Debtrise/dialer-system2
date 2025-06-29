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

// Global module references - initialize early
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
let optisignsService = null;

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
  // NEW FIELDS ADDED
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

// Models have been moved to the shared folder
const {
  Lead,
  CallLog,
  DID
} = require('../shared/lead-models')(sequelize);

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

// Function to initialize and maintain AMI connection for event listening
const initializeAmiConnection = async (tenant) => {
  if (amiConnected && globalAmiClient) {
    if (tenant && tenant.amiConfig && tenant.amiConfig.context) {
      knownContexts.add(tenant.amiConfig.context);
      console.log(`Added tenant ${tenant.id} context "${tenant.amiConfig.context}" to monitored contexts`);
    }
    return globalAmiClient;
  }
  
  try {
    console.log("Initializing global AMI connection for event listening");
    globalAmiClient = new AmiClient();
    
    await globalAmiClient.connect(
      tenant.amiConfig.username,
      tenant.amiConfig.password,
      {
        host: tenant.amiConfig.host,
        port: parseInt(tenant.amiConfig.port, 10),
        reconnect: true,
        maxRetries: -1,
        retryInterval: 5000
      }
    );
    
    if (tenant.amiConfig.context) {
      knownContexts.add(tenant.amiConfig.context);
      console.log(`Added tenant ${tenant.id} context "${tenant.amiConfig.context}" to monitored contexts`);
    }
    
    setupAmiEventListeners(globalAmiClient);
    
    amiConnected = true;
    console.log("Global AMI connection established successfully");
    return globalAmiClient;
  } catch (error) {
    console.error(`Failed to initialize global AMI connection: ${error.message}`);
    amiConnected = false;
    globalAmiClient = null;
    throw error;
  }
};

// Set up event listeners for AMI events
const setupAmiEventListeners = (ami) => {
  ami.on('NewChannel', async (event) => {
    try {
      const { UniqueID, Context, CallerIDNum, Exten, ChannelStateDesc } = event;
      
      if (UniqueID && Context && knownContexts.has(Context)) {
        if (activeCallMap.has(UniqueID)) {
          const callData = activeCallMap.get(UniqueID);
          callData.context = Context;
          activeCallMap.set(UniqueID, callData);
        }
      }
    } catch (error) {
      console.error(`Error processing NewChannel event: ${error.message}`);
    }
  });

  ami.on('DialBegin', async (event) => {
    try {
      const { UniqueID, DestChannel, CallerIDNum, DialString, Context } = event;
      
      if (Context && !knownContexts.has(Context)) {
        return;
      }
      
      if (UniqueID) {
        const destPhone = DestChannel ? DestChannel.split('@')[0].replace('PJSIP/', '') : 
                          (DialString ? DialString.split('@')[0].replace('PJSIP/', '') : '');
        
        const callLog = await CallLog.findOne({
          where: {
            from: CallerIDNum,
            to: destPhone,
            status: 'initiated',
            endTime: null
          },
          order: [['startTime', 'DESC']]
        });
        
        if (callLog) {
          activeCallMap.set(UniqueID, {
            callLogId: callLog.id,
            tenantId: callLog.tenantId,
            context: Context
          });
        }
      }
    } catch (error) {
      console.error(`Error processing DialBegin event: ${error.message}`);
    }
  });

  ami.on('DialEnd', async (event) => {
    try {
      const { UniqueID, DialStatus, Context } = event;
      
      if (!UniqueID || !activeCallMap.has(UniqueID)) {
        return;
      }
      
      const callData = activeCallMap.get(UniqueID);
      
      if (Context && !knownContexts.has(Context) && 
          callData.context && !knownContexts.has(callData.context)) {
        return;
      }
      
      const callLog = await CallLog.findByPk(callData.callLogId);
      
      if (!callLog) {
        return;
      }
      
      if (DialStatus === 'ANSWER') {
        await callLog.update({ 
          status: 'answered',
          lastStatusUpdate: new Date()
        });
      } else if (DialStatus === 'BUSY' || DialStatus === 'NOANSWER' || DialStatus === 'CANCEL') {
        const endTime = new Date();
        const duration = Math.floor((endTime - callLog.startTime) / 1000);
        
        await callLog.update({
          status: 'failed',
          endTime,
          duration,
          lastStatusUpdate: new Date()
        });
      }
    } catch (error) {
      console.error(`Error processing DialEnd event: ${error.message}`);
    }
  });

  ami.on('Hangup', async (event) => {
    try {
      const { UniqueID, Cause, CauseTxt, Context } = event;
      
      if (!UniqueID || !activeCallMap.has(UniqueID)) {
        return;
      }
      
      const callData = activeCallMap.get(UniqueID);
      
      if (Context && !knownContexts.has(Context) && 
          callData.context && !knownContexts.has(callData.context)) {
        return;
      }
      
      const callLog = await CallLog.findByPk(callData.callLogId);
      
      if (!callLog) {
        return;
      }
      
      if (callLog.tenantId !== callData.tenantId) {
        console.warn(`Tenant mismatch for call ${UniqueID}: expected ${callData.tenantId}, found ${callLog.tenantId}`);
      }
      
      const endTime = new Date();
      const duration = Math.floor((endTime - callLog.startTime) / 1000);
      
      let status = 'completed';
      if (callLog.status === 'transferred') {
        status = 'transferred';
      } else if (duration < 5) {
        status = 'failed';
      }
      
      await callLog.update({
        status,
        endTime,
        duration,
        lastStatusUpdate: new Date()
      });
      
      if (callLog.leadId) {
        const lead = await Lead.findByPk(callLog.leadId);
        if (lead) {
          const callDurations = [...(lead.callDurations || []), duration];
          
          let leadStatus = lead.status;
          if (status === 'transferred') {
            leadStatus = 'transferred';
          } else if (status === 'completed' && duration >= 30) {
            leadStatus = 'completed';
          }
          
          await lead.update({
            callDurations,
            status: leadStatus
          });
        }
      }
      
      activeCallMap.delete(UniqueID);
    } catch (error) {
      console.error(`Error processing Hangup event: ${error.message}`);
    }
  });

  ami.on('BlindTransfer', async (event) => {
    try {
      const { UniqueID, TransferExten, Context } = event;
      
      if (!UniqueID || !activeCallMap.has(UniqueID)) {
        return;
      }
      
      const callData = activeCallMap.get(UniqueID);
      
      if (Context && !knownContexts.has(Context) && 
          callData.context && !knownContexts.has(callData.context)) {
        return;
      }
      
      const callLog = await CallLog.findByPk(callData.callLogId);
      
      if (!callLog) {
        return;
      }
      
      await callLog.update({
        status: 'transferred',
        transferNumber: TransferExten,
        lastStatusUpdate: new Date()
      });
      
      if (callLog.leadId) {
        const lead = await Lead.findByPk(callLog.leadId);
        if (lead) {
          await lead.update({ status: 'transferred' });
        }
      }
    } catch (error) {
      console.error(`Error processing BlindTransfer event: ${error.message}`);
    }
  });
  
  ami.on('disconnect', () => {
    console.log('AMI disconnected. Reconnection will be attempted automatically.');
    amiConnected = false;
  });
};
// Helper function to check if a lead matches journey criteria
async function matchesJourneyCriteria(lead, criteria) {
  if (!criteria) return true;
  
  if (criteria.leadStatus && criteria.leadStatus.length > 0) {
    if (!criteria.leadStatus.includes(lead.status)) {
      return false;
    }
  }
  
  if (criteria.leadTags && criteria.leadTags.length > 0) {
    const leadTags = lead.additionalData.tags || [];
    if (!criteria.leadTags.every(tag => leadTags.includes(tag))) {
      return false;
    }
  }
  
  if (criteria.leadAgeDays) {
    const leadAgeDays = lead.getAgeDays();
    
    if (criteria.leadAgeDays.min !== undefined && 
        criteria.leadAgeDays.min !== null && 
        leadAgeDays < criteria.leadAgeDays.min) {
      return false;
    }
    
    if (criteria.leadAgeDays.max !== undefined && 
        criteria.leadAgeDays.max !== null && 
        leadAgeDays > criteria.leadAgeDays.max) {
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
  const { Lead, Tenant, CallLog, DID } = sequelize.models;
  
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



// Add this to your Express server (server.js or main app file)

const axios = require('axios');
const crypto = require('crypto');

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
      return res.status(400).json({ error: 'Only HTTP/HTTPS URLs allowed' });
    }

    // Generate cache key
    const cacheKey = crypto.createHash('md5').update(url).digest('hex');
    
    console.log(`📷 Proxying image: ${url}`);

    // Fetch the image
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'Knittt-Image-Proxy/1.0'
      }
    });

    // Validate content type
    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'URL does not point to an image' });
    }

    // Set appropriate headers
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'X-Proxy-Cache-Key': cacheKey
    });

    // If image processing is requested and Sharp is available
    if ((w || h || q) && req.app.locals.sharp) {
      try {
        const sharp = req.app.locals.sharp;
        let transform = sharp();

        // Resize if width/height specified
        if (w || h) {
          const width = w ? parseInt(w) : null;
          const height = h ? parseInt(h) : null;
          transform = transform.resize(width, height, { 
            fit: 'inside', 
            withoutEnlargement: true 
          });
        }

        // Compress if quality specified
        if (q) {
          const quality = Math.max(10, Math.min(100, parseInt(q)));
          transform = transform.jpeg({ quality });
        }

        // Pipe through Sharp for processing
        response.data.pipe(transform).pipe(res);
      } catch (sharpError) {
        console.warn('Sharp processing failed, serving original:', sharpError.message);
        response.data.pipe(res);
      }
    } else {
      // Stream the image directly
      response.data.pipe(res);
    }

  } catch (error) {
    console.error('Image proxy error:', error.message);
    
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.status(404).json({ error: 'Image not found or server unreachable' });
    }
    
    if (error.code === 'ECONNABORTED') {
      return res.status(408).json({ error: 'Image request timeout' });
    }

    res.status(500).json({ error: 'Failed to proxy image' });
  }
});

// Optional: Cached image proxy with file system caching
app.get('/api/proxy-image-cached', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    // Generate cache filename
    const cacheKey = crypto.createHash('md5').update(url).digest('hex');
    const cacheDir = path.join('./uploads/content/proxy-cache');
    const cachePath = path.join(cacheDir, `${cacheKey}.cache`);
    const metaPath = path.join(cacheDir, `${cacheKey}.meta`);

    // Ensure cache directory exists
    await fs.mkdir(cacheDir, { recursive: true });

    // Check if cached version exists and is fresh (24 hours)
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






  // Journey relationships - only add instance methods since associations are already set up
  if (journeyModels && Lead) {
    const { Journey, JourneyStep, LeadJourney, JourneyExecution } = journeyModels;
    
    console.log('Setting up Journey instance methods...');
    
    // Check if associations already exist (they should from journey-models.js)
    const associationsExist = LeadJourney.associations.currentStep && 
                             Lead.associations.leadJourneys &&
                             Journey.associations.steps;
    
    if (associationsExist) {
      console.log('✅ Journey associations already exist (set up by journey-models.js)');
    } else {
      console.log('⚠️  Some journey associations missing, this might cause issues');
    }
    
    // Add useful instance methods to Lead model (these won't conflict)
    if (!Lead.prototype.getAgeDays) {
      Lead.prototype.getAgeDays = function() {
        const now = moment();
        const created = moment(this.createdAt);
        return now.diff(created, 'days');
      };
    }
    
    if (!Lead.prototype.getActiveJourneys) {
      Lead.prototype.getActiveJourneys = async function() {
        return await LeadJourney.findAll({
          where: {
            leadId: this.id,
            status: {
              [Op.in]: ['active', 'paused']
            }
          },
          include: [{
            model: Journey,
            as: 'journey'
          }]
        });
      };
    }
    
    if (!Lead.prototype.isEligibleForJourney) {
      Lead.prototype.isEligibleForJourney = async function(journeyId) {
        const existingEnrollment = await LeadJourney.findOne({
          where: {
            leadId: this.id,
            journeyId: journeyId,
            status: {
              [Op.in]: ['active', 'paused']
            }
          }
        });
        
        return !existingEnrollment;
      };
    }
    
    // Add useful instance methods to Journey model
    if (!Journey.prototype.getActiveLeadsCount) {
      Journey.prototype.getActiveLeadsCount = async function() {
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



// Initialize all modules before defining routes
async function initializeModules() {
  console.log('Initializing modules...');
  
 try {
    console.log('Initializing Optisigns module...');
    const initOptisigns = require('../shared/optisigns-integration');
    const optisignsIntegration = initOptisigns(app, sequelize, authenticateToken);
    optisignsModels = optisignsIntegration.models;
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

try {
  console.log('Initializing Content Creation module...');
  const initContentCreation = require('../shared/content-creation-integration');
  const contentIntegration = initContentCreation(app, sequelize, authenticateToken, optisignsModels);
  contentModels = contentIntegration.models;
  contentService = contentIntegration.services?.contentService; // Store the service
  console.log('Content Creation module initialized successfully');
} catch (error) {
  console.error('Error initializing Content Creation module:', error);
}

try {
  console.log('Initializing Sales Rep Photo module...');
  
  // Only initialize if content service is available
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

 try {
  console.log('Initializing Enhanced Webhook Integration module...');
  const initWebhooks = require('../shared/webhook-integration');
  
  // Pass the services as options
  const webhookIntegration = initWebhooks(app, sequelize, authenticateToken, {
    contentService: contentService,
    contentModels: contentModels,
    optisignsService: optisignsService,
    optisignsModels: optisignsModels
  });
  
  webhookModels = webhookIntegration.models;
  console.log('Enhanced Webhook Integration module initialized successfully with all services');
} catch (error) {
  console.error('Error initializing Enhanced Webhook module:', error);
}


  // 2. ADD USER ROUTES IMPORT (Add this near the top with other imports)
  const userRoutes = require('../shared/user-routes');
  const leadRoutes = require('../shared/lead-routes');

  // 3. INITIALIZE USER ROUTES (Add this after the DialPlan Builder initialization and before startServer())
  // Initialize User Routes
  console.log('Initializing User Routes module...');
  userRoutes(app, sequelize, authenticateToken);
  console.log('User Routes module initialized successfully');

  console.log('Initializing Lead Routes module...');
  leadRoutes(app, sequelize, authenticateToken);
  console.log('Lead Routes module initialized successfully');

  // Initialize the Webhook Integration module
  console.log('Initializing Webhook Integration module...');
  const webhookIntegration = initWebhookIntegration(app, sequelize, authenticateToken);
  console.log('Webhook Integration module initialized successfully');

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
    templateModels = initTemplates(app, sequelize, authenticateToken);
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

 try {
    const initRecordings = require('../shared/recording-routes');
    recordingModels = initRecordings(app, sequelize, authenticateToken);
    console.log('Recording module initialized successfully');
  } catch (error) {
    console.error('Error initializing recording module:', error);
  }
 
try {
    console.log('Initializing Optisigns module...');
    const initOptisigns = require('../shared/optisigns-integration');
    const optisignsIntegration = initOptisigns(app, sequelize, authenticateToken);
    optisignsModels = optisignsIntegration.models;
    console.log('Optisigns module initialized successfully');
  } catch (error) {
    console.error('Error initializing Optisigns module:', error);
  }
  
  return {
    dialplanBuilder,
    recordingModels,
    reportBuilderModels
  };
}

// Define routes after module initialization
async function defineRoutes(dialplanBuilder) {
  const router = express.Router(); // Add this line if it's missing


// Initialize TracersAPI module
  try {
    const initTracers = require('../shared/tracers-routes');
    tracersModels = initTracers(app, sequelize, authenticateToken);
    console.log('TracersAPI module initialized successfully');
  } catch (error) {
    console.error('Error initializing TracersAPI module:', error);
  }


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
      console.log('✅ JWT token generated');
    } catch (jwtError) {
      console.error('❌ JWT generation error:', jwtError);
      return res.status(500).json({ error: 'Token generation error' });
    }
    
    console.log("✅ Login successful for:", username);
    
    const response = { 
      token, 
      userId: user.id, 
      username: user.username, 
      tenantId: user.tenantId, 
      role: user.role 
    };
    
    console.log('🚀 Sending response:', response);
    res.json(response);
    
  } catch (err) {
    console.error('💥 UNEXPECTED ERROR in login route:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ error: 'Internal server error during login' });
  }
  
  console.log('🔥 LOGIN ROUTE HIT - END');
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

app.get('/api/calls/:id', authenticateToken, async (req, res) => {
  try {
    const callId = req.params.id;
    const tenantId = req.user.tenantId;
    
    const callLog = await CallLog.findOne({
      where: {
        id: callId,
        tenantId
      },
      include: [
        {
          model: Lead,
          as: 'lead',  // Add the alias here
          attributes: ['id', 'name', 'phone', 'email', 'status', 'callDurations'],
          required: false  // Make it optional since leadId can be NULL
        }
      ]
    });
    if (!callLog) {
      return res.status(404).json({ error: 'Call log not found' });
    }
    
    res.json(callLog);
  } catch (err) {
    console.error("Error fetching call details:", err);
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

      if (requester.tenantId !== targetId && requester.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const tenant = await Tenant.findByPk(targetId);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const incoming = req.body;
      let apiConfigUpdate = { ...tenant.apiConfig };

      if (typeof incoming.ingroup === 'string') {
        apiConfigUpdate.ingroup = incoming.ingroup;
        delete incoming.ingroup;
      }
      
      if (typeof incoming.ingroups === 'string') {
        apiConfigUpdate.ingroup = incoming.ingroups;
        delete incoming.ingroups;
      }

      if (typeof incoming.url === 'string') {
        apiConfigUpdate.url = incoming.url;
        delete incoming.url;
      }

      if (incoming.apiConfig && typeof incoming.apiConfig === 'object') {
        apiConfigUpdate = {
          ...apiConfigUpdate,
          ...incoming.apiConfig
        };
        delete incoming.apiConfig;
      }

      const [updatedCount] = await Tenant.update(
        {
          ...incoming,
          apiConfig: apiConfigUpdate
        },
        { where: { id: targetId } }
      );

      if (!updatedCount) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const refreshed = await Tenant.findByPk(targetId);
      res.json(refreshed);

    } catch (err) {
      console.error('Error updating tenant:', err);
      res.status(400).json({ error: err.message });
    }
  });

 // Updated getAgentStatus function for server.js
const getAgentStatus = async (tenant) => {
  if (!tenant) {
    throw new Error('Tenant not found');
  }
  
  // Get config from tenant
  const { url: baseUrl, user, password: pass, ingroup, source } = tenant.apiConfig;
  
  if (!baseUrl) {
    throw new Error('Missing API URL in tenant.apiConfig.url');
  }
  
  if (!ingroup) {
    throw new Error('Missing ingroup in tenant.apiConfig.ingroup');
  }

  // Construct the correct API URL - ensure it uses the non_agent_api.php endpoint
  let apiUrl = baseUrl;
  if (!apiUrl.includes('non_agent_api.php')) {
    // If the base URL doesn't include the endpoint, construct it properly
    const urlParts = new URL(baseUrl);
    apiUrl = `${urlParts.protocol}//${urlParts.host}/x5/api/non_agent_api.php`;
  }

  // Use configured source or default to 'test'
  const apiSource = source || 'test';

  const apiParams = {
    source: apiSource,
    user,
    pass,
    stage: 'csv',
    function: 'in_group_status',
    header: 'YES',
    in_groups: ingroup // Use in_groups (with underscore) to match your working endpoint
  };

  try {
    console.log(`Fetching agent status from: ${apiUrl}`);
    console.log(`Parameters:`, { ...apiParams, pass: '***HIDDEN***' });
    
    const response = await axios.get(apiUrl, { params: apiParams });

    // CSV → JSON
    const results = [];
    const stream = Readable.from(response.data);
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', row => results.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    // Shape into agent-status objects
    const data = results.map(row => ({
      ingroup: row.ingroup || ingroup,
      agents_logged_in: parseInt(row.agents_logged_in, 10) || 0,
      agents_waiting: parseInt(row.agents_waiting, 10) || 0,
      total_calls: parseInt(row.total_calls, 10) || 0,
      calls_waiting: parseInt(row.calls_waiting, 10) || 0,
      brand: 'Tax',
      source: apiSource
    }));

    return {
      source: apiSource,
      user,
      pass,
      ingroups: ingroup,
      data
    };

  } catch (error) {
    console.error(`API error: ${error.message}, returning mock data`);

    // Fallback mock in same shape
    return {
      source: apiSource,
      user,
      pass,
      ingroups: ingroup,
      data: [{
        ingroup: ingroup,
        agents_logged_in: 5,
        agents_waiting: 3,
        total_calls: 12,
        calls_waiting: 2,
        brand: 'Tax',
        source: apiSource
      }]
    };
  }
};


  app.post('/api/make-call', authenticateToken, async (req, res) => {
    try {
      const { to, transfer_number, from, trunk, context, exten, priority, timeout, variables } = req.body;
      const asyncParam = req.body.async || 'true';
      const tenantId = req.user.tenantId;
      const leadId = req.body.leadId || null;

      if (!to || !transfer_number || !from) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      const tenant = await Tenant.findByPk(tenantId);
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

      if (!tenant.amiConfig || !tenant.amiConfig.host || !tenant.amiConfig.port) {
        return res.status(400).json({ error: 'Invalid AMI configuration' });
      }
      
      if (tenant.amiConfig.context) {
        knownContexts.add(tenant.amiConfig.context);
      }

      const callLog = await CallLog.create({
        tenantId,
        leadId,
        to,
        from,
        transferNumber: transfer_number,
        status: 'initiated',
        startTime: new Date(),
        agentId: req.user.id,
        lastStatusUpdate: new Date()
      });

      try {
        await initializeAmiConnection(tenant);
      } catch (error) {
        console.warn(`Failed to initialize global AMI connection: ${error.message}`);
      }
      
      let variableString = `transfer_number=${transfer_number},to=${to},call_log_id=${callLog.id},tenant_id=${tenantId}`;
      if (variables && typeof variables === 'object') {
        Object.entries(variables).forEach(([key, value]) => {
          variableString += `,${key}=${value}`;
        });
      }

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
        console.log("Creating AMI client for originate");
        const originateAmi = new AmiClient();
        
        await originateAmi.connect(
          tenant.amiConfig.username,
          tenant.amiConfig.password,
          {
            host: tenant.amiConfig.host,
            port: parseInt(tenant.amiConfig.port, 10)
          }
        );

        console.log("Sending AMI action:", {
          ...action,
          Variable: variableString.substring(0, 30) + '...',
          Context: action.Context
        });

        const response = await originateAmi.action(action);

        await originateAmi.disconnect();

        if (response.ActionID || response.UniqueID) {
          const uniqueId = response.ActionID || response.UniqueID;
          activeCallMap.set(uniqueId, {
            callLogId: callLog.id,
            tenantId: tenantId.toString(),
            context: action.Context
          });
          console.log(`Added call ${uniqueId} to tracking map for tenant ${tenantId} with context ${action.Context}`);
        }

        // Create a safe response object without circular references
        const safeAmiResponse = {
          actionId: response.ActionID || null,
          uniqueId: response.UniqueID || null,
          message: response.Message || null,
          response: response.Response || null,
          eventList: response.EventList || null,
          // Add any other safe properties you need
          rawResponse: response.rawResponse || null
        };

        res.json({
          message: 'Call initiated successfully',
          callId: callLog.id,
          amiResponse: safeAmiResponse, // Use safe response instead of raw response
          context: action.Context
        });
      } catch (error) {
        console.error("AMI error:", error); 
        await callLog.update({ status: 'failed', lastStatusUpdate: new Date() });
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

  app.put('/api/calls/:id/status', authenticateToken, async (req, res) => {
    try {
      const { status } = req.body;
      const callId = req.params.id;
      const tenantId = req.user.tenantId;
      
     const callLog = await CallLog.findOne({
  where: {
    id: callId,
    tenantId
  },
  include: [
    {
      model: Lead,
      as: 'lead',  // Add this line
      attributes: ['id', 'name', 'phone', 'email', 'status', 'callDurations']
    }
  ]
});
      if (!callLog) {
        return res.status(404).json({ error: 'Call log not found' });
      }
      
      if (!['initiated', 'answered', 'transferred', 'completed', 'failed', 'connected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      
      if (status === 'completed' || status === 'failed') {
        const endTime = new Date();
        const duration = Math.floor((endTime - callLog.startTime) / 1000);
        
        await callLog.update({
          status,
          endTime,
          duration,
          lastStatusUpdate: new Date()
        });
        
        if (callLog.leadId) {
          const lead = await Lead.findByPk(callLog.leadId);
          if (lead) {
            const callDurations = [...(lead.callDurations || []), duration];
            
            let leadStatus = lead.status;
            if (status === 'completed' && duration >= 30) {
              leadStatus = 'completed';
            } else if (status === 'failed') {
              leadStatus = 'failed';
            }
            
            await lead.update({
              callDurations,
              status: leadStatus
            });
          }
        }
      } else {
        await callLog.update({ 
          status,
          lastStatusUpdate: new Date()
        });
        
        if (status === 'transferred' && callLog.leadId) {
          const lead = await Lead.findByPk(callLog.leadId);
          if (lead) {
            await lead.update({ status: 'transferred' });
          }
        }
      }
      
      res.json({
        message: `Call status updated to ${status}`,
        call: await CallLog.findByPk(callId)
      });
    } catch (err) {
      console.error("Error updating call status:", err);
      res.status(400).json({ error: err.message });
    }
  });

// Replace the existing GET /api/calls route with this fixed version:

app.get('/api/calls', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, status, leadId } = req.query;
    const tenantId = req.user.tenantId;
    
    const query = { 
      where: { tenantId },
      include: [
        {
          model: Lead,
          as: 'lead',  // Add the alias here
          attributes: ['id', 'name', 'phone', 'email', 'status'],
          required: false  // Make it optional since leadId can be NULL
        }
      ]
    };
    
    if (status) query.where.status = status;
    if (leadId) query.where.leadId = leadId;
    
    const calls = await CallLog.findAll({
      ...query,
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
      order: [['startTime', 'DESC']]
    });
    
    const count = await CallLog.count({ where: query.where });
    
    res.json({
      calls,
      totalPages: Math.ceil(count / parseInt(limit)),
      currentPage: parseInt(page),
      totalCount: count
    });
  } catch (err) {
    console.error("Error fetching calls:", err);
    res.status(400).json({ error: err.message });
  }
});


  app.get('/api/calls/:id', authenticateToken, async (req, res) => {
    try {
      const callId = req.params.id;
      const tenantId = req.user.tenantId;
      
     const callLog = await CallLog.findOne({
  where: {
    id: callId,
    tenantId
  },
  include: [
    {
      model: Lead,
      as: 'lead',  // Add this line
      attributes: ['id', 'name', 'phone', 'email', 'status', 'callDurations']
    }
  ]
});
      
      if (!callLog) {
        return res.status(404).json({ error: 'Call log not found' });
      }
      
      res.json(callLog);
    } catch (err) {
      console.error("Error fetching call details:", err);
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/calls', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 50, status, leadId } = req.query;
      const tenantId = req.user.tenantId;
      
      const query = { 
        where: { tenantId },
        include: [
          {
            model: Lead,
            attributes: ['id', 'name', 'phone', 'email', 'status']
          }
        ]
      };
      
      if (status) query.where.status = status;
      if (leadId) query.where.leadId = leadId;
      
      const calls = await CallLog.findAll({
        ...query,
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        order: [['startTime', 'DESC']]
      });
      
      const count = await CallLog.count(query);
      
      res.json({
        calls,
        totalPages: Math.ceil(count / parseInt(limit)),
        currentPage: parseInt(page)
      });
    } catch (err) {
      console.error("Error fetching calls:", err);
      res.status(400).json({ error: err.message });
    }
  });

  // DID routes
  app.get('/api/dids', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 50, isActive, areaCode, state } = req.query;
      const tenantId = req.user.tenantId;
      
      const query = { where: { tenantId } };
      
      // Add filters if provided
      if (isActive !== undefined) query.where.isActive = isActive === 'true';
      if (areaCode) query.where.areaCode = areaCode;
      if (state) query.where.state = state;
      
      const dids = await DID.findAll({
        ...query,
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        order: [['phoneNumber', 'ASC']]
      }); const count = await DID.count(query);
      
      res.json({
        dids,
        totalPages: Math.ceil(count / parseInt(limit)),
        currentPage: parseInt(page),
        totalCount: count
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get DID by ID with usage history
  app.get('/api/dids/:id', authenticateToken, async (req, res) => {
    try {
      const didId = req.params.id;
      const tenantId = req.user.tenantId;
      
      const did = await DID.findOne({
        where: {
          id: didId,
          tenantId
        }
      });
      
      if (!did) {
        return res.status(404).json({ error: 'DID not found' });
      }
      
      // Get call history for this DID
      const calls = await CallLog.findAll({
        where: {
          from: did.phoneNumber,
          tenantId
        },
        order: [['startTime', 'DESC']],
        limit: 100 // Limit to recent calls
      });
      
      // Calculate statistics
      const totalCalls = calls.length;
      const answeredCalls = calls.filter(call => 
        call.status !== 'failed' && call.status !== 'initiated'
      ).length;
      const transferredCalls = calls.filter(call => 
        call.status === 'transferred'
      ).length;
      const completedCalls = calls.filter(call => 
        call.status === 'completed'
      ).length;
      
      const totalDuration = calls.reduce((sum, call) => 
        sum + (call.duration || 0), 0
      );
      
      const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
      
      // Get call distribution by day of week and hour
      const callsByDayOfWeek = [0, 0, 0, 0, 0, 0, 0]; // Sunday-Saturday
      const callsByHour = Array(24).fill(0);
      
      calls.forEach(call => {
        const date = new Date(call.startTime);
        callsByDayOfWeek[date.getDay()]++;
        callsByHour[date.getHours()]++;
      });
      
      res.json({
        did,
        usageHistory: {
          calls,
          stats: {
            totalCalls,
            answeredCalls,
            transferredCalls,
            completedCalls,
            totalDuration,
            avgDuration,
            callsByDayOfWeek,
            callsByHour
          }
        }
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
      
      // Check if DID already exists for this tenant
      const existingDID = await DID.findOne({
        where: {
          tenantId,
          phoneNumber
        }
      });
      
      if (existingDID) {
        return res.status(400).json({ error: 'DID already exists for this tenant' });
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

  // Bulk upload DIDs
  app.post('/api/dids/upload', authenticateToken, async (req, res) => {
    try {
      const { fileContent } = req.body;
      const tenantId = req.user.tenantId;
      
      if (!fileContent) {
        return res.status(400).json({ error: 'No file content provided' });
      }
      
      const results = [];
      const errors = [];
      const stream = Readable.from(fileContent);
      
      // Parse CSV
      const csvData = [];
      await new Promise((resolve, reject) => {
        stream
          .pipe(csv())
          .on('data', (data) => csvData.push(data))
          .on('end', resolve)
          .on('error', reject);
      });
      
      if (csvData.length === 0) {
        return res.status(400).json({ error: 'No data found in CSV file' });
      }
      
      // Process each row
      const didsToCreate = [];
      const existingNumbers = new Set();
      
      // Get all existing DIDs for this tenant to check for duplicates
      const existingDIDs = await DID.findAll({
        where: { tenantId },
        attributes: ['phoneNumber']
      });
      
      existingDIDs.forEach(did => existingNumbers.add(did.phoneNumber));
      
      for (let i = 0; i < csvData.length; i++) {
        const row = csvData[i];
        const rowNumber = i + 2; // Adding 2 because CSV headers are row 1, and arrays are 0-indexed
        
        try {
          // Extract phone number from various possible column names
          const phoneNumber = (
            row.phone || 
            row.Phone || 
            row.phoneNumber || 
            row.PhoneNumber || 
            row.phone_number || 
            row['Phone Number'] ||
            row.did ||
            row.DID ||
            ''
          ).toString().trim();
          
          // Clean phone number - remove all non-digits
          const cleanedPhone = phoneNumber.replace(/\D/g, '');
          
          // Validate phone number
          if (!cleanedPhone) {
            errors.push({
              row: rowNumber,
              error: 'Missing phone number',
              data: row
            });
            continue;
          }
          
          if (cleanedPhone.length < 10 || cleanedPhone.length > 15) {
            errors.push({
              row: rowNumber,
              error: `Invalid phone number length: ${cleanedPhone} (must be 10-15 digits)`,
              data: row
            });
            continue;
          }
          
          // Check for duplicates in existing DIDs
          if (existingNumbers.has(cleanedPhone)) {
            errors.push({
              row: rowNumber,
              error: `DID already exists: ${cleanedPhone}`,
              data: row
            });
            continue;
          }
          
          // Check for duplicates within the upload
          if (didsToCreate.some(did => did.phoneNumber === cleanedPhone)) {
            errors.push({
              row: rowNumber,
              error: `Duplicate in upload: ${cleanedPhone}`,
              data: row
            });
            continue;
          }
          
          // Extract other fields
          const description = (
            row.description || 
            row.Description || 
            row.desc || 
            ''
          ).toString().trim();
          
          const areaCode = (
            row.areaCode || 
            row.AreaCode || 
            row.area_code || 
            row['Area Code'] ||
            cleanedPhone.substring(0, 3)
          ).toString().trim();
          
          const state = (
            row.state || 
            row.State || 
            row.STATE || 
            ''
          ).toString().trim().toUpperCase();
          
          // Handle isActive field
          let isActive = true;
          if (row.isActive !== undefined || row.is_active !== undefined || row.active !== undefined) {
            const activeValue = (row.isActive || row.is_active || row.active).toString().toLowerCase();
            isActive = ['true', '1', 'yes', 'y', 'active'].includes(activeValue);
          }
          
          // Add to creation list
          didsToCreate.push({
            tenantId,
            phoneNumber: cleanedPhone,
            description: description || `Uploaded DID ${cleanedPhone}`,
            areaCode: areaCode,
            state: state || null,
            isActive: isActive,
            usageCount: 0,
            lastUsed: null
          });
          
          // Add to existing numbers set to prevent duplicates within the batch
          existingNumbers.add(cleanedPhone);
          
        } catch (error) {
          errors.push({
            row: rowNumber,
            error: error.message,
            data: row
          });
        }
      }
      
      // Bulk create DIDs if any are valid
      let created = [];
      if (didsToCreate.length > 0) {
        try {
          created = await DID.bulkCreate(didsToCreate);
          results.push({
            success: true,
            count: created.length,
            message: `Successfully imported ${created.length} DIDs`
          });
        } catch (error) {
          console.error('Bulk create error:', error);
          return res.status(500).json({ 
            error: 'Failed to create DIDs in database',
            details: error.message 
          });
        }
      }
      
      // Return summary
      res.status(201).json({
        summary: {
          totalRows: csvData.length,
          successfulImports: created.length,
          failedImports: errors.length,
          duplicatesFound: errors.filter(e => e.error.includes('already exists') || e.error.includes('Duplicate')).length
        },
        results: results,
        errors: errors.slice(0, 100), // Limit errors returned to prevent huge responses
        importedDIDs: created.map(did => ({
          id: did.id,
          phoneNumber: did.phoneNumber,
          description: did.description,
          areaCode: did.areaCode,
          state: did.state
        }))
      });
      
    } catch (err) {
      console.error('DID upload error:', err);
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/dids/:id', authenticateToken, async (req, res) => {
    try {
      const { description, isActive, state } = req.body;
      const tenantId = req.user.tenantId;
      
      const did = await DID.findByPk(req.params.id);
      if (!did) return res.status(404).json({ error: 'DID not found' });
      
      if (did.tenantId !== tenantId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      await did.update({ 
        description, 
        isActive,
        state: state || did.state
      });
      
      res.json(did);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete DID
  app.delete('/api/dids/:id', authenticateToken, async (req, res) => {
    try {
      const didId = req.params.id;
      const tenantId = req.user.tenantId;
      
      // Find the DID to ensure it exists and belongs to this tenant
      const did = await DID.findOne({
        where: {
          id: didId,
          tenantId
        }
      });
      
      if (!did) {
        return res.status(404).json({ error: 'DID not found' });
      }
      
      // Check if there are any active calls using this DID
      const activeCalls = await CallLog.findOne({
        where: {
          from: did.phoneNumber,
          tenantId,
          status: {
            [Op.in]: ['initiated', 'answered']
          },
          endTime: null
        }
      });
      
      if (activeCalls) {
        return res.status(400).json({ error: 'Cannot delete DID with active calls' });
      }
      
      // Delete the DID
      await did.destroy();
      
      res.json({
        message: 'DID deleted successfully',
        didId
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Bulk delete DIDs
  app.post('/api/dids/delete', authenticateToken, async (req, res) => {
    try {
      const { ids } = req.body;
      const tenantId = req.user.tenantId;
      
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'No DID IDs provided' });
      }
      
      // Get all DIDs to check they belong to tenant and get phone numbers
      const dids = await DID.findAll({
        where: {
          id: {
            [Op.in]: ids
          },
          tenantId
        }
      });
      
      if (dids.length === 0) {
        return res.status(404).json({ error: 'No DIDs found for deletion' });
      }
      
      const phoneNumbers = dids.map(did => did.phoneNumber);
      
      // Check for active calls on any of these DIDs
      const activeCalls = await CallLog.findOne({
        where: {
          from: {
            [Op.in]: phoneNumbers
          },
          tenantId,
          status: {
            [Op.in]: ['initiated', 'answered']
          },
          endTime: null
        }
      });
      
      if (activeCalls) {
        return res.status(400).json({ error: 'Cannot delete DIDs with active calls' });
      }
      
      // Delete the DIDs
      const result = await DID.destroy({
        where: {
          id: {
            [Op.in]: ids
          },
          tenantId
        }
      });
      
      res.json({
        message: `${result} DIDs deleted successfully`,
        count: result
      });
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

  app.get('/api/system/dialplan-capabilities', authenticateToken, (req, res) => {
    const nodeTypeCount = dialplanBuilder.models.NodeType.count()
      .then(count => count)
      .catch(() => 0);
    
    res.json({
      message: 'DialPlan Builder module is active',
      capabilities: {
        nodeTypes: nodeTypeCount,
        generator: !!dialplanBuilder.services.generatorService,
        validator: !!dialplanBuilder.services.validationService,
        deployment: !!dialplanBuilder.services.deploymentService
      }
    });
  });

 
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
    
    await sequelize.sync({ alter: false });
    console.log('Database models synchronized.');
    
    // Initialize modules before defining routes
    const { dialplanBuilder, recordingModels, reportBuilderModels } = await initializeModules();
    
    // Define all routes
    await defineRoutes(dialplanBuilder);

    // Set up enhanced model relationships
    await setupModelRelationships();


// Add these cron jobs to your server.js file in the startServer() function
// Place them after the existing cron jobs and before app.listen()

// Process scheduled webhook resumes every 2 minutes
cron.schedule('*/2 * * * *', async () => {
  try {
    if (webhookModels && webhookModels.WebhookService) {
      // Get webhook service instance (you'll need to make this accessible)
      const webhookIntegration = initWebhookIntegration(app, sequelize, authenticateToken);
      const webhookService = webhookIntegration.services.webhookService;
      
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
    if (webhookModels && webhookModels.WebhookService) {
      // Get webhook service instance
      const webhookIntegration = initWebhookIntegration(app, sequelize, authenticateToken);
      const webhookService = webhookIntegration.services.webhookService;
      
      const resumedCount = await webhookService.checkResumeConditions();
      if (resumedCount > 0) {
        console.log(`Resumed ${resumedCount} leads based on conditions`);
      }
    }
  } catch (error) {
    console.error('Error in webhook resume conditions checker:', error);
  }
});

// Cleanup old webhook events and pause states daily at 3 AM
cron.schedule('0 3 * * *', async () => {
  try {
    console.log('Running webhook cleanup task...');
    
    // Clean up old webhook events (older than 90 days)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    if (webhookModels && webhookModels.WebhookEvent) {
      const deletedEvents = await webhookModels.WebhookEvent.destroy({
        where: {
          receivedAt: {
            [Op.lt]: ninetyDaysAgo
          }
        }
      });
      console.log(`Cleaned up ${deletedEvents} old webhook events`);
    }
    
    // Clean up old completed pause states (older than 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    if (webhookModels && webhookModels.LeadPauseState) {
      const deletedPauseStates = await webhookModels.LeadPauseState.destroy({
        where: {
          status: {
            [Op.in]: ['resumed', 'stopped']
          },
          [Op.or]: [
            { resumedAt: { [Op.lt]: thirtyDaysAgo } },
            { pausedAt: { [Op.lt]: thirtyDaysAgo } }
          ]
        }
      });
      console.log(`Cleaned up ${deletedPauseStates} old pause states`);
    }
    
  } catch (error) {
    console.error('Error in webhook cleanup task:', error);
  }
});






    // Set up cron jobs
    cron.schedule('*/5 * * * *', async () => {
      try {
        console.log('Running call cleanup task');
        
        const staleTime = new Date(Date.now() - 60 * 60 * 1000);
        
        const staleCalls = await CallLog.findAll({
          where: {
            status: 'initiated',
            startTime: { [Sequelize.Op.lt]: staleTime },
            endTime: null
          }
        });
        
        console.log(`Found ${staleCalls.length} stale calls to clean up`);
        
        for (const call of staleCalls) {
          await call.update({
            status: 'failed',
            endTime: new Date(),
            duration: 0,
            lastStatusUpdate: new Date()
          });
          
          console.log(`Cleaned up stale call ${call.id}`);
        }
      } catch (error) {
        console.error(`Error in call cleanup task: ${error.message}`);
      }
    });
    
    // Schedule journey execution processor
    if (journeyService) {
      cron.schedule('*/30 * * * * *', async () => {
        try {
          await journeyService.processScheduledExecutions();
        } catch (error) {
          console.error('Error in journey execution processor:', error);
        }
      });
      console.log('Journey execution processor scheduled');
    }

    const tenantsCount = await Tenant.count();
    if (tenantsCount === 0) {
      console.log('Creating default tenant and admin user...');
      const tenant = await Tenant.create({
        name: "Default Company",
        apiConfig: {
          source: 'BTR',
          endpoint: 'test',
          user: 'Ytel2618231',
          password: '4USz9PfeiV8',
          ingroup: 'TaxSales',
          url: 'https://btr.ytel.com/api.php'
        },
        timezone: 'America/Los_Angeles'
      });   
      
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('admin123', salt);

      await User.create({
        username: 'admin',
        password: hashedPassword,
        email: 'admin@example.com',
        tenantId: tenant.id.toString(),
        role: 'admin',
        firstName: 'System',
        lastName: 'Administrator',
        isActive: true
      }); 
      console.log('Default tenant and admin user created successfully');
      console.log('Login with username: admin, password: admin123');
      
      const projectId = await createSampleDialplan(tenant.id.toString(), dialplanBuilder);
      if (projectId) {
        console.log(`Created sample dialplan project ${projectId} for default tenant`);
      }
    }
    
    try {
      const firstTenant = await Tenant.findOne();
      if (firstTenant) {
        await initializeAmiConnection(firstTenant);
        console.log('AMI event listener started');
      } else {
        console.log('No tenants found, AMI event listener will be started when first call is made');
      }
    } catch (error) {
      console.error(`Failed to initialize AMI event listener: ${error.message}`);
      console.log('AMI event listener will be started when first call is made');
    }
    
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
console.log(`
      Modules loaded:
      - Core Dialer ✓
      - DialPlan Builder ✓
      - Journey Management ${journeyModels ? '✓' : '✗'}
      - Webhook Integration ${webhookModels ? '✓' : '✗'}
      - Twilio SMS ${twilioModels ? '✓' : '✗'}
      - Template System ${templateModels ? '✓' : '✗'}
      - Reporting & Analytics ${reportingModels ? '✓' : '✗'}
      - Report Builder ${reportBuilderModels ? '✓' : '✗'}
      - Recording Management ${recordingModels ? '✓' : '✗'}
      - Optisigns Integration ${optisignsModels ? '✓' : '✗'}
    `);
  });

  } catch (error) {
    console.error('Failed to start server:', error);
  }
}

startServer();
