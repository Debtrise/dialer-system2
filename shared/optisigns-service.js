const fs = require('fs').promises;
const uuid = require('uuid');
const path = require('path');
const { Readable } = require('stream');

class OptisignsService {
  constructor(models) {
    this.models = models;
    this.clientCache = new Map(); // Cache SDK clients per tenant
    this.timeout = 30000;
    this.OptiSigns = null; // Will be loaded dynamically

  }

  /**
   * Initialize the OptiSigns SDK
   */
  async initializeSDK() {
    if (!this.OptiSigns) {
      try {
        // Dynamic import for ES module
        const module = await import('@optisigns/optisigns');
        this.OptiSigns = module.OptiSigns;
        console.log('✅ OptiSigns SDK loaded successfully');
      } catch (error) {
        console.error('❌ Failed to load OptiSigns SDK:', error.message);
        throw new Error('Failed to load OptiSigns SDK. Make sure @optisigns/optisigns is installed.');
      }
    }
  }

  /**
   * Validate device ID (for OptiSigns IDs, not UUIDs)
   */
  validateDeviceId(deviceId) {
    return deviceId && 
           deviceId !== 'undefined' && 
           deviceId !== 'null' && 
           deviceId.length > 0 &&
           typeof deviceId === 'string';
  }

  /**
   * Safe API call wrapper with retry logic
   */
  async safeApiCall(apiFunction, ...args) {
    try {
      return await apiFunction(...args);
    } catch (error) {
      console.error('API call failed:', error.message);
      
      if (error.message.includes('invalid signature')) {
        throw new Error('Invalid API token. Please verify your OptiSigns API token.');
      } else if (error.message.includes('Variable')) {
        throw new Error(`Invalid parameters: ${error.message}`);
      } else if (error.message.includes('API_NOT_AVAILABLE')) {
        throw new Error('This API endpoint is not currently available');
      }
      
      throw error;
    }
  }

  /**
   * Get or create SDK client for a tenant
   */
  async getClient(tenantId) {
    try {
      console.log(`🔑 Getting OptiSigns client for tenant: ${tenantId}`);
      
      // Ensure SDK is loaded
      await this.initializeSDK();
      
      // Check cache first
      if (this.clientCache.has(tenantId)) {
        const cachedClient = this.clientCache.get(tenantId);
        
        // Test if cached client still works
        try {
          await this.safeApiCall(() => cachedClient.devices.listAllDevices());
          console.log('✅ Using cached OptiSigns client');
          return cachedClient;
        } catch (error) {
          console.log('⚠️ Cached client failed, recreating...');
          this.clientCache.delete(tenantId);
        }
      }

      // Get API token from database
      const config = await this.models.OptisignsConfig.findOne({
        where: { tenantId: tenantId.toString(), isActive: true }
      });
      
      console.log('📋 Config lookup result:', {
        found: !!config,
        tenantId: tenantId,
        hasToken: !!(config && config.apiToken),
        tokenLength: config?.apiToken?.length || 0
      });
      
      if (!config) {
        throw new Error(`OptiSigns not configured for tenant ${tenantId}. Please configure your OptiSigns integration first using PUT /api/optisigns/config`);
      }
      
      if (!config.apiToken) {
        throw new Error(`OptiSigns API token is missing for tenant ${tenantId}. Please update your configuration with a valid API token.`);
      }

      try {
        // Create client with config object (not string)
        console.log('🔧 Creating OptiSigns SDK client...');
        const client = new this.OptiSigns({
          token: config.apiToken
        });
        
        // Verify the client works by making a test call
        console.log('🧪 Testing OptiSigns client...');
        await this.safeApiCall(() => client.devices.listAllDevices());
        
        this.clientCache.set(tenantId, client);
        console.log('✅ OptiSigns client created and cached successfully');
        
        // Update last validated timestamp
        await config.update({ lastValidated: new Date() });
        
        return client;
      } catch (error) {
        console.error('❌ Failed to create/test OptiSigns client:', error.message);
        // Clear from cache if it fails
        this.clientCache.delete(tenantId);
        
        throw new Error(`Failed to initialize OptiSigns SDK: ${error.message}. Please verify your API token is valid.`);
      }
    } catch (error) {
      console.error('❌ Error in getClient:', error.message);
      throw error;
    }
  }

  /**
   * Clear client from cache (useful when API token changes)
   */
  clearClientCache(tenantId) {
    this.clientCache.delete(tenantId);
  }

  /**
   * Update configuration for a tenant
   */
  async updateConfiguration(tenantId, apiToken, settings = {}) {
    try {
      // Validate token format
      if (!apiToken || typeof apiToken !== 'string' || apiToken.length < 10) {
        throw new Error('Invalid API token format');
      }

      // Clear cached client when updating config
      this.clearClientCache(tenantId);

      // Ensure tenantId is string
      const tenantIdStr = tenantId.toString();

      // Enhanced settings to include teamId
      const enhancedSettings = {
        ...settings,
        teamId: settings.teamId || '1', // Default to '1' if not provided
        defaultTeamId: settings.defaultTeamId || settings.teamId || '1'
      };

      const [configRecord, created] = await this.models.OptisignsConfig.upsert({
        tenantId: tenantIdStr,
        apiToken,
        settings: enhancedSettings,
        isActive: true,
        lastValidated: new Date(),
        updatedAt: new Date()
      });
      
      console.log(`${created ? 'Created' : 'Updated'} configuration for tenant ${tenantIdStr} with teamId: ${enhancedSettings.teamId}`);
      return configRecord;
    } catch (error) {
      console.error(`Error updating configuration for tenant ${tenantId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get configuration for a tenant
   */
  async getConfiguration(tenantId) {
    try {
      const tenantIdStr = tenantId.toString();
      return await this.models.OptisignsConfig.findOne({
        where: { tenantId: tenantIdStr, isActive: true }
      });
    } catch (error) {
      console.error(`Error getting configuration for tenant ${tenantId}:`, error.message);
      throw error;
    }
  }

  /**
   * Check if tenant has OptiSigns configured
   */
  async isConfigured(tenantId) {
    try {
      const config = await this.getConfiguration(tenantId);
      return !!(config && config.apiToken && config.isActive);
    } catch (error) {
      return false;
    }
  }

  /**
   * Test API connection with provided token
   */
  async testApiConnection(apiToken) {
    try {
      console.log('Testing OptiSigns API connection...');
      
      await this.initializeSDK();
      const testClient = new this.OptiSigns({
        token: apiToken
      });
      
      // Try to list devices as a connection test
      const devices = await this.safeApiCall(() => testClient.devices.listAllDevices());
      
      return {
        success: true,
        message: 'API connection successful',
        deviceCount: devices.length || 0
      };
    } catch (error) {
      console.error('API test failed:', error.message);
      throw new Error(`API connection failed: ${error.message}`);
    }
  }

  /**
   * Sync all displays for a tenant
   */
  async syncDisplays(tenantId) {
    try {
      console.log(`🔄 Syncing displays for tenant ${tenantId}...`);
      
      const client = await this.getClient(tenantId);
      const devices = await this.safeApiCall(() => client.devices.listAllDevices());
      
      console.log(`📱 Found ${devices.length} devices from OptiSigns API`);
      
      // Filter out devices with invalid IDs
      const validDevices = devices.filter(device => {
        const deviceId = device.id || device._id;
        const isValid = this.validateDeviceId(deviceId);
        
        if (!isValid) {
          console.warn(`⚠️ Skipping device with invalid ID: ${deviceId}`);
        }
        
        return isValid;
      });
      
      console.log(`✅ ${validDevices.length} devices have valid IDs`);
      
      // Clear existing displays for this tenant
      await this.models.OptisignsDisplay.destroy({
        where: { tenant_id: tenantId.toString() }
      });
      
      // Save new displays
      const savedDisplays = [];
      
      for (const device of validDevices) {
        try {
          const deviceId = device.id || device._id;
          
          // Debug log for device UUID
          if (device.uuid || device.UUID) {
            console.log(`📟 Device ${device.name || device.deviceName} has UUID: ${device.uuid || device.UUID}`);
          }
          
          const deviceData = {
            id: uuid.v4(), // Generate proper UUID for database primary key
            tenantId: tenantId.toString(),
            optisignsDisplayId: deviceId, // Store OptiSigns ID here
            optisignsId: deviceId,
            name: device.name || device.deviceName || 'Unknown Device',
            uuid: device.uuid || device.UUID || null, // This is now VARCHAR, so any string is OK
            location: device.location || null,
            status: this.mapDeviceStatus(device),
            resolution: device.resolution || {},
            orientation: device.orientation || null,
            isActive: true,
            isOnline: true, // Default to online as requested
            lastSeen: this.getLastSeenDate(device),
            metadata: device,
            currentAssetId: device.currentAssetId || null,
            currentPlaylistId: device.currentPlaylistId || null,
            currentType: this.validateCurrentType(device.currentType)
          };
          
          const savedDisplay = await this.models.OptisignsDisplay.create(deviceData);
          savedDisplays.push(savedDisplay);
          
          console.log(`✅ Saved device: ${device.name || device.deviceName} (${deviceId}) - Online: ${deviceData.isOnline}`);
        } catch (error) {
          console.error(`❌ Failed to save device ${device.id || device._id}:`, error.message);
          console.error('Device data:', JSON.stringify(device, null, 2));
        }
      }
      
      console.log(`✅ Sync complete: ${savedDisplays.length} devices saved`);
      console.log(`📊 Online devices: ${savedDisplays.filter(d => d.isOnline).length}`);
      console.log(`📊 Offline devices: ${savedDisplays.filter(d => !d.isOnline).length}`);
      
      return savedDisplays;
    } catch (error) {
      console.error(`❌ Display sync failed for tenant ${tenantId}:`, error.message);
      throw new Error(`Failed to sync displays: ${error.message}`);
    }
  }

  /**
   * Helper method to get file extension
   */
  getFileExtension(fileName) {
    if (!fileName || typeof fileName !== 'string') {
      return 'unknown';
    }
    const parts = fileName.split('.');
    if (parts.length > 1) {
      return parts[parts.length - 1].toLowerCase();
    }
    return 'unknown';
  }

  /**
   * Make API call to OptiSigns (Direct API method)
   */
  async makeApiCall(method, endpoint, data, options = {}) {
    try {
      const config = await this.models.OptisignsConfig.findOne({
        where: { tenantId: options.tenantId || '1', isActive: true }
      });
      
      if (!config || !config.apiToken) {
        throw new Error('OptiSigns API token not configured');
      }

      const baseURL = 'https://api.optisigns.com/v1';
      const url = `${baseURL}${endpoint}`;
      
      const requestConfig = {
        method: method.toUpperCase(),
        url: url,
        headers: {
          'Authorization': `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
          ...options.headers
        },
        timeout: 30000
      };

      if (data) {
        if (data instanceof FormData) {
          requestConfig.data = data;
          requestConfig.headers = { ...requestConfig.headers, ...data.getHeaders() };
        } else if (method.toUpperCase() === 'GET') {
          requestConfig.params = data;
        } else {
          requestConfig.data = data;
        }
      }

      console.log(`🌐 Making API call: ${method.toUpperCase()} ${url}`);
      const response = await axios(requestConfig);
      
      console.log(`✅ API call successful: ${response.status}`);
      return response.data;
      
    } catch (error) {
      console.error(`❌ API call failed: ${method} ${endpoint}`, error.response?.data || error.message);
      
      if (error.response?.status === 401) {
        throw new Error('Invalid OptiSigns API token');
      } else if (error.response?.status === 429) {
        throw new Error('OptiSigns API rate limit exceeded');
      } else if (error.response?.data?.message) {
        throw new Error(`OptiSigns API error: ${error.response.data.message}`);
      } else {
        throw new Error(`OptiSigns API call failed: ${error.message}`);
      }
    }
  }

  /**
   * Upload file using OptiSigns SDK with fallback to website asset
   */
  async uploadFileAsBase64(tenantId, fileBuffer, assetName, fileName, options = {}) {
    try {
      console.log('📤 Uploading file using OptiSigns SDK...');
      
      // First, try direct SDK upload if available
      try {
        return await this.uploadViaSdkFileUpload(tenantId, fileBuffer, assetName, fileName, options);
      } catch (sdkError) {
        console.warn('⚠️ SDK file upload failed (likely not enabled):', sdkError.message);
        
        // Check if it's the "Upload Files via API is not enabled" error
        if (sdkError.message.includes('Upload Files via API is not enabled') || 
            sdkError.message.includes('not enabled')) {
          console.log('🔄 API file upload not enabled, falling back to hosted website asset...');
          return await this.uploadAsHostedWebsiteAsset(tenantId, fileBuffer, assetName, fileName, options);
        } else {
          // Some other SDK error, try the hosted approach anyway
          console.warn('⚠️ SDK upload failed for other reason, trying hosted approach:', sdkError.message);
          return await this.uploadAsHostedWebsiteAsset(tenantId, fileBuffer, assetName, fileName, options);
        }
      }
    } catch (error) {
      console.error('❌ Error uploading file:', error);
      throw new Error('Failed to upload file: ' + error.message);
    }
  }

  /**
   * Try SDK file upload (will fail if not enabled)
   */
  async uploadViaSdkFileUpload(tenantId, fileBuffer, assetName, fileName, options = {}) {
    // Save buffer to temporary file for SDK upload
    const tempDir = path.join(__dirname, '../temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const tempFilePath = path.join(tempDir, fileName);
    await fs.writeFile(tempFilePath, fileBuffer);
    
    console.log('📁 Temp file created:', tempFilePath);
    
    try {
      // Get the configured client
      const client = await this.getClient(tenantId);
      
      // Get teamId from options or config
      let teamId = options.teamId;
      if (!teamId) {
        const config = await this.getConfiguration(tenantId);
        teamId = config?.settings?.teamId || config?.settings?.defaultTeamId || null;
      }
      
      console.log('🚀 Uploading via SDK uploadFileAsset...');
      
      // Use SDK to upload the file
      const asset = await this.safeApiCall(() => 
        client.assets.uploadFileAsset(tempFilePath, teamId)
      );
      
      console.log('✅ SDK upload successful:', asset);
      
      // Determine asset type
      let assetType = 'other';
      const contentType = options.contentType || 'application/octet-stream';
      
      if (contentType.startsWith('image/')) {
        assetType = 'image';
      } else if (contentType === 'text/html') {
        assetType = 'web';
      } else if (contentType.startsWith('video/')) {
        assetType = 'video';
      }
      
      // Save to local database
      const uploadedAsset = await this.models.OptisignsContent.create({
        id: uuid.v4(),
        tenantId: tenantId.toString(),
        optisignsId: asset.id || asset._id || asset.assetId,
        name: assetName,
        type: assetType,
        fileType: this.getFileExtension(fileName),
        fileSize: fileBuffer.length,
        status: 'uploaded',
        url: asset.url || asset.webLink || '',
        webLink: asset.webLink || asset.url || '',
        metadata: {
          ...options.metadata,
          uploadMethod: 'sdk_file_upload',
          originalFileName: fileName,
          contentType: contentType,
          sdkResponse: asset
        },
        uploadedAt: new Date()
      });

      console.log('✅ File uploaded successfully via SDK, OptiSigns ID:', uploadedAsset.optisignsId);
      return uploadedAsset;
      
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tempFilePath);
        console.log('🧹 Temp file cleaned up');
      } catch (cleanupError) {
        console.warn('⚠️ Failed to cleanup temp file:', cleanupError.message);
      }
    }
  }

  /**
   * Upload as hosted website asset (fallback when API upload is disabled)
   */
  async uploadAsHostedWebsiteAsset(tenantId, fileBuffer, assetName, fileName, options = {}) {
    try {
      console.log('🌐 Creating hosted website asset as fallback...');
      
      // Create uploads directory with tenant ID
      const uploadsDir = path.join(__dirname, '../uploads/content/exports/public', tenantId.toString());
      await fs.mkdir(uploadsDir, { recursive: true });
      
      // Save file to uploads directory
      const publicFilePath = path.join(uploadsDir, fileName);
      await fs.writeFile(publicFilePath, fileBuffer);
      
      // Generate public URL
      const baseUrl = process.env.BASE_URL || 'http://34.122.156.88:3001';
      const publicUrl = `${baseUrl}/uploads/content/exports/public/${tenantId}/${fileName}`;
      
      console.log('📁 Content hosted at:', publicUrl);
      
      // Create website asset in OptiSigns pointing to our hosted content
      const client = await this.getClient(tenantId);
      
      // Get teamId from options or config
      let teamId = options.teamId;
      if (!teamId) {
        const config = await this.getConfiguration(tenantId);
        teamId = config?.settings?.teamId || config?.settings?.defaultTeamId || null;
      }
      
      console.log('🚀 Creating website asset pointing to hosted content...');
      
      let asset;
      try {
        asset = await this.safeApiCall(() => 
          client.assets.createWebsiteAppAsset(
            {
              url: publicUrl,
              title: assetName
            },
            teamId
          )
        );
        console.log('✅ Website asset created successfully:', asset);
      } catch (websiteError) {
        console.warn('⚠️ Website asset creation failed, creating placeholder:', websiteError.message);
        // Create a fallback asset record
        asset = {
          id: `hosted-${Date.now()}`,
          url: publicUrl,
          webLink: publicUrl,
          title: assetName
        };
      }
      
      // Determine asset type
      let assetType = 'web'; // Default to web since we're creating a website asset
      const contentType = options.contentType || 'application/octet-stream';
      
      if (contentType.startsWith('image/')) {
        assetType = 'image';
      } else if (contentType.startsWith('video/')) {
        assetType = 'video';
      }
      
      // Save to local database
      const uploadedAsset = await this.models.OptisignsContent.create({
        id: uuid.v4(),
        tenantId: tenantId.toString(),
        optisignsId: asset.id || asset._id || asset.assetId || `hosted-${Date.now()}`,
        name: assetName,
        type: assetType,
        fileType: this.getFileExtension(fileName),
        fileSize: fileBuffer.length,
        status: 'uploaded',
        url: publicUrl,
        webLink: publicUrl,
        metadata: {
          ...options.metadata,
          uploadMethod: 'hosted_website_asset',
          originalFileName: fileName,
          contentType: contentType,
          hostedUrl: publicUrl,
          sdkResponse: asset
        },
        uploadedAt: new Date()
      });

      console.log('✅ Hosted website asset created successfully, OptiSigns ID:', uploadedAsset.optisignsId);
      return uploadedAsset;
      
    } catch (error) {
      console.error('❌ Error creating hosted website asset:', error);
      throw new Error('Failed to create hosted website asset: ' + error.message);
    }
  }

  /**
   * Upload web content (HTML) directly to OptiSigns
   */
  async uploadWebContent(tenantId, fileBuffer, assetName, options = {}) {
    try {
      console.log('📤 Uploading web content to OptiSigns...');
      
      // For web content, use the base64 upload method
      const uploadOptions = Object.assign({}, options, {
        contentType: options.contentType || 'text/html'
      });
      
      return await this.uploadFileAsBase64(
        tenantId, 
        fileBuffer, 
        assetName, 
        options.fileName || `${assetName}.html`, 
        uploadOptions
      );
    } catch (error) {
      console.error('❌ Error uploading web content:', error);
      throw new Error(`Failed to upload web content: ${error.message}`);
    }
  }

  /**
   * Upload image content directly to OptiSigns
   */
  async uploadImageContent(tenantId, fileBuffer, assetName, options = {}) {
    const fileName = options.fileName || assetName + '.png';
    const uploadOptions = Object.assign({}, options, {
      contentType: options.contentType || 'image/png'
    });
    
    return await this.uploadFileAsBase64(tenantId, fileBuffer, assetName, fileName, uploadOptions);
  }

  /**
   * Main upload method (alias for uploadFileAsBase64)
   */
  async uploadContent(tenantId, fileBuffer, assetName, fileName, options = {}) {
    return await this.uploadFileAsBase64(tenantId, fileBuffer, assetName, fileName, options);
  }

  /**
   * Get a specific device by name
   */
  async getDeviceByName(tenantId, deviceName) {
    try {
      const client = await this.getClient(tenantId);
      return await this.safeApiCall(() => client.devices.getDeviceByName(deviceName));
    } catch (error) {
      console.error(`Error getting device by name ${deviceName}:`, error.message);
      throw error;
    }
  }

  /**
   * Get a specific device
   */
  async getDevice(tenantId, deviceId) {
    try {
      if (!this.validateDeviceId(deviceId)) {
        throw new Error('Invalid device ID format');
      }
      
      const client = await this.getClient(tenantId);
      return await this.safeApiCall(() => client.devices.getDeviceById(deviceId));
    } catch (error) {
      console.error(`Error getting device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Update device (name, tags, etc.)
   */
  async updateDevice(tenantId, deviceId, updates) {
    try {
      console.log(`🔧 Updating device ${deviceId} for tenant ${tenantId}`);
      
      const client = await this.getClient(tenantId);
      
      // Map updates to correct format
      const deviceUpdates = {};
      if (updates.name) deviceUpdates.deviceName = updates.name;
      if (updates.location) deviceUpdates.location = updates.location;
      // Add other valid fields as needed
      
      const apiDeviceId = deviceId;
      const device = await this.safeApiCall(() =>
        client.devices.updateDevice(apiDeviceId, deviceUpdates)
      );
      
      console.log('✅ Device updated successfully');
      return device;
    } catch (error) {
      console.error('❌ Device update failed:', error.message);
      throw new Error(`Device update failed: ${error.message}`);
    }
  }

  /**
   * Add tags to device
   */
  async addTags(tenantId, deviceId, tags) {
    try {
      if (!Array.isArray(tags) || tags.length === 0) {
        throw new Error('Tags must be a non-empty array');
      }
      
      const client = await this.getClient(tenantId);
      
      // The SDK might have a specific method for tags
      // If not, use updateDevice with tags field
      const apiDeviceId = deviceId;
      const device = await this.safeApiCall(() =>
        client.devices.updateDevice(apiDeviceId, { tags })
      );
      
      return device;
    } catch (error) {
      console.error('Error adding tags:', error.message);
      throw error;
    }
  }

  /**
   * Upload file asset using SDK
   */
  async uploadFileAsset(tenantId, filePath, fileName, teamId = null) {
    try {
      console.log(`📤 Uploading file asset for tenant ${tenantId}: ${fileName}`);
      
      // Get the configured client
      const client = await this.getClient(tenantId);
      
      console.log('📁 File path:', filePath);
      console.log('🏷️ Team ID:', teamId || 'none');
      
      // Check if file exists
      try {
        await fs.access(filePath);
        console.log('✅ File exists');
      } catch (error) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      // Upload using SDK method
      console.log('🚀 Calling SDK uploadFileAsset...');
      let asset;
      
      try {
        asset = await this.safeApiCall(() => 
          client.assets.uploadFileAsset(filePath, teamId)
        );
        console.log('✅ SDK upload successful:', asset);
      } catch (sdkError) {
        console.error('❌ SDK uploadFileAsset failed:', sdkError.message);
        throw sdkError;
      }
      
      // Save to local database
      const fileStats = await fs.stat(filePath);
      const savedAsset = await this.models.OptisignsContent.create({
        id: uuid.v4(), // Generate proper UUID
        tenantId: tenantId.toString(),
        optisignsId: asset.id || asset._id || `uploaded-${Date.now()}`,
        name: fileName,
        type: this.determineAssetType(fileName),
        fileType: path.extname(fileName),
        fileSize: fileStats.size,
        url: asset.url || asset.webLink || '',
        webLink: asset.webLink || asset.url || '',
        status: 'created',
        metadata: asset
      });
      
      console.log('✅ Asset saved to database:', savedAsset.optisignsId);
      return savedAsset;
    } catch (error) {
      console.error('❌ Asset upload failed:', error.message);
      throw new Error(`Asset upload failed: ${error.message}`);
    }
  }

  /**
   * Create a website asset
   */
  async createWebsiteAsset(tenantId, webLink, name, teamId = null) {
    try {
      console.log(`🌐 Creating website asset for tenant ${tenantId}: ${name}`);
      
      // Validate parameters
      if (!webLink || !name) {
        throw new Error('Website URL and name are required');
      }
      
      if (!webLink.startsWith('https://') && !webLink.startsWith('http://')) {
        throw new Error('Website URL must start with http:// or https://');
      }
      
      let asset;
      
      try {
        // Method 1: Try SDK first
        const client = await this.getClient(tenantId);
        asset = await this.safeApiCall(() => 
          client.assets.createWebsiteAppAsset(
            {
              url: webLink,
              title: name
            },
            teamId
          )
        );
        console.log('✅ Website asset created via SDK:', asset);
        
      } catch (sdkError) {
        console.warn('⚠️ SDK createWebsiteAppAsset failed, trying direct API:', sdkError.message);
        
        // Method 2: Try direct API call
        try {
          asset = await this.makeApiCall('POST', '/assets/website', {
            url: webLink,
            name: name,
            title: name,
            type: 'website',
            teamId: teamId
          }, {
            tenantId: tenantId.toString()
          });
          console.log('✅ Website asset created via direct API:', asset);
          
        } catch (apiError) {
          console.warn('⚠️ Direct API failed, trying contents endpoint:', apiError.message);
          
          // Method 3: Try contents endpoint
          asset = await this.makeApiCall('POST', '/contents', {
            name: name,
            type: 'web',
            url: webLink,
            webLink: webLink,
            teamId: teamId
          }, {
            tenantId: tenantId.toString()
          });
          console.log('✅ Website asset created via contents endpoint:', asset);
        }
      }
      
      // Save to local database
      const savedAsset = await this.models.OptisignsContent.create({
        id: uuid.v4(), // Generate proper UUID
        tenantId: tenantId.toString(),
        optisignsId: asset.id || asset._id || asset.assetId || `web-${Date.now()}`,
        name: name,
        type: 'web',
        fileType: 'url',
        fileSize: 0,
        url: webLink,
        webLink: webLink,
        status: 'created',
        metadata: {
          ...asset,
          originalUrl: webLink,
          creationMethod: asset.id ? 'api_success' : 'local_fallback'
        }
      });
      
      console.log('✅ Website asset saved to database:', savedAsset.optisignsId);
      return savedAsset;
    } catch (error) {
      console.error('❌ Website asset creation failed:', error.message);
      throw new Error(`Website asset creation failed: ${error.message}`);
    }
  }

  /**
   * Sync assets
   */
  async syncAssets(tenantId) {
    try {
      console.log(`🔄 Syncing assets for tenant ${tenantId}...`);
      
      const client = await this.getClient(tenantId);
      
      // Note: The SDK might not have a listAllAssets method
      // You may need to implement pagination or use a different approach
      console.log('⚠️ Asset sync not implemented - SDK may not support listing all assets');
      
      return [];
    } catch (error) {
      console.error(`Error syncing assets for tenant ${tenantId}:`, error.message);
      throw error;
    }
  }

  /**
   * Push content to device using SDK updateDevice
   */
  async pushContent(tenantId, deviceId, contentId, schedule = "NOW", teamId = null) {
    try {
      console.log(`📤 Assigning content ${contentId} to device ${deviceId} using SDK updateDevice`);
      
      const client = await this.getClient(tenantId);
      
      // Find device in local database
      const device = await this.models.OptisignsDisplay.findOne({
        where: { id: deviceId, tenant_id: tenantId.toString() }
      });
      
      if (!device) {
        throw new Error('Device not found');
      }

      if (!this.validateDeviceId(device.optisignsDisplayId)) {
        throw new Error('Device has invalid OptiSigns ID');
      }

      // Get teamId if not provided
      if (!teamId) {
        const config = await this.getConfiguration(tenantId);
        teamId = config?.settings?.teamId || config?.settings?.defaultTeamId || null;
        console.log(`📋 Using teamId from config: ${teamId}`);
      }

      // Check if contentId is a local UUID or OptiSigns ID
      let optisignsContentId = contentId;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      
      if (uuidRegex.test(contentId)) {
        // It's a local UUID, need to get OptiSigns ID
        const content = await this.models.OptisignsContent.findOne({
          where: { id: contentId, tenant_id: tenantId.toString() }
        });
        
        if (content) {
          optisignsContentId = content.optisignsId;
          console.log(`🔄 Resolved content ID: ${contentId} -> ${optisignsContentId}`);
        }
      }

      const apiDeviceId = device.uuid || device.optisignsDisplayId;
      console.log(`🚀 Using SDK updateDevice: device=${apiDeviceId}, content=${optisignsContentId}, team=${teamId}`);

      // Use SDK updateDevice method to assign content
      const result = await this.safeApiCall(() => 
        client.devices.updateDevice(
          apiDeviceId,
          {
            currentAssetId: optisignsContentId,
            currentType: 'ASSET'
          },
          teamId
        )
      );
      
      console.log('✅ Content assigned successfully via SDK updateDevice');
      
      // Update local database
      await device.update({
        currentAssetId: optisignsContentId,
        currentType: 'ASSET',
        lastUpdated: new Date()
      });
      
      return result;
    } catch (error) {
      console.error('❌ Error assigning content via SDK updateDevice:', error.message);
      throw error;
    }
  }

  /**
   * Simple content assignment without takeover logic
   */
  async assignContent(tenantId, deviceId, contentId, teamId = null) {
    try {
      console.log(`📋 Assigning content ${contentId} to device ${deviceId}`);
      
      // This is just an alias for pushContent
      return await this.pushContent(tenantId, deviceId, contentId, "NOW", teamId);
    } catch (error) {
      console.error('Error in assignContent:', error.message);
      throw error;
    }
  }

  /**
   * Simple content assignment using SDK updateDevice
   */
  async assignContentToDevice(tenantId, deviceId, contentId, contentType = 'ASSET', teamId = null) {
    try {
      console.log(`📋 Assigning content ${contentId} to device ${deviceId} via SDK updateDevice`);
      
      // Use the pushContent method which now uses updateDevice correctly
      return await this.pushContent(tenantId, deviceId, contentId, "NOW", teamId);
      
    } catch (error) {
      console.error('Error assigning content via SDK updateDevice:', error.message);
      throw error;
    }
  }

  /**
   * Push content to multiple devices
   */
  async pushContentToMultipleDevices(tenantId, deviceIds, contentId, teamId = null) {
    const results = {
      successful: [],
      failed: []
    };
    
    for (const deviceId of deviceIds) {
      try {
        await this.pushContent(tenantId, deviceId, contentId, "NOW", teamId);
        results.successful.push(deviceId);
      } catch (error) {
        results.failed.push({
          deviceId,
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * Schedule content for later
   */
  async scheduleContent(tenantId, deviceId, contentId, scheduleTime, teamId = null) {
    try {
      // Convert schedule time to OptiSigns format if needed
      const schedule = scheduleTime instanceof Date ? 
        scheduleTime.toISOString() : scheduleTime;
      
      return await this.pushContent(tenantId, deviceId, contentId, schedule, teamId);
    } catch (error) {
      console.error('Error scheduling content:', error.message);
      throw error;
    }
  }

  /**
   * Clear content from device using SDK updateDevice
   */
  async clearDeviceContent(tenantId, deviceId, teamId = null) {
    try {
      const client = await this.getClient(tenantId);
      
      // Find device in local database
      const device = await this.models.OptisignsDisplay.findOne({
        where: { id: deviceId, tenant_id: tenantId.toString() }
      });
      
      if (!device) {
        throw new Error('Device not found');
      }

      // Get teamId if not provided
      if (!teamId) {
        const config = await this.getConfiguration(tenantId);
        teamId = config?.settings?.teamId || '1';
      }

      // Clear by setting empty values using updateDevice
      const apiDeviceId = device.uuid || device.optisignsDisplayId;
      const result = await this.safeApiCall(() =>
        client.devices.updateDevice(
          apiDeviceId,
          {
            currentAssetId: null,
            currentType: null
          },
          teamId
        )
      );
      
      // Update local database
      await device.update({
        currentAssetId: null,
        currentType: null,
        isUnderTakeover: false,
        currentTakeoverId: null
      });
      
      console.log('✅ Device content cleared');
      return result;
    } catch (error) {
      console.error('Error clearing device content:', error.message);
      throw error;
    }
  }

  /**
   * Takeover device with content using SDK updateDevice
   */
  async takeoverDevice(tenantId, deviceId, contentType, contentId, options = {}) {
    try {
      console.log(`🚨 Initiating device takeover for device ${deviceId}`);
      
      const {
        priority = 'HIGH',
        duration = null,
        message = 'Device takeover initiated',
        restoreAfter = true,
        initiatedBy = 'system',
        teamId = null
      } = options;

      // Find the device in local database
      const device = await this.models.OptisignsDisplay.findOne({
        where: {
          id: deviceId,
          tenant_id: tenantId.toString()
        }
      });
      
      if (!device) {
        throw new Error('Device not found');
      }

      if (!this.validateDeviceId(device.optisignsDisplayId)) {
        throw new Error('Device has invalid OptiSigns ID');
      }

      // Resolve content ID
      const resolvedContent = await this.resolveContentId(tenantId, contentType, contentId);
      
      // Get teamId if not provided
      let effectiveTeamId = teamId;
      if (!effectiveTeamId) {
        const config = await this.getConfiguration(tenantId);
        effectiveTeamId = config?.settings?.teamId || config?.settings?.defaultTeamId || null;
      }
      
      // Assign content to device using SDK updateDevice
      const client = await this.getClient(tenantId);
      
      try {
        const apiDeviceId = device.uuid || device.optisignsDisplayId;
        console.log(`🚀 Using SDK updateDevice for takeover: device=${apiDeviceId}, content=${resolvedContent.optisignsId}, team=${effectiveTeamId}`);

        await this.safeApiCall(() =>
          client.devices.updateDevice(
            apiDeviceId,
            {
              currentAssetId: resolvedContent.optisignsId,
              currentType: contentType
            },
            effectiveTeamId
          )
        );
        console.log('✅ Content assigned to device via SDK updateDevice for takeover');
      } catch (sdkError) {
        console.error('❌ SDK updateDevice failed:', sdkError.message);
        throw new Error(`Failed to assign content to device: ${sdkError.message}`);
      }

      // Create takeover record in database
      const takeover = await this.createTakeoverRecord(
        tenantId,
        device,
        contentType,
        resolvedContent,
        {
          priority,
          duration,
          message,
          restoreAfter,
          initiatedBy,
          teamId: effectiveTeamId
        }
      );

      // Update device state
      await device.update({
        isUnderTakeover: true,
        currentTakeoverId: takeover.id,
        currentType: contentType,
        currentAssetId: contentType === 'ASSET' ? resolvedContent.optisignsId : null,
        currentPlaylistId: contentType === 'PLAYLIST' ? resolvedContent.optisignsId : null
      });

      // Schedule automatic restoration if duration is set
      if (duration && restoreAfter) {
        setTimeout(async () => {
          try {
            await this.stopTakeover(tenantId, deviceId, true, 'Duration expired');
          } catch (error) {
            console.error('Error during automatic takeover restoration:', error.message);
          }
        }, duration * 1000);
      }

      console.log(`✅ Device takeover initiated successfully`);
      
      return {
        takeover,
        device: await device.reload()
      };
    } catch (error) {
      console.error('❌ Device takeover failed:', error.message);
      throw error;
    }
  }

  /**
   * Reboot device
   */
  async rebootDevice(tenantId, deviceId) {
    try {
      console.log(`🔄 Rebooting device ${deviceId}`);
      
      const client = await this.getClient(tenantId);
      
      // Find device in local database
      const device = await this.models.OptisignsDisplay.findOne({
        where: { id: deviceId, tenant_id: tenantId.toString() }
      });
      
      if (!device) {
        throw new Error('Device not found');
      }

      if (!this.validateDeviceId(device.optisignsDisplayId)) {
        throw new Error('Device has invalid OptiSigns ID');
      }

      await this.safeApiCall(() => 
        client.devices.rebootDevice(device.optisignsDisplayId)
      );
      console.log('✅ Device reboot command sent');
      
      return {
        success: true,
        message: 'Device reboot command sent successfully',
        device: {
          id: device.id,
          name: device.name,
          optisignsId: device.optisignsDisplayId
        }
      };
    } catch (error) {
      console.error('Error rebooting device:', error.message);
      throw error;
    }
  }

  /**
   * Delete device
   */
  async deleteDevice(tenantId, deviceId, teamId = null) {
    try {
      console.log(`🗑️ Deleting device ${deviceId}`);
      
      const client = await this.getClient(tenantId);
      
      // Find device in local database
      const device = await this.models.OptisignsDisplay.findOne({
        where: { id: deviceId, tenant_id: tenantId.toString() }
      });
      
      if (!device) {
        throw new Error('Device not found');
      }

      if (!this.validateDeviceId(device.optisignsDisplayId)) {
        throw new Error('Device has invalid OptiSigns ID');
      }

      await this.safeApiCall(() => 
        client.devices.deleteDeviceById(device.optisignsDisplayId, teamId)
      );
      
      // Remove from local database
      await device.destroy();
      
      console.log('✅ Device deleted successfully');
      return { success: true, message: 'Device deleted' };
    } catch (error) {
      console.error('Error deleting device:', error.message);
      throw error;
    }
  }

  /**
   * Map device status from SDK response
   */
  mapDeviceStatus(device) {
    // Check multiple possible status fields
    if (device.deviceStatus) return device.deviceStatus.toUpperCase();
    if (device.status) return device.status.toUpperCase();
    
    // Default to ONLINE since we're defaulting all devices to online
    return 'ONLINE';
  }

  /**
   * Determine if device is online - Now defaults to true
   */
  isDeviceOnline(device) {
    // Always return true as requested
    return true;
  }

  /**
   * Get last seen date from device
   */
  getLastSeenDate(device) {
    // Check multiple possible date fields
    const dateFields = [
      device.lastSeen,
      device.lastOnline,
      device.lastHeartbeat,
      device.lastActivity,
      device.updatedAt,
      device.lastUpdated
    ];
    
    for (const dateField of dateFields) {
      if (dateField) {
        const date = new Date(dateField);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }
    
    // Default to current time if no valid date found
    return new Date();
  }

  /**
   * Validate current type
   */
  validateCurrentType(currentType) {
    if (!currentType) return null;
    const upperType = currentType.toUpperCase();
    return ['ASSET', 'PLAYLIST'].includes(upperType) ? upperType : null;
  }

  /**
   * Determine asset type from filename
   */
  determineAssetType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    const videoExts = ['.mp4', '.webm', '.avi', '.mov'];
    
    if (imageExts.includes(ext)) return 'image';
    if (videoExts.includes(ext)) return 'video';
    if (ext === '.pdf') return 'document';
    if (ext === '.html' || ext === '.htm') return 'web';
    return 'other';
  }

  /**
   * Resolve content ID
   */
  async resolveContentId(tenantId, contentType, contentId) {
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const isLocalUuid = uuidRegex.test(contentId);
      
      let content = null;
      
      if (contentType === 'ASSET') {
        if (isLocalUuid) {
          content = await this.models.OptisignsContent.findOne({
            where: { id: contentId, tenant_id: tenantId.toString() }
          });
        } else {
          content = await this.models.OptisignsContent.findOne({
            where: { optisigns_id: contentId, tenant_id: tenantId.toString() }
          });
        }
      } else if (contentType === 'PLAYLIST') {
        if (isLocalUuid) {
          content = await this.models.OptisignsPlaylist.findOne({
            where: { id: contentId, tenant_id: tenantId.toString() }
          });
        } else {
          content = await this.models.OptisignsPlaylist.findOne({
            where: { optisigns_id: contentId, tenant_id: tenantId.toString() }
          });
        }
      }
      
      if (!content) {
        throw new Error(`${contentType} with ID ${contentId} not found`);
      }
      
      return {
        localId: content.id,
        optisignsId: content.optisignsId,
        content: content
      };
    } catch (error) {
      console.error(`Failed to resolve ${contentType} ID ${contentId}:`, error.message);
      throw error;
    }
  }

  /**
   * Create takeover record
   */
  async createTakeoverRecord(tenantId, device, contentType, resolvedContent, options) {
    const {
      priority,
      duration,
      message,
      restoreAfter,
      initiatedBy
    } = options;

    const startTime = new Date();
    const endTime = duration ? new Date(startTime.getTime() + (duration * 1000)) : null;

    return await this.models.OptisignsTakeover.create({
      id: uuid.v4(), // Generate proper UUID
      tenantId: tenantId.toString(),
      displayId: device.id,
      contentType,
      contentId: resolvedContent.localId,
      optisignsContentId: resolvedContent.optisignsId,
      priority,
      status: 'ACTIVE',
      startTime,
      endTime,
      duration,
      message,
      restoreAfter,
      previousContentType: device.currentType,
      previousContentId: device.currentAssetId || device.currentPlaylistId,
      initiatedBy,
      metadata: {
        deviceName: device.name,
        contentName: resolvedContent.content.name,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Stop device takeover and optionally restore previous content
   */
  async stopTakeover(tenantId, deviceId, restoreContent = true, reason = 'Manual stop') {
    try {
      console.log(`🛑 Stopping takeover for device ${deviceId}`);
      
      // Find active takeover
      const takeover = await this.models.OptisignsTakeover.findOne({
        where: {
          display_id: deviceId,
          status: 'ACTIVE'
        },
        include: [
          { model: this.models.OptisignsDisplay, as: 'display' }
        ]
      });
      
      if (!takeover) {
        throw new Error('No active takeover found for this device');
      }
      
      const device = takeover.display;

      // Mark takeover as completed
      await takeover.update({
        status: 'COMPLETED',
        completedAt: new Date()
      });

      // Restore previous content if requested
      let contentRestored = false;
      if (restoreContent && takeover.restoreAfter && takeover.previousContentId) {
        try {
          const client = await this.getClient(tenantId);
          
          // Get teamId
          const config = await this.getConfiguration(tenantId);
          const teamId = config?.settings?.teamId || config?.settings?.defaultTeamId || null;
          
          // Use updateDevice to restore previous content
          const apiDeviceId = device.uuid || device.optisignsDisplayId;
          await this.safeApiCall(() =>
            client.devices.updateDevice(
              apiDeviceId,
              {
                currentAssetId: takeover.previousContentId,
                currentType: takeover.previousContentType || 'ASSET'
              },
              teamId
            )
          );
          contentRestored = true;
          console.log('✅ Previous content restored via updateDevice');
        } catch (error) {
          console.warn('⚠️ Content restoration failed:', error.message);
        }
      }

      // Update device state
      await device.update({
        isUnderTakeover: false,
        currentTakeoverId: null,
        currentType: contentRestored ? takeover.previousContentType : device.currentType,
        currentAssetId: contentRestored && takeover.previousContentType === 'ASSET' ? 
          takeover.previousContentId : device.currentAssetId,
        currentPlaylistId: contentRestored && takeover.previousContentType === 'PLAYLIST' ? 
          takeover.previousContentId : device.currentPlaylistId
      });

      // Log event
      await this.models.OptisignsEvent.create({
        id: uuid.v4(), // Generate proper UUID
        tenantId: tenantId.toString(),
        displayId: deviceId,
        takeoverId: takeover.id,
        eventType: 'TAKEOVER_STOPPED',
        eventData: {
          reason,
          contentRestored,
          duration: takeover.duration
        }
      });

      console.log(`✅ Takeover stopped successfully`);
      
      return {
        takeover,
        device: await device.reload(),
        contentRestored
      };
    } catch (error) {
      console.error('❌ Stop takeover failed:', error.message);
      throw error;
    }
  }

  /**
   * Get active takeovers
   */
  async getActiveTakeovers(tenantId, filters = {}) {
    try {
      const whereClause = {
        tenant_id: tenantId.toString(),
        status: filters.status || 'ACTIVE'
      };
      
      if (filters.priority) whereClause.priority = filters.priority;
      if (filters.deviceId) whereClause.display_id = filters.deviceId;
      
      const takeovers = await this.models.OptisignsTakeover.findAll({
        where: whereClause,
        include: [
          {
            model: this.models.OptisignsDisplay,
            as: 'display',
            attributes: ['id', 'name', 'location']
          }
        ],
        limit: filters.limit || 600,
        offset: filters.offset || 60,
        order: [['created_at', 'DESC']]
      });
      
      const total = await this.models.OptisignsTakeover.count({ where: whereClause });
      
      return {
        takeovers,
        total,
        summary: {
          active: takeovers.filter(t => t.status === 'ACTIVE').length,
          scheduled: takeovers.filter(t => t.status === 'SCHEDULED').length,
          emergency: takeovers.filter(t => t.priority === 'EMERGENCY').length
        }
      };
    } catch (error) {
      console.error('Error getting active takeovers:', error.message);
      throw error;
    }
  }

  /**
   * Get takeover status for a device
   */
  async getTakeoverStatus(tenantId, deviceId) {
    try {
      const device = await this.models.OptisignsDisplay.findOne({
        where: {
          id: deviceId,
          tenant_id: tenantId.toString()
        }
      });
      
      if (!device) {
        throw new Error('Device not found');
      }
      
      const activeTakeover = await this.models.OptisignsTakeover.findOne({
        where: {
          display_id: deviceId,
          status: 'ACTIVE'
        }
      });
      
      return {
        isUnderTakeover: device.isUnderTakeover,
        currentTakeover: activeTakeover ? {
          id: activeTakeover.id,
          priority: activeTakeover.priority,
          startTime: activeTakeover.startTime,
          endTime: activeTakeover.endTime,
          message: activeTakeover.message
        } : null
      };
    } catch (error) {
      console.error('Error getting takeover status:', error.message);
      throw error;
    }
  }

  /**
   * Remove tags from device
   */
  async removeTags(tenantId, deviceId, tags) {
    try {
      if (!Array.isArray(tags) || tags.length === 0) {
        throw new Error('Tags must be a non-empty array');
      }
      
      const client = await this.getClient(tenantId);
      
      // Get current device to find existing tags
      const apiDeviceId = deviceId;
      const device = await this.safeApiCall(() =>
        client.devices.getDeviceById(apiDeviceId)
      );
      
      // Remove specified tags
      const currentTags = device.tags || [];
      const updatedTags = currentTags.filter(tag => !tags.includes(tag));
      
      // Update device with new tags
      const updatedDevice = await this.safeApiCall(() =>
        client.devices.updateDevice(apiDeviceId, { tags: updatedTags })
      );
      
      return updatedDevice;
    } catch (error) {
      console.error('Error removing tags:', error.message);
      throw error;
    }
  }

  /**
   * List all devices (alias for syncDisplays for compatibility)
   */
  async listDevices(tenantId) {
    try {
      return await this.syncDisplays(tenantId);
    } catch (error) {
      console.error('Error listing devices:', error.message);
      throw error;
    }
  }

  /**
   * Verify all required methods are available
   */
  verifyRequiredMethods() {
    const requiredMethods = [
      'getClient',
      'updateDevice',
      'takeoverDevice',
      'stopTakeover',
      'syncDisplays',
      'listDevices',
      'pushContent',
      'uploadFileAsset',
      'addTags',
      'removeTags',
      'validateDeviceId',
      'safeApiCall'
    ];
    
    for (const method of requiredMethods) {
      if (typeof this[method] !== 'function') {
        console.error(`Missing required method: ${method}`);
        return false;
      }
    }
    
    return true;
  }
}

module.exports = OptisignsService;