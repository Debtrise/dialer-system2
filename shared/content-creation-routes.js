// shared/content-creation-routes.js
// API routes for Content Creation System with drag-and-drop canvas support

const express = require('express');
const multer = require('multer');
const ContentCreationService = require('./content-creation-service');

// Configure multer for asset uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images, videos, fonts, and documents
    const allowedTypes = [
      'image/', 'video/', 'audio/',
      'application/pdf', 'application/font',
      'font/', 'application/x-font'
    ];
    
    const isAllowed = allowedTypes.some(type => file.mimetype.startsWith(type));
    
    if (isAllowed) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
  }
});

module.exports = function(app, sequelize, authenticateToken, contentModels, optisignsModels = null) {
  // Initialize service
  const contentService = new ContentCreationService(contentModels, optisignsModels);
  
  console.log('Initializing Content Creation routes...');

  // Middleware to check API token for public OptiSync endpoints
  const authenticateApiToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // TODO: Validate API token here
      // For now, just set a basic user object
      req.user = { tenantId: req.headers['x-tenant-id'] };
    }
    next();
  };


// GET endpoint for project preview (for webhooks and direct access)
  app.get('/api/content/projects/:projectId/preview', async (req, res) => {
    try {
      console.log(`🔍 Project preview request: ${req.params.projectId}`);
      
      // Allow both authenticated and unauthenticated access for webhooks
      let tenantId;
      let project;
      
      if (req.user && req.user.tenantId) {
        // Authenticated request
        tenantId = req.user.tenantId;
        project = await contentService.getProjectWithElements(
          req.params.projectId,
          tenantId
        );
      } else {
        // Unauthenticated request - try to find project by ID
        console.log('🔓 Unauthenticated preview request, attempting to find project...');
        
        try {
          project = await contentService.models.ContentProject.findOne({
            where: { id: req.params.projectId },
            include: [{
              model: contentService.models.ContentElement,
              as: 'elements',
              include: [{
                model: contentService.models.ContentAsset,
                as: 'asset'
              }]
            }]
          });
          
          if (project) {
            tenantId = project.tenantId;
            console.log(`✅ Found project for tenant: ${tenantId}`);
          }
        } catch (findError) {
          console.error('❌ Error finding project:', findError.message);
          throw new Error('Project not found');
        }
      }
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      console.log(`📋 Project found: ${project.name} (${project.elements?.length || 0} elements)`);
      
      // Generate HTML preview
      console.log('🎨 Generating HTML preview...');
      const htmlStart = Date.now();
      
      const htmlContent = await contentService.generateProjectHTML(project, {
        publicServing: true,
        useBase64Images: true,
        baseUrl: `${req.protocol}://${req.get('host')}`,
        projectId: project.id
      });
      
      const htmlTime = Date.now() - htmlStart;
      const htmlSize = Buffer.byteLength(htmlContent, 'utf8');
      const htmlSizeMB = (htmlSize / 1024 / 1024).toFixed(2);
      
      console.log(`📊 HTML generation took: ${htmlTime}ms`);
      console.log(`📏 HTML size: ${htmlSize} bytes (${htmlSizeMB} MB)`);
      
      // Set appropriate headers
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'X-Project-ID': project.id,
        'X-Content-Size': htmlSize.toString(),
        'X-Generation-Time': htmlTime.toString()
      });
      
      console.log(`✅ Project preview served successfully`);
      res.send(htmlContent);
      
    } catch (error) {
      console.error('❌ Error serving project preview:', error.message);
      
      const errorHtml = `<!DOCTYPE html>
<html><head><title>Preview Error</title></head>
<body>
  <h1>Preview Generation Error</h1>
  <p><strong>Error:</strong> ${error.message}</p>
  <p><strong>Project ID:</strong> ${req.params.projectId}</p>
  <p><strong>Time:</strong> ${new Date().toISOString()}</p>
</body></html>`;
      
      res.set('Content-Type', 'text/html');
      res.status(500).send(errorHtml);
    }
  });



  // ===== OPTISYNC API ENDPOINTS FOR OPTISIGNS INTEGRATION =====
  
  // OptiSync data feed endpoint - for OptiSigns API Gateway
  app.get('/api/content/optisync/projects/:projectId/feed', authenticateApiToken, async (req, res) => {
    try {
      // Get tenant ID from API token or header
      let tenantId = req.headers['x-tenant-id'];
      
      // If authenticated user, use their tenant ID
      if (req.user && req.user.tenantId) {
        tenantId = req.user.tenantId;
      }
      
      if (!tenantId) {
        return res.status(400).json({ 
          error: 'Tenant ID required. Include X-Tenant-ID header or authenticate.',
          documentation: 'https://docs.knittt.com/optisync'
        });
      }

      const {
        format = 'json',
        includeElements = 'true',
        includeAssets = 'true',
        lastUpdated
      } = req.query;

      const options = {
        format,
        includeElements: includeElements === 'true',
        includeAssets: includeAssets === 'true',
        lastUpdated: lastUpdated ? new Date(lastUpdated) : null
      };

      const dataFeed = await contentService.generateOptiSyncDataFeed(
        req.params.projectId,
        tenantId,
        options
      );

      // Set appropriate headers for OptiSigns
      res.set({
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-OptiSync-Version': '1.0',
        'X-Last-Modified': dataFeed.lastUpdated,
        'X-Refresh-Interval': dataFeed.optisync.refreshInterval
      });

      res.json(dataFeed);

    } catch (error) {
      console.error('Error generating OptiSync data feed:', error.message);
      res.status(400).json({ 
        error: error.message,
        timestamp: new Date().toISOString(),
        feedVersion: '1.0'
      });
    }
  });

  // OptiSync project list endpoint - for OptiSigns to discover available projects
  app.get('/api/content/optisync/projects', authenticateApiToken, async (req, res) => {
    try {
      let tenantId = req.headers['x-tenant-id'];
      
      if (req.user && req.user.tenantId) {
        tenantId = req.user.tenantId;
      }
      
      if (!tenantId) {
        return res.status(400).json({ 
          error: 'Tenant ID required. Include X-Tenant-ID header or authenticate.' 
        });
      }

      const { limit = 500, page = 1, status = 'active' } = req.query;

      const projects = await contentService.getProjects(tenantId, {
        status,
        limit,
        page,
        sortBy: 'recent'
      });

      const optiSyncProjects = projects.projects.map(project => ({
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        lastUpdated: project.updatedAt,
        feedUrl: `${req.protocol}://${req.get('host')}/api/content/optisync/projects/${project.id}/feed`,
        elementsCount: project.elements?.length || 0,
        previewUrl: `${req.protocol}://${req.get('host')}/api/content/projects/${project.id}/preview`
      }));

      res.json({
        projects: optiSyncProjects,
        pagination: projects.pagination,
        optisync: {
          version: '1.0',
          baseUrl: `${req.protocol}://${req.get('host')}/api/content/optisync`,
          documentation: 'https://docs.knittt.com/optisync',
          supportedFormats: ['json'],
          refreshInterval: 300
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error listing OptiSync projects:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // OptiSync webhook endpoint - for notifying OptiSigns of updates
  app.post('/api/content/optisync/projects/:projectId/webhook', authenticateApiToken, async (req, res) => {
    try {
      let tenantId = req.headers['x-tenant-id'];
      
      if (req.user && req.user.tenantId) {
        tenantId = req.user.tenantId;
      }
      
      if (!tenantId) {
        return res.status(400).json({ 
          error: 'Tenant ID required. Include X-Tenant-ID header or authenticate.' 
        });
      }

      const { action = 'refresh', source = 'manual' } = req.body;

      console.log(`🔔 OptiSync webhook received for project ${req.params.projectId}: ${action}`);

      // Validate project exists
      const project = await contentService.getProjectWithElements(req.params.projectId, tenantId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      // Handle different webhook actions
      let response;
      switch (action) {
        case 'refresh':
          response = {
            action: 'refresh',
            message: 'Data refresh requested',
            feedUrl: `${req.protocol}://${req.get('host')}/api/content/optisync/projects/${req.params.projectId}/feed`,
            lastUpdated: project.updatedAt
          };
          break;
          
        case 'validate':
          response = {
            action: 'validate',
            message: 'Project validation completed',
            isValid: true,
            elementsCount: project.elements?.length || 0,
            lastUpdated: project.updatedAt
          };
          break;
          
        default:
          return res.status(400).json({ error: `Unsupported action: ${action}` });
      }

      res.json({
        success: true,
        projectId: req.params.projectId,
        ...response,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error handling OptiSync webhook:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // OptiSync configuration helper endpoint
  app.get('/api/content/optisync/projects/:projectId/config', authenticateToken, async (req, res) => {
    try {
      const config = await contentService.createOptiSignsApiGatewayConfig(
        req.params.projectId,
        req.user.tenantId,
        {
          refreshInterval: parseInt(req.query.refreshInterval) || 300
        }
      );

      res.json({
        config,
        message: 'OptiSigns API Gateway configuration generated',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error generating OptiSigns config:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

// ===== PUBLIC CONTENT SERVING ENDPOINTS =====
  
// Enhanced public endpoint with comprehensive debugging
app.get('/api/content/public/:exportId', async (req, res) => {
  const startTime = Date.now();
  let exportId = req.params.exportId;
  
  try {
    console.log(`🔍 [${new Date().toISOString()}] Public content request: ${req.params.exportId}`);
    
    // Clean the exportId
    const originalExportId = exportId;
    exportId = exportId.replace(/\.(html?|htm|json|xml)$/i, '');
    
    if (originalExportId !== exportId) {
      console.log(`🧹 Cleaned export ID: ${originalExportId} -> ${exportId}`);
    }
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(exportId)) {
      console.error(`❌ Invalid UUID format: ${exportId}`);
      const errorHtml = `<!DOCTYPE html>
<html><head><title>Invalid Content ID</title></head>
<body>
  <h1>Invalid Content ID Format</h1>
  <p>Received: <code>${originalExportId}</code></p>
  <p>Cleaned: <code>${exportId}</code></p>
  <p>Expected: UUID format (e.g., 12345678-1234-1234-1234-123456789012)</p>
</body></html>`;
      
      res.set('Content-Type', 'text/html');
      return res.status(400).send(errorHtml);
    }
    
    console.log(`✅ Valid UUID: ${exportId}`);
    
    // Database query with timeout
    console.log(`🔍 Querying database for export ${exportId}...`);
    const queryStart = Date.now();
    
    const exportRecord = await Promise.race([
      contentModels.ContentExport.findOne({
        where: { 
          id: exportId,
          processingStatus: 'completed'
        },
        include: [{
          model: contentModels.ContentProject,
          as: 'project',
          include: [{
            model: contentModels.ContentElement,
            as: 'elements',
            include: [{
              model: contentModels.ContentAsset,
              as: 'asset'
            }]
          }]
        }]
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database query timeout')), 10000)
      )
    ]);

    const queryTime = Date.now() - queryStart;
    console.log(`📊 Database query took: ${queryTime}ms`);

    if (!exportRecord) {
      console.warn(`⚠️ Export record not found: ${exportId}`);
      const notFoundHtml = `<!DOCTYPE html>
<html><head><title>Content Not Found</title></head>
<body>
  <h1>Content Not Found</h1>
  <p>Export ID: <code>${exportId}</code></p>
  <p>This content may have expired or been removed.</p>
</body></html>`;
      
      res.set('Content-Type', 'text/html');
      return res.status(404).send(notFoundHtml);
    }

    console.log(`✅ Export record found: ${exportRecord.project?.name || 'Unknown'}`);
    console.log(`📋 Project has ${exportRecord.project?.elements?.length || 0} elements`);

    // Generate HTML with size monitoring
    console.log(`🎨 Generating HTML content...`);
    const htmlStart = Date.now();
    
    const htmlContent = await Promise.race([
      contentService.generateProjectHTML(exportRecord.project, {
        publicServing: true,
        baseUrl: `${req.protocol}://${req.get('host')}`,
        exportId: exportId,
        useBase64Images: true
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('HTML generation timeout')), 30000)
      )
    ]);

    const htmlTime = Date.now() - htmlStart;
    const htmlSize = Buffer.byteLength(htmlContent, 'utf8');
    const htmlSizeMB = (htmlSize / 1024 / 1024).toFixed(2);
    
    console.log(`📊 HTML generation took: ${htmlTime}ms`);
    console.log(`📏 HTML size: ${htmlSize} bytes (${htmlSizeMB} MB)`);
    
    // Check if response is too large
    if (htmlSize > 50 * 1024 * 1024) { // 50MB limit
      console.error(`❌ HTML too large: ${htmlSizeMB}MB`);
      const errorHtml = `<!DOCTYPE html>
<html><head><title>Content Too Large</title></head>
<body>
  <h1>Content Too Large</h1>
  <p>The generated content is ${htmlSizeMB}MB, which exceeds the 50MB limit.</p>
  <p>Try reducing the number of images or use smaller images.</p>
</body></html>`;
      
      res.set('Content-Type', 'text/html');
      return res.status(413).send(errorHtml);
    }

    // Set headers carefully
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-ID': exportId,
      'X-Project-ID': exportRecord.projectId,
      'X-Content-Size': htmlSize.toString(),
      'X-Generation-Time': htmlTime.toString()
    });

    const totalTime = Date.now() - startTime;
    console.log(`✅ Content served successfully in ${totalTime}ms (${htmlSizeMB}MB)`);
    
    res.send(htmlContent);

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ Error serving public content (${totalTime}ms):`, error.message);
    console.error(`❌ Stack trace:`, error.stack);
    
    const errorHtml = `<!DOCTYPE html>
<html><head><title>Error Loading Content</title></head>
<body>
  <h1>Error Loading Content</h1>
  <p><strong>Error:</strong> ${error.message}</p>
  <p><strong>Export ID:</strong> ${exportId}</p>
  <p><strong>Time:</strong> ${new Date().toISOString()}</p>
  <p>Please try again later or contact support.</p>
</body></html>`;
    
    res.set('Content-Type', 'text/html');
    res.status(500).send(errorHtml);
  }
});

// Add debugging endpoint
app.get('/api/content/debug/:exportId', authenticateToken, async (req, res) => {
  try {
    let exportId = req.params.exportId.replace(/\.(html?|htm|json|xml)$/i, '');
    
    const exportRecord = await contentModels.ContentExport.findOne({
      where: { id: exportId },
      include: [{
        model: contentModels.ContentProject,
        as: 'project',
        include: [{
          model: contentModels.ContentElement,
          as: 'elements'
        }]
      }]
    });

    if (!exportRecord) {
      return res.status(404).json({ error: 'Export not found' });
    }

    const debugInfo = {
      export: {
        id: exportRecord.id,
        status: exportRecord.processingStatus,
        format: exportRecord.format,
        createdAt: exportRecord.createdAt
      },
      project: {
        id: exportRecord.project?.id,
        name: exportRecord.project?.name,
        elementsCount: exportRecord.project?.elements?.length || 0
      },
      elements: exportRecord.project?.elements?.map(el => ({
        id: el.id,
        type: el.elementType,
        hasImageUrl: !!(el.properties?.imageUrl || el.properties?.src),
        imageUrl: el.properties?.imageUrl || el.properties?.src
      })) || [],
      publicUrl: `${req.protocol}://${req.get('host')}/api/content/public/${exportId}`,
      timestamp: new Date().toISOString()
    };

    res.json(debugInfo);
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

  // OptiSync integration status endpoint
  app.get('/api/content/optisync/status', authenticateToken, async (req, res) => {
    try {
      const integrationStatus = await contentService.checkOptiSignsIntegration(req.user.tenantId);

      const projectsWithOptiSync = await contentModels.ContentProject.count({
        where: { 
          tenantId: req.user.tenantId,
          status: 'active'
        }
      });

      res.json({
        integration: integrationStatus,
        statistics: {
          availableProjects: projectsWithOptiSync,
          apiEndpoint: `${req.protocol}://${req.get('host')}/api/content/optisync`,
          feedsGenerated: projectsWithOptiSync, // Could track this separately
          lastChecked: new Date().toISOString()
        },
        capabilities: {
          realTimeUpdates: true,
          webhookSupport: true,
          multipleProjects: true,
          customRefreshIntervals: true
        },
        documentation: {
          setup: 'https://docs.knittt.com/optisync/setup',
          apiReference: 'https://docs.knittt.com/optisync/api',
          troubleshooting: 'https://docs.knittt.com/optisync/troubleshooting'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error getting OptiSync status:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== TEMPLATE ENDPOINTS =====
  
  // Get templates
  app.get('/api/content/templates', authenticateToken, async (req, res) => {
    try {
      const {
        category,
        isPublic,
        search,
        page,
        limit
      } = req.query;
      
      const options = {
        category,
        isPublic: isPublic !== undefined ? isPublic === 'true' : undefined,
        search,
        page,
        limit
      };
      
      const result = await contentService.getTemplates(req.user.tenantId, options);
      
      res.json({
        ...result,
        message: `Retrieved ${result.templates.length} templates`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting templates:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Get single template
  app.get('/api/content/templates/:templateId', authenticateToken, async (req, res) => {
    try {
      const template = await contentService.getTemplate(
        req.params.templateId,
        req.user.tenantId
      );
      
      res.json({
        template,
        message: 'Template retrieved successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting template:', error.message);
      res.status(404).json({ error: error.message });
    }
  });

  // Create template
  app.post('/api/content/templates', authenticateToken, async (req, res) => {
    try {
      const template = await contentService.createTemplate(
        req.user.tenantId,
        req.user.id,
        req.body
      );

      res.status(201).json({
        template,
        message: 'Template created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error creating template:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Update template
  app.put('/api/content/templates/:templateId', authenticateToken, async (req, res) => {
    try {
      const template = await contentService.updateTemplate(
        req.params.templateId,
        req.user.tenantId,
        req.user.id,
        req.body
      );

      res.json({
        template,
        message: 'Template updated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating template:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== PROJECT ENDPOINTS =====
  app.get('/api/content/projects', authenticateToken, async (req, res) => {
    try {
      const {
        status,
        search,
        page,
        limit
      } = req.query;
      
      const options = {
        status,
        search,
        page,
        limit
      };
      
      const result = await contentService.getProjects(req.user.tenantId, options);
      
      res.json({
        ...result,
        message: `Retrieved ${result.projects.length} projects`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting projects:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Create project
  app.post('/api/content/projects', authenticateToken, async (req, res) => {
    try {
      const project = await contentService.createProject(
        req.user.tenantId,
        req.body,
        req.user.id
      );
      
      res.status(201).json({
        project,
        message: 'Project created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error creating project:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Get single project with elements
  app.get('/api/content/projects/:projectId', authenticateToken, async (req, res) => {
    try {
      const project = await contentService.getProjectWithElements(
        req.params.projectId,
        req.user.tenantId
      );
      
      res.json({
        project,
        message: 'Project retrieved successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting project:', error.message);
      res.status(404).json({ error: error.message });
    }
  });

  // Update project
app.put('/api/content/projects/:projectId', authenticateToken, async (req, res) => {
  try {
    const project = await contentService.updateProject(
      req.params.projectId,
      req.user.tenantId,
      req.user.id,  // ADD THIS - pass user ID as third parameter
      req.body      // This should be fourth parameter
    );
    
    res.json({
      project,
      message: 'Project updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error updating project:', error.message);
    res.status(400).json({ error: error.message });
  }
});

  // Delete project
  app.delete('/api/content/projects/:projectId', authenticateToken, async (req, res) => {
    try {
      await contentService.deleteProject(
        req.params.projectId,
        req.user.tenantId
      );
      
      res.json({
        message: 'Project deleted successfully',
        projectId: req.params.projectId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error deleting project:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Create element
  app.post('/api/content/projects/:projectId/elements', authenticateToken, async (req, res) => {
    try {
      const element = await contentService.createElement(
        req.params.projectId,
        req.user.tenantId,
        req.body
      );
      
      res.status(201).json({
        element,
        message: 'Element created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error creating element:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Update element
  app.put('/api/content/projects/:projectId/elements/:elementId', authenticateToken, async (req, res) => {
    try {
      const element = await contentService.updateElement(
        req.params.elementId,
        req.params.projectId,
        req.user.tenantId,
        req.body
      );
      
      res.json({
        element,
        message: 'Element updated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating element:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Delete element
  app.delete('/api/content/projects/:projectId/elements/:elementId', authenticateToken, async (req, res) => {
    try {
      await contentService.deleteElement(
        req.params.elementId,
        req.params.projectId,
        req.user.tenantId
      );
      
      res.json({
        message: 'Element deleted successfully',
        elementId: req.params.elementId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error deleting element:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Reorder elements
  app.put('/api/content/projects/:projectId/elements/reorder', authenticateToken, async (req, res) => {
    try {
      const { elementOrders } = req.body;
      
      if (!elementOrders || !Array.isArray(elementOrders)) {
        return res.status(400).json({ error: 'elementOrders array is required' });
      }

      await contentService.reorderElements(
        req.params.projectId,
        req.user.tenantId,
        elementOrders
      );
      
      res.json({
        message: 'Elements reordered successfully',
        count: elementOrders.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error reordering elements:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== ASSET ENDPOINTS =====
  
  // Get assets
  app.get('/api/content/assets', authenticateToken, async (req, res) => {
    try {
      const {
        assetType,
        search,
        tags,
        page,
        limit
      } = req.query;
      
      const options = {
        assetType,
        search,
        tags: tags ? tags.split(',') : undefined,
        page,
        limit
      };
      
      const result = await contentService.getAssets(req.user.tenantId, options);
      
      res.json({
        ...result,
        message: `Retrieved ${result.assets.length} assets`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting assets:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Upload asset
  app.post('/api/content/assets/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const metadata = {
        name: req.body.name,
        tags: req.body.tags ? req.body.tags.split(',') : [],
        metadata: req.body.metadata ? JSON.parse(req.body.metadata) : {}
      };

      const asset = await contentService.uploadAsset(
        req.user.tenantId,
        req.user.id,
        req.file,
        metadata
      );
      
      res.status(201).json({
        asset,
        message: 'Asset uploaded successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error uploading asset:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Delete asset
  app.delete('/api/content/assets/:assetId', authenticateToken, async (req, res) => {
    try {
      const asset = await contentModels.ContentAsset.findOne({
        where: {
          id: req.params.assetId,
          tenantId: req.user.tenantId
        }
      });

      if (!asset) {
        return res.status(404).json({ error: 'Asset not found' });
      }

      // Check if asset is being used in any elements
      const usageCount = await contentModels.ContentElement.count({
        where: { assetId: req.params.assetId }
      });

      if (usageCount > 0) {
        return res.status(400).json({ 
          error: `Asset is being used in ${usageCount} elements. Remove from projects first.` 
        });
      }

      await asset.destroy();

      res.json({
        message: 'Asset deleted successfully',
        assetId: req.params.assetId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error deleting asset:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== VARIABLE ENDPOINTS =====
  
  // Get variables
  app.get('/api/content/variables', authenticateToken, async (req, res) => {
    try {
      const { category, dataSource } = req.query;
      
      const variables = await contentService.getVariables(req.user.tenantId, {
        category,
        dataSource
      });
      
      // Group variables by category for easier UI consumption
      const groupedVariables = variables.reduce((groups, variable) => {
        const category = variable.category || 'Other';
        if (!groups[category]) {
          groups[category] = [];
        }
        groups[category].push(variable);
        return groups;
      }, {});
      
      res.json({
        variables,
        groupedVariables,
        message: `Retrieved ${variables.length} variables`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting variables:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Create variable
  app.post('/api/content/variables', authenticateToken, async (req, res) => {
    try {
      const variable = await contentService.createVariable(
        req.user.tenantId,
        req.body
      );
      
      res.status(201).json({
        variable,
        message: 'Variable created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error creating variable:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Initialize system variables
  app.post('/api/content/variables/initialize-system', authenticateToken, async (req, res) => {
    try {
      const variables = await contentService.initializeSystemVariables(req.user.tenantId);
      
      res.json({
        variables,
        message: `Initialized ${variables.length} system variables`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error initializing system variables:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== PREVIEW AND EXPORT ENDPOINTS =====

  // Generate preview
  app.post('/api/content/projects/:projectId/preview', authenticateToken, async (req, res) => {
    try {
      const { device = 'desktop' } = req.body;
      
      const previewData = await contentService.generatePreview(
        req.params.projectId,
        req.user.tenantId,
        device
      );
      
      res.json({
        preview: previewData,
        message: 'Preview generated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error generating preview:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Publish to OptiSigns (Updated for OptiSync)
  app.post('/api/content/projects/:projectId/publish', authenticateToken, async (req, res) => {
    try {
      const { displayIds } = req.body;
      
      const result = await contentService.publishToOptiSigns(
        req.params.projectId,
        req.user.tenantId,
        displayIds || []
      );
      
      res.json({
        ...result,
        message: 'Project configured for OptiSigns via OptiSync',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error publishing to OptiSigns:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Get export status
  app.get('/api/content/exports/:exportId/status', authenticateToken, async (req, res) => {
    try {
      const status = await contentService.getExportStatus(
        req.params.exportId,
        req.user.tenantId
      );
      
      res.json({
        ...status,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting export status:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Get system status
  app.get('/api/content/system/status', authenticateToken, async (req, res) => {
    try {
      res.json({
        status: 'healthy',
        features: {
          contentCreation: true,
          projectManagement: true,
          assetManagement: true,
          optisyncIntegration: !!optisignsModels,
          export: true
        },
        supportedAssetTypes: [
          'image/jpeg', 'image/png', 'image/gif', 'image/webp',
          'video/mp4', 'video/webm',
          'audio/mp3', 'audio/wav',
          'application/pdf'
        ],
        supportedElementTypes: [
          'text', 'image', 'video', 'shape', 'button', 
          'qr_code', 'chart', 'timer', 'weather', 'animation', 'confetti'
        ],
        integrations: {
          optisigns: {
            available: !!optisignsModels,
            method: 'optisync',
            version: '1.0',
            endpoints: {
              projects: '/api/content/optisync/projects',
              feed: '/api/content/optisync/projects/{id}/feed',
              webhook: '/api/content/optisync/projects/{id}/webhook'
            }
          }
        },
        maxFileSize: '50MB',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting system status:', error.message);
      res.status(500).json({ error: error.message });
    }
  });
  
  console.log('✅ Content Creation routes initialized successfully');
  console.log('📋 Available endpoints:');
  console.log('   📁 Projects: GET/POST/PUT/DELETE /api/content/projects');
  console.log('   🧩 Elements: POST /api/content/projects/:id/elements');
  console.log('   👁️  Preview: POST /api/content/projects/:id/preview');
  console.log('   🚀 Publish: POST /api/content/projects/:id/publish');
  console.log('   🔄 OptiSync: GET /api/content/optisync/projects');
  console.log('   📊 Data Feed: GET /api/content/optisync/projects/:id/feed');
  console.log('   🔔 Webhook: POST /api/content/optisync/projects/:id/webhook');
  console.log('   ⚙️  System: GET /api/content/system/status');

  return {
    models: contentModels,
    service: contentService
  };
};