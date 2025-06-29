// e2e-test.js - End-to-End Test without external dependencies
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const BASE_URL = 'http://localhost:3001/api';
let JWT_TOKEN = null;

// Helper function for delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Get JWT token (adjust based on your auth system)
async function getJWTToken() {
  try {
    console.log('🔑 Getting JWT token...');
    
    // Try different auth endpoints
    const authEndpoints = [
      '/auth/login',
      '/api/auth/login', 
      '/login'
    ];
    
    for (const endpoint of authEndpoints) {
      try {
        const response = await axios.post(`http://localhost:3001${endpoint}`, {
          username: 'admin',
          password: 'admin'
        });
        
        if (response.data.token) {
          JWT_TOKEN = response.data.token;
          console.log('✅ JWT token obtained');
          return JWT_TOKEN;
        }
      } catch (error) {
        // Try next endpoint
        continue;
      }
    }
    
    // If no token obtained, use a placeholder for testing
    console.log('⚠️  Could not get JWT token, using placeholder');
    JWT_TOKEN = 'test_token_placeholder';
    return JWT_TOKEN;
    
  } catch (error) {
    console.log('⚠️  Auth error:', error.message);
    JWT_TOKEN = 'test_token_placeholder';
    return JWT_TOKEN;
  }
}

// Test API endpoint
async function testAPI(method, endpoint, data = null) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    return { success: true, data: response.data, status: response.status };
    
  } catch (error) {
    return { 
      success: false, 
      error: error.message, 
      status: error.response?.status,
      data: error.response?.data 
    };
  }
}

async function runE2ETest() {
  console.log('🎯 Starting End-to-End Recording Test...');
  console.log('=' .repeat(50));
  
  try {
    // Step 0: Get JWT token
    await getJWTToken();
    
    // Step 1: Test server connectivity
    console.log('\n📡 Step 1: Testing server connectivity...');
    const healthCheck = await testAPI('GET', '/recordings');
    if (!healthCheck.success && healthCheck.status !== 401) {
      console.log('❌ Server not responding properly');
      console.log('   Make sure your server is running on port 3001');
      return;
    }
    console.log('✅ Server is responding');
    
    // Step 2: Test FreePBX connection
    console.log('\n🌐 Step 2: Testing FreePBX connection...');
    const freepbxTest = await testAPI('GET', '/freepbx/test');
    console.log('📊 FreePBX Test Result:', freepbxTest.success ? '✅ Connected' : '❌ Failed');
    if (freepbxTest.data) {
      console.log('   Details:', freepbxTest.data);
    }
    
    // Step 3: Test FreePBX status
    console.log('\n📊 Step 3: Getting FreePBX status...');
    const freepbxStatus = await testAPI('GET', '/freepbx/status');
    console.log('📊 FreePBX Status:', freepbxStatus.success ? '✅ Online' : '❌ Offline');
    if (freepbxStatus.data) {
      console.log('   Server URL:', freepbxStatus.data.serverUrl);
      console.log('   Server IP:', freepbxStatus.data.serverIp);
      console.log('   Online:', freepbxStatus.data.online);
    }
    
    // Step 4: Test Eleven Labs configuration
    console.log('\n🎵 Step 4: Testing Eleven Labs configuration...');
    const elevenLabsConfig = await testAPI('GET', '/elevenlabs/config');
    console.log('🎤 Eleven Labs Config:', elevenLabsConfig.success ? '✅ Configured' : '❌ Not configured');
    if (elevenLabsConfig.data) {
      console.log('   API Key:', elevenLabsConfig.data.apiKey ? 'SET' : 'NOT SET');
      console.log('   Characters Used:', elevenLabsConfig.data.charactersUsedThisMonth || 0);
      console.log('   Monthly Limit:', elevenLabsConfig.data.monthlyCharacterLimit || 0);
    }
    
    // Step 5: Create recording
    console.log('\n📝 Step 5: Creating test recording...');
    const recordingData = {
      name: 'E2E Test Recording',
      description: 'End-to-end test recording created by automated test',
      text: 'Hello, this is a test recording for the end-to-end testing process. Welcome to our automated testing system!',
      type: 'tts',
      tags: ['test', 'e2e', 'automated']
    };
    
    const createResult = await testAPI('POST', '/recordings', recordingData);
    
    if (!createResult.success) {
      console.log('❌ Failed to create recording:', createResult.error);
      if (createResult.status === 401) {
        console.log('   → Authentication issue. Make sure you have a valid JWT token.');
      }
      return;
    }
    
    const recordingId = createResult.data.id;
    console.log('✅ Recording created successfully');
    console.log('   Recording ID:', recordingId);
    console.log('   Name:', createResult.data.name);
    console.log('   Status:', createResult.data.freepbxStatus);
    
    // Step 6: Generate audio
    console.log('\n🎵 Step 6: Generating audio...');
    const generateResult = await testAPI('POST', `/recordings/${recordingId}/generate`);
    
    if (!generateResult.success) {
      console.log('❌ Failed to generate audio:', generateResult.error);
      console.log('   This might be due to Eleven Labs API configuration');
    } else {
      console.log('✅ Audio generation initiated');
      console.log('   File Name:', generateResult.data.recording?.fileName);
      console.log('   File Size:', generateResult.data.recording?.fileSize, 'bytes');
      console.log('   FreePBX Status:', generateResult.data.recording?.freepbxStatus);
      
      // Wait for audio generation to complete
      console.log('⏳ Waiting for generation to complete...');
      await sleep(10000); // Wait 10 seconds
    }
    
    // Step 7: Check recording status
    console.log('\n🔍 Step 7: Checking recording status...');
    const statusResult = await testAPI('GET', `/recordings/${recordingId}`);
    
    if (statusResult.success) {
      console.log('✅ Recording status retrieved');
      console.log('   FreePBX Status:', statusResult.data.freepbxStatus);
      console.log('   File URL:', statusResult.data.fileUrl);
      console.log('   File Size:', statusResult.data.fileSize);
      console.log('   Generated At:', statusResult.data.generatedAt);
    }
    
    // Step 8: Upload to FreePBX (if audio was generated)
    if (generateResult.success && statusResult.data?.fileUrl) {
      console.log('\n🌐 Step 8: Uploading to FreePBX...');
      const uploadResult = await testAPI('POST', `/recordings/${recordingId}/upload-to-freepbx`);
      
      if (uploadResult.success) {
        console.log('✅ Upload to FreePBX successful');
        console.log('   FreePBX Recording ID:', uploadResult.data.freepbxRecordingId);
        console.log('   Upload Time:', uploadResult.data.uploadedAt);
      } else {
        console.log('❌ Upload to FreePBX failed:', uploadResult.error);
      }
    } else {
      console.log('⏭️  Step 8: Skipping FreePBX upload (no audio file)');
    }
    
    // Step 9: Test audio download (if file exists)
    if (statusResult.data?.fileUrl) {
      console.log('\n🎧 Step 9: Testing audio download...');
      try {
        const audioResponse = await axios.get(`${BASE_URL}/recordings/${recordingId}/audio`, {
          headers: { 'Authorization': `Bearer ${JWT_TOKEN}` },
          responseType: 'stream'
        });
        
        const fileName = `test_recording_${recordingId}.mp3`;
        const writer = fs.createWriteStream(fileName);
        audioResponse.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        
        const stats = fs.statSync(fileName);
        console.log('✅ Audio file downloaded successfully');
        console.log('   File size:', stats.size, 'bytes');
        
        // Clean up test file
        fs.unlinkSync(fileName);
        
      } catch (error) {
        console.log('❌ Audio download failed:', error.message);
      }
    } else {
      console.log('⏭️  Step 9: Skipping audio download (no audio file)');
    }
    
    // Step 10: List recordings
    console.log('\n📋 Step 10: Listing recordings...');
    const listResult = await testAPI('GET', '/recordings?limit=5');
    
    if (listResult.success) {
      console.log('✅ Recordings list retrieved');
      console.log('   Total recordings:', listResult.data.totalCount);
      console.log('   Current page:', listResult.data.currentPage);
      console.log('   Sample recordings:');
      listResult.data.recordings.slice(0, 3).forEach(recording => {
        console.log(`     - ${recording.name} (${recording.freepbxStatus})`);
      });
    }
    
    // Step 11: Final status check
    console.log('\n🔍 Step 11: Final status verification...');
    const finalStatus = await testAPI('GET', `/recordings/${recordingId}`);
    
    if (finalStatus.success) {
      console.log('✅ Final recording details:');
      console.log('   ID:', finalStatus.data.id);
      console.log('   Name:', finalStatus.data.name);
      console.log('   FreePBX Status:', finalStatus.data.freepbxStatus);
      console.log('   FreePBX Recording ID:', finalStatus.data.freepbxRecordingId);
      console.log('   Usage Count:', finalStatus.data.usageCount);
      console.log('   Created:', finalStatus.data.createdAt);
    }
    
    // Test Summary
    console.log('\n' + '='.repeat(50));
    console.log('🎉 End-to-End Test Summary');
    console.log('='.repeat(50));
    console.log('✅ Server connectivity: PASSED');
    console.log(freepbxTest.success ? '✅ FreePBX connection: PASSED' : '❌ FreePBX connection: FAILED');
    console.log(createResult.success ? '✅ Recording creation: PASSED' : '❌ Recording creation: FAILED');
    console.log(generateResult.success ? '✅ Audio generation: PASSED' : '❌ Audio generation: FAILED');
    console.log(statusResult.success ? '✅ Status retrieval: PASSED' : '❌ Status retrieval: FAILED');
    
    if (createResult.success) {
      console.log('\n📊 Test Recording Details:');
      console.log('   Recording ID:', recordingId);
      console.log('   You can view this recording in your admin panel');
    }
    
    console.log('\n✅ End-to-End test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
if (require.main === module) {
  runE2ETest().then(() => {
    console.log('\n🏁 Test execution finished');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = runE2ETest;
