// test-login.js
// Run this script to debug login issues
// Save as test-login.js and run: node test-login.js

const bcrypt = require('bcrypt');
const { Sequelize, DataTypes } = require('sequelize');

async function testLogin() {
  console.log('🔍 Testing login functionality...\n');
  
  // Test password hashing
  console.log('1. Testing password hashing:');
  const password = 'admin123';
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  console.log(`   Original: ${password}`);
  console.log(`   Hashed: ${hashedPassword}`);
  
  const isValid = await bcrypt.compare(password, hashedPassword);
  console.log(`   Hash comparison: ${isValid ? '✅ PASS' : '❌ FAIL'}\n`);
  
  // Test database connection
  console.log('2. Testing database connection:');
  const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
    host: 'localhost',
    dialect: 'postgres',
    logging: false
  });
  
  try {
    await sequelize.authenticate();
    console.log('   Database connection: ✅ PASS\n');
    
    // Test user query
    console.log('3. Testing user query:');
    const [results] = await sequelize.query(`
      SELECT id, username, password, email, "tenantId", role, "isActive"
      FROM "Users" 
      WHERE username = 'admin'
    `);
    
    if (results.length === 0) {
      console.log('   ❌ No admin user found in database');
      return;
    }
    
    const user = results[0];
    console.log('   User found:', {
      id: user.id,
      username: user.username,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      isActive: user.isActive
    });
    
    // Test password comparison
    console.log('\n4. Testing password comparison:');
    const passwordValid = await bcrypt.compare('admin123', user.password);
    console.log(`   Password check: ${passwordValid ? '✅ PASS' : '❌ FAIL'}`);
    
    if (!passwordValid) {
      console.log('   🔧 Password hash in database does not match "admin123"');
      console.log('   💡 Solution: Run the SQL script to recreate user with correct hash');
    }
    
    // Test tenant exists
    console.log('\n5. Testing tenant:');
    const [tenantResults] = await sequelize.query(`
      SELECT id, name FROM "Tenants" WHERE id = '${user.tenantId}'
    `);
    
    if (tenantResults.length === 0) {
      console.log(`   ❌ Tenant ${user.tenantId} not found`);
      console.log('   💡 Solution: Run the SQL script to create default tenant');
    } else {
      console.log(`   ✅ Tenant found: ${tenantResults[0].name}`);
    }
    
    console.log('\n🎯 DIAGNOSIS:');
    if (passwordValid && tenantResults.length > 0 && user.isActive) {
      console.log('   ✅ Everything looks good - login should work!');
      console.log('   💡 Check server logs for other errors');
    } else {
      console.log('   ❌ Issues found - run the SQL fix script');
    }
    
  } catch (error) {
    console.log('   ❌ Database connection failed:', error.message);
  } finally {
    await sequelize.close();
  }
}

testLogin().catch(console.error);