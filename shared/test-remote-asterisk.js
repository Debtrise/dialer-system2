// test-remote-asterisk.js
// Test script for remote Asterisk recording deployment

const RemoteAsteriskRecordingService = require('./remote-asterisk-recording-service');
require('dotenv').config();

async function testRemoteAsteriskDeployment() {
  console.log('🎯 Testing Remote Asterisk Recording Deployment...');
  console.log('=' .repeat(60));
  
  // Show configuration
  console.log('📊 Configuration:');
  console.log('   Asterisk Server:', process.env.ASTERISK_SERVER_HOST || '34.29.105.211');
  console.log('   SSH User:', process.env.ASTERISK_SERVER_USER || 'root');
  console.log('   SSH Key:', process.env.ASTERISK_SERVER_KEY || 'NOT SET');
  console.log('   SSH Password:', process.env.ASTERISK_SERVER_PASSWORD ? 'SET' : 'NOT SET');
  console.log('   Sounds Path:', process.env.ASTERISK_SOUNDS_PATH || '/var/lib/asterisk/sounds/custom');
  console.log('   Eleven Labs API:', process.env.ELEVEN_LABS_API_KEY ? 'SET' : 'NOT SET');
  
  try {
    // Initialize service (you'll need to adjust this based on your setup)
    const recordingModels = require('./recording-models')(
      require('./path-to-your-sequelize-instance'), 
      require('sequelize').DataTypes
    );
    
    const recordingService = new RemoteAsteriskRecordingService(recordingModels);
    
    // Step 1: Initialize local directory
    console.log('\n📁 Step 1: Initializing local directories...');
    await recordingService.initializeDirectory();
    console.log('✅ Local directories ready');
    
    // Step 2: Test SSH connection
    console.log('\n🔐 Step 2: Testing SSH connection to Asterisk server...');
    const connectionTest = await recordingService.testAsteriskConnection();
    
    if (connectionTest.success) {
      console.log('✅ SSH connection successful');
      console.log('   Output:', connectionTest.output);
    } else {
      console.log('❌ SSH connection failed:', connectionTest.error);
      console.log('\n💡 SSH Troubleshooting:');
      console.log('   1. Check ASTERISK_SERVER_HOST is correct');
      console.log('   2. Verify SSH key path or password');
      console.log('   3. Ensure SSH service is running on Asterisk server');
      console.log('   4. Check firewall settings');
      return;
    }
    
    // Step 3: Setup remote server
    console.log('\n🛠️ Step 3: Setting up remote Asterisk server...');
    const setupResult = await recordingService.setupRemoteServer();
    
    if (setupResult.success) {
      console.log('✅ Remote server setup successful');
      console.log('Setup output:');
      console.log(setupResult.output);
    } else {
      console.log('❌ Remote server setup failed:', setupResult.error);
    }
    
    // Step 4: Create test recording
    console.log('\n📝 Step 4: Creating test recording...');
    const testRecording = await recordingService.createRecording('test_tenant', {
      name: 'Remote Asterisk Test',
      description: 'Test recording for remote Asterisk deployment',
      text: 'Hello, this is a test recording for remote Asterisk deployment via SSH.',
      type: 'tts'
    });
    
    console.log('✅ Test recording created');
    console.log('   Recording ID:', testRecording.id);
    console.log('   Remote Deploy Status:', testRecording.remoteDeployStatus);
    
    // Step 5: Generate audio (if Eleven Labs is configured)
    if (process.env.ELEVEN_LABS_API_KEY) {
      console.log('\n🎵 Step 5: Generating audio...');
      try {
        const generatedRecording = await recordingService.generateAudio(
          testRecording.id, 
          'test_tenant'
        );
        
        console.log('✅ Audio generated successfully');
        console.log('   File name:', generatedRecording.fileName);
        console.log('   File size:', generatedRecording.fileSize, 'bytes');
        console.log('   Local path:', generatedRecording.fileUrl);
        
        // Step 6: Deploy to remote Asterisk server
        console.log('\n🚀 Step 6: Deploying to remote Asterisk server...');
        try {
          const deployResult = await recordingService.deployToAsterisk(
            testRecording.id,
            'test_tenant'
          );
          
          console.log('✅ Deployment successful!');
          console.log('   Remote file path:', deployResult.remoteFilePath);
          console.log('   Asterisk path:', deployResult.asteriskPath);
          console.log('   File info:', deployResult.fileInfo);
          
          // Step 7: Get AMI playback path
          console.log('\n📻 Step 7: AMI Playback Information...');
          const updatedRecording = await recordingService.getRecording(testRecording.id, 'test_tenant');
          const playbackPath = recordingService.getAsteriskPlaybackPath(updatedRecording);
          
          console.log('✅ AMI Playback Configuration:');
          console.log('   Playback Path:', playbackPath);
          console.log('   Dialplan Usage: Playback(' + playbackPath + ')');
          console.log('   AMI Usage: Data=' + playbackPath);
          
          // Step 8: List remote recordings
          console.log('\n📋 Step 8: Listing remote recordings...');
          const remoteRecordings = await recordingService.listRemoteRecordings('test_tenant');
          console.log('✅ Found', remoteRecordings.length, 'remote recordings for test_tenant:');
          remoteRecordings.forEach(rec => {
            console.log(`   - ${rec.filename} (${rec.size} bytes) - ${rec.lastModified}`);
          });
          
        } catch (deployError) {
          console.log('❌ Deployment failed:', deployError.message);
        }
        
      } catch (audioError) {
        console.log('❌ Audio generation failed:', audioError.message);
        console.log('   Check your Eleven Labs API key configuration');
      }
    } else {
      console.log('\n⏭️ Step 5-6: Skipping audio generation and deployment (no Eleven Labs API key)');
      console.log('   Set ELEVEN_LABS_API_KEY in .env to test full workflow');
    }
    
    // Final Summary
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Remote Asterisk Deployment Test Summary');
    console.log('='.repeat(60));
    console.log(connectionTest.success ? '✅ SSH Connection: WORKING' : '❌ SSH Connection: FAILED');
    console.log(setupResult.success ? '✅ Remote Setup: SUCCESSFUL' : '❌ Remote Setup: FAILED');
    console.log('✅ Local Recording Creation: WORKING');
    console.log(process.env.ELEVEN_LABS_API_KEY ? '✅ Audio Generation: CONFIGURED' : '❌ Audio Generation: NOT CONFIGURED');
    
    console.log('\n📖 Next Steps:');
    console.log('1. Set ELEVEN_LABS_API_KEY in .env for TTS generation');
    console.log('2. Configure SSH key authentication for better security');
    console.log('3. Update your dialplan to use recordings from custom/ directory');
    console.log('4. Use AMI playback paths in your call logic');
    
    console.log('\n🎯 AMI Integration Example:');
    console.log('```javascript');
    console.log('const amiAction = {');
    console.log('  Action: "Originate",');
    console.log('  Channel: `PJSIP/${phoneNumber}@trunk`,');
    console.log('  Application: "Playback",');
    console.log('  Data: "custom/tenant_123_recording_456" // Generated path');
    console.log('};');
    console.log('```');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Helper function to test SSH setup
async function testSSHSetup() {
  console.log('🔍 SSH Setup Helper...');
  
  const host = process.env.ASTERISK_SERVER_HOST || '34.29.105.211';
  const user = process.env.ASTERISK_SERVER_USER || 'root';
  
  console.log('\n📋 SSH Configuration Check:');
  console.log('   Host:', host);
  console.log('   User:', user);
  console.log('   Key:', process.env.ASTERISK_SERVER_KEY || 'NOT SET');
  console.log('   Password:', process.env.ASTERISK_SERVER_PASSWORD ? 'SET' : 'NOT SET');
  
  console.log('\n🔧 Manual SSH Test Commands:');
  console.log(`   Test connection: ssh ${user}@${host} "echo 'Connection successful'"`);
  console.log(`   Check directory: ssh ${user}@${host} "ls -la /var/lib/asterisk/sounds/"`);
  console.log(`   Create directory: ssh ${user}@${host} "mkdir -p /var/lib/asterisk/sounds/custom"`);
  
  if (!process.env.ASTERISK_SERVER_KEY && !process.env.ASTERISK_SERVER_PASSWORD) {
    console.log('\n⚠️  No SSH authentication configured!');
    console.log('   Add either ASTERISK_SERVER_KEY or ASTERISK_SERVER_PASSWORD to .env');
  }
}

// Run the test
if (require.main === module) {
  if (process.argv.includes('--ssh-help')) {
    testSSHSetup();
  } else {
    testRemoteAsteriskDeployment().then(() => {
      console.log('\n🏁 Test completed');
      process.exit(0);
    }).catch(error => {
      console.error('💥 Test execution failed:', error);
      process.exit(1);
    });
  }
}

module.exports = { testRemoteAsteriskDeployment, testSSHSetup };