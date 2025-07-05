// shared/webhook-service.js
// Enhanced webhook service with content creation and OptiSigns integration

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

  /**
   * Process announcement webhook with enhanced photo support and improved OptiSigns error handling
   */
  async processAnnouncementWebhook(webhookEndpoint, payload) {
    const processingStartTime = Date.now();
    const tenantId = webhookEndpoint.tenantId || 
      (typeof webhookEndpoint.get === 'function' ? 
        webhookEndpoint.get('tenantId') : 
        webhookEndpoint.dataValues?.tenantId);

    const announcementMetricData = {
      tenantId: webhookEndpoint.tenantId,
      webhookEndpointId: webhookEndpoint.id,
      announcementStartTime: new Date(processingStartTime),
      contentProjectId: null,
      displayIds: [],
      successfulDisplays: 0,
      failedDisplays: 0,
      variablesInjected: {},
      variablesMissing: [],
      errors: [],
      optisignsErrors: [] // Track specific OptiSigns errors
    };

    try {
      console.log('🎉 Processing announcement webhook:', webhookEndpoint.name);
      
      // Check if announcement is enabled
      if (!webhookEndpoint.announcementConfig || !webhookEndpoint.announcementConfig.enabled) {
        throw new Error('Announcement configuration is not enabled for this webhook');
      }

      // Check required services (OptiSigns is mandatory, content service optional)
      if (!this.optisignsService) {
        throw new Error('OptiSigns service is required for announcement webhooks');
      }

      const announcementConfig = webhookEndpoint.announcementConfig;
      
      // Step 1: Check trigger conditions
      if (announcementConfig.advanced?.triggerConditions?.enabled) {
        const conditionsPassed = await this.checkAnnouncementTriggerConditions(
          announcementConfig.advanced.triggerConditions, 
          payload
        );
        if (!conditionsPassed) {
          console.log('⏸️ Announcement skipped due to trigger conditions');
          return {
            success: true,
            webhookType: 'announcement',
            skipped: true,
            reason: 'Trigger conditions not met',
            announcementActions: {}
          };
        }
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
      
      // Step 3: Create content project
      let contentProject = null;
      let contentExportId = null;
      
      try {
        // Generate project name
        let projectName = announcementConfig.contentCreator.projectSettings?.name || 'Webhook Announcement';
        if (announcementConfig.contentCreator.projectSettings?.addTimestamp) {
          projectName += ` - ${new Date().toISOString()}`;
        } else if (announcementConfig.contentCreator.projectSettings?.customNamePattern) {
          projectName = this.interpolateVariables(
            announcementConfig.contentCreator.projectSettings.customNamePattern,
            extractedVariables.variables
          );
        }

        const baseProjectId = announcementConfig.contentCreator.projectId;

        if (baseProjectId) {
          contentProject = await this.duplicateProjectForTenant(
            baseProjectId,
            webhookEndpoint.tenantId,
            projectName,
            1
          );
        } else {
          const projectData = {
            name: projectName,
            description: `Automatically generated from webhook: ${webhookEndpoint.name}`,
            status: 'active',
            metadata: {
              source: 'webhook_announcement',
              webhookEndpointId: webhookEndpoint.id,
              variables: extractedVariables.variables
            }
          };

          contentProject = await this.contentService.createProject(
            webhookEndpoint.tenantId,
            projectData,
            1 // System user ID
          );
        }
        
        announcementMetricData.contentProjectId = contentProject.id;
        console.log('✅ Created content project:', contentProject.id);

        // Inject variables into project elements (including photo)
        await this.injectVariablesIntoProject(
          contentProject.id,
          extractedVariables.variables,
          webhookEndpoint.tenantId
        );
        
        console.log('✅ Variables injected into project elements');
        
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
      
      // Step 4: Determine target displays with enhanced debugging
      console.log('🔍 Determining target displays for OptiSigns...');
      console.log('📋 Display selection config:', JSON.stringify(announcementConfig.optisigns?.displaySelection, null, 2));
      
      const targetDisplays = await this.getAnnouncementTargetDisplays(
        webhookEndpoint.tenantId,
        announcementConfig.optisigns?.displaySelection || { mode: 'all' },
        payload
      );
      
      console.log(`🎯 Found ${targetDisplays.length} target displays:`, targetDisplays.map(d => ({
        id: d.id,
        name: d.name,
        location: d.location,
        isActive: d.isActive,
        isOnline: d.isOnline,
        optisignsDisplayId: d.optisignsDisplayId,
        uuid: d.uuid
      })));
      
      announcementMetricData.displayIds = targetDisplays.map(d => d.id);
      
      // Step 5: ENHANCED OptiSigns publishing with detailed error handling
      if (targetDisplays.length > 0) {
        try {
          console.log('📦 Starting export generation for OptiSigns...');
          
          // Generate export
          const exportOptions = {
            format: 'html',
            quality: 'high',
            optimizeForDigitalSignage: true
          };
          
          const exportInfo = await this.contentService.generateProjectExport(
            contentProject.id,
            webhookEndpoint.tenantId,
            exportOptions
          );
          contentExportId = exportInfo.exportId;

          console.log('✅ Generated content export successfully');
          console.log('📦 Export info:', {
            exportId: exportInfo.exportId,
            publicUrl: exportInfo.publicUrl,
            format: exportInfo.format
          });
          
          // ENHANCED OptiSigns publishing with better error handling
          const publishResult = await this.publishToOptisignsWithRetry(
            contentProject,
            exportInfo,
            targetDisplays,
            announcementConfig.optisigns,
            webhookEndpoint.tenantId,
            announcementMetricData
          );
          
          announcementMetricData.successfulDisplays = publishResult.successCount;
          announcementMetricData.failedDisplays = publishResult.failedCount;
          announcementMetricData.optisignsErrors = publishResult.errors;
          
          console.log('🎯 OptiSigns publishing completed!');
          console.log('📊 Final Results:', {
            successful: publishResult.successCount,
            failed: publishResult.failedCount,
            total: targetDisplays.length,
            errors: publishResult.errors
          });
          
        } catch (error) {
          console.error('❌ Failed to publish to OptiSigns displays:', error);
          announcementMetricData.failedDisplays = targetDisplays.length;
          announcementMetricData.errors.push({
            stage: 'optisigns_publishing',
            error: error.message,
            stack: error.stack
          });
          announcementMetricData.optisignsErrors.push({
            error: error.message,
            stage: 'export_or_setup'
          });
          console.log('⚠️ Continuing with partial success (content created but not published to displays)');
        }
      } else {
        console.log('⚠️ No target displays found for OptiSigns publishing');
        
        // Enhanced debugging for display selection
        await this.debugDisplaySelection(webhookEndpoint.tenantId, announcementConfig.optisigns?.displaySelection);
        
        announcementMetricData.errors.push({
          stage: 'display_selection',
          error: 'No target displays found'
        });
      }
      
      // Step 6: Record metrics
      announcementMetricData.announcementEndTime = new Date();
      announcementMetricData.processingTime = Date.now() - processingStartTime;
      announcementMetricData.totalDuration = Math.round(
        (announcementMetricData.announcementEndTime -
          announcementMetricData.announcementStartTime) /
          1000
      );
      await this.recordAnnouncementMetrics(announcementMetricData);
      
      return {
        success: true,
        webhookType: 'announcement',
        announcementActions: {
          contentProjectId: contentProject?.id,
          contentExportId,
          targetDisplays: targetDisplays.length,
          successfulDisplays: announcementMetricData.successfulDisplays,
          failedDisplays: announcementMetricData.failedDisplays,
          variablesInjected: Object.keys(extractedVariables.variables).length,
          processingTime: Date.now() - processingStartTime,
          optisignsErrors: announcementMetricData.optisignsErrors
        }
      };
      
    } catch (error) {
      console.error('❌ Announcement webhook processing failed:', error);
      
      // Record failed metrics
      announcementMetricData.errors.push({
        stage: 'general',
        error: error.message
      });
      announcementMetricData.announcementEndTime = new Date();
      announcementMetricData.processingTime = Date.now() - processingStartTime;
      announcementMetricData.totalDuration = Math.round(
        (announcementMetricData.announcementEndTime -
          announcementMetricData.announcementStartTime) /
          1000
      );
      await this.recordAnnouncementMetrics(announcementMetricData);
      
      throw error;
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
   * Enhanced sales rep photo lookup with better debugging and error handling
   */
  async getSalesRepPhoto(tenantId, email) {
    const normalizedEmail = email.toLowerCase().trim();
    try {
      console.log(`🔍 Looking for sales rep photo for: ${normalizedEmail}`);
      
      const sequelize = this.models.ContentAsset.sequelize;
      
      // Enhanced query with multiple email matching strategies and fixed type casting
      const [results] = await sequelize.query(`
        SELECT 
          id, 
          public_url, 
          thumbnail_url, 
          file_path,
          name,
          metadata,
          categories
        FROM content_assets 
        WHERE 
          tenant_id = $1
          AND processing_status = 'completed'
          AND (
            LOWER(metadata->>'repEmail') = $2
            OR LOWER(metadata->>'rep_email') = $2
            OR LOWER(metadata->>'email') = $2
            OR LOWER(metadata->>'salesRepEmail') = $2
          )
          AND (
            categories::varchar[] @> ARRAY['Sales Reps']::varchar[]
            OR categories::varchar[] @> ARRAY['sales_reps']::varchar[]
            OR categories::varchar[] @> ARRAY['sales-reps']::varchar[]
            OR categories::varchar[] @> ARRAY['Sales Rep']::varchar[]
            OR categories::varchar[] @> ARRAY['sales_rep']::varchar[]
            OR categories::varchar[] @> ARRAY['salesrep']::varchar[]
            OR categories::varchar[] @> ARRAY['SalesRep']::varchar[]
          )
        ORDER BY created_at DESC 
        LIMIT 1
      `, {
        bind: [tenantId.toString(), normalizedEmail],
        type: sequelize.QueryTypes.SELECT
      });

      if (results && results.length > 0) {
        const asset = results[0];
        console.log(`✅ Found sales rep photo: ${asset.name} (ID: ${asset.id})`);
        console.log(`📋 Photo metadata:`, asset.metadata);
        console.log(`🏷️ Photo categories:`, asset.categories);
        
        let publicUrl = asset.public_url;
        if (!publicUrl && asset.file_path) {
          const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
          const fileName = path.basename(asset.file_path);
          publicUrl = `${baseUrl}/uploads/content/assets/${fileName}`;
          
          // Update the public_url in database
          try {
            await sequelize.query(`
              UPDATE content_assets 
              SET public_url = $1 
              WHERE id = $2
            `, {
              bind: [publicUrl, asset.id]
            });
            console.log(`🔗 Generated public URL: ${publicUrl}`);
          } catch (updateError) {
            console.warn('⚠️ Could not update public URL in database:', updateError.message);
          }
        }

        return {
          id: asset.id,
          url: publicUrl,
          thumbnailUrl: asset.thumbnail_url
        };
      }

      // Enhanced debugging - show what photos exist with proper error handling
      try {
        const [allPhotos] = await sequelize.query(`
          SELECT 
            id, 
            name,
            metadata->>'repEmail' as rep_email,
            metadata->>'email' as email,
            categories
          FROM content_assets 
          WHERE
            tenant_id = $1
            AND processing_status = 'completed'
            AND (
              categories::varchar[] @> ARRAY['Sales Reps']::varchar[]
              OR categories::varchar[] @> ARRAY['sales_reps']::varchar[]
              OR categories::varchar[] @> ARRAY['sales-reps']::varchar[]
              OR categories::varchar[] @> ARRAY['Sales Rep']::varchar[]
              OR categories::varchar[] @> ARRAY['sales_rep']::varchar[]
            )
          ORDER BY created_at DESC 
          LIMIT 10
        `, {
          bind: [tenantId.toString()],
          type: sequelize.QueryTypes.SELECT
        });

        console.log(`❌ No sales rep photo found for: ${normalizedEmail}`);
        
        if (allPhotos && Array.isArray(allPhotos) && allPhotos.length > 0) {
          console.log(`📋 Available sales rep photos (${allPhotos.length}):`, 
            allPhotos.map(p => ({ 
              id: p.id, 
              name: p.name, 
              repEmail: p.rep_email || p.email,
              categories: p.categories 
            }))
          );
        } else {
          console.log(`📋 No sales rep photos found in database for tenant ${tenantId}`);
        }
      } catch (debugError) {
        console.error('❌ Error in debug photo listing:', debugError.message);
        console.log(`📋 Could not list available photos due to database error`);
      }
      
      return null;
      
    } catch (error) {
      console.error('❌ Error fetching sales rep photo:', error.message);
      
      // If it's a database type error, provide helpful information
      if (error.message.includes('operator does not exist') || error.message.includes('text[] && character varying[]')) {
        console.error('💡 Database type error detected. This may be due to categories column type mismatch.');
        console.error('💡 Consider running: ALTER TABLE content_assets ALTER COLUMN categories TYPE text[];');
      }
      
      return null;
    }
  }

  /**
   * Enhanced fallback photo lookup with proper error handling
   */
  async getFallbackPhoto(tenantId) {
    try {
      console.log(`🔍 Looking for fallback photo for tenant: ${tenantId}`);
      
      const sequelize = this.models.ContentAsset.sequelize;
      
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

      // Use built-in placeholder when no fallback asset exists
      console.log(`📷 No fallback photo configured for tenant ${tenantId}, using default placeholder`);
      return {
        id: null,
        url: DEFAULT_FALLBACK_PHOTO,
        thumbnailUrl: DEFAULT_FALLBACK_PHOTO
      };
      
    } catch (error) {
      console.error('❌ Error fetching fallback photo:', error.message);
      
      // If it's a database error, provide helpful information
      if (error.message.includes('relation') && error.message.includes('does not exist')) {
        console.error('💡 Database table error detected. Make sure content_assets table exists.');
      }
      
      // Always return default placeholder on error
      return {
        id: null,
        url: DEFAULT_FALLBACK_PHOTO,
        thumbnailUrl: DEFAULT_FALLBACK_PHOTO
      };
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
   * Get target displays for announcement with enhanced debugging and fallback logic
   */
  async getAnnouncementTargetDisplays(tenantId, displaySelection, payload) {
    const { mode, displayIds, displayGroups, conditionalRules } = displaySelection;
    
    let targetDisplays = [];
    
    try {
      console.log(`🔍 Display selection mode: ${mode}`);
      
      switch (mode) {
        case 'all':
          // Get all active and online displays
          console.log('🔍 Fetching all active and online displays...');
          targetDisplays = await this.models.OptisignsDisplay.findAll({
            where: {
              tenantId: tenantId.toString(),
              isActive: true,
              isOnline: true
            }
          });
          console.log(`📊 Found ${targetDisplays.length} active & online displays`);
          break;
          
        case 'specific':
          // Get specific displays by ID with enhanced fallback logic
          console.log('🔍 Fetching specific displays by ID:', displayIds);
          if (displayIds && displayIds.length > 0) {
            targetDisplays = await this.models.OptisignsDisplay.findAll({
              where: {
                id: { [Op.in]: displayIds },
                tenantId: tenantId.toString(),
                isActive: true
              }
            });
            console.log(`📊 Found ${targetDisplays.length} specific displays out of ${displayIds.length} requested`);
            
            // If no specific displays found, check if any displays exist and offer fallback
            if (targetDisplays.length === 0) {
              console.log('❌ No specific displays found, checking if any displays exist...');
              
              const allDisplays = await this.models.OptisignsDisplay.findAll({
                where: {
                  tenantId: tenantId.toString(),
                  isActive: true,
                  isOnline: true
                }
              });
              
              if (allDisplays.length > 0) {
                console.log(`💡 Found ${allDisplays.length} other active displays. Consider updating the webhook configuration with valid display IDs.`);
                console.log(`📋 Available display IDs:`, allDisplays.map(d => `${d.name} (${d.id})`));
                
                // Optional: Enable fallback to all displays when specific ones aren't found
                // Uncomment the next two lines to enable this fallback behavior
                // console.log('🔄 Falling back to all active displays...');
                // targetDisplays = allDisplays;
              } else {
                console.log('❌ No active displays found at all');
              }
            }
          } else {
            console.log('❌ No display IDs provided for specific mode');
          }
          break;
          
        case 'group':
          // Get displays by group/location
          console.log('🔍 Fetching displays by location:', displayGroups);
          if (displayGroups && displayGroups.length > 0) {
            targetDisplays = await this.models.OptisignsDisplay.findAll({
              where: {
                location: { [Op.in]: displayGroups },
                tenantId: tenantId.toString(),
                isActive: true,
                isOnline: true
              }
            });
            console.log(`📊 Found ${targetDisplays.length} displays in specified locations`);
            
            // If no displays found in specified locations, show what locations are available
            if (targetDisplays.length === 0) {
              const allDisplays = await this.models.OptisignsDisplay.findAll({
                where: { tenantId: tenantId.toString() }
              });
              const availableLocations = [...new Set(allDisplays.map(d => d.location).filter(Boolean))];
              console.log(`💡 No displays found in specified locations. Available locations:`, availableLocations);
            }
          } else {
            console.log('❌ No display groups provided for group mode');
          }
          break;
          
        case 'conditional':
          // Apply conditional rules based on payload
          console.log('🔍 Applying conditional rules...');
          if (conditionalRules?.enabled && conditionalRules.conditions) {
            for (const rule of conditionalRules.conditions) {
              const fieldValue = this.getNestedValue(payload, rule.field);
              console.log(`🔍 Checking condition: ${rule.field} ${rule.operator} ${rule.value} (payload value: ${fieldValue})`);
              
              if (this.evaluateCondition(fieldValue, rule.operator, rule.value)) {
                console.log(`✅ Condition matched, adding displays:`, rule.displayIds);
                const displays = await this.models.OptisignsDisplay.findAll({
                  where: {
                    id: { [Op.in]: rule.displayIds },
                    tenantId: tenantId.toString(),
                    isActive: true
                  }
                });
                targetDisplays.push(...displays);
              } else {
                console.log(`❌ Condition not matched`);
              }
            }
          } else {
            console.log('❌ No conditional rules configured');
          }
          break;
          
        default:
          console.log(`❌ Unknown display selection mode: ${mode}`);
          // Fallback to all displays for unknown modes
          console.log('🔄 Falling back to all active displays...');
          targetDisplays = await this.models.OptisignsDisplay.findAll({
            where: {
              tenantId: tenantId.toString(),
              isActive: true,
              isOnline: true
            }
          });
      }
    } catch (error) {
      console.error('❌ Error querying displays:', error);
      // If there's a database error, return empty array
      return [];
    }
    
    // Remove duplicates
    const uniqueDisplays = [];
    const seenIds = new Set();
    
    for (const display of targetDisplays) {
      if (!seenIds.has(display.id)) {
        seenIds.add(display.id);
        uniqueDisplays.push(display);
      }
    }
    
    console.log(`🎯 Final target displays after deduplication: ${uniqueDisplays.length}`);
    
    // Enhanced logging when no displays are found
    if (uniqueDisplays.length === 0) {
      console.log('⚠️ No displays targeted. Recommendations:');
      console.log('   1. Check display selection mode and criteria');
      console.log('   2. Verify display IDs exist in database');
      console.log('   3. Ensure displays are active and online');
      console.log('   4. Consider using "all" mode for testing');
    }
    
    return uniqueDisplays;
  }

  /**
   * Restore displays after announcement duration
   */
  async restoreDisplaysAfterAnnouncement(tenantId, takeoverIds) {
    try {
      console.log('🔄 Restoring displays after announcement...');
      
      for (const takeoverId of takeoverIds) {
        try {
          // Find the takeover record
          const takeover = await this.models.OptisignsTakeover.findOne({
            where: {
              id: takeoverId,
              tenantId: tenantId.toString(),
              status: 'ACTIVE'
            }
          });
          
          if (takeover) {
            await this.optisignsService.stopTakeover(
              tenantId,
              takeover.displayId,
              true, // Restore previous content
              'Announcement duration expired'
            );
          }
        } catch (error) {
          console.error(`Failed to restore takeover ${takeoverId}:`, error.message);
        }
      }
      
    } catch (error) {
      console.error('Error restoring displays:', error);
    }
  }

  /**
   * Execute post-announcement actions
   */
  async executePostAnnouncementActions(actions, webhookEndpoint, payload, contentProject) {
    if (!actions || actions.length === 0) {
      return;
    }

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'create_lead':
            // Create a lead from the announcement data
            await this.createLeadFromAnnouncement(action.config, payload, webhookEndpoint);
            break;
            
          case 'send_notification':
            // Send notification about the announcement
            console.log(`📧 Would send notification: ${action.config.message}`);
            break;
            
          case 'log_event':
            // Log custom event
            console.log(`📝 Logging event: ${action.config.eventName}`);
            break;
        }
      } catch (error) {
        console.error(`Post-announcement action failed: ${action.type}`, error);
      }
    }
  }

  /**
   * Create lead from announcement data
   */
  async createLeadFromAnnouncement(config, payload, webhookEndpoint) {
    const leadData = {
      tenantId: webhookEndpoint.tenantId,
      source: 'announcement_webhook',
      status: 'new',
      metadata: {
        announcementPayload: payload,
        webhookEndpointId: webhookEndpoint.id
      }
    };
    
    // Map fields from config
    if (config.fieldMapping) {
      for (const [leadField, payloadPath] of Object.entries(config.fieldMapping)) {
        const value = this.getNestedValue(payload, payloadPath);
        if (value !== undefined) {
          leadData[leadField] = value;
        }
      }
    }
    
    // Only create if we have minimum required data
    if (leadData.name || leadData.phone || leadData.email) {
      await this.models.Lead.create(leadData);
      console.log('✅ Lead created from announcement');
    }
  }

  /**
   * Evaluate a condition
   */
  evaluateCondition(fieldValue, operator, conditionValue) {
    switch (operator) {
      case 'equals':
        return fieldValue == conditionValue;
      case 'not_equals':
        return fieldValue != conditionValue;
      case 'greater_than':
        return Number(fieldValue) > Number(conditionValue);
      case 'less_than':
        return Number(fieldValue) < Number(conditionValue);
      case 'contains':
        return String(fieldValue).includes(String(conditionValue));
      case 'exists':
        return fieldValue !== null && fieldValue !== undefined;
      case 'not_exists':
        return fieldValue === null || fieldValue === undefined;
      default:
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