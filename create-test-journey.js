#!/usr/bin/env node
/**
 * Test Script: Create Journey
 * 
 * This script creates a test journey with multiple steps and enrolls a lead in it.
 * Run this script from the command line: node create-test-journey.js
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');

// Configuration
const TENANT_ID = process.argv[2] || '1'; // Default to tenant ID 1, or pass as argument
const LEAD_ID = process.argv[3] ? parseInt(process.argv[3], 10) : null; // Convert to integer or null

// Database connection
const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
  host: 'localhost',
  dialect: 'postgres',
  logging: false
});

// Import journey models - adjust path as needed for your setup
const initJourneyModels = require('./shared/journey-models');

// Import Lead model definition
const Lead = sequelize.define('Lead', {
  // Basic definition for reference - this should match your actual model
  tenantId: {
    type: Sequelize.DataTypes.STRING,
    allowNull: false
  },
  phone: {
    type: Sequelize.DataTypes.STRING,
    allowNull: false
  },
  name: {
    type: Sequelize.DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: Sequelize.DataTypes.STRING,
    allowNull: true
  },
  additionalData: {
    type: Sequelize.DataTypes.JSONB,
    defaultValue: {}
  },
  status: {
    type: Sequelize.DataTypes.STRING,
    defaultValue: 'pending'
  }
});

const Tenant = sequelize.define('Tenant', {
  // Basic definition for reference
  name: Sequelize.DataTypes.STRING
});

// Initialize and create test journey
async function createTestJourney() {
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('Connected to database successfully');
    
    // Initialize journey models
    const journeyModels = initJourneyModels(sequelize);
    const { Journey, JourneyStep, LeadJourney } = journeyModels;
    
    // Verify tenant exists
    const tenant = await Tenant.findByPk(TENANT_ID);
    if (!tenant) {
      console.error(`Tenant ID ${TENANT_ID} not found`);
      process.exit(1);
    }
    console.log(`Using tenant: ${tenant.name} (ID: ${TENANT_ID})`);
    
    // Create a test journey
    const journey = await Journey.create({
      name: "Test Follow-up Sequence",
      description: "A test journey created by the script",
      tenantId: TENANT_ID,
      isActive: true,
      triggerCriteria: {
        leadStatus: ["pending", "contacted"],
        autoEnroll: false
      }
    });
    
    console.log(`Created journey: ${journey.name} (ID: ${journey.id})`);
    
    // Create multiple steps
    const steps = [
      // Step 1: Initial call
      {
        name: "Initial Call Attempt",
        description: "First contact with the lead",
        stepOrder: 10,
        actionType: "call", 
        actionConfig: {
          transferNumber: "8005551234",
          scriptId: "script-1"
        },
        delayType: "immediate"
      },
      
      // Step 2: Status change (if call was successful)
      {
        name: "Update Status - Contacted",
        description: "Update status after successful call",
        stepOrder: 20,
        actionType: "status_change",
        actionConfig: {
          newStatus: "contacted"
        },
        delayType: "immediate",
        conditions: {
          callOutcomes: ["completed", "transferred"]
        }
      },
      
      // Step 3: Follow-up call (if first call failed)
      {
        name: "Follow-up Call Attempt",
        description: "Try calling again if first attempt failed",
        stepOrder: 30,
        actionType: "call",
        actionConfig: {
          transferNumber: "8005551234",
          scriptId: "script-2"
        },
        delayType: "delay_after_previous",
        delayConfig: {
          hours: 4
        },
        conditions: {
          callOutcomes: ["noanswer", "busy", "failed"]
        }
      },
      
      // Step 4: Final status update
      {
        name: "Mark as Completed",
        description: "Final step in the journey",
        stepOrder: 40,
        actionType: "status_change",
        actionConfig: {
          newStatus: "completed"
        },
        delayType: "immediate",
        isExitPoint: true
      }
    ];
    
    for (const stepData of steps) {
      const step = await JourneyStep.create({
        journeyId: journey.id,
        ...stepData
      });
      console.log(`Created step: ${step.name} (ID: ${step.id})`);
    }
    
    // If lead ID was provided as a valid number, enroll the lead in the journey
    if (LEAD_ID && !isNaN(LEAD_ID)) {
      console.log(`Checking for lead with ID: ${LEAD_ID}`);
      // Check if lead exists
      const lead = await Lead.findOne({
        where: {
          id: LEAD_ID,
          tenantId: TENANT_ID
        }
      });
      
      if (!lead) {
        console.error(`Lead ID ${LEAD_ID} not found for tenant ${TENANT_ID}`);
      } else {
        console.log(`Found lead: ${lead.name} (ID: ${LEAD_ID})`);
        console.log(`Enrolling lead ${lead.name} (ID: ${LEAD_ID}) in journey`);
        
        // Enroll lead in journey
        const leadJourney = await LeadJourney.create({
          leadId: LEAD_ID,
          journeyId: journey.id,
          status: 'active',
          startedAt: new Date()
        });
        
        // Find the first step
        const firstStep = await JourneyStep.findOne({
          where: {
            journeyId: journey.id
          },
          order: [['stepOrder', 'ASC']]
        });
        
        // Schedule first step
        const scheduledTime = new Date();
        scheduledTime.setMinutes(scheduledTime.getMinutes() + 1); // Schedule 1 minute from now
        
        await leadJourney.update({
          currentStepId: firstStep.id,
          nextExecutionTime: scheduledTime
        });
        
        // Create execution record
        const execution = await journeyModels.JourneyExecution.create({
          leadJourneyId: leadJourney.id,
          stepId: firstStep.id,
          scheduledTime,
          status: 'pending'
        });
        
        console.log(`Lead enrolled in journey, first step scheduled for ${scheduledTime}`);
        console.log(`Journey execution ID: ${execution.id}`);
      }
    } else if (process.argv[3] && isNaN(parseInt(process.argv[3], 10))) {
      console.error(`Error: Invalid lead ID provided. Must be a number.`);
    }
    
    // Display instructions for manual lead enrollment
    if (!LEAD_ID || isNaN(LEAD_ID)) {
      console.log('\nTo enroll a lead in this journey:');
      console.log(`1. Make a POST request to /api/journeys/${journey.id}/enroll`);
      console.log('2. Include the following in the request body:');
      console.log(`   { "leadIds": [LEAD_ID], "restart": false }`);
      console.log('\nOr run this script again with the lead ID as an argument:');
      console.log(`   node create-test-journey.js ${TENANT_ID} <LEAD_ID_NUMBER>`);
    }
    
    console.log('\nTest journey created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error creating test journey:', error);
    process.exit(1);
  }
}

// Run the script
createTestJourney();
