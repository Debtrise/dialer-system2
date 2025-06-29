// debug-freepbx-auth.js
// Debug script to test FreePBX authentication and upload

const axios = require('axios');
const FormData = require('form-data');
const tough = require('tough-cookie');
const https = require('https');
const fs = require('fs');
require('dotenv').config();

async function debugFreePBXAuth() {
  console.log('🔍 Debugging FreePBX Authentication...');
  
  const config = {
    serverUrl: 'https://dial.knittt.com',
    serverIp: '34.29.105.211',
    username: process.env.FREEPBX_USERNAME || 'admin',
    password: process.env.FREEPBX_PASSWORD || 'admin'
  };
  
  console.log('📊 Configuration:');
  console.log('   Server URL:', config.serverUrl);
  console.log('   Server IP:', config.serverIp);
  console.log('   Username:', config.username);
  console.log('   Password:', config.password ? '***SET***' : '***NOT SET***');
  
  // Create cookie jar for session management
  const cookieJar = new tough.CookieJar();
  
  // Create axios client with proper settings
  const client = axios.create({
    baseURL: config.serverUrl,
    timeout: 30000,
    httpsAgent: new https.Agent({
      rejectUnauthorized: false // Allow self-signed certificates
    }),
    jar: cookieJar,
    withCredentials: true,
    maxRedirects: 5
  });

  try {
    // Step 1: Test basic connectivity
    console.log('\n🌐 Step 1: Testing basic connectivity...');
    try {
      const pingResponse = await client.get('/', { timeout: 10000 });
      console.log('✅ Basic connectivity: OK (Status:', pingResponse.status, ')');
    } catch (error) {
      console.log('❌ Basic connectivity failed:', error.message);
      if (error.code === 'ENOTFOUND') {
        console.log('   → DNS resolution failed. Check if dial.knittt.com is accessible');
        return;
      }
      if (error.code === 'ECONNREFUSED') {
        console.log('   → Connection refused. Check if FreePBX is running on the server');
        return;
      }
    }

    // Step 2: Access admin area (should redirect to login)
    console.log('\n🔐 Step 2: Testing admin area access...');
    try {
      const adminResponse = await client.get('/admin/index.php');
      console.log('✅ Admin area accessible (Status:', adminResponse.status, ')');
      
      // Check if we're at login page
      if (adminResponse.data && typeof adminResponse.data === 'string') {
        const isLoginPage = adminResponse.data.includes('login') || 
                           adminResponse.data.includes('username') || 
                           adminResponse.data.includes('password');
        console.log('   Login page detected:', isLoginPage ? 'YES' : 'NO');
        
        // Look for login form action
        const actionMatch = adminResponse.data.match(/action="([^"]+)"/);
        if (actionMatch) {
          console.log('   Login form action:', actionMatch[1]);
        }
      }
    } catch (error) {
      console.log('❌ Admin area access failed:', error.message);
      return;
    }

    // Step 3: Attempt login
    console.log('\n🔑 Step 3: Attempting login...');
    try {
      const loginData = new FormData();
      loginData.append('username', config.username);
      loginData.append('password', config.password);

      const loginResponse = await client.post('/admin/index.php', loginData, {
        headers: {
          ...loginData.getHeaders()
        }
      });

      console.log('✅ Login attempt completed (Status:', loginResponse.status, ')');
      
      // Check if login was successful
      const finalUrl = loginResponse.request.res.responseUrl || loginResponse.config.url;
      console.log('   Final URL:', finalUrl);
      
      const loginSuccess = !finalUrl.includes('admin=false') && 
                          loginResponse.status === 200;
      console.log('   Login success:', loginSuccess ? 'YES' : 'NO');
      
      if (!loginSuccess) {
        console.log('❌ Login failed - checking possible causes:');
        console.log('   1. Invalid username/password');
        console.log('   2. Account disabled');
        console.log('   3. IP restriction');
        console.log('   4. FreePBX version compatibility');
        return;
      }
      
    } catch (error) {
      console.log('❌ Login failed:', error.message);
      return;
    }

    // Step 4: Test access to recordings module
    console.log('\n🎵 Step 4: Testing recordings module access...');
    try {
      const recordingsResponse = await client.get('/admin/config.php?display=recordings');
      console.log('✅ Recordings module accessible (Status:', recordingsResponse.status, ')');
      
      // Check for common error indicators
      if (recordingsResponse.data && typeof recordingsResponse.data === 'string') {
        const hasError = recordingsResponse.data.includes('error') || 
                        recordingsResponse.data.includes('denied') ||
                        recordingsResponse.data.includes('forbidden');
        console.log('   Error indicators found:', hasError ? 'YES' : 'NO');
        
        const hasRecordingsContent = recordingsResponse.data.includes('recordings') ||
                                   recordingsResponse.data.includes('System Recordings');
        console.log('   Recordings content found:', hasRecordingsContent ? 'YES' : 'NO');
      }
      
    } catch (error) {
      console.log('❌ Recordings module access failed:', error.message);
      if (error.response?.status === 403) {
        console.log('   → 403 Forbidden: User lacks permissions for recordings module');
        console.log('   → Check user permissions in FreePBX User Management');
      }
      return;
    }

    // Step 5: Test file upload capability
    console.log('\n📤 Step 5: Testing file upload permissions...');
    try {
      // First, get the recordings page to check upload form
      const recordingsPageResponse = await client.get('/admin/config.php?display=recordings');
      
      if (recordingsPageResponse.data && typeof recordingsPageResponse.data === 'string') {
        const hasUploadForm = recordingsPageResponse.data.includes('file') || 
                             recordingsPageResponse.data.includes('upload') ||
                             recordingsPageResponse.data.includes('multipart');
        console.log('   Upload form detected:', hasUploadForm ? 'YES' : 'NO');
        
        // Look for CSRF token
        const tokenMatch = recordingsPageResponse.data.match(/name="token"\s+value="([^"]+)"/);
        if (tokenMatch) {
          console.log('   CSRF token found:', tokenMatch[1].substring(0, 10) + '...');
        } else {
          console.log('   CSRF token found: NO');
        }
      }
      
    } catch (error) {
      console.log('❌ Upload form check failed:', error.message);
    }

    // Step 6: Test actual upload (with dummy data)
    console.log('\n🧪 Step 6: Testing dummy upload...');
    try {
      // Create a small test file
      const testData = Buffer.from('test audio data');
      
      const form = new FormData();
      form.append('files[]', testData, {
        filename: 'test_upload.mp3',
        contentType: 'audio/mpeg'
      });
      form.append('display', 'recordings');
      form.append('action', 'add');
      
      const uploadResponse = await client.post('/admin/config.php', form, {
        headers: {
          ...form.getHeaders(),
          'Referer': `${config.serverUrl}/admin/config.php?display=recordings`
        },
        timeout: 30000
      });
      
      console.log('✅ Upload test completed (Status:', uploadResponse.status, ')');
      
      if (uploadResponse.status === 403) {
        console.log('❌ 403 Forbidden on upload - Possible causes:');
        console.log('   1. User lacks file upload permissions');
        console.log('   2. Recordings module not properly configured');
        console.log('   3. Web server file upload restrictions');
        console.log('   4. FreePBX security settings');
      }
      
    } catch (error) {
      console.log('❌ Upload test failed:', error.message);
      if (error.response?.status === 403) {
        console.log('   → 403 Forbidden: Upload permission denied');
        console.log('   → Check FreePBX user permissions and web server config');
      }
    }

    // Step 7: Recommendations
    console.log('\n💡 Troubleshooting Recommendations:');
    console.log('1. Verify FreePBX admin credentials in .env file');
    console.log('2. Check user permissions in FreePBX Admin -> User Management');
    console.log('3. Ensure user has "System Recordings" module access');
    console.log('4. Check FreePBX logs: /var/log/asterisk/freepbx.log');
    console.log('5. Verify web server (Apache/Nginx) upload limits');
    console.log('6. Check firewall/security groups for dial.knittt.com');

  } catch (error) {
    console.error('❌ Debug script failed:', error.message);
  }
}

// Run the debug script
if (require.main === module) {
  debugFreePBXAuth().then(() => {
    console.log('\n🏁 Debug completed');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Debug failed:', error);
    process.exit(1);
  });
}

module.exports = debugFreePBXAuth;
