// freepbx-service.js
// Production-ready FreePBX integration service for centralized FreePBX instance

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs').promises;
const fsSync = require('fs');
const https = require('https');
const tough = require('tough-cookie');
const path = require('path');

class FreePBXService {
  constructor(models) {
    this.models = models;
    this.freepbxConfig = {
      serverUrl: 'http://34.29.105.211',  // Use IP and HTTP
      serverIp: '34.29.105.211',
      username: process.env.FREEPBX_USERNAME || 'admin',
      password: process.env.FREEPBX_PASSWORD || 'admin',
      recordingModule: 'recordings',
      uploadPath: '/admin/config.php'
    };
    
    // Session management
    this.cookieJar = new tough.CookieJar();
    this.authenticatedClient = null;
    this.sessionExpiry = null;
    this.sessionDuration = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Get authenticated axios client with session management
   */
  async getAuthenticatedClient() {
    // Check if we have a valid session
    if (this.authenticatedClient && this.sessionExpiry && Date.now() < this.sessionExpiry) {
      return this.authenticatedClient;
    }

    console.log('Creating new FreePBX authenticated session...');

    // Create new client with cookie jar
    const cookieJar = new tough.CookieJar();
    const client = axios.create({
      baseURL: this.freepbxConfig.serverUrl,
      timeout: 30000,
      // Remove HTTPS agent since we're using HTTP
      jar: cookieJar,
      withCredentials: true,
      maxRedirects: 5
    });

    try {
      // Step 1: Test basic connectivity first
      console.log('Testing basic connectivity to FreePBX...');
      await client.get('/', { timeout: 10000 });
      console.log('✅ Basic connectivity successful');

      // Step 2: Get login page to establish session
      console.log('Getting FreePBX login page...');
      const loginPageResponse = await client.get('/admin/index.php');
      
      // Step 3: Extract any CSRF tokens or form data
      let token = null;
      if (loginPageResponse.data && typeof loginPageResponse.data === 'string') {
        const tokenMatch = loginPageResponse.data.match(/name="token"\s+value="([^"]+)"/);
        if (tokenMatch) {
          token = tokenMatch[1];
          console.log('Found CSRF token for login');
        }
      }

      // Step 4: Perform login with better error handling
      console.log('Logging into FreePBX...');
      const loginData = new FormData();
      loginData.append('username', this.freepbxConfig.username);
      loginData.append('password', this.freepbxConfig.password);
      if (token) {
        loginData.append('token', token);
      }

      const loginResponse = await client.post('/admin/index.php', loginData, {
        headers: {
          ...loginData.getHeaders(),
          'Referer': `${this.freepbxConfig.serverUrl}/admin/index.php`
        }
      });

      // Check if login was successful
      const finalUrl = loginResponse.request?.res?.responseUrl || loginResponse.config.url;
      const loginSuccess = !finalUrl.includes('admin=false') && loginResponse.status === 200;

      if (!loginSuccess) {
        throw new Error('FreePBX login failed - invalid credentials or access denied');
      }

      // Step 5: Verify we can access recordings module
      console.log('Verifying recordings module access...');
      const recordingsResponse = await client.get('/admin/config.php?display=recordings');
      
      if (recordingsResponse.status === 403) {
        throw new Error('403 Forbidden: User lacks permissions for System Recordings module');
      }
      
      if (recordingsResponse.status !== 200) {
        throw new Error(`Cannot access recordings module: HTTP ${recordingsResponse.status}`);
      }

      console.log('✅ FreePBX authentication successful');
      
      // Cache the authenticated client
      this.authenticatedClient = client;
      this.sessionExpiry = Date.now() + this.sessionDuration;
      
      return client;

    } catch (error) {
      console.error('FreePBX authentication failed:', error.message);
      this.authenticatedClient = null;
      this.sessionExpiry = null;
      
      // Provide specific error messages for common issues
      if (error.code === 'ENOTFOUND') {
        throw new Error(`FreePBX server not found: ${this.freepbxConfig.serverUrl}. Check IP address and connectivity.`);
      }
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Connection refused to FreePBX server: ${this.freepbxConfig.serverUrl}. Check if HTTP server is running on port 80.`);
      }
      if (error.response?.status === 403) {
        throw new Error('403 Forbidden: Check FreePBX user permissions for System Recordings module');
      }
      if (error.response?.status === 401) {
        throw new Error('401 Unauthorized: Invalid FreePBX credentials');
      }
      
      throw new Error(`FreePBX authentication failed: ${error.message}`);
    }
  }

  /**
   * Test connection to FreePBX server
   */
  async testConnection() {
    try {
      const client = await this.getAuthenticatedClient();
      
      // Try to access recordings module
      const response = await client.get('/admin/config.php?display=recordings');
      
      if (response.status === 200) {
        return { 
          success: true, 
          message: 'FreePBX connection successful',
          serverUrl: this.freepbxConfig.serverUrl 
        };
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }
    } catch (error) {
      console.error('FreePBX connection test failed:', error);
      return { 
        success: false, 
        error: error.message,
        serverUrl: this.freepbxConfig.serverUrl 
      };
    }
  }

  /**
   * Upload recording to FreePBX with tenant isolation
   */
  async uploadRecording(recording, tenantId) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Uploading recording ${recording.id} to FreePBX (attempt ${attempt}/${maxRetries})`);
        
        // Update status to pending
        await recording.update({ 
          freepbxStatus: 'pending',
          freepbxError: null 
        });

        const result = await this._performUpload(recording, tenantId);
        
        console.log(`Recording ${recording.id} uploaded successfully to FreePBX`);
        return result;

      } catch (error) {
        lastError = error;
        console.error(`Upload attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxRetries) {
          // Final attempt failed
          await recording.update({
            freepbxStatus: 'failed',
            freepbxError: error.message
          });
          break;
        }
        
        // Wait before retry (exponential backoff)
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Clear cached session on retry
        this.authenticatedClient = null;
        this.sessionExpiry = null;
      }
    }

    throw lastError;
  }

  /**
   * Perform the actual upload to FreePBX
   */
  async _performUpload(recording, tenantId) {
    const client = await this.getAuthenticatedClient();

    // Verify file exists
    const filePath = path.join(__dirname, '..', recording.fileUrl);
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new Error(`Recording file not found: ${filePath}`);
    }

    // Get file stats
    const fileStats = await fs.stat(filePath);
    console.log(`Uploading file: ${filePath} (${fileStats.size} bytes)`);

    // Create tenant-isolated recording name
    const tenantRecordingName = `tenant_${tenantId}_${recording.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const tenantRecordingDescription = `[Tenant: ${tenantId}] ${recording.description || recording.name}`;

    // Get recordings page to extract form token
    const recordingsPageResponse = await client.get('/admin/config.php?display=recordings');
    let formToken = null;
    
    if (recordingsPageResponse.data && typeof recordingsPageResponse.data === 'string') {
      const tokenMatch = recordingsPageResponse.data.match(/name="token"\s+value="([^"]+)"/);
      if (tokenMatch) {
        formToken = tokenMatch[1];
        console.log('Found form token for upload');
      }
    }

    // Create form data for upload
    const form = new FormData();
    
    // Add the audio file
    form.append('files[]', fsSync.createReadStream(filePath), {
      filename: `${tenantRecordingName}.${path.extname(filePath).substring(1)}`,
      contentType: this._getContentType(filePath)
    });
    
    // Add FreePBX form fields
    form.append('display', 'recordings');
    form.append('action', 'add');
    form.append('submit', 'Submit');
    form.append('id', ''); // Empty for new recording
    form.append('rname', tenantRecordingName);
    form.append('description', tenantRecordingDescription);
    form.append('fcode', '0'); // Feature code (0 for none)
    form.append('fcode_pass', ''); // Feature code password
    
    if (formToken) {
      form.append('token', formToken);
    }

    // Submit upload form
    console.log('Submitting recording upload to FreePBX...');
    const uploadResponse = await client.post('/admin/config.php', form, {
      headers: {
        ...form.getHeaders(),
        'Referer': `${this.freepbxConfig.serverUrl}/admin/config.php?display=recordings`
      },
      timeout: 60000, // 60 second timeout for large files
      maxContentLength: 100 * 1024 * 1024, // 100MB max
      maxBodyLength: 100 * 1024 * 1024
    });

    // Validate upload response
    await this._validateUploadResponse(uploadResponse, recording, tenantRecordingName);

    // Update recording status
    await recording.update({
      freepbxStatus: 'uploaded',
      freepbxUploadedAt: new Date(),
      freepbxRecordingId: tenantRecordingName,
      freepbxError: null
    });

    return {
      success: true,
      recordingId: tenantRecordingName,
      message: 'Recording uploaded successfully to FreePBX',
      tenantId: tenantId,
      uploadedAt: new Date().toISOString()
    };
  }

  /**
   * Validate FreePBX upload response
   */
  async _validateUploadResponse(response, recording, recordingName) {
    if (response.status !== 200) {
      throw new Error(`Upload failed with status: ${response.status}`);
    }

    // Check response content for errors
    if (response.data && typeof response.data === 'string') {
      // Look for error indicators in HTML response
      const errorPatterns = [
        /<div[^>]*class="[^"]*alert-danger[^"]*"[^>]*>(.*?)<\/div>/gi,
        /<div[^>]*class="[^"]*alert[^"]*error[^"]*"[^>]*>(.*?)<\/div>/gi,
        /<span[^>]*class="[^"]*error[^"]*"[^>]*>(.*?)<\/span>/gi,
        /error[:\s]+(.*?)(?:<|$)/gi
      ];

      for (const pattern of errorPatterns) {
        const matches = [...response.data.matchAll(pattern)];
        if (matches.length > 0) {
          const errorMessage = matches[0][1].replace(/<[^>]*>/g, '').trim();
          if (errorMessage && errorMessage.length > 0) {
            throw new Error(`FreePBX upload error: ${errorMessage}`);
          }
        }
      }

      // Look for success indicators
      const successPatterns = [
        /successfully/gi,
        /uploaded/gi,
        /added/gi,
        /created/gi
      ];

      const hasSuccessIndicator = successPatterns.some(pattern => 
        pattern.test(response.data)
      );

      if (!hasSuccessIndicator && response.data.length > 100) {
        // If response is substantial but no success indicator, log for debugging
        console.warn('Upload response unclear, assuming success. Response length:', response.data.length);
      }
    }

    // If we get here, assume success
    console.log(`Recording "${recordingName}" uploaded successfully to FreePBX`);
  }

  /**
   * Get content type for file
   */
  _getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.flac': 'audio/flac',
      '.webm': 'audio/webm'
    };
    return contentTypes[ext] || 'audio/mpeg';
  }

  /**
   * List tenant's recordings from FreePBX
   */
  async listTenantRecordings(tenantId) {
    try {
      const client = await this.getAuthenticatedClient();
      
      // Try to get recordings via AJAX endpoint
      const response = await client.get('/admin/ajax.php', {
        params: {
          module: 'recordings',
          command: 'getJSON',
          jdata: 'grid'
        },
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `${this.freepbxConfig.serverUrl}/admin/config.php?display=recordings`
        }
      });

      let allRecordings = [];
      
      if (response.data && Array.isArray(response.data)) {
        allRecordings = response.data;
      } else if (response.data && response.data.data && Array.isArray(response.data.data)) {
        allRecordings = response.data.data;
      }

      // Filter recordings for this tenant
      const tenantPrefix = `tenant_${tenantId}_`;
      const tenantRecordings = allRecordings.filter(rec => {
        const name = rec.name || rec.rname || rec.displayname || '';
        return name.startsWith(tenantPrefix);
      }).map(rec => ({
        id: rec.id || rec.recording_id,
        name: (rec.name || rec.rname || rec.displayname || '').replace(tenantPrefix, ''),
        description: rec.description || '',
        filename: rec.filename,
        duration: rec.duration,
        freepbxId: rec.id || rec.recording_id,
        originalName: rec.name || rec.rname || rec.displayname
      }));

      return tenantRecordings;

    } catch (error) {
      console.error('Error listing tenant recordings from FreePBX:', error);
      return [];
    }
  }

  /**
   * Delete tenant recording from FreePBX
   */
  async deleteTenantRecording(tenantId, recordingId) {
    try {
      const client = await this.getAuthenticatedClient();
      
      // Get form token
      const recordingsPageResponse = await client.get('/admin/config.php?display=recordings');
      let formToken = null;
      
      if (recordingsPageResponse.data && typeof recordingsPageResponse.data === 'string') {
        const tokenMatch = recordingsPageResponse.data.match(/name="token"\s+value="([^"]+)"/);
        if (tokenMatch) {
          formToken = tokenMatch[1];
        }
      }

      // Create delete form
      const form = new FormData();
      form.append('display', 'recordings');
      form.append('action', 'del');
      form.append('id', recordingId);
      if (formToken) {
        form.append('token', formToken);
      }

      const response = await client.post('/admin/config.php', form, {
        headers: {
          ...form.getHeaders(),
          'Referer': `${this.freepbxConfig.serverUrl}/admin/config.php?display=recordings`
        }
      });

      if (response.status === 200) {
        return { success: true, message: 'Recording deleted from FreePBX' };
      } else {
        throw new Error(`Delete failed with status: ${response.status}`);
      }

    } catch (error) {
      console.error('Error deleting recording from FreePBX:', error);
      throw error;
    }
  }

  /**
   * Get FreePBX server status
   */
  async getServerStatus() {
    try {
      const client = await this.getAuthenticatedClient();
      const response = await client.get('/admin/index.php');
      
      return {
        online: true,
        serverUrl: this.freepbxConfig.serverUrl,
        serverIp: this.freepbxConfig.serverIp,
        lastChecked: new Date().toISOString()
      };
    } catch (error) {
      return {
        online: false,
        serverUrl: this.freepbxConfig.serverUrl,
        serverIp: this.freepbxConfig.serverIp,
        error: error.message,
        lastChecked: new Date().toISOString()
      };
    }
  }
}

module.exports = FreePBXService;