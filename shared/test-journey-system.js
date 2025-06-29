// test-journey-system.js
// Diagnostic script to test journey builder functionality
// Usage: node test-journey-system.js

require('dotenv').config();
const { Sequelize } = require('sequelize');
const axios = require('axios');

const API_URL = 'http://localhost:3001/api';
let authToken = '';

async function testJourneySystem() {
  console.log('🔍 Journey System Diagnostic Test\n');
  
  // Test 1: Database Connection
  console.log('1. Testing database connection...');
  const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
    host: 'localhost',
    dialect: 'postgres',
    logging: false
  });

  try {
    await sequelize.authenticate();
    console.log('✅ Database connection successful\n');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return;
  }

  // Test 2: Check if journey tables exist
  console.log('2. Checking journey tables...');
  try {
    const tables = await sequelize.getQueryInterface().showAllTables();
    const journeyTables = ['Journeys', 'JourneySteps', 'LeadJourneys', 'JourneyExecutions'];
    
    journeyTables.forEach(table => {
      if (tables.includes(table)) {
        console.log(`✅ Table ${table} exists`);
      } else {
        console.log(`❌ Table ${table} is missing`);
      }
    });
    console.log('');
  } catch (error) {
    console.error('❌ Error checking tables:', error.message);
  }

  // Test 3: API Authentication
  console.log('3. Testing API authentication...');
  try {
    const loginResponse = await axios.post(`${API_URL}/login`, {
      username: 'admin',
      password: 'admin123'
    });
    
    authToken = loginResponse.data.token;
    console.log('✅ Authentication successful');
    console.log(`   Tenant ID: ${loginResponse.data.tenantId}\n`);
  } catch (error) {
    console.error('❌ Authentication failed:', error.response?.data || error.message);
    console.log('   Make sure the server is running and admin/admin123 credentials exist\n');
    return;
  }

  // Test 4: Journey API Endpoints
  console.log('4. Testing Journey API endpoints...');
  
  const headers = {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json'
  };

  // Test 4a: List journeys
  try {
    console.log('   Testing GET /api/journeys...');
    const response = await axios.get(`${API_URL}/journeys`, { headers });
    console.log(`   ✅ Listed ${response.data.length} journeys`);
  } catch (error) {
    console.error('   ❌ Failed to list journeys:', error.response?.data || error.message);
  }

  // Test 4b: Create a test journey
  let testJourneyId;
  try {
    console.log('   Testing POST /api/journeys...');
    const response = await axios.post(`${API_URL}/journeys`, {
      name: 'Test Journey',
      description: 'Automated test journey',
      isActive: true,
      triggerCriteria: {
        leadStatus: ['pending'],
        autoEnroll: false
      }
    }, { headers });
    
    testJourneyId = response.data.id;
    console.log(`   ✅ Created test journey with ID: ${testJourneyId}`);
  } catch (error) {
    console.error('   ❌ Failed to create journey:', error.response?.data || error.message);
  }

  // Test 4c: Add a step to the journey
  if (testJourneyId) {
    try {
      console.log('   Testing POST /api/journeys/:id/steps...');
      const response = await axios.post(`${API_URL}/journeys/${testJourneyId}/steps`, {
        name: 'Send Welcome SMS',
        actionType: 'sms',
        actionConfig: {
          templateId: 1,
          message: 'Welcome to our journey!'
        },
        delayType: 'immediate',
        stepOrder: 1,
        isActive: true
      }, { headers });
      
      console.log(`   ✅ Created test step with ID: ${response.data.id}`);
    } catch (error) {
      console.error('   ❌ Failed to create journey step:', error.response?.data || error.message);
    }
  }

  // Test 4d: Get journey details
  if (testJourneyId) {
    try {
      console.log('   Testing GET /api/journeys/:id...');
      const response = await axios.get(`${API_URL}/journeys/${testJourneyId}`, { headers });
      console.log(`   ✅ Retrieved journey details:`);
      console.log(`      - Name: ${response.data.name}`);
      console.log(`      - Steps: ${response.data.steps?.length || 0}`);
    } catch (error) {
      console.error('   ❌ Failed to get journey details:', error.response?.data || error.message);
    }
  }

  // Test 4e: Clean up - delete test journey
  if (testJourneyId) {
    try {
      console.log('   Testing DELETE /api/journeys/:id...');
      await axios.delete(`${API_URL}/journeys/${testJourneyId}?force=true`, { headers });
      console.log('   ✅ Deleted test journey');
    } catch (error) {
      console.error('   ❌ Failed to delete journey:', error.response?.data || error.message);
    }
  }

  console.log('\n5. Testing module status...');
  try {
    const response = await axios.get(`${API_URL}/system/module-status`, { headers });
    console.log('Module Status:');
    Object.entries(response.data.modules).forEach(([module, status]) => {
      console.log(`   ${status ? '✅' : '❌'} ${module}`);
    });
    console.log('\nServices:');
    Object.entries(response.data.services).forEach(([service, status]) => {
      console.log(`   ${status ? '✅' : '❌'} ${service}`);
    });
  } catch (error) {
    console.error('❌ Failed to get module status:', error.response?.data || error.message);
  }

  // Close database connection
  await sequelize.close();
  
  console.log('\n📊 Diagnostic Summary:');
  console.log('If you see any ❌ marks above, those areas need attention.');
  console.log('\nRecommended fixes:');
  console.log('1. If tables are missing: Run "node fix-journey-schema.js"');
  console.log('2. If API endpoints fail: Check server logs for detailed errors');
  console.log('3. If modules show as false: Verify the module files exist in the shared directory');
}

// Run the test
testJourneySystem().catch(console.error);
