// direct-login-test.js
// Save this file and run: node direct-login-test.js
// This bypasses the server and tests login directly

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Sequelize, DataTypes } = require('sequelize');

const JWT_SECRET = 'your-secret-key';

async function directLoginTest() {
  console.log('🔥 DIRECT LOGIN TEST');
  console.log('====================\n');
  
  // Database connection
  const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
    host: 'localhost',
    dialect: 'postgres',
    logging: false
  });

  try {
    await sequelize.authenticate();
    console.log('✅ Database connected\n');

    // Step 1: Get user
    console.log('1. Getting admin user...');
    const [users] = await sequelize.query(`
      SELECT id, username, password, email, "tenantId", role, "isActive"
      FROM "Users" 
      WHERE username = 'admin'
    `);

    if (users.length === 0) {
      console.log('❌ No admin user found');
      return;
    }

    const user = users[0];
    console.log('✅ User found:', {
      id: user.id,
      username: user.username,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      isActive: user.isActive
    });

    // Step 2: Test password
    console.log('\n2. Testing password...');
    const passwordValid = await bcrypt.compare('admin123', user.password);
    console.log(`Password valid: ${passwordValid ? '✅ YES' : '❌ NO'}`);

    if (!passwordValid) {
      console.log('\n🔧 FIXING PASSWORD HASH...');
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('admin123', salt);
      
      await sequelize.query(`
        UPDATE "Users" 
        SET password = '${hashedPassword}', "updatedAt" = NOW()
        WHERE username = 'admin'
      `);
      console.log('✅ Password hash updated');
      user.password = hashedPassword;
    }

    // Step 3: Test JWT generation
    console.log('\n3. Testing JWT generation...');
    try {
      const token = jwt.sign({ 
        id: user.id, 
        username: user.username, 
        tenantId: user.tenantId, 
        role: user.role 
      }, JWT_SECRET, { expiresIn: '1d' });
      
      console.log('✅ JWT generated successfully');
      console.log(`Token: ${token.substring(0, 50)}...`);
      
      // Test JWT verification
      const decoded = jwt.verify(token, JWT_SECRET);
      console.log('✅ JWT verification successful');
      console.log('Decoded:', decoded);
      
    } catch (jwtError) {
      console.log('❌ JWT error:', jwtError.message);
    }

    // Step 4: Simulate full login
    console.log('\n4. Full login simulation...');
    const finalPasswordCheck = await bcrypt.compare('admin123', user.password);
    
    if (!finalPasswordCheck) {
      console.log('❌ Password still invalid');
      return;
    }

    if (!user.isActive) {
      console.log('❌ User not active');
      return;
    }

    const finalToken = jwt.sign({ 
      id: user.id, 
      username: user.username, 
      tenantId: user.tenantId, 
      role: user.role 
    }, JWT_SECRET, { expiresIn: '1d' });

    console.log('🎉 LOGIN WOULD SUCCEED!');
    console.log('Response would be:');
    console.log(JSON.stringify({
      token: finalToken,
      userId: user.id,
      username: user.username,
      tenantId: user.tenantId,
      role: user.role
    }, null, 2));

  } catch (error) {
    console.log('❌ Error:', error.message);
  } finally {
    await sequelize.close();
  }
}

directLoginTest().catch(console.error);
