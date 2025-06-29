// test-freepbx.js
const FreePBXService = require('./freepbx-service');

async function testFreePBX() {
  console.log('🌐 Testing FreePBX Connection...');
  
  const freepbxService = new FreePBXService({});
  
  try {
    const result = await freepbxService.testConnection();
    console.log('✅ FreePBX Test Result:', result);
    
    if (result.success) {
      console.log('✅ FreePBX connection successful');
      
      // Test server status
      const status = await freepbxService.getServerStatus();
      console.log('📊 Server Status:', status);
      
    } else {
      console.log('❌ FreePBX connection failed:', result.error);
    }
  } catch (error) {
    console.log('❌ FreePBX test error:', error.message);
  }
}

testFreePBX();
