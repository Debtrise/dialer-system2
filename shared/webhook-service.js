
const crypto = require('crypto');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');


// Small 1x1 pixel placeholder used when no fallback photo is configured
const DEFAULT_FALLBACK_PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

class WebhookService {
  constructor(models, journeyService = null, contentService = null, optisignsService = null) {
    this.models = models;
    this.journeyService = journeyService;
    this.contentService = contentService;
    this.optisignsService = optisignsService;

    // Ensure metric recording helper is always bound correctly
    this.recordAnnouncementMetrics = this.recordAnnouncementMetrics.bind(this);
    
    console.log('WebhookService initialized with services:', {
      models: !!models,
      journeyService: !!journeyService,
      contentService: !!contentService,
      optisignsService: !!optisignsService
    });
  }

  /**
   * Generate a secure random endpoint key
   */
  generateEndpointKey() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate a security token for webhook authentication
   */
  generateSecurityToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Normalize takeover priority to supported levels
   * Supported values in the DB are 'NORMAL', 'HIGH', 'EMERGENCY'.
   * Any unknown value defaults to 'NORMAL'.
   */
  normalizeTakeoverPriority(priority) {
    if (!priority) return 'NORMAL';
    const mapping = {
      EMERGENCY: 'EMERGENCY',
      HIGH: 'HIGH',
      NORMAL: 'NORMAL',
      MEDIUM: 'NORMAL',
      LOW: 'NORMAL'
    };
    const key = String(priority).toUpperCase();
    return mapping[key] || 'NORMAL';
  }

  /**
   * Create a new webhook endpoint
   */
  async createWebhookEndpoint(data) {
    try {
      // Generate endpoint key and security token if not provided
      const endpointKey = data.endpointKey || this.generateEndpointKey();
      const securityToken = data.securityToken || this.generateSecurityToken();

      const webhook = await this.models.WebhookEndpoint.create({
        ...data,
        endpointKey,
        securityToken
      });

      return webhook;
    } catch (error) {
      console.error('Error creating webhook endpoint:', error);
      throw error;
    }
  }

  /**
   * Update a webhook endpoint
   */
  async updateWebhookEndpoint(id, data, tenantId) {
    try {
      const [updated] = await this.models.WebhookEndpoint.update(data, {
        where: {
          id,
          tenantId
        }
      });

      if (!updated) {
        throw new Error('Webhook endpoint not found or access denied');
      }

      return this.getWebhookEndpoint(id, tenantId);
    } catch (error) {
      console.error('Error updating webhook endpoint:', error);
      throw error;
    }
  }

  /**
   * Get a webhook endpoint by ID
   */
  async getWebhookEndpoint(id, tenantId) {
    try {
      const webhook = await this.models.WebhookEndpoint.findOne({
        where: {
          id,
          tenantId
        }
      });

      if (!webhook) {
        throw new Error('Webhook endpoint not found or access denied');
      }

      return webhook;
    } catch (error) {
      console.error('Error getting webhook endpoint:', error);
      throw error;
    }
  }

  /**
   * Get a webhook endpoint by endpoint key
   */
  async getWebhookEndpointByKey(endpointKey) {
    try {
      const webhook = await this.models.WebhookEndpoint.findOne({
        where: {
          endpointKey,
          isActive: true
        }
      });

      if (!webhook) {
        throw new Error('Webhook endpoint not found or is inactive');
      }

      return webhook;
    } catch (error) {
      console.error('Error getting webhook endpoint by key:', error);
      throw error;
    }
  }

  /**
   * List webhook endpoints for a tenant
   */
  async listWebhookEndpoints(tenantId, options = {}) {
    try {
      const { limit = 50, offset = 0, isActive, webhookType } = options;
      
      const query = {
        where: { tenantId },
        limit,
        offset,
        order: [['createdAt', 'DESC']]
      };
      
      if (isActive !== undefined) {
        query.where.isActive = isActive;
      }
      
      if (webhookType) {
        query.where.webhookType = webhookType;
      }
      
      const webhooks = await this.models.WebhookEndpoint.findAll(query);
      const count = await this.models.WebhookEndpoint.count({ where: query.where });
      
      return {
        webhooks,
        totalCount: count,
        currentPage: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(count / limit)
      };
    } catch (error) {
      console.error('Error listing webhook endpoints:', error);
      throw error;
    }
  }

  /**
   * Delete a webhook endpoint
   */
  async deleteWebhookEndpoint(id, tenantId) {
    try {
      const result = await this.models.WebhookEndpoint.destroy({
        where: {
          id,
          tenantId
        }
      });

      if (!result) {
        throw new Error('Webhook endpoint not found or access denied');
      }

      return { success: true, id };
    } catch (error) {
      console.error('Error deleting webhook endpoint:', error);
      throw error;
    }
  }

  /**
   * Process an incoming webhook request with enhanced features
   */
  async processWebhook(endpointKey, payload, headers, ipAddress) {
    const startTime = Date.now();
    let webhookEndpoint;
    
    try {
      // Retrieve the webhook configuration
      webhookEndpoint = await this.getWebhookEndpointByKey(endpointKey);
      
      // Validate security token if configured
      if (webhookEndpoint.securityToken) {
        const authHeader = headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
        
        if (token !== webhookEndpoint.securityToken) {
          throw new Error('Invalid security token');
        }
      }
      
      // Validate required headers if configured
      if (webhookEndpoint.requiredHeaders && Object.keys(webhookEndpoint.requiredHeaders).length > 0) {
        for (const [key, value] of Object.entries(webhookEndpoint.requiredHeaders)) {
          if (headers[key.toLowerCase()] !== value) {
            throw new Error(`Missing or invalid required header: ${key}`);
          }
        }
      }
      
      // Process based on webhook type
      let executionResult;
      switch (webhookEndpoint.webhookType) {
        case 'go':
          executionResult = await this.processGoWebhook(webhookEndpoint, payload);
          break;
        case 'pause':
          executionResult = await this.processPauseWebhook(webhookEndpoint, payload);
          break;
        case 'stop':
          executionResult = await this.processStopWebhook(webhookEndpoint, payload);
          break;
        case 'announcement':
          executionResult = await this.processAnnouncementWebhook(webhookEndpoint, payload);
          break;
        default:
          throw new Error(`Unknown webhook type: ${webhookEndpoint.webhookType}`);
      }
      
      // Log the webhook event
      const event = await this.models.WebhookEvent.create({
        webhookEndpointId: webhookEndpoint.id,
        status: executionResult.success ? 'success' : 'failed',
        payload,
        headers,
        ipAddress,
        processingTime: Date.now() - startTime,
        executionLog: executionResult,
        createdLeadIds: executionResult.createdLeadIds || [],
        affectedLeadIds: executionResult.affectedLeadIds || [],
        announcementActions: executionResult.announcementActions || {},
        pauseResumeActions: executionResult.pauseResumeActions || {},
        stopActions: executionResult.stopActions || {},
        errorMessage: executionResult.error || null
      });

      return {
        ...executionResult,
        eventId: event.id,
        processingTime: event.processingTime,
        webhookEventId: event.id,
        webhookType: webhookEndpoint.webhookType,
        actionsExecuted: executionResult.actionsExecuted || [],
        conditionsMatched: executionResult.matchedConditionSets || []
      };

    } catch (error) {
      console.error('Error processing webhook:', error);
      
      // Log failed event if webhook endpoint was found
      if (webhookEndpoint) {
        await this.models.WebhookEvent.create({
          webhookEndpointId: webhookEndpoint.id,
          status: 'failed',
          payload,
          headers,
          ipAddress,
          processingTime: Date.now() - startTime,
          executionLog: {
            error: error.message,
            stack: error.stack
          },
          errorMessage: error.message,
          createdLeadIds: [],
          affectedLeadIds: [],
          announcementActions: {}
        });
      }

      throw error;
    }
  }

 // shared/webhook-service.js - Backward compatible announcement processing

/**
 * Process announcement webhook with backward compatibility for projectId
 */
async processAnnouncementWebhook(webhookEndpoint, payload, headers) {
  const processingStartTime = Date.now();
  const announcementConfig = webhookEndpoint.announcementConfig;
  
  // Initialize metrics tracking
  const announcementMetricData = {
    webhookEndpointId: webhookEndpoint.id,
    processingStartTime,
    variablesInjected: {},
    variablesMissing: [],
    templateId: null,
    contentProjectId: null,
    contentGenerationTime: null,
    targetDisplayCount: 0,
    optisignsExecutionTime: null,
    errors: [],
    warnings: []
  };
  
  try {
    console.log('🎯 Processing announcement webhook:', webhookEndpoint.name);
    console.log('📋 Announcement config:', JSON.stringify(announcementConfig, null, 2));
    
    // Step 1: Check trigger conditions
    const shouldTrigger = await this.checkAnnouncementTriggerConditions(
      announcementConfig,
      payload,
      webhookEndpoint.tenantId
    );
    
    if (!shouldTrigger) {
      console.log('⏭️ Announcement trigger conditions not met, skipping');
      return {
        webhookType: 'announcement',
        status: 'skipped',
        reason: 'trigger_conditions_not_met',
        announcementMetrics: announcementMetricData
      };
    }
    
    // Step 2: Extract variables from webhook payload WITH PHOTO SUPPORT
    const extractedVariables = await this.extractAnnouncementVariablesWithPhoto(
      announcementConfig.contentCreator,
      payload,
      webhookEndpoint.tenantId
    );
    
    announcementMetricData.variablesInjected = extractedVariables.variables;
    announcementMetricData.variablesMissing = extractedVariables.missing;
    
    console.log('📝 Extracted variables with photo:', extractedVariables.variables);
    
    // Step 3: Create content project - HANDLE BOTH OLD AND NEW FORMATS
    let contentProject = null;
    let contentExportId = null;
    
    try {
      // Generate project name
      let projectName = announcementConfig.contentCreator.projectSettings?.name || 
                       announcementConfig.contentCreator.projectName || 
                       'Webhook Announcement';
      
      if (announcementConfig.contentCreator.projectSettings?.addTimestamp) {
        projectName += ` - ${new Date().toISOString()}`;
      } else if (announcementConfig.contentCreator.projectSettings?.customNamePattern) {
        projectName = this.interpolateVariables(
          announcementConfig.contentCreator.projectSettings.customNamePattern,
          extractedVariables.variables
        );
      } else if (projectName.includes('{{timestamp}}')) {
        // Handle old timestamp format
        projectName = projectName.replace('{{timestamp}}', new Date().toISOString());
      }

      // BACKWARD COMPATIBILITY: Check for both new templateId and old projectId
      const templateId = announcementConfig.contentCreator.templateId;
      const projectId = announcementConfig.contentCreator.projectId;
      
      if (templateId) {
        console.log('✅ Using new template-based approach with templateId:', templateId);
        // NEW APPROACH: Create project from template
        announcementMetricData.templateId = templateId;
        
        contentProject = await this.createProjectFromTemplate(
          templateId,
          webhookEndpoint.tenantId,
          projectName,
          extractedVariables.variables,
          {
            source: 'webhook_announcement',
            webhookEndpointId: webhookEndpoint.id,
            variables: extractedVariables.variables
          }
        );
        
      } else if (projectId) {
        console.log('⚠️ Using legacy project-based approach with projectId:', projectId);
        console.log('💡 Consider migrating this webhook to use templateId instead');
        
        // LEGACY APPROACH: Duplicate existing project
        contentProject = await this.duplicateProjectForTenant(
          projectId,
          webhookEndpoint.tenantId,
          projectName,
          1 // System user ID
        );
        
        // Inject variables into the duplicated project
        if (contentProject) {
          await this.injectVariablesIntoProject(
            contentProject.id,
            extractedVariables.variables,
            webhookEndpoint.tenantId
          );
        }
        
      } else {
        throw new Error('No templateId or projectId specified in announcement configuration. Please configure either contentCreator.templateId (recommended) or contentCreator.projectId (legacy).');
      }
      
      announcementMetricData.contentProjectId = contentProject.id;
      console.log('✅ Created content project:', contentProject.id);
      
    } catch (error) {
      console.error('❌ Failed to create content project:', error);
      announcementMetricData.errors.push({
        stage: 'content_creation',
        error: error.message
      });
      throw new Error(`Content creation failed: ${error.message}`);
    }

    // Record content generation time
    announcementMetricData.contentGenerationTime = Date.now() - processingStartTime;
    
    // Step 4: Determine target displays
    console.log('🔍 Determining target displays for OptiSigns...');
    
    const targetDisplays = await this.getAnnouncementTargetDisplays(
      webhookEndpoint.tenantId,
      announcementConfig.optisigns?.displaySelection || { mode: 'all' },
      payload
    );
    
    console.log(`🎯 Found ${targetDisplays.length} target displays`);
    announcementMetricData.targetDisplayCount = targetDisplays.length;
    
    if (targetDisplays.length === 0) {
      console.log('⚠️ No target displays found, skipping OptiSigns execution');
      announcementMetricData.warnings.push('No target displays found');
      
      return {
        webhookType: 'announcement',
        status: 'completed_partial',
        contentProjectId: contentProject.id,
        announcementMetrics: announcementMetricData,
        warnings: ['No target displays found']
      };
    }
    
    // Step 5: Execute OptiSigns announcements
    const optisignsStartTime = Date.now();
    const announcements = [];
    
    for (const display of targetDisplays) {
      try {
        const announcement = await this.executeOptiSignsAnnouncement(
          display,
          contentProject,
          announcementConfig.optisigns,
          webhookEndpoint.tenantId
        );
        
        announcements.push({
          displayId: display.id,
          displayName: display.name,
          announcementId: announcement.id,
          status: 'success'
        });
        
      } catch (error) {
        console.error(`❌ Failed to execute announcement on display ${display.name}:`, error);
        announcements.push({
          displayId: display.id,
          displayName: display.name,
          status: 'failed',
          error: error.message
        });
        
        announcementMetricData.errors.push({
          stage: 'optisigns_execution',
          displayId: display.id,
          error: error.message
        });
      }
    }
    
    announcementMetricData.optisignsExecutionTime = Date.now() - optisignsStartTime;
    
    // Step 6: Return results
    const successfulAnnouncements = announcements.filter(a => a.status === 'success');
    const failedAnnouncements = announcements.filter(a => a.status === 'failed');
    
    console.log(`✅ Announcement webhook completed: ${successfulAnnouncements.length} success, ${failedAnnouncements.length} failed`);
    
    return {
      webhookType: 'announcement',
      status: failedAnnouncements.length === 0 ? 'completed' : 'completed_partial',
      contentProjectId: contentProject.id,
      templateId: announcementMetricData.templateId,
      projectId: announcementConfig.contentCreator.projectId, // Include for legacy tracking
      announcements: announcements,
      announcementMetrics: announcementMetricData,
      processingTime: Date.now() - processingStartTime
    };
    
  } catch (error) {
    console.error('❌ Announcement webhook processing failed:', error);
    
    announcementMetricData.errors.push({
      stage: 'general',
      error: error.message
    });
    
    return {
      webhookType: 'announcement',
      status: 'failed',
      error: error.message,
      announcementMetrics: announcementMetricData,
      processingTime: Date.now() - processingStartTime
    };
  }
}
/**
 * Get target displays for announcement based on selection criteria
 */
async getAnnouncementTargetDisplays(tenantId, displaySelection, payload) {
  try {
    console.log('🔍 Getting target displays for announcement...', {
      mode: displaySelection.mode,
      tenantId
    });

    if (!this.optisignsService) {
      console.warn('⚠️ OptiSigns service not available');
      return [];
    }

    let displays = [];

    switch (displaySelection.mode) {
      case 'all':
        // Get all active displays for tenant
        displays = await this.models.OptisignsDisplay?.findAll({
          where: {
            tenantId: tenantId,
            isActive: true
          }
        }) || [];
        break;

      case 'specific':
        // Get specific displays by IDs
        if (displaySelection.displayIds && displaySelection.displayIds.length > 0) {
          displays = await this.models.OptisignsDisplay?.findAll({
            where: {
              id: displaySelection.displayIds,
              tenantId: tenantId,
              isActive: true
            }
          }) || [];
        }
        break;

      case 'group':
        // Get displays by group/tag
        if (displaySelection.displayGroups && displaySelection.displayGroups.length > 0) {
          displays = await this.models.OptisignsDisplay?.findAll({
            where: {
              tenantId: tenantId,
              isActive: true,
              tags: {
                [this.models.Sequelize.Op.overlap]: displaySelection.displayGroups
              }
            }
          }) || [];
        }
        break;

      case 'conditional':
        // Get displays based on conditional logic (payload-based)
        displays = await this.getConditionalDisplays(
          tenantId, 
          displaySelection.conditionalSelection, 
          payload
        );
        break;

      default:
        console.warn(`⚠️ Unknown display selection mode: ${displaySelection.mode}`);
        displays = [];
    }

    console.log(`📊 Found ${displays.length} target displays`);
    return displays;

  } catch (error) {
    console.error('❌ Error getting target displays:', error);
    return [];
  }
}


/**
   * Execute OptiSigns announcement on a specific display
   * UPDATED: Uses proper export URL from created project
   */
  async executeOptiSignsAnnouncement(display, contentProject, optisignsConfig, tenantId) {
    try {
      console.log(`🚀 Executing OptiSigns announcement on display: ${display.name} (${display.id})`);

      if (!this.optisignsService) {
        throw new Error('OptiSigns service not available');
      }

      if (!contentProject) {
        throw new Error('Content project is required for announcement');
      }

      // Get the content project URL for OptiSigns
      let exportData;
      try {
        console.log('📤 Preparing content for OptiSigns...');
        
        // Check if project already has an export URL (from createProjectFromTemplate)
        if (contentProject.publicUrl && contentProject.exportId) {
          console.log(`✅ Using existing export URL: ${contentProject.publicUrl}`);
          exportData = {
            publicUrl: contentProject.publicUrl,
            url: contentProject.publicUrl,
            type: 'webhook_generated',
            format: 'html',
            projectId: contentProject.id,
            projectName: contentProject.name,
            exportId: contentProject.exportId,
            exportedAt: new Date().toISOString()
          };
        } else {
          // Fallback: Try to use export method if available
          if (this.contentService.exportProject) {
            console.log('📤 Generating new export...');
            exportData = await this.contentService.exportProject(
              contentProject.id, 
              tenantId, 
              'optisigns'
            );
          } else {
            // Final fallback: Use project preview URL
            console.log('📋 Using project preview URL as fallback');
            const baseUrl = process.env.BASE_URL || 'http://34.122.156.88:3001';
            exportData = {
              publicUrl: `${baseUrl}/api/content/projects/${contentProject.id}/preview`,
              url: `${baseUrl}/api/content/projects/${contentProject.id}/preview`,
              type: 'project_preview',
              format: 'html',
              projectId: contentProject.id,
              projectName: contentProject.name,
              exportedAt: new Date().toISOString()
            };
          }
        }
        
        console.log('📋 Using export data:', {
          url: exportData.publicUrl || exportData.url,
          type: exportData.type,
          exportId: exportData.exportId
        });
        
      } catch (exportError) {
        console.error('❌ Content export failed, using fallback:', exportError);
        
        // Final fallback
        const baseUrl = process.env.BASE_URL || 'http://34.122.156.88:3001';
        exportData = {
          publicUrl: `${baseUrl}/api/content/projects/${contentProject.id}/preview`,
          url: `${baseUrl}/api/content/projects/${contentProject.id}/preview`,
          type: 'fallback',
          format: 'html',
          projectId: contentProject.id
        };
      }

      // Prepare takeover configuration
      const takeoverConfig = {
        displayId: display.id,
        priority: optisignsConfig.takeover?.priority || 'NORMAL',
        duration: optisignsConfig.takeover?.duration || 30,
        restoreAfter: optisignsConfig.takeover?.restoreAfter !== false,
        interruptCurrent: optisignsConfig.takeover?.interruptCurrent !== false,
        contentType: 'PROJECT',
        contentId: contentProject.id,
        contentUrl: exportData.publicUrl || exportData.url,
        metadata: {
          source: 'webhook_announcement',
          projectId: contentProject.id,
          projectName: contentProject.name,
          exportId: exportData.exportId,
          executedAt: new Date().toISOString()
        }
      };

      console.log('🎯 Executing takeover with config:', {
        displayId: display.id,
        displayName: display.name,
        priority: takeoverConfig.priority,
        duration: takeoverConfig.duration,
        contentUrl: takeoverConfig.contentUrl
      });

      // Execute the takeover through OptiSigns service
      let takeover;
      try {
        console.log('🚀 Preparing content for OptiSigns takeover...');
        
        // First, we need to upload the content as an asset to OptiSigns
        let optisignsAssetId;
        try {
          console.log('📤 Uploading content to OptiSigns as asset...');
          
          // Try to upload the HTML content as a website asset
const uploadResult = await this.optisignsService.createWebsiteAsset(
  tenantId,
  exportData.publicUrl || exportData.url,
  `Webhook Announcement - ${contentProject.name}`,
  null // teamId - let service use default
);
          
optisignsAssetId = uploadResult.optisignsId || uploadResult.id;
          console.log(`✅ Content uploaded to OptiSigns as asset: ${optisignsAssetId}`);
          
        } catch (uploadError) {
          console.error('❌ Failed to upload content to OptiSigns:', uploadError.message);
          
          // Fallback: Try to find an existing asset or use a placeholder
          console.log('🔄 Trying fallback approach...');
          
          // Check if there's a default announcement asset we can use
          try {
            const displays = await this.models.OptisignsDisplay?.findAll({
              where: { tenantId: tenantId },
              limit: 1
            });
            
            if (displays && displays.length > 0 && displays[0].currentAssetId) {
              console.log('📋 Using existing asset as fallback');
              optisignsAssetId = displays[0].currentAssetId;
            } else {
              throw new Error('No fallback asset available');
            }
          } catch (fallbackError) {
            throw new Error(`Content upload failed and no fallback available: ${uploadError.message}`);
          }
        }
        
        if (optisignsConfig.scheduling?.immediate !== false) {
          // Immediate execution using the correct method name
          console.log(`🎯 Executing immediate takeover with asset: ${optisignsAssetId}`);
          
          takeover = await this.optisignsService.takeoverDevice(
            tenantId,
            display.id,
            'ASSET', // Content type for announcements
            optisignsAssetId, // Use the OptiSigns asset ID
            {
              priority: takeoverConfig.priority,
              duration: takeoverConfig.duration,
              message: `Webhook announcement: ${contentProject.name}`,
              restoreAfter: takeoverConfig.restoreAfter,
              initiatedBy: 'webhook_system',
              metadata: {
                ...takeoverConfig.metadata,
                optisignsAssetId,
                originalProjectId: contentProject.id
              }
            }
          );
          
          // Extract takeover info from result
          takeover = takeover.takeover || takeover;
          
        } else {
          // For scheduled execution, we'll need to implement scheduling
          console.log('⏰ Scheduled takeovers not yet implemented, executing immediately');
          
          takeover = await this.optisignsService.takeoverDevice(
            tenantId,
            display.id,
            'ASSET',
            optisignsAssetId,
            {
              priority: takeoverConfig.priority,
              duration: takeoverConfig.duration,
              message: `Scheduled webhook announcement: ${contentProject.name}`,
              restoreAfter: takeoverConfig.restoreAfter,
              initiatedBy: 'webhook_system_scheduled',
              metadata: {
                ...takeoverConfig.metadata,
                optisignsAssetId,
                originalProjectId: contentProject.id
              }
            }
          );
          
          takeover = takeover.takeover || takeover;
        }
      } catch (optisignsError) {
        console.error('❌ OptiSigns takeover failed:', optisignsError);
        throw new Error(`OptiSigns execution failed: ${optisignsError.message}`);
      }

      console.log(`✅ OptiSigns announcement executed successfully:`, {
        takeoverId: takeover.id,
        displayId: display.id,
        displayName: display.name,
        status: takeover.status
      });

      return {
        id: takeover.id,
        displayId: display.id,
        displayName: display.name,
        status: 'success',
        takeoverConfig,
        executedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ Failed to execute OptiSigns announcement on ${display.name}:`, error);
      throw error;
    }
  }
  


/**
 * Get displays based on conditional selection criteria
 */
async getConditionalDisplays(tenantId, conditionalSelection, payload) {
  try {
    if (!conditionalSelection.enabled || !conditionalSelection.conditions) {
      return [];
    }

    // Start with all active displays
    let displays = await this.models.OptisignsDisplay?.findAll({
      where: {
        tenantId: tenantId,
        isActive: true
      }
    }) || [];

    // Filter displays based on conditions
    for (const condition of conditionalSelection.conditions) {
      const payloadValue = this.getNestedValue(payload, condition.field);
      
      displays = displays.filter(display => {
        // Check if display matches the condition
        // This could be extended to check display metadata, location, etc.
        const displayValue = this.getNestedValue(display.metadata || {}, condition.field);
        return this.evaluateCondition(displayValue || payloadValue, condition.operator, condition.value);
      });
    }

    return displays;

  } catch (error) {
    console.error('❌ Error in conditional display selection:', error);
    return [];
  }
}

 
/**
 * Check announcement trigger conditions
 */
async checkAnnouncementTriggerConditions(announcementConfig, payload, tenantId) {
  try {
    const triggerConditions = announcementConfig.advanced?.triggerConditions;
    
    if (!triggerConditions?.enabled) {
      console.log('✅ Trigger conditions disabled, allowing announcement');
      return true;
    }

    console.log('🔍 Checking announcement trigger conditions...');

    // Time-based restrictions
    if (triggerConditions.timeRestrictions?.enabled) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

      const allowedHours = triggerConditions.timeRestrictions.allowedHours;
      const allowedDays = triggerConditions.timeRestrictions.allowedDays || [0,1,2,3,4,5,6];

      if (allowedHours && (currentHour < allowedHours.start || currentHour >= allowedHours.end)) {
        console.log(`⏰ Time restriction: Current hour ${currentHour} not in allowed range ${allowedHours.start}-${allowedHours.end}`);
        return false;
      }

      if (!allowedDays.includes(currentDay)) {
        console.log(`📅 Day restriction: Current day ${currentDay} not in allowed days ${allowedDays}`);
        return false;
      }
    }

    // Rate limiting
    if (triggerConditions.rateLimiting?.enabled) {
      const rateLimiting = triggerConditions.rateLimiting;
      const now = new Date();
      
      // Check recent announcements
      const recentAnnouncements = await this.models.AnnouncementMetric?.count({
        where: {
          tenantId: tenantId,
          announcementStartTime: {
            [this.models.Sequelize.Op.gte]: new Date(now.getTime() - (rateLimiting.cooldownMinutes || 5) * 60 * 1000)
          }
        }
      }) || 0;

      if (recentAnnouncements > 0) {
        console.log(`⏱️ Rate limit: Last announcement was too recent`);
        return false;
      }
    }

    // Payload conditions
    if (triggerConditions.payloadConditions?.enabled) {
      for (const condition of triggerConditions.payloadConditions.conditions) {
        const fieldValue = this.getNestedValue(payload, condition.field);
        if (!this.evaluateCondition(fieldValue, condition.operator, condition.value)) {
          console.log(`❌ Payload condition failed: ${condition.field} ${condition.operator} ${condition.value}`);
          return false;
        }
      }
    }

    console.log('✅ All trigger conditions passed');
    return true;

  } catch (error) {
    console.error('❌ Error checking trigger conditions:', error);
    // Default to allowing announcement if check fails
    return true;
  }
}

/**
 * Evaluate a condition (used for trigger conditions and display selection)
 */
evaluateCondition(value, operator, expectedValue) {
  switch (operator) {
    case 'equals':
      return value == expectedValue;
    case 'not_equals':
      return value != expectedValue;
    case 'contains':
      return String(value || '').toLowerCase().includes(String(expectedValue || '').toLowerCase());
    case 'not_contains':
      return !String(value || '').toLowerCase().includes(String(expectedValue || '').toLowerCase());
    case 'starts_with':
      return String(value || '').toLowerCase().startsWith(String(expectedValue || '').toLowerCase());
    case 'ends_with':
      return String(value || '').toLowerCase().endsWith(String(expectedValue || '').toLowerCase());
    case 'greater_than':
      return parseFloat(value) > parseFloat(expectedValue);
    case 'less_than':
      return parseFloat(value) < parseFloat(expectedValue);
    case 'greater_equal':
      return parseFloat(value) >= parseFloat(expectedValue);
    case 'less_equal':
      return parseFloat(value) <= parseFloat(expectedValue);
    case 'exists':
      return value !== null && value !== undefined && value !== '';
    case 'not_exists':
      return value === null || value === undefined || value === '';
    case 'regex':
      try {
        const regex = new RegExp(expectedValue);
        return regex.test(String(value || ''));
      } catch (error) {
        console.warn('Invalid regex pattern:', expectedValue);
        return false;
      }
    case 'in_array':
      const expectedArray = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
      return expectedArray.includes(value);
    case 'not_in_array':
      const notExpectedArray = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
      return !notExpectedArray.includes(value);
    default:
      console.warn(`Unknown operator: ${operator}`);
      return false;
  }
}



/**
 * Duplicate existing project for tenant (legacy support)
 */
async duplicateProjectForTenant(sourceProjectId, tenantId, newProjectName, userId) {
  try {
    console.log(`🔄 Duplicating project ${sourceProjectId} for tenant ${tenantId}`);
    
    // Get the source project with all its elements
    const sourceProject = await this.contentService.getProjectWithElements(sourceProjectId, tenantId);
    
    if (!sourceProject) {
      throw new Error(`Source project ${sourceProjectId} not found or not accessible for tenant ${tenantId}`);
    }
    
    // Create new project based on source
    const newProjectData = {
      name: newProjectName,
      description: `Duplicated from: ${sourceProject.name}`,
      templateId: sourceProject.templateId,
      canvasSize: sourceProject.canvasSize,
      responsiveBreakpoints: sourceProject.responsiveBreakpoints,
      canvasBackground: sourceProject.canvasBackground,
      projectData: sourceProject.projectData,
      variables: sourceProject.variables,
      globalStyles: sourceProject.globalStyles,
      interactions: sourceProject.interactions,
      status: 'active',
      metadata: {
        source: 'webhook_duplication',
        sourceProjectId: sourceProjectId,
        duplicatedAt: new Date().toISOString()
      }
    };
    
    const newProject = await this.contentService.createProject(tenantId, newProjectData, userId);
    
    // Copy all elements from source project
    if (sourceProject.elements && sourceProject.elements.length > 0) {
      for (const element of sourceProject.elements) {
        const elementData = {
          elementType: element.elementType,
          name: element.name,
          position: element.position,
          size: element.size,
          properties: element.properties,
          styles: element.styles,
          layerOrder: element.layerOrder,
          isLocked: element.isLocked,
          isVisible: element.isVisible,
          animations: element.animations,
          interactions: element.interactions,
          conditions: element.conditions,
          assetId: element.assetId
        };
        
        await this.contentService.createElement(newProject.id, elementData, tenantId);
      }
    }
    
    console.log(`✅ Successfully duplicated project to: ${newProject.id}`);
    return newProject;
    
  } catch (error) {
    console.error('Error duplicating project:', error);
    throw new Error(`Failed to duplicate project: ${error.message}`);
  }
}




/**
   * Create a new project from a template with variable injection
   * UPDATED: Now creates export record for public API access
   */
  async createProjectFromTemplate(templateId, tenantId, projectName, variables, metadata = {}) {
    try {
      // Get the template
      const template = await this.contentService.getTemplate(templateId, tenantId);
      if (!template) {
        throw new Error(`Template not found: ${templateId}`);
      }
      
      console.log(`📋 Creating project from template: ${template.name}`);
      
      // Create project data from template
      const projectData = {
        name: projectName,
        description: `Auto-generated from template: ${template.name}`,
        templateId: template.id,
        canvasSize: template.canvasSize,
        responsiveBreakpoints: template.responsiveBreakpoints,
        status: 'active',
        metadata: {
          ...metadata,
          sourceTemplate: template.name,
          createdFromTemplate: true,
          templateVersion: template.updatedAt
        },
        variables: template.variables || {}
      };
      
      // Create the project
      const project = await this.contentService.createProject(
        tenantId,
        projectData,
        1 // System user ID
      );
      
      console.log(`✅ Created project "${project.name}" from template`);
      
      // Copy elements from template and inject variables
      if (template.templateData && typeof template.templateData === 'object') {
        console.log('📋 Template data structure:', JSON.stringify(template.templateData, null, 2));
        await this.copyTemplateElementsWithVariables(
          project.id,
          template.templateData,
          variables,
          tenantId
        );
      } else {
        console.log('⚠️ No template data found or template data is not an object');
        console.log('📋 Template structure:', {
          hasTemplateData: !!template.templateData,
          templateDataType: typeof template.templateData,
          templateKeys: Object.keys(template)
        });
      }
      
      // IMPORTANT: Create export record for public API access
      console.log('📤 Creating export record for public API access...');
      
      const { v4: uuidv4 } = require('uuid');
      const exportId = uuidv4();
      const baseUrl = process.env.BASE_URL || 'http://34.122.156.88:3001';
      const publicUrl = `${baseUrl}/api/content/public/${exportId}`;
      
      try {
        const exportRecord = await this.contentService.models.ContentExport.create({
          id: exportId,
          projectId: project.id,
          tenantId: tenantId.toString(),
          exportType: 'preview', // FIXED: Use valid enum value
          format: 'html',
          quality: 'high',
          resolution: project.canvasSize || { width: 1920, height: 1080 },
          publicUrl: publicUrl,
          processingStatus: 'completed',
          variableData: variables || {},
          exportSettings: {
            publicServing: true,
            webhookGenerated: true,
            selfContained: true,
            generatedAt: new Date().toISOString()
          },
          createdBy: 1 // System user
        });
        
        console.log(`✅ Created export record: ${exportId}`);
        console.log(`🌐 Public URL: ${publicUrl}`);
        
        // Add export info to project metadata
        project.exportId = exportId;
        project.publicUrl = publicUrl;
        
      } catch (exportError) {
        console.error('❌ Failed to create export record:', exportError.message);
        console.log('⚠️ Project created but public API access may not work');
      }
      
      return project;
      
    } catch (error) {
      console.error('Error creating project from template:', error);
      throw new Error(`Failed to create project from template: ${error.message}`);
    }
  }

/**
 * Copy template elements to project with variable injection
 */

async injectVariablesIntoProject(projectId, variables, tenantId = null) {
    try {
      // Get project with elements
      const project = await this.contentService.getProjectWithElements(
        projectId,
        tenantId // Pass through tenant for proper lookup
      );
      
      if (!project || !project.elements) {
        return;
      }

      // Update each element with variable interpolation
      for (const element of project.elements) {
        const updatedProperties = {};
        let hasChanges = false;
        
        // Special handling for text elements - THIS IS THE KEY FIX
        if (element.elementType === 'text' || 
            element.elementType === 'gradient_text' || 
            element.elementType === 'shadow_text' || 
            element.elementType === 'outline_text' || 
            element.elementType === 'typewriter_text') {
          
          // Check for text content in multiple possible property names
          const textProperties = ['text', 'content', 'innerHTML', 'textContent'];
          
          for (const textProp of textProperties) {
            if (element.properties[textProp] && typeof element.properties[textProp] === 'string') {
              const interpolatedText = this.interpolateVariables(element.properties[textProp], variables);
              if (interpolatedText !== element.properties[textProp]) {
                updatedProperties[textProp] = interpolatedText;
                hasChanges = true;
                console.log(`📝 Updated ${element.elementType} ${textProp}:`, {
                  original: element.properties[textProp],
                  interpolated: interpolatedText
                });
              }
            }
          }
        }
        
        // Check all other properties for variable placeholders
        if (element.properties) {
          for (const [key, value] of Object.entries(element.properties)) {
            // Skip text properties as they're handled above
            if (element.elementType === 'text' && ['text', 'content', 'innerHTML', 'textContent'].includes(key)) {
              continue;
            }
            
            if (typeof value === 'string' && value.includes('{')) {
              updatedProperties[key] = this.interpolateVariables(value, variables);
              hasChanges = true;
            }
          }

          // Special handling for image or sales rep photo elements
          if ((element.elementType === 'image' || element.elementType === 'sales_rep_photo') && element.properties.src) {
            // Check if src contains a variable placeholder for photo
            if (element.properties.src.includes('{rep_photo}') && variables.rep_photo) {
              updatedProperties.src = variables.rep_photo;
              hasChanges = true;
            } else if (element.properties.src.includes('{rep_photo_id}') && variables.rep_photo_id) {
              // Link to asset ID
              updatedProperties.assetId = variables.rep_photo_id;
              hasChanges = true;
            }
          }
        }
        
        // Update element if changes were made
        if (hasChanges) {
          await element.update({
            properties: {
              ...element.properties,
              ...updatedProperties
            }
          });
          console.log(`✅ Updated element ${element.id} (${element.elementType}) with variables`);
        }
      }
      
      console.log('✅ Variables injected into project elements');
      
    } catch (error) {
      console.error('Error injecting variables:', error);
      throw error;
    }
  }

  /**
   * Copy template elements and inject variables during creation (ENHANCED FOR TEXT)
   */
  async copyTemplateElementsWithVariables(templateId, targetProjectId, variables, tenantId) {
    try {
      console.log(`📋 Copying template elements from ${templateId} to ${targetProjectId} with variables`);
      
      // Get template elements
      const template = await this.contentService.getProjectWithElements(templateId, tenantId);
      
      if (!template || !template.elements || template.elements.length === 0) {
        console.log('⚠️ No template elements found to copy');
        return;
      }
      
      let createdCount = 0;
      
      for (const element of template.elements) {
        try {
          // Clone element data
          const elementClone = JSON.parse(JSON.stringify(element.toJSON()));
          
          // Inject variables into properties BEFORE creating the element
          if (elementClone.properties) {
            // Special handling for text elements - ENHANCED FIX
            if (elementClone.elementType === 'text' || 
                elementClone.elementType === 'gradient_text' || 
                elementClone.elementType === 'shadow_text' || 
                elementClone.elementType === 'outline_text' || 
                elementClone.elementType === 'typewriter_text') {
              
              // Handle multiple text property names
              const textProperties = ['text', 'content', 'innerHTML', 'textContent'];
              
              for (const textProp of textProperties) {
                if (elementClone.properties[textProp] && typeof elementClone.properties[textProp] === 'string') {
                  elementClone.properties[textProp] = this.interpolateVariables(
                    elementClone.properties[textProp], 
                    variables
                  );
                  console.log(`📝 Injected variables into ${elementClone.elementType} ${textProp}:`, 
                    elementClone.properties[textProp]);
                }
              }
            }
            
            // Handle all other properties
            for (const [key, value] of Object.entries(elementClone.properties)) {
              if (typeof value === 'string' && value.includes('{')) {
                // Skip text properties for text elements as they're handled above
                if ((elementClone.elementType === 'text' || 
                     elementClone.elementType === 'gradient_text' || 
                     elementClone.elementType === 'shadow_text' || 
                     elementClone.elementType === 'outline_text' || 
                     elementClone.elementType === 'typewriter_text') && 
                    ['text', 'content', 'innerHTML', 'textContent'].includes(key)) {
                  continue;
                }
                
                elementClone.properties[key] = this.interpolateVariables(value, variables);
              }
            }
            
            // Recursively inject variables into nested objects
            elementClone.properties = this.injectVariablesIntoObject(elementClone.properties, variables);
          }
          
          // Create element with injected variables
          const elementToCreate = {
            projectId: targetProjectId,
            elementType: elementClone.elementType,
            position: elementClone.position || { x: 0, y: 0 },
            size: elementClone.size || { width: 100, height: 100 },
            rotation: elementClone.rotation || 0,
            scale: elementClone.scale || { x: 1, y: 1 },
            skew: elementClone.skew || { x: 0, y: 0 },
            opacity: elementClone.opacity !== undefined ? elementClone.opacity : 1,
            properties: elementClone.properties || {},
            styles: elementClone.styles || {},
            responsiveStyles: elementClone.responsiveStyles || {},
            animations: elementClone.animations || [],
            interactions: elementClone.interactions || [],
            variables: elementClone.variables || {},
            conditions: elementClone.conditions || {},
            constraints: elementClone.constraints || {},
            isLocked: elementClone.isLocked || false,
            isVisible: elementClone.isVisible !== undefined ? elementClone.isVisible : true,
            isInteractive: elementClone.isInteractive || false,
            layerOrder: elementClone.layerOrder || (createdCount + 1),
            groupId: elementClone.groupId || null,
            parentId: elementClone.parentId || null,
            assetId: elementClone.assetId || null,
            linkedElements: elementClone.linkedElements || [],
            customCSS: elementClone.customCSS || null,
            customJS: elementClone.customJS || null
          };
          
          // Create the element in the database
          const createdElement = await this.contentService.models.ContentElement.create(elementToCreate);
          createdCount++;
          
          console.log(`✅ Created element ${createdElement.id}: ${createdElement.elementType}`);
          
        } catch (elementError) {
          console.error(`❌ Error creating element:`, elementError);
          console.error(`Element data:`, elementData);
        }
      }
      
      console.log(`✅ Copied ${createdCount} template elements with variables injected`);
      
    } catch (error) {
      console.error('Error copying template elements:', error);
      throw new Error(`Failed to copy template elements: ${error.message}`);
    }
  }

  /**
   * Recursively inject variables into an object (ENHANCED)
   */
  injectVariablesIntoObject(obj, variables) {
    if (typeof obj === 'string') {
      return this.interpolateVariables(obj, variables);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.injectVariablesIntoObject(item, variables));
    }
    
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.injectVariablesIntoObject(value, variables);
      }
      return result;
    }
    
    return obj;
  }

  /**
   * Interpolate variables in a string (ENHANCED WITH BETTER ERROR HANDLING)
   */
  interpolateVariables(template, variables) {
    if (!template || typeof template !== 'string') {
      return template;
    }
    
    return template.replace(/{([^}]+)}/g, (match, variableName) => {
      const value = variables[variableName];
      if (value !== undefined && value !== null) {
        return String(value);
      }
      
      // Check for nested variables (e.g., {user.name})
      if (variableName.includes('.')) {
        const parts = variableName.split('.');
        let nestedValue = variables;
        
        for (const part of parts) {
          if (nestedValue && typeof nestedValue === 'object' && nestedValue[part] !== undefined) {
            nestedValue = nestedValue[part];
          } else {
            nestedValue = undefined;
            break;
          }
        }
        
        if (nestedValue !== undefined && nestedValue !== null) {
          return String(nestedValue);
        }
      }
      
      // Return original placeholder if variable not found
      console.warn(`⚠️ Variable not found: ${variableName}`);
      return match;
    });
  }

async copyTemplateElementsWithVariables(projectId, templateData, variables, tenantId) {
  try {
    console.log(`📋 Copying template elements with variable injection...`);
    console.log(`📊 Template data type: ${typeof templateData}, Array: ${Array.isArray(templateData)}`);
    
    // Handle both array and object structures
    const elements = Array.isArray(templateData) 
      ? templateData 
      : templateData.elements || Object.values(templateData);
    
    console.log(`📋 Found ${elements.length} elements to copy`);
    
    let createdCount = 0;
    
    for (const elementData of elements) {
      if (!elementData || !elementData.elementType) {
        console.log(`⚠️ Skipping invalid element:`, elementData);
        continue;
      }
      
      try {
        // Clone element data to avoid modifying original
        const elementClone = JSON.parse(JSON.stringify(elementData));
        
        // Inject variables into element properties
        elementClone.properties = this.injectVariablesIntoObject(
          elementClone.properties || {},
          variables
        );
        
        // Inject variables into element styles
        elementClone.styles = this.injectVariablesIntoObject(
          elementClone.styles || {},
          variables
        );
        
        // Handle special cases like sales rep photos
        if (elementClone.elementType === 'image' && 
            elementClone.properties && 
            elementClone.properties.customElementType === 'sales_rep_photo') {
          
          if (variables.rep_photo) {
            elementClone.properties.src = variables.rep_photo;
            if (variables.rep_photo_id) {
              elementClone.assetId = variables.rep_photo_id;
            }
          }
        }
        
        // Ensure required fields for database insertion (NO NAME FIELD)
        const elementToCreate = {
          projectId: projectId,
          elementType: elementClone.elementType,
          position: elementClone.position || { x: 0, y: 0, z: 0 },
          size: elementClone.size || { width: 100, height: 100 },
          rotation: elementClone.rotation || 0,
          scale: elementClone.scale || { x: 1, y: 1 },
          skew: elementClone.skew || { x: 0, y: 0 },
          opacity: elementClone.opacity !== undefined ? elementClone.opacity : 1,
          properties: elementClone.properties || {},
          styles: elementClone.styles || {},
          responsiveStyles: elementClone.responsiveStyles || {},
          animations: elementClone.animations || [],
          interactions: elementClone.interactions || [],
          variables: elementClone.variables || {},
          conditions: elementClone.conditions || {},
          constraints: elementClone.constraints || {},
          isLocked: elementClone.isLocked || false,
          isVisible: elementClone.isVisible !== undefined ? elementClone.isVisible : true,
          isInteractive: elementClone.isInteractive || false,
          layerOrder: elementClone.layerOrder || (createdCount + 1),
          groupId: elementClone.groupId || null,
          parentId: elementClone.parentId || null,
          assetId: elementClone.assetId || null,
          linkedElements: elementClone.linkedElements || [],
          customCSS: elementClone.customCSS || null,
          customJS: elementClone.customJS || null
        };
        
        // Create the element in the database
        const createdElement = await this.contentService.models.ContentElement.create(elementToCreate);
        createdCount++;
        
        console.log(`✅ Created element ${createdElement.id}: ${createdElement.elementType}`);
        
      } catch (elementError) {
        console.error(`❌ Error creating element:`, elementError);
        console.error(`Element data:`, elementData);
      }
    }
    
    console.log(`✅ Copied ${createdCount} template elements with variables injected`);
    
  } catch (error) {
    console.error('Error copying template elements:', error);
    throw new Error(`Failed to copy template elements: ${error.message}`);
  }
}

/**
 * Recursively inject variables into an object
 */
injectVariablesIntoObject(obj, variables) {
  if (typeof obj === 'string') {
    return this.interpolateVariables(obj, variables);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => this.injectVariablesIntoObject(item, variables));
  }
  
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.injectVariablesIntoObject(value, variables);
    }
    return result;
  }
  
  return obj;
}

/**
 * Enhanced variable extraction with photo support
 */
async extractAnnouncementVariablesWithPhoto(contentConfig, payload, tenantId) {
  const variables = {};
  const missing = [];
  const { variableMapping, defaultValues } = contentConfig;
  
  // Extract mapped variables
  for (const [variableName, payloadPath] of Object.entries(variableMapping || {})) {
    let value = this.getNestedValue(payload, payloadPath);
    
    if (value === null || value === undefined || value === '') {
      // Use default value if available
      if (defaultValues && defaultValues[variableName] !== undefined) {
        value = defaultValues[variableName];
      } else {
        missing.push(variableName);
        value = ''; // Set empty string for missing variables
      }
    }
    
    variables[variableName] = value;
  }
  
  // Special handling for sales rep photos
  if (variables.rep_email) {
    try {
      const photoAsset = await this.findSalesRepPhoto(variables.rep_email, tenantId);
      if (photoAsset) {
        variables.rep_photo = photoAsset.publicUrl;
        variables.rep_photo_thumbnail = photoAsset.thumbnailUrl;
        console.log(`✅ Found sales rep photo for ${variables.rep_email}`);
      } else {
        console.log(`⚠️ No photo found for sales rep: ${variables.rep_email}`);
        variables.rep_photo = ''; // Set empty for fallback handling
      }
    } catch (error) {
      console.error('Error finding sales rep photo:', error);
      variables.rep_photo = '';
    }
  }
  
  // Add system variables
  variables['system.timestamp'] = new Date().toISOString();
  variables['system.date'] = new Date().toLocaleDateString();
  variables['system.time'] = new Date().toLocaleTimeString();
  
  return { variables, missing };
}

/**
 * Find sales rep photo by email
 */
async findSalesRepPhoto(repEmail, tenantId) {
  try {
    if (!this.contentService) return null;
    
    const normalizedEmail = repEmail.toLowerCase().trim();
    
    // Search in content assets for sales rep photos
    const assets = await this.contentService.getAssets(tenantId, {
      assetType: 'image',
      search: normalizedEmail,
      limit: 1
    });
    
    // Find asset with matching email in metadata
    const photoAsset = assets.assets?.find(asset => 
      asset.metadata?.repEmail?.toLowerCase() === normalizedEmail ||
      asset.metadata?.rep_email?.toLowerCase() === normalizedEmail ||
      asset.metadata?.email?.toLowerCase() === normalizedEmail
    );
    
    return photoAsset || null;
    
  } catch (error) {
    console.error('Error finding sales rep photo:', error);
    return null;
  }
}

  /**
   * ENHANCED OptiSigns publishing with retry logic and detailed error tracking
   */
  async publishToOptisignsWithRetry(contentProject, exportInfo, targetDisplays, optisignsConfig, tenantId, metricsData) {
    const publishResults = {
      successCount: 0,
      failedCount: 0,
      errors: [],
      displayResults: []
    };

    console.log('🚀 Starting enhanced OptiSigns publishing...');
    
    // Validate OptiSigns service first
    if (!this.optisignsService) {
      const error = 'OptiSigns service not available';
      console.error('❌', error);
      publishResults.errors.push({
        stage: 'service_validation',
        error: error,
        displayId: null,
        displayName: 'N/A'
      });
      publishResults.failedCount = targetDisplays.length;
      return publishResults;
    }

    // Process each display with enhanced error handling
    for (let i = 0; i < targetDisplays.length; i++) {
      const display = targetDisplays[i];
      const displayInfo = {
        id: display.id,
        name: display.name,
        optisignsDisplayId: display.optisignsDisplayId,
        uuid: display.uuid
      };
      
      console.log(`\n📺 [${i + 1}/${targetDisplays.length}] Processing display: ${display.name} (${display.id})`);
      console.log(`🔍 Display info:`, displayInfo);

      try {
        // Validate display has OptiSigns ID
        const optisignsApiId = display.optisignsDisplayId || display.uuid;
        if (!optisignsApiId || optisignsApiId === 'undefined' || optisignsApiId === 'null') {
          throw new Error(`Display missing OptiSigns API ID - optisignsDisplayId: "${display.optisignsDisplayId}", uuid: "${display.uuid}"`);
        }

        console.log(`✅ Using OptiSigns API ID: ${optisignsApiId}`);

        // Create website asset using OptiSigns service method with retry
        let assetResult;
        const maxRetries = 3;
        let retryCount = 0;
        
        while (retryCount < maxRetries) {
          try {
            console.log(`📦 Creating OptiSigns website asset (attempt ${retryCount + 1}/${maxRetries})...`);
            
            // Use the existing createWebsiteAsset method from OptiSigns service
            assetResult = await this.optisignsService.createWebsiteAsset(
              tenantId,
              exportInfo.publicUrl,
              `Webhook Announcement - ${contentProject.name}`,
              null // teamId - let service use default
            );
            
            console.log('✅ Created OptiSigns website asset:', {
              id: assetResult.optisignsId,
              name: assetResult.name,
              url: assetResult.url || assetResult.webLink
            });
            break;
            
          } catch (assetError) {
            retryCount++;
            console.error(`❌ Asset creation attempt ${retryCount} failed:`, assetError.message);
            
            if (retryCount >= maxRetries) {
              throw new Error(`Asset creation failed after ${maxRetries} attempts: ${assetError.message}`);
            }
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          }
        }

        // Trigger takeover on the display using OptiSigns service with enhanced error handling
        retryCount = 0;
        while (retryCount < maxRetries) {
          try {
            console.log(`🎯 Triggering takeover (attempt ${retryCount + 1}/${maxRetries})...`);
            const takeoverPriority = this.normalizeTakeoverPriority(
              optisignsConfig.takeover?.priority
            );
            console.log(`📋 Takeover config:`, {
              displayId: optisignsApiId,
              assetId: assetResult.optisignsId,
              priority: takeoverPriority,
              duration: optisignsConfig.takeover?.duration || 30
            });
            
            // Use OptiSigns service takeoverDevice method
            const takeoverResult = await this.optisignsService.takeoverDevice(
              tenantId,
              display.id, // Use local display ID
              'ASSET',
              assetResult.optisignsId,
              {
                priority: takeoverPriority,
                duration: optisignsConfig.takeover?.duration || 30,
                message: `Webhook announcement: ${contentProject.name}`,
                initiatedBy: 'webhook_announcement'
              }
            );
            
            console.log(`🎯 ✅ Successfully triggered takeover on ${display.name}!`);
            console.log(`📊 Takeover result:`, takeoverResult);
            
            publishResults.successCount++;
            publishResults.displayResults.push({
              displayId: display.id,
              displayName: display.name,
              status: 'success',
              assetId: assetResult.optisignsId,
              takeoverResult: takeoverResult
            });
            break;
            
          } catch (takeoverError) {
            retryCount++;
            console.error(`❌ Takeover attempt ${retryCount} failed for ${display.name}:`, takeoverError.message);
            
            if (retryCount >= maxRetries) {
              throw new Error(`Takeover failed after ${maxRetries} attempts: ${takeoverError.message}`);
            }
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1500 * retryCount));
          }
        }
        
      } catch (displayError) {
        console.error(`❌ Failed to publish to display ${display.name}:`, displayError.message);
        
        publishResults.failedCount++;
        publishResults.errors.push({
          stage: 'display_publishing',
          error: displayError.message,
          displayId: display.id,
          displayName: display.name,
          optisignsDisplayId: display.optisignsDisplayId,
          uuid: display.uuid
        });
        
        publishResults.displayResults.push({
          displayId: display.id,
          displayName: display.name,
          status: 'failed',
          error: displayError.message
        });
      }
    }

    return publishResults;
  }

  /**
   * Debug display selection to help troubleshoot targeting issues
   */
  async debugDisplaySelection(tenantId, displaySelection) {
    try {
      console.log('🔍 Debug: Display selection configuration:', JSON.stringify(displaySelection, null, 2));
      
      if (!this.models.OptisignsDisplay) {
        console.log('❌ Debug: OptisignsDisplay model not available');
        return;
      }

      // Check all displays for this tenant
      const allDisplays = await this.models.OptisignsDisplay.findAll({
        where: { tenantId: tenantId.toString() }
      });
      
      console.log(`📊 Debug: Total displays in database: ${allDisplays.length}`);
      
      if (allDisplays.length > 0) {
        const activeDisplays = allDisplays.filter(d => d.isActive);
        const onlineDisplays = allDisplays.filter(d => d.isOnline);
        const activeAndOnline = allDisplays.filter(d => d.isActive && d.isOnline);
        const withOptisignsId = allDisplays.filter(d => d.optisignsDisplayId && d.optisignsDisplayId !== 'null');
        const withUuid = allDisplays.filter(d => d.uuid && d.uuid !== 'null');
        
        console.log(`📊 Debug: Active displays: ${activeDisplays.length}`);
        console.log(`📊 Debug: Online displays: ${onlineDisplays.length}`);
        console.log(`📊 Debug: Active AND Online displays: ${activeAndOnline.length}`);
        console.log(`📊 Debug: Displays with OptiSigns ID: ${withOptisignsId.length}`);
        console.log(`📊 Debug: Displays with UUID: ${withUuid.length}`);
        
        // Show sample display data with IDs
        console.log('📋 Debug: Sample display statuses:');
        allDisplays.slice(0, 5).forEach(display => {
          console.log(`  - ${display.name} (ID: ${display.id}): active=${display.isActive}, online=${display.isOnline}, location=${display.location}, optisignsId=${display.optisignsDisplayId}, uuid=${display.uuid}`);
        });
        
        // Check against display selection criteria
        const mode = displaySelection?.mode || 'all';
        console.log(`🎯 Debug: Display selection mode: ${mode}`);
        
        switch (mode) {
          case 'all':
            console.log('🔍 Debug: Mode is "all", should target all active & online displays');
            console.log(`📋 Debug: Available active & online display IDs:`, 
              activeAndOnline.map(d => d.id)
            );
            break;
          case 'specific':
            console.log('🔍 Debug: Mode is "specific", target IDs:', displaySelection?.displayIds);
            console.log(`📋 Debug: Available display IDs in database:`, 
              allDisplays.map(d => d.id)
            );
            
            // Check if target IDs exist
            if (displaySelection?.displayIds) {
              const missingIds = displaySelection.displayIds.filter(targetId => 
                !allDisplays.some(display => display.id === targetId)
              );
              if (missingIds.length > 0) {
                console.log(`❌ Debug: Missing display IDs:`, missingIds);
                console.log(`💡 Debug: These display IDs don't exist in the database`);
              }
              
              const foundIds = displaySelection.displayIds.filter(targetId => 
                allDisplays.some(display => display.id === targetId)
              );
              if (foundIds.length > 0) {
                console.log(`✅ Debug: Found display IDs:`, foundIds);
                const foundDisplays = allDisplays.filter(d => foundIds.includes(d.id));
                foundDisplays.forEach(display => {
                  console.log(`  - ${display.name} (${display.id}): active=${display.isActive}, online=${display.isOnline}, optisignsId=${display.optisignsDisplayId}`);
                });
              }
            }
            break;
          case 'group':
            console.log('🔍 Debug: Mode is "group", target locations:', displaySelection?.displayGroups);
            const uniqueLocations = [...new Set(allDisplays.map(d => d.location).filter(Boolean))];
            console.log('📍 Debug: Available locations:', uniqueLocations);
            
            if (displaySelection?.displayGroups) {
              displaySelection.displayGroups.forEach(targetLocation => {
                const displaysInLocation = allDisplays.filter(d => d.location === targetLocation);
                console.log(`📍 Debug: Displays in "${targetLocation}": ${displaysInLocation.length}`, 
                  displaysInLocation.map(d => `${d.name} (${d.id})`)
                );
              });
            }
            break;
          case 'conditional':
            console.log('🔍 Debug: Mode is "conditional", rules:', displaySelection?.conditionalRules);
            break;
        }
      } else {
        console.log('❌ Debug: No displays found in database for this tenant');
        console.log('💡 Debug: Make sure to sync displays from OptiSigns first');
      }
    } catch (error) {
      console.error('❌ Debug: Error in display selection debugging:', error);
    }
  }

  /**
   * Extract variables from announcement webhook payload WITH ENHANCED PHOTO SUPPORT
   */
  async extractAnnouncementVariablesWithPhoto(contentCreatorConfig, payload, tenantId) {
    const variables = {};
    const missing = [];
    
    // Process regular variable mappings
    if (contentCreatorConfig.variableMapping) {
      for (const [varName, payloadPath] of Object.entries(contentCreatorConfig.variableMapping)) {
        const value = this.getNestedValue(payload, payloadPath);
        if (value !== undefined && value !== null) {
          variables[varName] = value;
        } else if (contentCreatorConfig.defaultValues?.[varName] !== undefined) {
          variables[varName] = contentCreatorConfig.defaultValues[varName];
        } else {
          missing.push(varName);
        }
      }
    }
    
    // Enhanced sales rep photo lookup with multiple fallback strategies
    console.log('🔍 Starting sales rep photo lookup...');
    const emailSources = [
      variables.rep_email,
      payload.rep_email, 
      payload.email,
      payload.salesRep?.email,
      payload.representative?.email,
      payload.agent?.email
    ].filter(Boolean);
    
    console.log('📧 Email sources found:', emailSources);
    
    if (emailSources.length > 0) {
      let photoFound = false;
      
      // Try each email source
      for (const repEmail of emailSources) {
        console.log(`🔍 Trying to find photo for: ${repEmail}`);
        
        try {
          const repPhoto = await this.getSalesRepPhoto(tenantId, repEmail);
          if (repPhoto && repPhoto.id) {
            variables.rep_photo = repPhoto.url;
            variables.rep_photo_id = repPhoto.id;
            console.log(`✅ Found sales rep photo for ${repEmail}: ${repPhoto.id}`);
            photoFound = true;
            break;
          }
        } catch (error) {
          console.error(`❌ Error fetching photo for ${repEmail}:`, error.message);
        }
      }
      
      // If no photo found, use fallback
      if (!photoFound) {
        console.log('🔄 No photo found, trying fallback...');
        try {
          const fallbackPhoto = await this.getFallbackPhoto(tenantId);
          if (fallbackPhoto) {
            variables.rep_photo = fallbackPhoto.url;
            variables.rep_photo_id = fallbackPhoto.id;
            if (fallbackPhoto.id) {
              console.log(`📷 Using configured fallback photo: ${fallbackPhoto.id}`);
            } else {
              console.log(`📷 Using default placeholder photo`);
            }
          } else {
            variables.rep_photo = DEFAULT_FALLBACK_PHOTO;
            variables.rep_photo_id = null;
            missing.push('rep_photo');
            console.log(`❌ No fallback photo configured, using placeholder`);
          }
        } catch (error) {
          console.error('❌ Error fetching fallback photo:', error);
          variables.rep_photo = DEFAULT_FALLBACK_PHOTO;
          variables.rep_photo_id = null;
          missing.push('rep_photo');
        }
      }
    } else {
      console.log('❌ No email found in payload for photo lookup');
      missing.push('rep_photo');
    }
    
    // Add system variables
    variables['system.timestamp'] = new Date().toISOString();
    variables['system.date'] = new Date().toLocaleDateString();
    variables['system.time'] = new Date().toLocaleTimeString();
    
    return { variables, missing };
  }

/**
 * Enhanced fallback photo lookup with proper error handling
 * This method was missing from the webhook service
 */
async getFallbackPhoto(tenantId) {
  try {
    console.log(`🔍 Looking for fallback photo for tenant: ${tenantId}`);
    
    if (!this.models.ContentAsset) {
      console.log('❌ ContentAsset model not available');
      return {
        id: null,
        url: DEFAULT_FALLBACK_PHOTO,
        thumbnailUrl: DEFAULT_FALLBACK_PHOTO
      };
    }
    
    const sequelize = this.models.ContentAsset.sequelize;
    
    try {
      const [results] = await sequelize.query(`
        SELECT 
          id, 
          public_url, 
          thumbnail_url, 
          file_path,
          name,
          metadata
        FROM content_assets 
        WHERE 
          tenant_id = $1
          AND processing_status = 'completed'
          AND (
            metadata->>'isFallbackPhoto' = 'true'
            OR metadata->>'is_fallback_photo' = 'true'
            OR metadata->>'fallback' = 'true'
            OR LOWER(name) LIKE '%fallback%'
            OR LOWER(name) LIKE '%default%'
            OR LOWER(name) LIKE '%placeholder%'
          )
        ORDER BY 
          CASE WHEN metadata->>'isFallbackPhoto' = 'true' THEN 1 ELSE 2 END,
          created_at DESC 
        LIMIT 1
      `, {
        bind: [tenantId.toString()],
        type: sequelize.QueryTypes.SELECT
      });

      if (results && results.length > 0) {
        const asset = results[0];
        console.log(`✅ Found fallback photo: ${asset.name} (ID: ${asset.id})`);
        
        let publicUrl = asset.public_url;
        if (!publicUrl && asset.file_path) {
          const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
          const fileName = path.basename(asset.file_path);
          publicUrl = `${baseUrl}/uploads/content/assets/${fileName}`;
          
          try {
            await sequelize.query(`
              UPDATE content_assets 
              SET public_url = $1 
              WHERE id = $2
            `, {
              bind: [publicUrl, asset.id]
            });
            console.log(`🔗 Generated and saved public URL: ${publicUrl}`);
          } catch (updateError) {
            console.warn('⚠️ Could not update fallback photo URL in database:', updateError.message);
          }
        }

        return {
          id: asset.id,
          url: publicUrl,
          thumbnailUrl: asset.thumbnail_url
        };
      }
    } catch (queryError) {
      console.warn('⚠️ Fallback photo query failed:', queryError.message);
    }

    // Use built-in placeholder when no fallback asset exists
    console.log(`📷 No fallback photo configured for tenant ${tenantId}, using default placeholder`);
    return {
      id: null,
      url: DEFAULT_FALLBACK_PHOTO,
      thumbnailUrl: DEFAULT_FALLBACK_PHOTO
    };
    
  } catch (error) {
    console.error('❌ Error fetching fallback photo:', error.message);
    
    // Always return default placeholder on error
    return {
      id: null,
      url: DEFAULT_FALLBACK_PHOTO,
      thumbnailUrl: DEFAULT_FALLBACK_PHOTO
    };
  }
}


/**
   * Enhanced sales rep photo lookup with proper error handling
   * SIMPLIFIED VERSION - Focuses on the core issue
   */
  async getSalesRepPhoto(tenantId, email) {
    const normalizedEmail = email.toLowerCase().trim();
    try {
      console.log(`🔍 Looking for sales rep photo for: ${normalizedEmail}`);
      console.log(`🏢 Tenant ID: ${tenantId} (type: ${typeof tenantId})`);
      
      if (!this.models.ContentAsset) {
        console.log('❌ ContentAsset model not available');
        return null;
      }
      
      const sequelize = this.models.ContentAsset.sequelize;
      
      // First, let's use Sequelize ORM to get all assets for this tenant
      console.log('🔍 Step 1: Getting all assets using Sequelize ORM...');
      
      try {
        const allAssets = await this.models.ContentAsset.findAll({
          where: {
            tenantId: tenantId.toString()
          },
          order: [['createdAt', 'DESC']],
          limit: 10
        });
        
        console.log(`📊 Found ${allAssets.length} assets for tenant ${tenantId}`);
        
        if (allAssets.length > 0) {
          console.log('📋 All assets for this tenant:');
          allAssets.forEach((asset, index) => {
            console.log(`  ${index + 1}. "${asset.name}" (ID: ${asset.id})`);
            console.log(`     Categories: ${JSON.stringify(asset.categories)}`);
            console.log(`     Status: ${asset.processingStatus}`);
            console.log(`     Created: ${asset.createdAt}`);
            console.log(`     Public URL: ${asset.publicUrl}`);
            console.log(`     File Path: ${asset.filePath}`);
            console.log(`     Metadata: ${JSON.stringify(asset.metadata, null, 2)}`);
            console.log(`     ----`);
          });
          
          // Now search for matching email
          console.log(`🔍 Step 2: Searching for email match: ${normalizedEmail}`);
          
          const matchingAssets = allAssets.filter(asset => {
            const metadata = asset.metadata || {};
            const repEmail = metadata.repEmail?.toLowerCase();
            const rep_email = metadata.rep_email?.toLowerCase();
            const email = metadata.email?.toLowerCase();
            const salesRepEmail = metadata.salesRepEmail?.toLowerCase();
            
            const hasMatch = (
              repEmail === normalizedEmail ||
              rep_email === normalizedEmail ||
              email === normalizedEmail ||
              salesRepEmail === normalizedEmail
            );
            
            if (hasMatch) {
              console.log(`✅ Found email match in asset: ${asset.name}`);
              console.log(`   Matched on: repEmail=${repEmail}, rep_email=${rep_email}, email=${email}, salesRepEmail=${salesRepEmail}`);
            }
            
            return hasMatch;
          });
          
          if (matchingAssets.length > 0) {
            console.log(`🎯 Found ${matchingAssets.length} assets with matching email`);
            
            // Get the first completed asset, or the most recent
            const bestAsset = matchingAssets.find(a => a.processingStatus === 'completed') || matchingAssets[0];
            
            console.log(`🎯 Using asset: ${bestAsset.name} (Status: ${bestAsset.processingStatus})`);
            
            // Check if it has sales rep categories
            const categories = bestAsset.categories || [];
            const hasSalesRepCategory = categories.some(cat => 
              cat.toLowerCase().includes('sales') || 
              cat.toLowerCase().includes('rep')
            );
            
            if (!hasSalesRepCategory) {
              console.log(`⚠️ Asset found but missing sales rep categories. Categories: ${JSON.stringify(categories)}`);
              console.log(`💡 The asset exists but might not be categorized as a sales rep photo`);
            }
            
            let publicUrl = bestAsset.publicUrl;
            
            if (!publicUrl && bestAsset.filePath) {
              const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
              const fileName = path.basename(bestAsset.filePath);
              publicUrl = `${baseUrl}/uploads/content/assets/${fileName}`;
              
              console.log(`🔗 Generated public URL from file path: ${publicUrl}`);
              
              // Update the public URL
              try {
                await bestAsset.update({ publicUrl });
                console.log(`✅ Saved public URL to database`);
              } catch (updateError) {
                console.warn('⚠️ Could not update public URL:', updateError.message);
              }
            }

            return {
              id: bestAsset.id,
              url: publicUrl,
              thumbnailUrl: bestAsset.thumbnailUrl
            };
          } else {
            console.log(`❌ No assets found with email: ${normalizedEmail}`);
            
            console.log('🔍 Step 3: Checking what emails are actually stored...');
            allAssets.forEach(asset => {
              const metadata = asset.metadata || {};
              const emails = [
                metadata.repEmail,
                metadata.rep_email, 
                metadata.email,
                metadata.salesRepEmail
              ].filter(Boolean);
              
              if (emails.length > 0) {
                console.log(`  📧 Asset "${asset.name}" has emails: ${emails.join(', ')}`);
              } else {
                console.log(`  📧 Asset "${asset.name}" has NO email metadata`);
              }
            });
          }
          
          // Also check for sales rep categories
          console.log('🔍 Step 4: Checking for any assets with sales rep categories...');
          
          const salesRepAssets = allAssets.filter(asset => {
            const categories = asset.categories || [];
            return categories.some(cat => 
              cat.toLowerCase().includes('sales') || 
              cat.toLowerCase().includes('rep')
            );
          });
          
          if (salesRepAssets.length > 0) {
            console.log(`📋 Found ${salesRepAssets.length} assets with sales rep categories:`);
            salesRepAssets.forEach(asset => {
              console.log(`  - ${asset.name} (${asset.id})`);
              console.log(`    Categories: ${JSON.stringify(asset.categories)}`);
              console.log(`    Metadata: ${JSON.stringify(asset.metadata)}`);
            });
          } else {
            console.log('❌ No assets found with sales rep categories');
          }
        } else {
          console.log('❌ No assets found for this tenant');
        }
        
      } catch (ormError) {
        console.error('❌ Error using Sequelize ORM:', ormError.message);
        
        // Fallback to raw SQL
        console.log('🔄 Falling back to raw SQL query...');
        
        const results = await sequelize.query(`
          SELECT 
            id, 
            name,
            categories,
            metadata,
            processing_status,
            created_at,
            public_url,
            file_path
          FROM content_assets 
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT 10;
        `, {
          bind: [tenantId.toString()],
          type: sequelize.QueryTypes.SELECT
        });
        
        console.log('📋 Raw SQL results:', results);
      }
      
      console.log(`❌ No matching sales rep photo found for: ${normalizedEmail}`);
      return null;
      
    } catch (error) {
      console.error('❌ Error fetching sales rep photo:', error.message);
      console.error('📋 Full error stack:', error.stack);
      return null;
    }
  }


  /**
   * Duplicate a system project for the specified tenant
   */
  async duplicateProjectForTenant(baseProjectId, tenantId, newName, userId = 1) {
    if (!this.contentService) {
      throw new Error('Content service not available');
    }

    const baseProject = await this.contentService.getProjectWithElements(
      baseProjectId,
      'system'
    );

    if (!baseProject) {
      throw new Error('Base project not found');
    }

    const project = await this.contentService.models.ContentProject.create({
      tenantId,
      name: newName,
      description: `Copy of ${baseProject.name}`,
      canvasSize: baseProject.canvasSize,
      responsiveBreakpoints: baseProject.responsiveBreakpoints,
      canvasBackground: baseProject.canvasBackground,
      projectData: baseProject.projectData,
      variables: baseProject.variables,
      globalStyles: baseProject.globalStyles,
      interactions: baseProject.interactions,
      status: 'draft',
      createdBy: userId,
      lastEditedBy: userId,
      tags: baseProject.tags
    });

    if (baseProject.elements && baseProject.elements.length > 0) {
      for (const element of baseProject.elements) {
        await this.contentService.models.ContentElement.create({
          projectId: project.id,
          elementType: element.elementType,
          position: element.position,
          size: element.size,
          rotation: element.rotation,
          scale: element.scale,
          skew: element.skew,
          opacity: element.opacity,
          properties: element.properties,
          styles: element.styles,
          responsiveStyles: element.responsiveStyles,
          animations: element.animations,
          interactions: element.interactions,
          variables: element.variables,
          conditions: element.conditions,
          constraints: element.constraints,
          isLocked: element.isLocked,
          isVisible: element.isVisible,
          isInteractive: element.isInteractive,
          layerOrder: element.layerOrder,
          groupId: element.groupId,
          parentId: element.parentId,
          assetId: element.assetId,
          linkedElements: element.linkedElements,
          customCSS: element.customCSS,
          customJS: element.customJS
        });
      }
    }

    return project;
  }

  /**
   * Inject variables into content project elements (ENHANCED FOR IMAGES)
   */
  async injectVariablesIntoProject(projectId, variables, tenantId = null) {
    try {
      // Get project with elements
      const project = await this.contentService.getProjectWithElements(
        projectId,
        tenantId // Pass through tenant for proper lookup
      );
      
      if (!project || !project.elements) {
        return;
      }

      // Update each element with variable interpolation
      for (const element of project.elements) {
        const updatedProperties = {};
        let hasChanges = false;
        
        // Check properties for variable placeholders
        if (element.properties) {
          for (const [key, value] of Object.entries(element.properties)) {
            if (typeof value === 'string' && value.includes('{')) {
              updatedProperties[key] = this.interpolateVariables(value, variables);
              hasChanges = true;
            }
          }

          // Special handling for image or sales rep photo elements
          if ((element.elementType === 'image' || element.elementType === 'sales_rep_photo') && element.properties.src) {
            // Check if src contains a variable placeholder for photo
            if (element.properties.src.includes('{rep_photo}') && variables.rep_photo) {
              updatedProperties.src = variables.rep_photo;
              hasChanges = true;
            } else if (element.properties.src.includes('{rep_photo_id}') && variables.rep_photo_id) {
              // Link to asset ID
              updatedProperties.assetId = variables.rep_photo_id;
              hasChanges = true;
            }
          }
        }
        
        // Update element if changes were made
        if (hasChanges) {
          await element.update({
            properties: {
              ...element.properties,
              ...updatedProperties
            }
          });
        }
      }
      
      console.log('✅ Variables injected into project elements');
      
    } catch (error) {
      console.error('Error injecting variables:', error);
      throw error;
    }
  }

  /**
   * Check announcement trigger conditions
   */
  async checkAnnouncementTriggerConditions(triggerConditions, payload) {
    // Time restrictions
    if (triggerConditions.timeRestrictions?.enabled) {
      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5); // HH:MM format
      const currentDay = now.getDay() || 7; // Sunday = 7 instead of 0
      
      const { startTime, endTime, daysOfWeek } = triggerConditions.timeRestrictions;
      
      // Check day of week
      if (daysOfWeek && daysOfWeek.length > 0 && !daysOfWeek.includes(currentDay)) {
        console.log(`⏰ Outside allowed days: ${currentDay} not in ${daysOfWeek}`);
        return false;
      }
      
      // Check time window
      if (startTime && endTime) {
        if (currentTime < startTime || currentTime > endTime) {
          console.log(`⏰ Outside time window: ${currentTime} not between ${startTime}-${endTime}`);
          return false;
        }
      }
    }

    // Rate limiting
    if (triggerConditions.rateLimiting?.enabled) {
      const recentAnnouncements = await this.models.AnnouncementMetric.count({
        where: {
          webhookEndpointId: payload.webhookEndpointId,
          announcementStartTime: {
            [Op.gte]: new Date(Date.now() - triggerConditions.rateLimiting.minimumInterval * 1000)
          }
        }
      });
      
      if (recentAnnouncements > 0) {
        console.log(`⏱️ Rate limit: Last announcement was too recent`);
        return false;
      }
    }

    // Payload conditions
    if (triggerConditions.payloadConditions?.enabled) {
      for (const condition of triggerConditions.payloadConditions.conditions) {
        const fieldValue = this.getNestedValue(payload, condition.field);
        if (!this.evaluateCondition(fieldValue, condition.operator, condition.value)) {
          console.log(`❌ Payload condition failed: ${condition.field} ${condition.operator} ${condition.value}`);
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Extract variables from webhook payload for announcement
   */
  extractAnnouncementVariables(contentConfig, payload) {
    const variables = {};
    const missing = [];
    const { variableMapping, defaultValues } = contentConfig;
    
    // Extract mapped variables
    for (const [variableName, payloadPath] of Object.entries(variableMapping || {})) {
      let value = this.getNestedValue(payload, payloadPath);
      
      if (value === null || value === undefined || value === '') {
        // Use default value if available
        if (defaultValues && defaultValues[variableName] !== undefined) {
          value = defaultValues[variableName];
        } else {
          missing.push(variableName);
          value = ''; // Set empty string for missing variables
        }
      }
      
      variables[variableName] = value;
    }
    
    // Add system variables
    variables['system.timestamp'] = new Date().toISOString();
    variables['system.date'] = new Date().toLocaleDateString();
    variables['system.time'] = new Date().toLocaleTimeString();
    
    return { variables, missing };
  }

  /**
   * Interpolate variables in a string
   */
  interpolateVariables(template, variables) {
    return template.replace(/{([^}]+)}/g, (match, variableName) => {
      const value = variables[variableName];
      return value !== undefined ? value : match;
    });
  }

  /**
 * Get target displays for announcement based on selection criteria
 */
async getAnnouncementTargetDisplays(tenantId, displaySelection, payload) {
  try {
    console.log('🔍 Getting target displays for announcement...', {
      mode: displaySelection.mode,
      tenantId
    });

    if (!this.optisignsService) {
      console.warn('⚠️ OptiSigns service not available');
      return [];
    }

    let displays = [];

    switch (displaySelection.mode) {
      case 'all':
        // Get all active displays for tenant
        displays = await this.models.OptisignsDisplay?.findAll({
          where: {
            tenantId: tenantId,
            isActive: true
          }
        }) || [];
        break;

      case 'specific':
        // Get specific displays by IDs
        if (displaySelection.displayIds && displaySelection.displayIds.length > 0) {
          displays = await this.models.OptisignsDisplay?.findAll({
            where: {
              id: displaySelection.displayIds,
              tenantId: tenantId,
              isActive: true
            }
          }) || [];
        }
        break;

      case 'group':
        // Get displays by group/tag
        if (displaySelection.displayGroups && displaySelection.displayGroups.length > 0) {
          displays = await this.models.OptisignsDisplay?.findAll({
            where: {
              tenantId: tenantId,
              isActive: true,
              tags: {
                [this.models.Sequelize.Op.overlap]: displaySelection.displayGroups
              }
            }
          }) || [];
        }
        break;

      case 'conditional':
        // Get displays based on conditional logic (payload-based)
        displays = await this.getConditionalDisplays(
          tenantId, 
          displaySelection.conditionalSelection, 
          payload
        );
        break;

      default:
        console.warn(`⚠️ Unknown display selection mode: ${displaySelection.mode}`);
        displays = [];
    }

    console.log(`📊 Found ${displays.length} target displays`);
    return displays;

  } catch (error) {
    console.error('❌ Error getting target displays:', error);
    return [];
  }
}

/**
 * Get displays based on conditional selection criteria
 */
async getConditionalDisplays(tenantId, conditionalSelection, payload) {
  try {
    if (!conditionalSelection.enabled || !conditionalSelection.conditions) {
      return [];
    }

    // Start with all active displays
    let displays = await this.models.OptisignsDisplay?.findAll({
      where: {
        tenantId: tenantId,
        isActive: true
      }
    }) || [];

    // Filter displays based on conditions
    for (const condition of conditionalSelection.conditions) {
      const payloadValue = this.getNestedValue(payload, condition.field);
      
      displays = displays.filter(display => {
        // Check if display matches the condition
        // This could be extended to check display metadata, location, etc.
        const displayValue = this.getNestedValue(display.metadata || {}, condition.field);
        return this.evaluateCondition(displayValue || payloadValue, condition.operator, condition.value);
      });
    }

    return displays;

  } catch (error) {
    console.error('❌ Error in conditional display selection:', error);
    return [];
  }
}


/**
 * Check announcement trigger conditions
 */
async checkAnnouncementTriggerConditions(announcementConfig, payload, tenantId) {
  try {
    const triggerConditions = announcementConfig.advanced?.triggerConditions;
    
    if (!triggerConditions?.enabled) {
      console.log('✅ Trigger conditions disabled, allowing announcement');
      return true;
    }

    console.log('🔍 Checking announcement trigger conditions...');

    // Time-based restrictions
    if (triggerConditions.timeRestrictions?.enabled) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

      const allowedHours = triggerConditions.timeRestrictions.allowedHours;
      const allowedDays = triggerConditions.timeRestrictions.allowedDays || [0,1,2,3,4,5,6];

      if (allowedHours && (currentHour < allowedHours.start || currentHour >= allowedHours.end)) {
        console.log(`⏰ Time restriction: Current hour ${currentHour} not in allowed range ${allowedHours.start}-${allowedHours.end}`);
        return false;
      }

      if (!allowedDays.includes(currentDay)) {
        console.log(`📅 Day restriction: Current day ${currentDay} not in allowed days ${allowedDays}`);
        return false;
      }
    }

    // Rate limiting
    if (triggerConditions.rateLimiting?.enabled) {
      const rateLimiting = triggerConditions.rateLimiting;
      const now = new Date();
      
      // Check recent announcements
      const recentAnnouncements = await this.models.AnnouncementMetric?.count({
        where: {
          tenantId: tenantId,
          announcementStartTime: {
            [this.models.Sequelize.Op.gte]: new Date(now.getTime() - (rateLimiting.cooldownMinutes || 5) * 60 * 1000)
          }
        }
      }) || 0;

      if (recentAnnouncements > 0) {
        console.log(`⏱️ Rate limit: Last announcement was too recent`);
        return false;
      }
    }

    // Payload conditions
    if (triggerConditions.payloadConditions?.enabled) {
      for (const condition of triggerConditions.payloadConditions.conditions) {
        const fieldValue = this.getNestedValue(payload, condition.field);
        if (!this.evaluateCondition(fieldValue, condition.operator, condition.value)) {
          console.log(`❌ Payload condition failed: ${condition.field} ${condition.operator} ${condition.value}`);
          return false;
        }
      }
    }

    console.log('✅ All trigger conditions passed');
    return true;

  } catch (error) {
    console.error('❌ Error checking trigger conditions:', error);
    // Default to allowing announcement if check fails
    return true;
  }
}

/**
 * Evaluate a condition (used for trigger conditions and display selection)
 */
evaluateCondition(value, operator, expectedValue) {
  switch (operator) {
    case 'equals':
      return value == expectedValue;
    case 'not_equals':
      return value != expectedValue;
    case 'contains':
      return String(value || '').toLowerCase().includes(String(expectedValue || '').toLowerCase());
    case 'not_contains':
      return !String(value || '').toLowerCase().includes(String(expectedValue || '').toLowerCase());
    case 'starts_with':
      return String(value || '').toLowerCase().startsWith(String(expectedValue || '').toLowerCase());
    case 'ends_with':
      return String(value || '').toLowerCase().endsWith(String(expectedValue || '').toLowerCase());
    case 'greater_than':
      return parseFloat(value) > parseFloat(expectedValue);
    case 'less_than':
      return parseFloat(value) < parseFloat(expectedValue);
    case 'greater_equal':
      return parseFloat(value) >= parseFloat(expectedValue);
    case 'less_equal':
      return parseFloat(value) <= parseFloat(expectedValue);
    case 'exists':
      return value !== null && value !== undefined && value !== '';
    case 'not_exists':
      return value === null || value === undefined || value === '';
    case 'regex':
      try {
        const regex = new RegExp(expectedValue);
        return regex.test(String(value || ''));
      } catch (error) {
        console.warn('Invalid regex pattern:', expectedValue);
        return false;
      }
    case 'in_array':
      const expectedArray = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
      return expectedArray.includes(value);
    case 'not_in_array':
      const notExpectedArray = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
      return !notExpectedArray.includes(value);
    default:
      console.warn(`Unknown operator: ${operator}`);
      return false;
  }
}

  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(obj, path) {
    if (!path || !obj) return null;
    
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return null;
      }
      current = current[part];
    }
    
    return current;
  }

  /**
   * Get webhook events for a specific webhook endpoint
   */
  async getWebhookEvents(webhookEndpointId, tenantId, options = {}) {
    try {
      const { limit = 50, offset = 0, status } = options;
      
      // Verify webhook belongs to tenant
      const webhook = await this.models.WebhookEndpoint.findOne({
        where: {
          id: webhookEndpointId,
          tenantId
        }
      });
      
      if (!webhook) {
        throw new Error('Webhook endpoint not found or access denied');
      }
      
      const query = {
        where: { webhookEndpointId },
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['createdAt', 'DESC']]
      };
      
      if (status) {
        query.where.status = status;
      }
      
      const events = await this.models.WebhookEvent.findAll(query);
      const count = await this.models.WebhookEvent.count({ where: query.where });
      
      return {
        events,
        totalCount: count,
        currentPage: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(count / limit)
      };
    } catch (error) {
      console.error('Error getting webhook events:', error);
      throw error;
    }
  }

  /**
   * Record announcement metrics
   */
  async recordAnnouncementMetrics(metricData) {
    try {
      await this.models.AnnouncementMetric.create(metricData);
    } catch (error) {
      console.error('Error recording announcement metrics:', error);
    }
  }

  /**
   * Test webhook with sample payload
   */
  async testWebhook(webhookId, payload, tenantId) {
    try {
      const webhook = await this.getWebhookEndpoint(webhookId, tenantId);
      
      const testHeaders = {
        'content-type': 'application/json',
        'user-agent': 'Knittt-Webhook-Test/1.0'
      };

      if (webhook.securityToken) {
        testHeaders.authorization = `Bearer ${webhook.securityToken}`;
      }

      // Add required headers if configured
      if (webhook.requiredHeaders) {
        Object.assign(testHeaders, webhook.requiredHeaders);
      }

      const result = await this.processWebhook(
        webhook.endpointKey,
        payload,
        testHeaders,
        '127.0.0.1'
      );

      return {
        success: true,
        message: 'Webhook test completed',
        result
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * MISSING METHOD - Check and resume leads (for scheduled task)
   */
  async checkAndResumeLeads() {
    try {
      console.log('🔄 Checking leads that need to be resumed...');
      
      // Implementation would check for paused leads with resume conditions
      // This is a placeholder implementation
      let resumedCount = 0;
      
      // Check for paused leads that should be resumed based on time or conditions
      if (this.models.Lead) {
        const pausedLeads = await this.models.Lead.findAll({
          where: {
            status: 'paused',
            // Add conditions for leads that should be resumed
          },
          limit: 100
        });
        
        console.log(`📊 Found ${pausedLeads.length} paused leads to check`);
        
        for (const lead of pausedLeads) {
          try {
            // Check resume conditions here
            // For now, just log
            console.log(`🔍 Checking resume conditions for lead ${lead.id}`);
            
            // Implementation would check specific resume triggers
            // and update lead status accordingly
            
          } catch (leadError) {
            console.error(`❌ Error checking resume conditions for lead ${lead.id}:`, leadError);
          }
        }
      }
      
      console.log(`✅ Resume check completed. ${resumedCount} leads resumed.`);
      return resumedCount;
      
    } catch (error) {
      console.error('❌ Error in checkAndResumeLeads:', error);
      return 0;
    }
  }

  /**
   * Database maintenance helper - Fix categories column type issues
   * This can be called during startup to fix common database type mismatches
   */
  async fixCategoriesColumnType() {
    try {
      if (!this.models.ContentAsset) {
        console.log('⚠️ ContentAsset model not available, skipping categories column fix');
        return false;
      }

      const sequelize = this.models.ContentAsset.sequelize;
      
      // Check current column type
      const [columnInfo] = await sequelize.query(`
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns 
        WHERE table_name = 'content_assets' 
        AND column_name = 'categories';
      `, {
        type: sequelize.QueryTypes.SELECT
      });

      if (columnInfo) {
        console.log(`📋 Categories column info:`, columnInfo);
        
        // If it's not already text[], convert it
        if (columnInfo.udt_name !== '_text') {
          console.log('🔧 Converting categories column to text[] type...');
          
          await sequelize.query(`
            ALTER TABLE content_assets
            ALTER COLUMN categories TYPE text[]
            USING categories::varchar[];
          `);
          
          console.log('✅ Categories column converted to text[] successfully');
          return true;
        } else {
          console.log('✅ Categories column is already text[] type');
          return true;
        }
      } else {
        console.log('❌ Categories column not found in content_assets table');
        return false;
      }
      
    } catch (error) {
      console.error('❌ Error fixing categories column type:', error.message);
      
      // Provide helpful SQL commands for manual execution
      if (error.message.includes('permission denied') || error.message.includes('must be owner')) {
        console.log('💡 Run this SQL manually as database owner:');
        console.log('   ALTER TABLE content_assets ALTER COLUMN categories TYPE text[] USING categories::varchar[];');
      }
      
      return false;
    }
  }

  /**
   * Process GO webhook functionality
   */
  async processGoWebhook(webhookEndpoint, payload) {
    try {
      console.log('Processing GO webhook:', webhookEndpoint.name);
      
      const processedLeads = [];
      const createdLeadIds = [];
      const errors = [];
      const actionsExecuted = [];
      
      // Handle single item or array of items
      const dataArray = Array.isArray(payload) ? payload : [payload];
      
      for (const item of dataArray) {
        try {
          // Map payload fields to lead data using field mapping
          const leadData = {};
          
          if (webhookEndpoint.fieldMapping) {
            for (const [targetField, mappingConfig] of Object.entries(webhookEndpoint.fieldMapping)) {
              const value = this.getNestedValue(item, mappingConfig.sourceField) || mappingConfig.defaultValue;
              if (value !== undefined) {
                leadData[targetField] = value;
              }
            }
          }
          
          // Ensure required fields
          if (!leadData.name && !leadData.phone && !leadData.email) {
            errors.push('No valid lead data found in payload item');
            continue;
          }
          
          // Add system fields
          leadData.tenantId = webhookEndpoint.tenantId;
          leadData.source = 'webhook';
          leadData.status = leadData.status || 'new';
          
          // Create the lead
          const lead = await this.models.Lead.create(leadData);
          
          processedLeads.push({
            leadId: lead.id,
            action: 'created',
            name: lead.name,
            phone: lead.phone,
            email: lead.email
          });
          
          createdLeadIds.push(lead.id);
          
          console.log(`Created lead ${lead.id} from webhook: ${lead.name} (${lead.phone})`);
          
          // Handle journey auto-enrollment if configured
          if (webhookEndpoint.autoEnrollJourneyId) {
            await this.handleJourneyAutoEnrollment(lead, webhookEndpoint.autoEnrollJourneyId, webhookEndpoint);
            actionsExecuted.push(`auto_enrolled_journey_${webhookEndpoint.autoEnrollJourneyId}`);
          }
          
        } catch (leadError) {
          console.error('Error processing lead from webhook data:', leadError);
          errors.push(`Lead creation failed: ${leadError.message}`);
        }
      }
      
      return {
        success: errors.length === 0 || processedLeads.length > 0,
        webhookType: 'go',
        processedLeads,
        createdLeadIds,
        errors,
        actionsExecuted,
        validCount: processedLeads.length,
        errorCount: errors.length
      };
      
    } catch (error) {
      console.error('Error processing GO webhook:', error);
      return {
        success: false,
        webhookType: 'go',
        error: error.message,
        processedLeads: [],
        createdLeadIds: [],
        errors: [error.message]
      };
    }
  }

  async processPauseWebhook(webhookEndpoint, payload) {
    try {
      console.log('Processing PAUSE webhook:', webhookEndpoint.name);
      
      const processedLeads = [];
      const affectedLeadIds = [];
      const errors = [];
      const pauseResumeActions = {};
      
      // Find leads based on criteria from payload and webhook config
      const leadSearchCriteria = {};
      
      if (webhookEndpoint.fieldMapping) {
        for (const [targetField, mappingConfig] of Object.entries(webhookEndpoint.fieldMapping)) {
          const value = this.getNestedValue(payload, mappingConfig.sourceField);
          if (value !== undefined) {
            leadSearchCriteria[targetField] = value;
          }
        }
      }
      
      if (Object.keys(leadSearchCriteria).length > 0) {
        leadSearchCriteria.tenantId = webhookEndpoint.tenantId;
        
        const leadsToProcess = await this.models.Lead.findAll({
          where: leadSearchCriteria
        });
        
        for (const lead of leadsToProcess) {
          processedLeads.push({
            leadId: lead.id,
            phone: lead.phone,
            name: lead.name,
            currentStatus: lead.status,
            action: 'would_pause',
            pauseConfig: webhookEndpoint.pauseConfig || {}
          });
          
          affectedLeadIds.push(lead.id);
        }
        
        pauseResumeActions.pausedLeads = processedLeads.length;
        pauseResumeActions.criteria = leadSearchCriteria;
      }
      
      if (processedLeads.length === 0) {
        errors.push('No leads found matching the pause criteria');
      }
      
      return {
        success: true,
        webhookType: 'pause',
        processedLeads,
        affectedLeadIds,
        pauseResumeActions,
        errors,
        validCount: processedLeads.length,
        errorCount: errors.length
      };
      
    } catch (error) {
      console.error('Error processing PAUSE webhook:', error);
      return {
        success: false,
        webhookType: 'pause',
        error: error.message,
        processedLeads: [],
        affectedLeadIds: [],
        errors: [error.message]
      };
    }
  }

  async processStopWebhook(webhookEndpoint, payload) {
    try {
      console.log('Processing STOP webhook:', webhookEndpoint.name);
      
      const processedLeads = [];
      const affectedLeadIds = [];
      const errors = [];
      const stopActions = {};
      
      // Find leads based on criteria from payload and webhook config
      const leadSearchCriteria = {};
      
      if (webhookEndpoint.fieldMapping) {
        for (const [targetField, mappingConfig] of Object.entries(webhookEndpoint.fieldMapping)) {
          const value = this.getNestedValue(payload, mappingConfig.sourceField);
          if (value !== undefined) {
            leadSearchCriteria[targetField] = value;
          }
        }
      }
      
      if (Object.keys(leadSearchCriteria).length > 0) {
        leadSearchCriteria.tenantId = webhookEndpoint.tenantId;
        
        const leadsToProcess = await this.models.Lead.findAll({
          where: leadSearchCriteria
        });
        
        for (const lead of leadsToProcess) {
          processedLeads.push({
            leadId: lead.id,
            phone: lead.phone,
            name: lead.name,
            currentStatus: lead.status,
            action: 'would_stop',
            stopConfig: webhookEndpoint.stopConfig || {}
          });
          
          affectedLeadIds.push(lead.id);
        }
        
        stopActions.stoppedLeads = processedLeads.length;
        stopActions.criteria = leadSearchCriteria;
      }
      
      if (processedLeads.length === 0) {
        errors.push('No leads found matching the stop criteria');
      }
      
      return {
        success: true,
        webhookType: 'stop',
        processedLeads,
        affectedLeadIds,
        stopActions,
        errors,
        validCount: processedLeads.length,
        errorCount: errors.length
      };
      
    } catch (error) {
      console.error('Error processing STOP webhook:', error);
      return {
        success: false,
        webhookType: 'stop',
        error: error.message,
        processedLeads: [],
        affectedLeadIds: [],
        errors: [error.message]
      };
    }
  }

  /**
   * Process scheduled webhook resumes
   */
  async processScheduledResumes() {
    try {
      // Implementation for processing scheduled resumes
      // This would check for paused leads that should be resumed
      console.log('Processing scheduled webhook resumes...');
      return 0; // Return count of processed resumes
    } catch (error) {
      console.error('Error processing scheduled resumes:', error);
      return 0;
    }
  }

  /**
   * Check resume conditions for paused leads
   */
  async checkResumeConditions() {
    try {
      // Implementation for checking resume conditions
      console.log('Checking webhook resume conditions...');
      return 0; // Return count of resumed leads
    } catch (error) {
      console.error('Error checking resume conditions:', error);
      return 0;
    }
  }

  /**
   * Initialize journey service if not already initialized
   */
  async initializeJourneyService() {
    try {
      if (this.journeyService) {
        return;
      }
      
      // Check if journey models are available
      if (!this.models.Journey || !this.models.JourneyStep) {
        console.log('Journey models not available, cannot initialize journey service');
        return;
      }
      
      const JourneyService = require('./journey-service');
      this.journeyService = new JourneyService({
        Journey: this.models.Journey,
        JourneyStep: this.models.JourneyStep,
        LeadJourney: this.models.LeadJourney,
        JourneyExecution: this.models.JourneyExecution,
        Lead: this.models.Lead,
        Tenant: this.models.Tenant,
        CallLog: this.models.CallLog,
        DID: this.models.DID
      });
      
      console.log('Journey service initialized successfully for webhook service');
      
    } catch (error) {
      console.error('Error initializing journey service:', error);
      this.journeyService = null;
    }
  }

  /**
   * Handle journey auto-enrollment
   */
  async handleJourneyAutoEnrollment(lead, journeyId, webhookEndpoint) {
    try {
      if (!this.journeyService) {
        console.log(`Initializing journey service for auto-enrollment of lead ${lead.id}`);
        await this.initializeJourneyService();
      }
      
      if (!this.journeyService) {
        console.error(`Journey service not available for auto-enrolling lead ${lead.id}`);
        return;
      }
      
      const { Op } = require('sequelize');
      
      const journey = await this.models.Journey?.findOne({
        where: {
          id: journeyId,
          tenantId: lead.tenantId,
          isActive: true
        }
      });
      
      if (!journey) {
        console.error(`Journey ${journeyId} not found or inactive for lead ${lead.id} auto-enrollment`);
        return;
      }
      
      const existingEnrollment = await this.models.LeadJourney?.findOne({
        where: {
          leadId: lead.id,
          journeyId: journeyId,
          status: {
            [Op.in]: ['active', 'paused']
          }
        }
      });
      
      if (existingEnrollment) {
        console.log(`Lead ${lead.id} already enrolled in journey ${journeyId}`);
        return;
      }
      
      await this.journeyService.enrollLeadInJourney(lead.id, journeyId, {
        contextData: { 
          enrolledBy: 'webhook_auto',
          webhookEndpointId: webhookEndpoint.id,
          enrolledAt: new Date().toISOString()
        }
      });
      
      console.log(`Successfully auto-enrolled lead ${lead.id} in journey ${journeyId} via webhook`);
      
    } catch (error) {
      console.error(`Error in journey auto-enrollment for lead ${lead.id}:`, error);
    }
  }
}

module.exports = WebhookService;