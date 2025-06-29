// shared/optisigns-routes.js
// OptiSigns routes using SDK-based service

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    console.log('File upload attempt:', file.originalname, file.mimetype);
    cb(null, true); // Accept any file for now
  }
});

// UUID validation middleware
const validateUUID = (paramName = 'id') => {
  return (req, res, next) => {
    const paramValue = req.params[paramName];
    
    // UUID regex pattern (version 4)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (!paramValue) {
      return res.status(400).json({
        error: `${paramName} parameter is required`,
        timestamp: new Date().toISOString()
      });
    }
    
    if (!uuidRegex.test(paramValue)) {
      console.log(`❌ Invalid UUID format received: "${paramValue}" for parameter: ${paramName}`);
      return res.status(400).json({
        error: `Invalid ${paramName} format. Expected UUID format (e.g., 123e4567-e89b-12d3-a456-426614174000)`,
        received: paramValue,
        timestamp: new Date().toISOString()
      });
    }
    
    console.log(`✅ Valid UUID: ${paramValue}`);
    next();
  };
};

module.exports = function(app, sequelize, authenticateToken, optisignsModels, optisignsService) {
  const router = express.Router();
  
  // Middleware to check if OptiSigns is configured for tenant
  const requireOptisignsConfig = async (req, res, next) => {
    try {
      if (!optisignsService) {
        return res.status(500).json({ 
          error: 'OptiSigns service not initialized',
          message: 'Internal server error - service unavailable'
        });
      }
      
      const isConfigured = await optisignsService.isConfigured(req.user.tenantId);
      if (!isConfigured) {
        return res.status(400).json({ 
          error: 'OptiSigns not configured for your account',
          message: 'Please configure your OptiSigns API token first',
          configureEndpoint: '/api/optisigns/config'
        });
      }
      next();
    } catch (error) {
      console.error('Error checking OptiSigns configuration:', error);
      res.status(500).json({ error: 'Failed to check OptiSigns configuration' });
    }
  };

  // ===== CONFIGURATION ENDPOINTS =====
  
  
  // Update configuration
  router.put('/optisigns/config', authenticateToken, async (req, res) => {
    try {
      const { apiToken, settings } = req.body;
      
      if (!apiToken) {
        return res.status(400).json({ error: 'API token is required' });
      }

      console.log('Updating OptiSigns configuration for tenant:', req.user.tenantId);
      const config = await optisignsService.updateConfiguration(
        req.user.tenantId, 
        apiToken, 
        settings
      );
      
      res.json({
        message: 'OptiSigns configuration updated successfully',
        apiToken: '***' + apiToken.slice(-8),
        settings: config.settings,
        isActive: config.isActive,
        lastValidated: config.lastValidated,
        status: 'active'
      });
    } catch (error) {
      console.error('Error updating config:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Get configuration
  router.get('/optisigns/config', authenticateToken, async (req, res) => {
    try {
      const config = await optisignsService.getConfiguration(req.user.tenantId);
      
      if (!config) {
        return res.json({ 
          apiToken: null, 
          settings: {}, 
          isActive: false,
          lastValidated: null,
          status: 'not_configured',
          message: 'OptiSigns has not been configured for your account'
        });
      }

      res.json({
        apiToken: config.apiToken ? '***' + config.apiToken.slice(-8) : null,
        settings: config.settings || {},
        isActive: config.isActive,
        lastValidated: config.lastValidated,
        status: config.isActive ? 'active' : 'inactive',
        message: 'OptiSigns is configured and ready to use'
      });
    } catch (error) {
      console.error('Error getting config:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== DEVICE ENDPOINTS =====

  // Sync displays
  router.post('/optisigns/displays/sync', authenticateToken, requireOptisignsConfig, async (req, res) => {
    try {
      console.log('Syncing displays for tenant:', req.user.tenantId);
      const displays = await optisignsService.syncDisplays(req.user.tenantId);
      
      res.json({
        message: `Successfully synced ${displays.length} displays`,
        summary: {
          totalSynced: displays.length,
          onlineDisplays: displays.filter(d => d.isOnline).length,
          offlineDisplays: displays.filter(d => !d.isOnline).length
        },
        displays: displays,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error syncing displays:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Get displays
  router.get('/optisigns/displays', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit, status, isOnline, location } = req.query;
      const tenantId = req.user.tenantId;

      const whereClause = { tenant_id: tenantId };
      if (status) whereClause.status = status;
      if (isOnline !== undefined) whereClause.is_online = isOnline === 'true';
      if (location) whereClause.location = { [sequelize.Sequelize.Op.iLike]: `%${location}%` };

      const queryOptions = {
        where: whereClause,
        order: [['name', 'ASC']],
        attributes: { exclude: ['metadata'] }
      };

      if (limit) {
        queryOptions.limit = parseInt(limit);
        queryOptions.offset = (parseInt(page) - 1) * parseInt(limit);
      }

      const displays = await optisignsModels.OptisignsDisplay.findAll(queryOptions);

      const count = await optisignsModels.OptisignsDisplay.count({ where: whereClause });

      const statistics = {
        total: count,
        online: displays.filter(d => d.isOnline).length,
        offline: displays.filter(d => !d.isOnline).length,
        configured: await optisignsService.isConfigured(tenantId)
      };

      const response = { displays, statistics };

      if (limit) {
        response.pagination = {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / parseInt(limit)),
          totalCount: count,
          hasNextPage: parseInt(page) * parseInt(limit) < count,
          hasPreviousPage: parseInt(page) > 1
        };
      }

      res.json(response);
    } catch (error) {
      console.error('Error getting displays:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Get single display
  router.get('/optisigns/displays/:id', authenticateToken, validateUUID('id'), async (req, res) => {
    try {
      const displayId = req.params.id;
      const tenantId = req.user.tenantId;
      
      const display = await optisignsModels.OptisignsDisplay.findOne({
        where: {
          id: displayId,
          tenant_id: tenantId
        },
        include: [
          {
            model: optisignsModels.OptisignsSchedule,
            as: 'schedules',
            limit: 10,
            order: [['start_time', 'DESC']]
          },
          {
            model: optisignsModels.OptisignsEvent,
            as: 'events',
            limit: 20,
            order: [['timestamp', 'DESC']]
          }
        ]
      });
      
      if (!display) {
        return res.status(404).json({
          error: 'Display not found',
          displayId: displayId,
          timestamp: new Date().toISOString()
        });
      }

      let liveDisplay = null;
      try {
        liveDisplay = await optisignsService.getDevice(
          tenantId,
          display.optisignsDisplayId
        );
        await display.update({
          name: liveDisplay.deviceName || liveDisplay.name || display.name,
          location: liveDisplay.location || display.location,
          status: liveDisplay.status || display.status,
          metadata: liveDisplay
        });
      } catch (liveErr) {
        console.error('Failed to fetch live display from OptiSigns:', liveErr.message);
      }

      res.json({
        display: liveDisplay ? { ...display.toJSON(), ...liveDisplay } : display,
        configured: await optisignsService.isConfigured(tenantId),
        message: 'Display details retrieved successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting display details:', error.message);
      res.status(400).json({ 
        error: error.message,
        displayId: req.params.id,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Update device
  router.put('/optisigns/displays/:id', authenticateToken, requireOptisignsConfig, validateUUID('id'), async (req, res) => {
    try {
      const displayId = req.params.id;
      const updates = req.body;
      
      const display = await optisignsModels.OptisignsDisplay.findOne({
        where: {
          id: displayId,
          tenant_id: req.user.tenantId
        }
      });
      
      if (!display) {
        return res.status(404).json({ error: 'Display not found' });
      }

      // Update in OptiSigns
      const updatedDevice = await optisignsService.updateDevice(
        req.user.tenantId,
        display.optisignsDisplayId,
        updates
      );

      // Update local database
      await display.update({
        name: updates.name || display.name,
        location: updates.location || display.location,
        metadata: { ...display.metadata, ...updates }
      });
      
      res.json({
        message: 'Display updated successfully',
        display: await display.reload(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating display:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== TAG ENDPOINTS =====

  // Add tags to display
  router.post('/optisigns/displays/:id/tags', authenticateToken, requireOptisignsConfig, validateUUID('id'), async (req, res) => {
    try {
      const { tags } = req.body;
      
      if (!tags || !Array.isArray(tags)) {
        return res.status(400).json({ error: 'Tags array is required' });
      }

      const display = await optisignsModels.OptisignsDisplay.findOne({
        where: {
          id: req.params.id,
          tenant_id: req.user.tenantId
        }
      });
      
      if (!display) {
        return res.status(404).json({ error: 'Display not found' });
      }

      const updatedDevice = await optisignsService.addTags(
        req.user.tenantId,
        display.optisignsDisplayId,
        tags
      );

      res.json({
        message: 'Tags added successfully',
        tags: updatedDevice.tags || [],
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error adding tags:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Remove tags from display
  router.delete('/optisigns/displays/:id/tags', authenticateToken, requireOptisignsConfig, validateUUID('id'), async (req, res) => {
    try {
      const { tags } = req.body;
      
      if (!tags || !Array.isArray(tags)) {
        return res.status(400).json({ error: 'Tags array is required' });
      }

      const display = await optisignsModels.OptisignsDisplay.findOne({
        where: {
          id: req.params.id,
          tenant_id: req.user.tenantId
        }
      });
      
      if (!display) {
        return res.status(404).json({ error: 'Display not found' });
      }

      const updatedDevice = await optisignsService.removeTags(
        req.user.tenantId,
        display.optisignsDisplayId,
        tags
      );

      res.json({
        message: 'Tags removed successfully',
        tags: updatedDevice.tags || [],
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error removing tags:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== TAKEOVER ENDPOINTS =====

  // Device takeover
  router.post('/optisigns/displays/:id/takeover', authenticateToken, requireOptisignsConfig, validateUUID('id'), async (req, res) => {
    try {
      const displayId = req.params.id;
      const { contentType, contentId, priority, duration, message, restoreAfter, teamId } = req.body;
      
      if (!contentType || !contentId) {
        return res.status(400).json({ 
          error: 'contentType and contentId are required' 
        });
      }
      
      if (!['ASSET', 'PLAYLIST'].includes(contentType)) {
        return res.status(400).json({ 
          error: 'contentType must be either ASSET or PLAYLIST' 
        });
      }

      console.log(`🚨 Takeover request for display ${displayId} with ${contentType} ${contentId}`);
      
      const options = {
        priority: priority || 'HIGH',
        duration: duration || null,
        message: message || 'Device takeover initiated',
        restoreAfter: restoreAfter !== false,
        initiatedBy: req.user.username || req.user.email || 'unknown',
        teamId: teamId || null
      };
      
      const result = await optisignsService.takeoverDevice(
        req.user.tenantId,
        displayId,
        contentType,
        contentId,
        options
      );
      
      res.json({
        message: 'Display takeover initiated successfully',
        takeover: result.takeover,
        device: result.device,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error in device takeover:', error.message);
      
      if (error.message.includes('Cannot override')) {
        return res.status(409).json({ 
          error: error.message,
          code: 'PRIORITY_CONFLICT'
        });
      } else if (error.message.includes('offline')) {
        return res.status(422).json({ 
          error: error.message,
          code: 'DEVICE_OFFLINE'
        });
      }
      
      res.status(400).json({ 
        error: error.message,
        code: 'TAKEOVER_FAILED'
      });
    }
  });

  // Stop takeover
  router.post('/optisigns/displays/:id/stop-takeover', authenticateToken, requireOptisignsConfig, validateUUID('id'), async (req, res) => {
    try {
      const displayId = req.params.id;
      const { restoreContent = true, reason = 'Manual stop' } = req.body;
      
      console.log(`🛑 Stop takeover request for display ${displayId}`);
      
      const result = await optisignsService.stopTakeover(
        req.user.tenantId,
        displayId,
        restoreContent,
        reason
      );
      
      res.json({
        message: 'Display takeover stopped successfully',
        takeover: {
          id: result.takeover.id,
          status: result.takeover.status,
          completedAt: result.takeover.completedAt
        },
        device: {
          id: result.device.id,
          name: result.device.name,
          isUnderTakeover: result.device.isUnderTakeover
        },
        contentRestored: result.contentRestored,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error stopping takeover:', error.message);
      res.status(400).json({ 
        error: error.message,
        code: 'STOP_TAKEOVER_FAILED'
      });
    }
  });

  // Get takeover status
  router.get('/optisigns/displays/:id/takeover-status', authenticateToken, validateUUID('id'), async (req, res) => {
    try {
      const displayId = req.params.id;
      
      const status = await optisignsService.getTakeoverStatus(
        req.user.tenantId,
        displayId
      );
      
      res.json({
        ...status,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting takeover status:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // List takeovers
  router.get('/optisigns/takeovers', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 500, priority, status, displayId } = req.query;
      
      const filters = {
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      };
      
      if (priority) filters.priority = priority;
      if (status) filters.status = status;
      if (displayId) filters.deviceId = displayId;
      
      const result = await optisignsService.getActiveTakeovers(
        req.user.tenantId,
        filters
      );
      
      res.json({
        takeovers: result.takeovers,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(result.total / parseInt(limit)),
          totalCount: result.total
        },
        summary: result.summary,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting takeovers:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== ASSET ENDPOINTS =====

  // Upload asset
  router.post('/optisigns/assets/upload', authenticateToken, requireOptisignsConfig, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { name = req.file.originalname, teamId } = req.body;
      
      console.log(`Uploading asset: ${name} (${req.file.size} bytes)`);
      
      // Save file temporarily
      const tempDir = path.join(process.cwd(), 'temp');
      await fs.mkdir(tempDir, { recursive: true });
      const tempPath = path.join(tempDir, `${Date.now()}-${req.file.originalname}`);
      await fs.writeFile(tempPath, req.file.buffer);
      
      try {
        // Upload using SDK
        const asset = await optisignsService.uploadFileAsset(
          req.user.tenantId,
          tempPath,
          name,
          teamId
        );
        
        res.json({
          message: 'Asset uploaded successfully',
          asset: {
            id: asset.id,
            optisignsId: asset.optisignsId,
            name: asset.name,
            type: asset.type,
            url: asset.webLink || asset.url
          },
          timestamp: new Date().toISOString()
        });
      } finally {
        // Clean up temp file
        await fs.unlink(tempPath).catch(console.warn);
      }
    } catch (error) {
      console.error('Error uploading asset:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Create website asset
  router.post('/optisigns/assets/website', authenticateToken, requireOptisignsConfig, async (req, res) => {
    try {
      const { url, name, teamId } = req.body;
      
      if (!url || !name) {
        return res.status(400).json({ error: 'URL and name are required' });
      }

      const asset = await optisignsService.createWebsiteAsset(
        req.user.tenantId,
        url,
        name,
        teamId
      );
      
      res.json({
        message: 'Website asset created successfully',
        asset: {
          id: asset.id,
          optisignsId: asset.optisignsId,
          name: asset.name,
          url: asset.webLink
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error creating website asset:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Sync assets
  router.post('/optisigns/assets/sync', authenticateToken, requireOptisignsConfig, async (req, res) => {
    try {
      console.log('Syncing assets for tenant:', req.user.tenantId);
      const assets = await optisignsService.syncAssets(req.user.tenantId);
      
      res.json({
        message: `Successfully synced ${assets.length} assets`,
        assets: assets,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error syncing assets:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Get assets
  router.get('/optisigns/assets', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 500, type } = req.query;
      const tenantId = req.user.tenantId;
      
      const whereClause = { tenant_id: tenantId };
      if (type) whereClause.type = type;
      
      const assets = await optisignsModels.OptisignsContent.findAll({
        where: whereClause,
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        order: [['created_at', 'DESC']],
        attributes: { exclude: ['metadata'] }
      });
      
      const count = await optisignsModels.OptisignsContent.count({ where: whereClause });
      
      res.json({
        assets: assets,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / parseInt(limit)),
          totalCount: count
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting assets:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== CONTENT PUSH ENDPOINTS =====

  // Push content to display
  router.post('/optisigns/displays/:id/push', authenticateToken, requireOptisignsConfig, validateUUID('id'), async (req, res) => {
    try {
      const displayId = req.params.id;
      const { contentId, schedule = "NOW", teamId } = req.body;
      
      if (!contentId) {
        return res.status(400).json({ error: 'contentId is required' });
      }

      const result = await optisignsService.pushContent(
        req.user.tenantId,
        displayId,
        contentId,
        schedule,
        teamId
      );
      
      res.json({
        message: 'Content pushed successfully',
        result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error pushing content:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== STATUS ENDPOINTS =====


// Test API connection
  router.post('/optisigns/config/test', authenticateToken, async (req, res) => {
    try {
      const { apiToken } = req.body;
      
      if (!apiToken) {
        return res.status(400).json({ 
          error: 'API token is required in request body' 
        });
      }

      console.log('Testing OptiSigns API connection for tenant:', req.user.tenantId);
      const startTime = Date.now();
      const result = await optisignsService.testApiConnection(apiToken);
      const testDuration = Date.now() - startTime;
      
      res.json({
        ...result,
        message: 'OptiSigns API connection test successful',
        testDuration: `${testDuration}ms`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('API test failed:', error.message);
      res.status(400).json({ 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });


  // Get integration status
  router.get('/optisigns/status', authenticateToken, async (req, res) => {
    try {
      const isConfigured = await optisignsService.isConfigured(req.user.tenantId);
      const config = await optisignsService.getConfiguration(req.user.tenantId);
      
      res.json({
        configured: isConfigured,
        lastValidated: config?.lastValidated || null,
        message: isConfigured ? 
          'OptiSigns is configured and ready to use' : 
          'OptiSigns API token not configured',
        sdkVersion: '1.0.0', // Add actual SDK version if available
        features: {
          devices: true,
          assets: true,
          takeover: true,
          tags: true,
          push: true
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Register all routes
  app.use('/api', router);
  
  console.log('✅ OptiSigns routes initialized successfully');
  console.log('📋 Available endpoints:');
  console.log('   🔧 Configuration: /config/test, /config, /status');
  console.log('   📺 Displays: /displays/sync, /displays, /displays/:id');
  console.log('   🏷️  Tags: /displays/:id/tags (POST/DELETE)');
  console.log('   🚨 Takeovers: /displays/:id/takeover, /displays/:id/stop-takeover');
  console.log('   📦 Assets: /assets/upload, /assets/website, /assets/sync');
  console.log('   📤 Push: /displays/:id/push');
  console.log('   📊 Status: /status');

  return {
    service: optisignsService,
    router
  };
};