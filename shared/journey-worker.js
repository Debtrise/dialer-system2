// journey-worker.js
require('dotenv').config();
const { Sequelize } = require('sequelize');
const cron = require('node-cron');
const moment = require('moment-timezone');

// Import journey models
const initJourneyModels = require('./journey-models');
const JourneyService = require('./journey-service');

// PostgreSQL connection
const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
  host: 'localhost',
  dialect: 'postgres',
  logging: false
});

// Import existing models
const Tenant = sequelize.define('Tenant', {
  // ... model definition from server.js
});

const Lead = sequelize.define('Lead', {
  // ... model definition from server.js
});

const CallLog = sequelize.define('CallLog', {
  // ... model definition from server.js
});

const DID = sequelize.define('DID', {
  // ... model definition from server.js
});

// Define relationships
Lead.hasMany(CallLog, { foreignKey: 'leadId' });
CallLog.belongsTo(Lead, { foreignKey: 'leadId' });

// Initialize journey models
const journeyModels = initJourneyModels(sequelize);

// Auto-enrollment service to check for leads that should be enrolled in journeys
class AutoEnrollmentService {
  constructor(models) {
    this.models = models;
  }
  
  async processAutoEnrollments() {
    try {
      console.log('Processing auto-enrollments...');
      
      // Find all active journeys with auto-enroll enabled
      const journeys = await this.models.Journey.findAll({
        where: {
          isActive: true,
          'triggerCriteria.autoEnroll': true
        }
      });
      
      console.log(`Found ${journeys.length} journeys with auto-enrollment enabled`);
      
      for (const journey of journeys) {
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
      const statuses = criteria.leadStatus || ['pending'];
      const tags = criteria.leadTags || [];
      
      // Build the query for leads that match criteria
      const query = {
        where: {
          tenantId: journey.tenantId,
          status: { [Sequelize.Op.in]: statuses }
        }
      };
      
      // If tags are specified, add condition
      if (tags.length > 0) {
        query.where = {
          ...query.where,
          additionalData: {
            [Sequelize.Op.contains]: { tags }
          }
        };
      }
      
      // Find leads matching criteria that are not already in this journey
      const leads = await this.models.Lead.findAll(query);
      
      console.log(`Found ${leads.length} leads matching criteria for journey ${journey.id}`);
      
      if (leads.length === 0) {
        return;
      }
      
      // Get lead IDs already in this journey
      const activeJourneys = await this.models.LeadJourney.findAll({
        where: {
          journeyId: journey.id,
          status: {
            [Sequelize.Op.in]: ['active', 'paused']
          }
        },
        attributes: ['leadId']
      });
      
      const activeLeadIds = activeJourneys.map(j => j.leadId);
      
      // Filter out leads already in this journey
      const newLeads = leads.filter(lead => !activeLeadIds.includes(lead.id));
      
      console.log(`Enrolling ${newLeads.length} new leads in journey ${journey.id}`);
      

// Create a journey service instance
const journeyService = new JourneyService({
  ...this.models,
  Tenant,
  Lead,
  CallLog,
  DID
});

// Enroll each lead
for (const lead of newLeads) {
  try {
    await journeyService.enrollLeadInJourney(lead.id, journey.id);
    console.log(`Enrolled lead ${lead.id} in journey ${journey.id}`);
  } catch (error) {
    console.error(`Error enrolling lead ${lead.id} in journey ${journey.id}:`, error);
  }
}

      
      console.log(`Completed auto-enrollments for journey ${journey.id}`);
    } catch (error) {
      console.error(`Error processing auto-enrollments for journey ${journey.id}:`, error);
    }
  }
}

// Initialize database and start cron jobs
async function initializeJourneyWorker() {
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    
    // Sync models with database
    await sequelize.sync({ alter: true });
    console.log('Journey models synchronized with database.');
    
    // Create service instances
    const journeyService = new JourneyService({
      ...journeyModels,
      Tenant,
      Lead,
      CallLog,
      DID
    });
    
    const autoEnrollmentService = new AutoEnrollmentService({
      ...journeyModels,
      Lead
    });
    
    // Process scheduled executions every minute
    cron.schedule('* * * * *', async () => {
      try {
        const count = await journeyService.processScheduledExecutions();
        if (count > 0) {
          console.log(`Processed ${count} journey executions`);
        }
      } catch (error) {
        console.error('Error in journey execution cron job:', error);
      }
    });
    
    // Process auto-enrollments every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      try {
        await autoEnrollmentService.processAutoEnrollments();
      } catch (error) {
        console.error('Error in auto-enrollment cron job:', error);
      }
    });
    
    // Cleanup completed journeys older than 30 days (run daily at midnight)
    cron.schedule('0 0 * * *', async () => {
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        
        const deletedCount = await journeyModels.LeadJourney.destroy({
          where: {
            status: {
              [Sequelize.Op.in]: ['completed', 'exited', 'failed']
            },
            completedAt: {
              [Sequelize.Op.lt]: thirtyDaysAgo
            }
          }
        });
        
        console.log(`Cleaned up ${deletedCount} old completed journeys`);
      } catch (error) {
        console.error('Error in journey cleanup cron job:', error);
      }
    });
    
    console.log('Journey worker service started successfully');
  } catch (error) {
    console.error('Failed to start journey worker service:', error);
  }
}

// Start the worker
initializeJourneyWorker();
