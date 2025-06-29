// shared/optisign-sdk.js
// OptiSign SDK - Replaces optisigns-service.js with enhanced SDK functionality

const axios = require('axios');

class OptisignSDK {
  constructor(models) {
    this.models = models;
    this.graphqlUrl = 'https://graphql-gateway.optisigns.com/graphql';
    this.timeout = 30000;
    this.retryAttempts = 3;
    this.retryDelay = 1000;
    this.cache = new Map();
    this.cacheTimeout = 300000; // 5 minutes
  }

  /**
   * Get tenant's OptiSigns configuration and API token with caching
   */
  async getTenantApiToken(tenantId) {
    try {
      const cacheKey = `token_${tenantId}`;
      
      // Check cache first
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTimeout) {
          return cached.data;
        }
        this.cache.delete(cacheKey);
      }

      const config = await this.models.OptisignsConfig.findOne({
        where: { tenantId, isActive: true }
      });
      
      if (!config || !config.apiToken) {
        throw new Error(`OptiSigns not configured for tenant ${tenantId}. Please set up your API token first.`);
      }
      
      // Cache the token
      this.cache.set(cacheKey, {
        data: config.apiToken,
        timestamp: Date.now()
      });
      
      return config.apiToken;
    } catch (error) {
      console.error(`Error getting API token for tenant ${tenantId}:`, error.message);
      throw error;
    }
  }

  /**
   * Execute GraphQL query with automatic API token fetching and retry logic
   */
  async executeGraphQL(tenantId, query, variables = {}) {
    const apiToken = await this.getTenantApiToken(tenantId);
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        console.log(`🔍 Making GraphQL request (attempt ${attempt}) for tenant ${tenantId} to: ${this.graphqlUrl}`);
        console.log(`📝 Query:`, query.replace(/\s+/g, ' ').trim());
        
        const payload = { query };
        
        if (Object.keys(variables).length > 0) {
          payload.variables = variables;
          console.log(`📊 Variables:`, JSON.stringify(variables, null, 2));
        }

        const response = await axios.post(this.graphqlUrl, payload, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          timeout: this.timeout
        });

        console.log(`✅ GraphQL response status: ${response.status}`);

        if (response.data.errors) {
          console.error('❌ GraphQL Errors:', JSON.stringify(response.data.errors, null, 2));
          
          // Check for specific JWT/authentication errors
          const authErrors = response.data.errors.filter(error => 
            error.message?.includes('invalid signature') ||
            error.message?.includes('jwt expired') ||
            error.message?.includes('invalid token') ||
            error.extensions?.code === 'UNAUTHENTICATED'
          );
          
          if (authErrors.length > 0) {
            // Clear cached token on auth errors
            this.cache.delete(`token_${tenantId}`);
            throw new Error(`Authentication failed: ${authErrors[0].message}`);
          }
          
          throw new Error(`GraphQL Error: ${response.data.errors[0].message}`);
        }

        return response.data.data;
        
      } catch (error) {
        console.error(`GraphQL attempt ${attempt} failed:`, error.message);
        
        // Don't retry on authentication errors
        if (error.message.includes('Authentication failed')) {
          throw error;
        }
        
        // Retry on network/timeout errors
        if (attempt < this.retryAttempts) {
          const delay = this.retryDelay * attempt;
          console.log(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
          continue;
        }
        
        throw new Error(`Request failed after ${this.retryAttempts} attempts: ${error.message}`);
      }
    }
  }

  /**
   * Test API connection with provided token
   */
  async testApiConnection(apiToken) {
    try {
      const query = `
        query {
          me {
            _id
            email
            firstName
            lastName
          }
        }
      `;

      const response = await axios.post(this.graphqlUrl, { query }, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      });

      if (response.data.errors) {
        return {
          success: false,
          error: response.data.errors[0].message
        };
      }

      return {
        success: true,
        user: response.data.data.me
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * List devices with pagination support
   */
  async listDevices(tenantId, cursor = null, limit = 20) {
    try {
      console.log(`📱 Listing devices for tenant ${tenantId} (cursor: ${cursor}, limit: ${limit})`);
      
      const query = `
        query GetDevices($first: Int, $after: String) {
          devices(first: $first, after: $after) {
            edges {
              node {
                _id
                deviceName
                UUID
                status
                utilsOnline
                currentAssetId
                currentPlaylistId
                currentType
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;
      
      const variables = { first: limit };
      if (cursor) variables.after = cursor;
      
      const data = await this.executeGraphQL(tenantId, query, variables);
      
      const devices = data.devices.edges.map(edge => edge.node);
      
      return {
        devices,
        pageInfo: data.devices.pageInfo,
        total: devices.length
      };
    } catch (error) {
      console.error(`Error listing devices for tenant ${tenantId}:`, error.message);
      throw new Error(`Failed to list devices: ${error.message}`);
    }
  }

  /**
   * Get single device by ID
   */
  async getDevice(tenantId, deviceId) {
    try {
      const query = `
        query GetDevice($deviceId: ID!) {
          device(id: $deviceId) {
            _id
            deviceName
            UUID
            status
            utilsOnline
            currentAssetId
            currentPlaylistId
            currentType
          }
        }
      `;
      
      const data = await this.executeGraphQL(tenantId, query, { deviceId });
      
      if (!data.device) {
        throw new Error(`Device ${deviceId} not found`);
      }
      
      return data.device;
    } catch (error) {
      console.error(`Error getting device ${deviceId}:`, error.message);
      throw new Error(`Failed to get device: ${error.message}`);
    }
  }

  /**
   * List assets
   */
  async listAssets(tenantId) {
    try {
      const query = `
        query {
          assets {
            _id
            name
            fileType
            fileSize
            webLink
          }
        }
      `;
      
      const data = await this.executeGraphQL(tenantId, query);
      return data.assets || [];
    } catch (error) {
      console.error(`Error listing assets for tenant ${tenantId}:`, error.message);
      throw new Error(`Failed to list assets: ${error.message}`);
    }
  }

  /**
   * Pair device using pairing code
   */
  async pairDevice(tenantId, pairingCode) {
    try {
      const mutation = `
        mutation PairDevice($pairingCode: String!) {
          pairDevice(pairingCode: $pairingCode) {
            _id
            deviceName
            UUID
            status
            utilsOnline
            currentType
          }
        }
      `;
      
      const data = await this.executeGraphQL(tenantId, mutation, { pairingCode });
      
      if (!data.pairDevice) {
        throw new Error('Device pairing failed');
      }
      
      return data.pairDevice;
    } catch (error) {
      console.error(`Error pairing device with code ${pairingCode}:`, error.message);
      throw new Error(`Failed to pair device: ${error.message}`);
    }
  }

  /**
   * Sync displays from OptiSigns API to local database
   */
  async syncDisplays(tenantId) {
    try {
      console.log(`Syncing displays for tenant ${tenantId}...`);
      
      let allDevices = [];
      let cursor = null;
      let hasNextPage = true;
      
      // Fetch all devices with pagination
      while (hasNextPage) {
        const result = await this.listDevices(tenantId, cursor, 50);
        allDevices = allDevices.concat(result.devices);
        hasNextPage = result.pageInfo.hasNextPage;
        cursor = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null;
      }
      
      console.log(`Found ${allDevices.length} devices from OptiSigns for tenant ${tenantId}`);
      
      // Clear existing displays for this tenant
      await this.models.OptisignsDisplay.destroy({
        where: { tenant_id: tenantId }
      });
      
      // Save new displays
      const savedDisplays = [];
      
      for (const device of allDevices) {
        try {
          const validatedCurrentType = this.validateCurrentType(device.currentType);
          
          const deviceData = {
            tenantId,
            optisignsDisplayId: device._id,
            optisignsId: device._id,
            name: device.deviceName || `OptiSign Display ${device._id.slice(-8)}`,
            uuid: device.UUID,
            location: null,
            status: device.status || 'UNKNOWN',
            resolution: {},
            orientation: null,
            isActive: true,
            lastSeen: device.utilsOnline ? new Date() : null,
            metadata: device,
            currentContentId: null,
            currentAssetId: device.currentAssetId,
            currentPlaylistId: device.currentPlaylistId,
            currentType: validatedCurrentType,
            isOnline: device.utilsOnline || false
          };
          
          const savedDisplay = await this.models.OptisignsDisplay.create(deviceData);
          savedDisplays.push(savedDisplay);
        } catch (error) {
          console.error(`Failed to save device ${device._id}:`, error.message);
        }
      }
      
      console.log(`✅ Saved ${savedDisplays.length} displays to database for tenant ${tenantId}`);
      return savedDisplays;
    } catch (error) {
      console.error(`Error syncing displays for tenant ${tenantId}:`, error.message);
      throw new Error(`Failed to sync displays: ${error.message}`);
    }
  }

  /**
   * Sync single device
   */
  async syncSingleDevice(tenantId, deviceId) {
    try {
      console.log(`Syncing single device for tenant ${tenantId}: ${deviceId}`);
      
      const device = await this.getDevice(tenantId, deviceId);
      const validatedCurrentType = this.validateCurrentType(device.currentType);
      
      const deviceData = {
        tenantId,
        optisignsDisplayId: device._id,
        optisignsId: device._id,
        name: device.deviceName || `OptiSign Display ${device._id.slice(-8)}`,
        uuid: device.UUID,
        location: null,
        status: device.status || 'UNKNOWN',
        resolution: {},
        orientation: null,
        isActive: true,
        lastSeen: device.utilsOnline ? new Date() : null,
        metadata: device,
        currentContentId: null,
        currentAssetId: device.currentAssetId,
        currentPlaylistId: device.currentPlaylistId,
        currentType: validatedCurrentType,
        isOnline: device.utilsOnline || false
      };
      
      const [savedDevice, created] = await this.models.OptisignsDisplay.upsert(
        deviceData,
        {
          where: {
            tenant_id: tenantId,
            optisigns_display_id: device._id
          }
        }
      );
      
      console.log(`✅ Device ${created ? 'created' : 'updated'} in database for tenant ${tenantId}`);
      return savedDevice;
    } catch (error) {
      console.error(`Error syncing single device for tenant ${tenantId}:`, error.message);
      throw new Error(`Failed to sync device: ${error.message}`);
    }
  }

  /**
   * Sync assets from OptiSigns API
   */
  async syncAssets(tenantId) {
    try {
      console.log(`Syncing assets for tenant ${tenantId}...`);
      
      const assets = await this.listAssets(tenantId);
      console.log(`Found ${assets.length} assets from OptiSigns for tenant ${tenantId}`);
      
      // Clear existing assets for this tenant
      await this.models.OptisignsContent.destroy({
        where: { tenant_id: tenantId }
      });
      
      // Save new assets
      const savedAssets = [];
      
      for (const asset of assets) {
        try {
          const assetData = {
            tenantId,
            optisignsId: asset._id,
            name: asset.name,
            type: asset.fileType || 'asset',
            fileType: asset.fileType,
            fileSize: asset.fileSize,
            url: asset.webLink,
            webLink: asset.webLink,
            status: 'created',
            metadata: asset
          };
          
          const savedAsset = await this.models.OptisignsContent.create(assetData);
          savedAssets.push(savedAsset);
        } catch (error) {
          console.error(`Failed to save asset ${asset._id}:`, error.message);
        }
      }
      
      console.log(`✅ Saved ${savedAssets.length} assets to database for tenant ${tenantId}`);
      return savedAssets;
    } catch (error) {
      console.error(`Error syncing assets for tenant ${tenantId}:`, error.message);
      throw new Error(`Failed to sync assets: ${error.message}`);
    }
  }

  /**
   * Configuration management
   */
  async updateConfiguration(tenantId, apiToken, settings) {
    try {
      // Test the API token before saving
      const testResult = await this.testApiConnection(apiToken);
      if (!testResult.success) {
        throw new Error(`Invalid API token: ${testResult.error}`);
      }

      const [config, created] = await this.models.OptisignsConfig.upsert({
        tenantId,
        apiToken,
        settings: settings || {},
        isActive: true,
        lastValidated: new Date()
      });

      // Clear cached token for this tenant
      this.cache.delete(`token_${tenantId}`);

      console.log(`✅ OptiSigns configuration ${created ? 'created' : 'updated'} for tenant ${tenantId}`);
      return config;
    } catch (error) {
      console.error(`Error updating configuration for tenant ${tenantId}:`, error.message);
      throw error;
    }
  }

  async getConfiguration(tenantId) {
    try {
      return await this.models.OptisignsConfig.findOne({
        where: { tenantId, isActive: true }
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
   * Validate currentType field
   */
  validateCurrentType(currentType) {
    const validTypes = ['ASSET', 'PLAYLIST', 'SCHEDULE', 'LIVE_STREAM', 'APP', null];
    return validTypes.includes(currentType) ? currentType : null;
  }

  /**
   * Debug API with comprehensive testing
   */
  async debugApiWithToken(apiToken) {
    const results = {
      me: null,
      schema: null,
      devices: null,
      errors: []
    };

    try {
      // Test basic connectivity
      console.log('🔍 Testing basic API connectivity...');
      const meQuery = `query { me { _id email } }`;
      
      const meResponse = await axios.post(this.graphqlUrl, { query: meQuery }, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      });

      if (meResponse.data.errors) {
        results.errors.push(`Me query failed: ${meResponse.data.errors[0].message}`);
      } else {
        results.me = meResponse.data.data.me;
        console.log('✅ Basic connectivity successful');
      }

      // Test schema introspection
      console.log('🔍 Testing schema introspection...');
      const schemaQuery = `
        query {
          __schema {
            queryType {
              fields {
                name
                type {
                  name
                }
              }
            }
          }
        }
      `;
      
      const schemaResponse = await axios.post(this.graphqlUrl, { query: schemaQuery }, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      });

      if (schemaResponse.data.errors) {
        results.errors.push(`Schema query failed: ${schemaResponse.data.errors[0].message}`);
      } else {
        results.schema = schemaResponse.data.data;
        console.log('✅ Schema introspection successful');
      }

      // Test devices query
      console.log('🔍 Testing devices query...');
      const devicesQuery = `
        query {
          devices(first: 5) {
            edges {
              node {
                _id
                deviceName
              }
            }
          }
        }
      `;
      
      const devicesResponse = await axios.post(this.graphqlUrl, { query: devicesQuery }, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      });

      if (devicesResponse.data.errors) {
        results.errors.push(`Devices query failed: ${devicesResponse.data.errors[0].message}`);
      } else {
        results.devices = {
          workingQuery: 'devices(first: 5)',
          result: devicesResponse.data.data
        };
        console.log('✅ Devices query successful');
      }

    } catch (error) {
      results.errors.push(`Network error: ${error.message}`);
    }

    return results;
  }

  /**
   * Upload asset to OptiSigns
   */
  async uploadAsset(tenantId, file, name, type) {
    try {
      console.log(`📤 Uploading asset for tenant ${tenantId}: ${name} (${type})`);
      
      if (!file) {
        throw new Error('File is required for asset upload');
      }
      
      if (!name) {
        throw new Error('Asset name is required');
      }

      // Note: Implementation depends on OptiSigns' actual upload mechanism
      const mutation = `
        mutation UploadAsset($file: Upload!, $name: String!, $type: String!) {
          uploadAsset(file: $file, name: $name, type: $type) {
            _id
            name
            webLink
            status
          }
        }
      `;
      
      const variables = { file, name, type };
      const data = await this.executeGraphQL(tenantId, mutation, variables);
      
      console.log(`✅ Asset uploaded successfully: ${data.uploadAsset._id}`);
      return data.uploadAsset;
    } catch (error) {
      console.error(`Error uploading asset for tenant ${tenantId}:`, error.message);
      throw new Error(`Failed to upload asset: ${error.message}`);
    }
  }

  /**
   * Schedule content on device
   */
  async scheduleContent(tenantId, deviceId, playlistId, start, end) {
    try {
      // Validate local device and playlist exist
      const localDevice = await this.models.OptisignsDisplay.findOne({
        where: {
          id: deviceId,
          tenant_id: tenantId
        }
      });
      
      if (!localDevice) {
        throw new Error('Device not found');
      }
      
      const localPlaylist = await this.models.OptisignsPlaylist.findOne({
        where: {
          id: playlistId,
          tenant_id: tenantId
        }
      });
      
      if (!localPlaylist) {
        throw new Error('Playlist not found');
      }

      // Check for scheduling conflicts
      const conflictingSchedule = await this.models.OptisignsSchedule.findOne({
        where: {
          display_id: deviceId,
          status: { [this.models.sequelize.Op.in]: ['SCHEDULED', 'ACTIVE'] },
          [this.models.sequelize.Op.or]: [
            {
              start_time: { [this.models.sequelize.Op.between]: [start, end] }
            },
            {
              end_time: { [this.models.sequelize.Op.between]: [start, end] }
            },
            {
              [this.models.sequelize.Op.and]: [
                { start_time: { [this.models.sequelize.Op.lte]: start } },
                { end_time: { [this.models.sequelize.Op.gte]: end } }
              ]
            }
          ]
        }
      });
      
      if (conflictingSchedule) {
        throw new Error('Schedule conflicts with existing schedule');
      }

      const mutation = `
        mutation ScheduleContent($deviceId: ID!, $playlistId: ID!, $startTime: DateTime!, $endTime: DateTime!) {
          schedulePlaylistAssignment(input: {
            deviceId: $deviceId,
            playlistId: $playlistId,
            startTime: $startTime,
            endTime: $endTime
          }) {
            _id
            status
          }
        }
      `;
      
      const variables = { 
        deviceId: localDevice.optisignsDisplayId, 
        playlistId: localPlaylist.optisignsId,
        startTime: start.toISOString(),
        endTime: end.toISOString()
      };
      
      let optisignsScheduleId = null;
      
      try {
        const data = await this.executeGraphQL(tenantId, mutation, variables);
        optisignsScheduleId = data.schedulePlaylistAssignment?._id;
        console.log('✅ Content scheduled in OptiSigns successfully');
      } catch (apiError) {
        console.warn('⚠️ OptiSigns scheduling failed, but continuing with local scheduling:', apiError.message);
      }
      
      // Create local schedule
      const scheduleData = {
        tenantId,
        optisignsScheduleId,
        displayId: deviceId,
        playlistId: playlistId,
        startTime: start,
        endTime: end,
        status: 'SCHEDULED',
        createdBy: 'sdk'
      };
      
      const schedule = await this.models.OptisignsSchedule.create(scheduleData);
      
      console.log(`✅ Schedule created locally: ${schedule.id}`);
      return schedule;
    } catch (error) {
      console.error(`Error scheduling content for tenant ${tenantId}:`, error.message);
      throw new Error(`Failed to schedule content: ${error.message}`);
    }
  }

  /**
   * Utility: Sleep function for retries
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear cache for tenant
   */
  clearCache(tenantId = null) {
    if (tenantId) {
      this.cache.delete(`token_${tenantId}`);
    } else {
      this.cache.clear();
    }
  }
}

module.exports = OptisignSDK;