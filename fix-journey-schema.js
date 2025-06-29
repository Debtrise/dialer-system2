// fix-journey-schema.js
// Run this script to fix any journey table schema issues
// Usage: node fix-journey-schema.js

require('dotenv').config();
const { Sequelize } = require('sequelize');

async function fixJourneySchema() {
  // PostgreSQL connection
  const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
    host: 'localhost',
    dialect: 'postgres',
    logging: console.log
  });

  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Database connection established.');

    // Initialize journey models
    const initJourneyModels = require('./shared/journey-models');
    const journeyModels = initJourneyModels(sequelize);

    console.log('Syncing journey models...');
    
    // Force sync to recreate tables with correct schema
    // WARNING: This will drop existing tables and recreate them
    // If you have existing data, change { force: true } to { alter: true }
    await sequelize.sync({ alter: true });
    
    console.log('Journey tables synchronized successfully!');
    
    // Verify tables exist
    const tables = await sequelize.getQueryInterface().showAllTables();
    console.log('\nExisting tables:');
    tables.forEach(table => console.log(`  - ${table}`));
    
    // Check journey-related tables
    const journeyTables = ['Journeys', 'JourneySteps', 'LeadJourneys', 'JourneyExecutions'];
    const missingTables = journeyTables.filter(table => !tables.includes(table));
    
    if (missingTables.length > 0) {
      console.error('\nMissing tables:', missingTables);
    } else {
      console.log('\nAll journey tables exist ✓');
    }
    
    // Test creating a sample journey
    console.log('\nTesting journey creation...');
    const testJourney = await journeyModels.Journey.create({
      name: 'Test Journey',
      description: 'Test journey to verify schema',
      tenantId: '1',
      isActive: false
    });
    
    console.log('Test journey created with ID:', testJourney.id);
    
    // Clean up test data
    await testJourney.destroy();
    console.log('Test journey removed.');
    
    console.log('\n✅ Journey schema fixed successfully!');
    
  } catch (error) {
    console.error('Error fixing journey schema:', error);
  } finally {
    await sequelize.close();
  }
}

// Run the fix
fixJourneySchema();
