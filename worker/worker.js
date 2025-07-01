require('dotenv').config();
const { Sequelize, DataTypes, Op } = require('sequelize');
const axios = require('axios');
const AmiClient = require('asterisk-ami-client');
const cron = require('node-cron');
const moment = require('moment-timezone');
const { Readable } = require('stream');
const csv = require('csv-parser');

// Import journey models and service
const initJourneyModels = require('../shared/journey-models');
const JourneyService = require('../shared/journey-service');

// PostgreSQL connection - FIXED to match server.js
const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
  host: 'localhost',
  dialect: 'postgres',
  logging: false, // Set to console.log for debugging
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// Models (EXACT same definitions as server.js)
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
  brand: {
    type: DataTypes.STRING,
    allowNull: true
  },
  source: {
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
  },
  smsAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lastSmsAttempt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  smsStatus: {
    type: DataTypes.ENUM('pending', 'sent', 'delivered', 'failed'),
    defaultValue: 'pending'
  },
  smsHistory: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  journeyEnrollments: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  dialerAssignment: {
    type: DataTypes.STRING,
    defaultValue: 'auto_dialer',
    allowNull: true,
    validate: {
      isIn: [['auto_dialer', 'journey_only', 'both', 'none']]
    }
  }
});

// Add instance method to Lead model for journey criteria checking
Lead.prototype.getAgeDays = function() {
  const now = moment();
  const created = moment(this.createdAt);
  return now.diff(created, 'days');
};

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
  ingroup: {
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
    type: DataTypes.ENUM('initiated', 'answered', 'transferred', 'completed', 'failed', 'connected'),
    defaultValue: 'initiated'
  },
  recordingUrl: {
    type: DataTypes.STRING,
    allowNull: true
  },
  agentId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  lastStatusUpdate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  journeyStepId: {
    type: DataTypes.INTEGER,
    allowNull: true
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

// Helper function to check if a lead matches journey criteria
async function matchesJourneyCriteria(lead, criteria) {
  if (!criteria) return true;
  
  console.log(`Checking criteria for lead ${lead.id}:`, JSON.stringify(criteria, null, 2));
  
  // Check lead status
  if (criteria.leadStatus && criteria.leadStatus.length > 0) {
    if (!criteria.leadStatus.includes(lead.status)) {
      console.log(`Lead ${lead.id} status ${lead.status} not in ${criteria.leadStatus}`);
      return false;
    }
  }
  
  // Check lead tags
  if (criteria.leadTags && criteria.leadTags.length > 0) {
    const leadTags = lead.additionalData.tags || [];
    if (!criteria.leadTags.every(tag => leadTags.includes(tag))) {
      console.log(`Lead ${lead.id} tags ${leadTags} missing required tags ${criteria.leadTags}`);
      return false;
    }
  }
  
  // Check lead age
  if (criteria.leadAgeDays) {
    const leadAgeDays = lead.getAgeDays();
    
    if (criteria.leadAgeDays.min !== undefined && 
        criteria.leadAgeDays.min !== null && 
        leadAgeDays < criteria.leadAgeDays.min) {
      console.log(`Lead ${lead.id} age ${leadAgeDays} days is less than minimum ${criteria.leadAgeDays.min}`);
      return false;
    }
    
    if (criteria.leadAgeDays.max !== undefined && 
        criteria.leadAgeDays.max !== null && 
        leadAgeDays > criteria.leadAgeDays.max) {
      console.log(`Lead ${lead.id} age ${leadAgeDays} days is greater than maximum ${criteria.leadAgeDays.max}`);
      return false;
    }
  }
  
  // Check brands
  if (criteria.brands && criteria.brands.length > 0) {
    if (!lead.brand || !criteria.brands.includes(lead.brand)) {
      console.log(`Lead ${lead.id} brand ${lead.brand} not in ${criteria.brands}`);
      return false;
    }
  }
  
  // Check sources
  if (criteria.sources && criteria.sources.length > 0) {
    if (!lead.source || !criteria.sources.includes(lead.source)) {
      console.log(`Lead ${lead.id} source ${lead.source} not in ${criteria.sources}`);
      return false;
    }
  }
  
  console.log(`Lead ${lead.id} matches all criteria`);
  return true;
}

// Helper: Check if current time is within business hours
const isWithinBusinessHours = (schedule, timezone = 'America/Los_Angeles') => {
  const now = moment().tz(timezone);
  const dayOfWeek = now.format('dddd').toLowerCase();
  
  if (!schedule[dayOfWeek] || !schedule[dayOfWeek].enabled) {
    console.log(`Dialer not active on ${dayOfWeek}`);
    return false;
  }
  
  const currentTime = now.format('HH:mm');
  const startTime = schedule[dayOfWeek].start;
  const endTime = schedule[dayOfWeek].end;
  
  if (currentTime < startTime || currentTime > endTime) {
    console.log(`Current time ${currentTime} is outside business hours (${startTime}-${endTime})`);
    return false;
  }
  
  return true;
};

// Helper: Select DID based on distribution method
const selectDID = async (tenant, lead) => {
  try {
    const query = {
      where: {
        tenantId: tenant.id.toString(),
        isActive: true
      }
    };
    
    if (tenant.dialerConfig.didDistribution === 'local' && lead.phone) {
      const leadAreaCode = lead.phone.replace(/\D/g, '').substring(0, 3);

      if (leadAreaCode) {
        const localDID = await DID.findOne({
          where: {
            ...query.where,
            areaCode: leadAreaCode
          }
        });

        if (localDID) {
          return localDID;
        }
      }
    }
    
    const did = await DID.findOne({
      where: query.where,
      order: [
        ['usageCount', 'ASC'],
        ['lastUsed', 'ASC']
      ]
    });
    
    if (!did) {
      throw new Error('No active DIDs available');
    }
    
    return did;
  } catch (error) {
    console.error(`Error selecting DID: ${error.message}`);
    throw error;
  }
};

// Helper: Make call via AMI
const makeCall = async (tenant, lead, transferNumber, journeyStepId = null) => {
  try {
    let did;
    try {
      did = await selectDID(tenant, lead);
    } catch (error) {
      console.error(`Could not select DID: ${error.message}`);
      did = { phoneNumber: '8005551234' };
    }
    
    const callLog = await CallLog.create({
      tenantId: tenant.id.toString(),
      leadId: lead.id,
      from: did.phoneNumber,    
      to: lead.phone,
      transferNumber,
      status: 'initiated',
      journeyStepId
    });
    
    await lead.update({
      attempts: lead.attempts + 1,
      lastAttempt: new Date(),
      status: 'contacted'
    });
    
    if (did.id) {
      await did.update({
        usageCount: did.usageCount + 1,
        lastUsed: new Date()
      });
    }
    
    try {
      // Print AMI config for debugging
      console.log("AMI Config:", {
        host: tenant.amiConfig.host,
        port: tenant.amiConfig.port,
        username: tenant.amiConfig.username,
        password: tenant.amiConfig.password ? '***' : 'missing'
      });

      const ami = new AmiClient();
      
      // Use the correct parameters format for AMI connection
      await ami.connect(
        tenant.amiConfig.username,                     // AMI username
        tenant.amiConfig.password,                     // AMI secret/password
        {
          host: tenant.amiConfig.host,                 // Asterisk host or IP
          port: parseInt(tenant.amiConfig.port, 10)    // AMI port (usually 5038)
        }
      );

      let variableString = `transfer_number=${transferNumber},to=${lead.phone}`;
      if (lead.name) {
        variableString += `,lead_name=${lead.name}`;
      }

      if (lead.email) {
        variableString += `,lead_email=${lead.email}`;
      }
      
      if (journeyStepId) {
        variableString += `,journey_step_id=${journeyStepId}`;
      }

      const action = {
        Action: 'Originate',
        Channel: `PJSIP/${lead.phone}@${tenant.amiConfig.trunk}`,
        Context: tenant.amiConfig.context,
        Exten: 's',
        Priority: 1,
        CallerID: did.phoneNumber,
        Timeout: 40000,
        Async: 'true',
        Variable: variableString
      };

      const response = await ami.action(action);

      await ami.disconnect();    
      await callLog.update({ status: 'initiated' });

      console.log(`Call initiated for lead ${lead.id}, phone: ${lead.phone} using DID ${did.phoneNumber}`);

      return {
        success: true,
        callId: callLog.id,
        didUsed: did.phoneNumber
      };
    } catch (error) {
      console.error(`AMI error: ${error.message}`);
      console.log(`Call simulation for lead ${lead.id}, phone: ${lead.phone} (AMI not available)`);

      return {
        success: true,
        callId: callLog.id,
        didUsed: did.phoneNumber,
        simulated: true
      };
    }
  } catch (error) {
    console.error(`Error making call: ${error.message}`);
    
    return {
      success: false,
      error: error.message
    };
  }
};

// Helper: Get agent status from API
const getAgentStatus = async (tenant) => {
  if (!tenant) {
    throw new Error('Tenant not found');
  }
  
  // Grab config out of tenant
  const { url: apiUrl, user, password: pass, ingroup } = tenant.apiConfig;
  
  if (!apiUrl) {
    throw new Error('Missing API URL in tenant.apiConfig.url');
  }
  
  if (!ingroup) {
    throw new Error('Missing ingroup in tenant.apiConfig.ingroup');
  }

  // Extract subdomain (e.g. "btr")
  let subdomain;
  try {
    subdomain = new URL(apiUrl).hostname.split('.')[0];
  } catch (err) {
    throw new Error('Invalid API URL format');
  }

  const apiParams = {
    source:     subdomain,
    user,
    pass,
    stage:      'csv',
    function:   'in_group_status',
    header:     'YES',
    in_groups:  ingroup // Use the tenant's ingroup instead of hardcoding
  };

  try {
    console.log(`Fetching agent status for ingroup: ${ingroup}`);
    const response = await axios.get(apiUrl, { params: apiParams });

    // CSV → JSON
    const results = [];
    const stream = Readable.from(response.data);
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', row => results.push(row))
        .on('end',  resolve)
        .on('error', reject);
    });

    // Shape into agent-status objects
    const data = results.map(row => ({
      ingroup:           row.ingroup || ingroup,
      agents_logged_in:  parseInt(row.agents_logged_in, 10) || 0,
      agents_waiting:    parseInt(row.agents_waiting, 10) || 0,
      total_calls:       parseInt(row.total_calls, 10) || 0,
      calls_waiting:     parseInt(row.calls_waiting, 10) || 0,
      brand:             'Tax',
      source:            subdomain
    }));

    return {
      subdomain,
      user,
      pass,
      ingroups: ingroup,
      data
    };

  } catch (error) {
    console.error(`API error: ${error.message}, returning mock data`);

    // Fallback mock in same shape
    return {
      subdomain,
      user,
      pass,
      ingroups: ingroup,
      data: [{
        ingroup:           ingroup,
        agents_logged_in:  5,
        agents_waiting:    3,
        total_calls:       12,
        calls_waiting:     2,
        brand:             'Tax',
        source:            subdomain
      }]
    };
  }
};

// Main dialer worker function
const processDialerQueue = async (tenantId) => {
  try {
    console.log(`Starting dialer worker for tenant ${tenantId}`);
    
    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant) {
      console.error(`Tenant ${tenantId} not found`);
      return;
    }

    if (tenant.dialerConfig && tenant.dialerConfig.enabled === false) {
      console.log(`Dialer disabled for tenant ${tenantId}`);
      return;
    }
    
    if (!isWithinBusinessHours(tenant.schedule, tenant.timezone)) {
      console.log(`Outside business hours for tenant ${tenantId}, skipping`);
      return;
    }
    
    // Check if tenant has required API configuration
    if (!tenant.apiConfig || !tenant.apiConfig.ingroup || !tenant.apiConfig.url) {
      console.error(`Tenant ${tenantId} is missing required API configuration (ingroup or url)`);
      return;
    }
    
    try {
      const agentStatus = await getAgentStatus(tenant);
      
      if (!agentStatus || !agentStatus.data || agentStatus.data.length === 0) {
        console.error(`Failed to get agent status for tenant ${tenantId}`);
        return;
      }
      
      const agentData = agentStatus.data[0];
      const agentsWaiting = agentData.agents_waiting;
      
      console.log(`Tenant ${tenantId} has ${agentsWaiting} agents waiting for ingroup ${agentData.ingroup}`);
      
      if (agentsWaiting < tenant.dialerConfig.minAgentsAvailable) {
        console.log(`Not enough agents waiting. Required: ${tenant.dialerConfig.minAgentsAvailable}, Available: ${agentsWaiting}`);
        return;
      }
      
      const leadsToFetch = Math.ceil(agentsWaiting * tenant.dialerConfig.speed);
      console.log(`Will fetch ${leadsToFetch} leads based on ${agentsWaiting} agents and speed ${tenant.dialerConfig.speed}`);
      
      const query = {
        where: {
          tenantId: tenant.id.toString(),
          status: 'pending',
          dialerAssignment: {
            [Op.in]: ['auto_dialer', 'both']  // Only dial leads assigned to auto dialer
          },
          [Op.or]: [
            { lastAttempt: null },
            { lastAttempt: { [Op.lt]: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
          ]
        }
      };
      
      if (tenant.dialerConfig.sortOrder === 'oldest') {
        query.order = [['createdAt', 'ASC']];
      } else if (tenant.dialerConfig.sortOrder === 'fewest') {
        query.order = [['attempts', 'ASC'], ['createdAt', 'ASC']];
      }
      
      query.limit = leadsToFetch;
      
      const leads = await Lead.findAll(query);
      
      if (leads.length === 0) {
        console.log(`No leads available for tenant ${tenantId}`);
        return;
      }
      
      console.log(`Processing ${leads.length} leads for tenant ${tenantId}`);
      
      const transferNumber = '8005555678';
      
      for (const lead of leads) {
        try {
          const result = await makeCall(tenant, lead, transferNumber);

          if (!result.success) {
            console.error(`Failed to make call for lead ${lead.id}: ${result.error}`);
            await lead.update({ status: 'failed' });
          }

          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`Error processing lead ${lead.id}: ${error.message}`);
        }
      }
      
      if (tenant.dialerConfig.autoDelete) {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

        const deleteResult = await Lead.destroy({
          where: {
            tenantId: tenant.id.toString(),
            status: { [Op.in]: ['completed', 'transferred'] },
            lastAttempt: { [Op.lt]: twoDaysAgo }
          }
        });

        console.log(`Auto-deleted ${deleteResult} leads for tenant ${tenantId}`);
      }
      
      console.log(`Dialer worker completed for tenant ${tenantId}`);
    } catch (error) {
      console.error(`Error getting agent status for tenant ${tenantId}: ${error.message}`);
    }
  } catch (error) {
    console.error(`Error in dialer worker for tenant ${tenantId}: ${error.message}`);
  }
};

// Set for tracking AMI contexts
let knownContexts = new Set();

// Initialize AMI connection
const initializeAmiConnection = async (tenant) => {
  try {
    if (!tenant || !tenant.amiConfig) {
      throw new Error('Invalid tenant or AMI configuration');
    }
    
    // Register this tenant's context if available
    if (tenant.amiConfig.context) {
      knownContexts.add(tenant.amiConfig.context);
    }
    
    // This is just to register the context - we don't actually maintain a connection here
    // Real AMI connection is handled by server.js
    console.log(`Registered context "${tenant.amiConfig.context}" for tenant ${tenant.id}`);
    
    return true;
  } catch (error) {
    console.error(`Failed to initialize AMI: ${error.message}`);
    return false;
  }
};

// Helper class for auto-enrollment - FIXED VERSION
class AutoEnrollmentService {
  constructor(models) {
    this.models = models;
  }
  
  async processAutoEnrollments() {
    try {
      console.log('Processing auto-enrollments...');
      
      // Find all active journeys with auto-enroll enabled using correct JSONB syntax
      const journeys = await this.models.Journey.findAll({
        where: {
          isActive: true,
          triggerCriteria: {
            [Op.and]: [
              { [Op.ne]: null }
            ]
          }
        }
      });
      
      console.log(`Found ${journeys.length} total active journeys`);
      
      // Filter for auto-enroll journeys
      const autoEnrollJourneys = journeys.filter(journey => {
        const criteria = journey.triggerCriteria || {};
        return criteria.autoEnroll === true;
      });
      
      console.log(`Found ${autoEnrollJourneys.length} journeys with auto-enrollment enabled`);
      
      for (const journey of autoEnrollJourneys) {
        await this.processJourneyEnrollments(journey);
      }
    } catch (error) {
      console.error('Error in auto-enrollment service:', error);
    }
  }
  
  async processJourneyEnrollments(journey) {
    try {
      console.log(`Processing auto-enrollments for journey ${journey.id}: ${journey.name}`);
      
      const criteria = journey.triggerCriteria || {};
      console.log('Journey criteria:', JSON.stringify(criteria, null, 2));
      
      // Build base query for tenant
      const baseQuery = {
        where: {
          tenantId: journey.tenantId
        }
      };
      
      // Apply status filter if specified
      if (criteria.leadStatus && criteria.leadStatus.length > 0) {
        baseQuery.where.status = { [Op.in]: criteria.leadStatus };
      }
      
      // Apply brand filter if specified
      if (criteria.brands && criteria.brands.length > 0) {
        baseQuery.where.brand = { [Op.in]: criteria.brands };
      }
      
      // Apply source filter if specified
      if (criteria.sources && criteria.sources.length > 0) {
        baseQuery.where.source = { [Op.in]: criteria.sources };
      }
      
      // Apply tag filter if specified (JSONB contains)
      if (criteria.leadTags && criteria.leadTags.length > 0) {
        baseQuery.where.additionalData = {
          [Op.contains]: { tags: criteria.leadTags }
        };
      }
      
      console.log('Base query:', JSON.stringify(baseQuery, null, 2));
      
      // Find leads matching criteria
      const leads = await Lead.findAll(baseQuery);
      
      console.log(`Found ${leads.length} leads matching base criteria for journey ${journey.id}`);
      
      if (leads.length === 0) {
        return;
      }
      
      // Get lead IDs already in this journey
      const activeJourneys = await this.models.LeadJourney.findAll({
        where: {
          journeyId: journey.id,
          status: {
            [Op.in]: ['active', 'paused']
          }
        },
        attributes: ['leadId']
      });
      
      const activeLeadIds = activeJourneys.map(j => j.leadId);
      console.log(`Found ${activeLeadIds.length} leads already enrolled in journey ${journey.id}`);
      
      // Filter out leads already in this journey and apply additional criteria
      const newLeads = [];
      for (const lead of leads) {
        if (activeLeadIds.includes(lead.id)) {
          continue; // Skip already enrolled leads
        }
        
        // Check additional criteria that require individual lead checking
        if (await matchesJourneyCriteria(lead, criteria)) {
          newLeads.push(lead);
        }
      }
      
      console.log(`Enrolling ${newLeads.length} new leads in journey ${journey.id}`);
      
      if (newLeads.length === 0) {
        return;
      }
      
      // Create a journey service instance
      const journeyService = new JourneyService({
        ...this.models,
        Tenant,
        Lead,
        CallLog,
        DID
      });
      
      // Enroll each lead
      let successCount = 0;
      for (const lead of newLeads) {
        try {
          await journeyService.enrollLeadInJourney(lead.id, journey.id, {
            contextData: { enrolledBy: 'auto_worker' }
          });
          console.log(`Auto-enrolled lead ${lead.id} in journey ${journey.id}`);
          successCount++;
        } catch (error) {
          console.error(`Error enrolling lead ${lead.id} in journey ${journey.id}:`, error);
        }
      }
      
      console.log(`Completed auto-enrollments for journey ${journey.id}: ${successCount}/${newLeads.length} successful`);
    } catch (error) {
      console.error(`Error processing auto-enrollments for journey ${journey.id}:`, error);
    }
  }
}

// Global variables
let journeyModels = null;
let journeyService = null;

// Ensure optisigns_takeovers.priority uses ENUM type
async function ensurePriorityEnum() {
  try {
    const [result] = await sequelize.query(
      `SELECT data_type, udt_name FROM information_schema.columns WHERE table_name = 'optisigns_takeovers' AND column_name = 'priority'`
    );
    const column = result[0];
    const isEnum = column && column.data_type === 'USER-DEFINED' && column.udt_name === 'enum_optisigns_takeovers_priority';
    if (!isEnum) {
      console.log('Updating optisigns_takeovers.priority column to ENUM...');
      await sequelize.transaction(async (t) => {
        await sequelize.query('ALTER TABLE "optisigns_takeovers" ALTER COLUMN "priority" DROP DEFAULT', { transaction: t });
        await sequelize.query(
          `DO $$ BEGIN CREATE TYPE "public"."enum_optisigns_takeovers_priority" AS ENUM('EMERGENCY','HIGH','NORMAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
          { transaction: t }
        );
        await sequelize.query(
          'ALTER TABLE "optisigns_takeovers" ALTER COLUMN "priority" TYPE "public"."enum_optisigns_takeovers_priority" USING ("priority"::text::"public"."enum_optisigns_takeovers_priority")',
          { transaction: t }
        );
        await sequelize.query('ALTER TABLE "optisigns_takeovers" ALTER COLUMN "priority" SET DEFAULT \'NORMAL\'', { transaction: t });
        await sequelize.query('ALTER TABLE "optisigns_takeovers" ALTER COLUMN "priority" SET NOT NULL', { transaction: t });
      });
      console.log('priority column updated.');
    }
  } catch (err) {
    console.error('Failed to ensure priority column enum:', err);
  }
}

// Initialize database and start cron job
async function initializeWorker() { 
  try {
    console.log('=== WORKER INITIALIZATION START ===');
    
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');

    // Ensure priority column is correct before syncing models
    await ensurePriorityEnum();

    // Sync models with database - FIRST sync basic models
    await sequelize.sync({ alter: false });
    console.log('✅ Basic models synchronized.');
    
    // Set up basic relationships
    Lead.hasMany(CallLog, { foreignKey: 'leadId' });
    CallLog.belongsTo(Lead, { foreignKey: 'leadId' });
    console.log('✅ Basic model relationships established');
    
    // THEN initialize journey models
    console.log('Initializing journey models...');
    journeyModels = initJourneyModels(sequelize);
    console.log('✅ Journey models initialized');
    
    // Sync journey models
    await sequelize.sync({ alter: false });
    console.log('✅ Journey models synchronized.');

    // Initialize journey service
    journeyService = new JourneyService({
      ...journeyModels,
      Lead,
      Tenant,
      CallLog,
      DID
    });
    console.log('✅ Journey service initialized');
    
    // Verify tenants exist
    const tenantCount = await Tenant.count();
    console.log(`📊 Found ${tenantCount} tenants in database`);
    
    if (tenantCount === 0) {
      console.warn('⚠️  No tenants found! Creating a test tenant...');
      
      const testTenant = await Tenant.create({
        name: "Test Company",
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
      
      console.log(`✅ Created test tenant with ID: ${testTenant.id}`);
    }
    
    // Verify journey models work
    try {
      const journeyCount = await journeyModels.Journey.count();
      console.log(`📊 Found ${journeyCount} journeys in database`);
      
      const pendingExecutions = await journeyModels.JourneyExecution.count({
        where: { status: 'pending' }
      });
      console.log(`📊 Found ${pendingExecutions} pending journey executions`);
    } catch (error) {
      console.error('❌ Error checking journey models:', error);
    }

    // Initialize the call cleanup task - runs every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      try {
        console.log('🧹 Running call cleanup task');
        
        // Find stale call logs (initiated more than 1 hour ago but never completed)
        const staleTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
        
        const staleCalls = await CallLog.findAll({
          where: {
            status: 'initiated',
            startTime: { [Op.lt]: staleTime },
            endTime: null
          }
        });
        
        console.log(`Found ${staleCalls.length} stale calls to clean up`);
        
        // Update each stale call
        for (const call of staleCalls) {
          await call.update({
            status: 'failed',
            endTime: new Date(),
            duration: 0
          });
          
          console.log(`Cleaned up stale call ${call.id}`);
          
          // If this call was initiated by a journey step, update journey execution data
          if (call.journeyStepId && journeyModels) {
            try {
              const execution = await journeyModels.JourneyExecution.findOne({
                where: {
                  stepId: call.journeyStepId,
                  status: 'completed'
                },
                order: [['updatedAt', 'DESC']],
                include: [{ 
                  model: journeyModels.LeadJourney,
                  as: 'leadJourney'
                }]
              });
              
              if (execution && execution.leadJourney) {
                // Update execution result
                const result = execution.result || {};
                result.callOutcome = 'failed';
                result.callDuration = 0;
                await execution.update({ result });
                
                // Update journey context data
                const leadJourney = execution.leadJourney;
                const contextData = leadJourney.contextData || {};
                contextData.lastCallOutcome = 'failed';
                contextData.lastCallDuration = 0;
                contextData.lastCallTimestamp = new Date().toISOString();
                await leadJourney.update({ contextData });
              }
            } catch (err) {
              console.error(`Error updating journey execution for call ${call.id}:`, err);
            }
          }
        }
      } catch (error) {
        console.error(`❌ Error in call cleanup task: ${error.message}`);
      }
    });
    
    // Load all tenant contexts
    try {
      const tenants = await Tenant.findAll();
      for (const tenant of tenants) {
        if (tenant.amiConfig && tenant.amiConfig.context) {
          knownContexts.add(tenant.amiConfig.context);
          console.log(`📡 Registered context "${tenant.amiConfig.context}" for tenant ${tenant.id}`);
        }
      }
      console.log(`✅ Loaded ${knownContexts.size} contexts to monitor`);
      
      // Initialize the AMI connection with the first tenant
      if (tenants.length > 0) {
        await initializeAmiConnection(tenants[0]);
      } else {
        console.log('⚠️  No tenants found, AMI event listener will be started when first call is made');
      }
    } catch (error) {
      console.error(`❌ Failed to load tenant contexts: ${error.message}`);
    }

    // Schedule the dialer worker to run every 30 seconds
    cron.schedule('*/30 * * * * *', async () => {
      try {
        console.log('🔄 Running scheduled dialer worker');

        const tenants = await Tenant.findAll();

        if (tenants.length === 0) {
          console.log('⚠️  No tenants found');
          return;
        }

        console.log(`📊 Found ${tenants.length} tenants`);

        // Process each tenant in sequence to avoid overwhelming the system
        for (const tenant of tenants) {
          await processDialerQueue(tenant.id);
        }
      } catch (error) {
        console.error(`❌ Error in dialer worker cron job: ${error.message}`);
      }
    });

    // Process scheduled journey executions every 30 seconds (more frequent)
    cron.schedule('*/30 * * * * *', async () => {
      try {
        if (journeyService) {
          const count = await journeyService.processScheduledExecutions();
          if (count > 0) {
            console.log(`🚀 Processed ${count} journey executions`);
          }
        }
      } catch (error) {
        console.error('❌ Error in journey execution cron job:', error);
      }
    });
    
    // Process auto-enrollments for journeys every 5 minutes (more frequent)
    cron.schedule('*/5 * * * *', async () => {
      try {
        console.log('🎯 Running auto-enrollment worker...');
        
        if (!journeyModels) {
          console.log('⚠️  Journey models not initialized, skipping auto-enrollment');
          return;
        }
        
        // Initialize AutoEnrollmentService
        const autoEnrollService = new AutoEnrollmentService({
          ...journeyModels,
          Lead,
          Tenant
        });
        
        await autoEnrollService.processAutoEnrollments();
        
        console.log('✅ Auto-enrollment worker completed');
      } catch (error) {
        console.error('❌ Error in auto-enrollment cron job:', error);
      }
    });
    
    // Cleanup completed journeys older than 30 days (run daily at midnight)
    cron.schedule('0 0 * * *', async () => {
      try {
        if (!journeyModels) {
          console.log('⚠️  Journey models not initialized, skipping cleanup');
          return;
        }
        
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        
        const deletedCount = await journeyModels.LeadJourney.destroy({
          where: {
            status: {
              [Op.in]: ['completed', 'exited', 'failed']
            },
            completedAt: {
              [Op.lt]: thirtyDaysAgo
            }
          }
        });
        
        console.log(`🧹 Cleaned up ${deletedCount} old completed journeys`);
      } catch (error) {
        console.error('❌ Error in journey cleanup cron job:', error);
      }
    });

    console.log('=== WORKER INITIALIZATION COMPLETE ===');
    console.log('✅ Dialer and Journey worker services started');
    console.log('🔄 Auto-enrollment worker will run every 5 minutes');
    console.log('🚀 Journey execution processor will run every 30 seconds');
    console.log('🧹 Call cleanup will run every 5 minutes');
    console.log('🧹 Journey cleanup will run daily at midnight');
    
  } catch (error) {
    console.error('❌ Failed to start worker service:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Export the AutoEnrollmentService for use in other modules
module.exports = {
  AutoEnrollmentService
};

// Start the worker
console.log('🚀 Starting Knittt Worker Process...');
initializeWorker();