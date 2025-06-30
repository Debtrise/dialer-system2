// shared/webhook-service.js
// Enhanced webhook service with content creation and OptiSigns integration

const crypto = require('crypto');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

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
   * Process announcement webhook with enhanced photo support
   */
  async processAnnouncementWebhook(webhookEndpoint, payload) {
    const processingStartTime = Date.now();
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
      errors: []
    };

    try {
      console.log('🎉 Processing announcement webhook:', webhookEndpoint.name);
      
      // Check if announcement is enabled
      if (!webhookEndpoint.announcementConfig || !webhookEndpoint.announcementConfig.enabled) {
        throw new Error('Announcement configuration is not enabled for this webhook');
      }

      // Check required services
      if (!this.contentService || !this.optisignsService) {
        throw new Error('Content Creator and OptiSigns services are required for announcement webhooks');
      }

      const announcementConfig = webhookEndpoint.announcementConfig;
      
      // Step 1: Check trigger conditions
      if (announcementConfig.advanced?.triggerConditions?.enabled) {
        const conditionsPassed = await this.checkAnnouncementTriggerConditions(announcementConfig.advanced.triggerConditions, payload);
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

        const projectData = {
          name: projectName,
          description: `Automatically generated from webhook: ${webhookEndpoint.name}`,
          templateId: announcementConfig.contentCreator.templateId,
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
        
        announcementMetricData.contentProjectId = contentProject.id;
        console.log('✅ Created content project:', contentProject.id);

        // Inject variables into project elements (including photo)
        await this.injectVariablesIntoProject(
          contentProject.id,
          extractedVariables.variables,
          webhookEndpoint.tenantId
        );
        
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
      const targetDisplays = await this.getAnnouncementTargetDisplays(
        webhookEndpoint.tenantId,
        announcementConfig.optisigns.displaySelection,
        payload
      );
      
      announcementMetricData.displayIds = targetDisplays.map(d => d.id);
      
      // Step 5: Generate and publish content to OptiSigns
      if (targetDisplays.length > 0) {
        try {
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

          console.log('📦 Generated content export:', exportInfo.publicUrl);
          
          // Publish to OptiSigns
          const publishResult = await this.contentService.publishToOptiSigns(
            contentProject.id,
            webhookEndpoint.tenantId,
            targetDisplays.map(d => d.optisignsDisplayId),
            {
              priority: announcementConfig.optisigns.takeover?.priority || 'NORMAL',
              duration: announcementConfig.optisigns.takeover?.duration,
              exportId: contentExportId
            }
          );
          
          announcementMetricData.successfulDisplays = publishResult.successCount || targetDisplays.length;
          console.log('🎯 Published to OptiSigns displays:', publishResult);
          
        } catch (error) {
          console.error('❌ Failed to publish to OptiSigns:', error);
          announcementMetricData.errors.push({
            stage: 'optisigns_publish',
            error: error.message
          });
          announcementMetricData.failedDisplays = targetDisplays.length;
        }
      }

      // Optional video celebration
      if (announcementConfig.videoCelebration?.enabled && extractedVariables.variables.rep_photo) {
        try {
          const videoData = {
            repName: extractedVariables.variables.rep_name,
            repPhotoUrl: extractedVariables.variables.rep_photo,
            dealAmount: extractedVariables.variables.deal_amount,
            companyName: extractedVariables.variables.company_name
          };

          const videoInfo = await this.contentService.generateCelebrationVideo(videoData);
          const videoBuffer = await fs.readFile(videoInfo.filePath);
          const uploaded = await this.optisignsService.uploadFileAsBase64(
            webhookEndpoint.tenantId,
            videoBuffer,
            `celebration_${Date.now()}.mp4`,
            `celebration_${Date.now()}.mp4`,
            { contentType: 'video/mp4' }
          );

          for (const display of targetDisplays) {
            await this.optisignsService.takeoverDevice(
              webhookEndpoint.tenantId,
              display.id,
              'ASSET',
              uploaded.optisignsId,
              {
                duration: announcementConfig.optisigns.takeover?.duration || 30,
                priority: announcementConfig.optisigns.takeover?.priority || 'HIGH'
              }
            );
          }
        } catch (error) {
          console.error('Error publishing celebration video:', error);
        }
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
          variablesInjected: Object.keys(extractedVariables.variables).length,
          processingTime: Date.now() - processingStartTime
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
   * Extract variables from announcement webhook payload WITH PHOTO SUPPORT
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
    
    // Look up sales rep photo if email is available
    if (variables.rep_email || payload.rep_email || payload.email) {
      const repEmail = variables.rep_email || payload.rep_email || payload.email;
      
      try {
        const repPhoto = await this.getSalesRepPhoto(tenantId, repEmail);
        if (repPhoto) {
          variables.rep_photo = repPhoto.url;
          variables.rep_photo_id = repPhoto.id;
          console.log(`✅ Found sales rep photo for ${repEmail}`);
        } else {
          // Use fallback photo
          const fallbackPhoto = await this.getFallbackPhoto(tenantId);
          if (fallbackPhoto) {
            variables.rep_photo = fallbackPhoto.url;
            variables.rep_photo_id = fallbackPhoto.id;
            console.log(`📷 Using fallback photo for ${repEmail}`);
          } else {
            missing.push('rep_photo');
            console.log(`❌ No photo found for ${repEmail} and no fallback configured`);
          }
        }
      } catch (error) {
        console.error('Error fetching sales rep photo:', error);
        missing.push('rep_photo');
      }
    }
    
    // Add system variables
    variables['system.timestamp'] = new Date().toISOString();
    variables['system.date'] = new Date().toLocaleDateString();
    variables['system.time'] = new Date().toLocaleTimeString();
    
    return { variables, missing };
  }

  /**
   * Get sales rep photo from content assets
   */
  async getSalesRepPhoto(tenantId, email) {
    const normalizedEmail = email.toLowerCase();
    try {
      // Search for photo in Sales Reps folder
      const asset = await this.models.ContentAsset.findOne({
          where: {
            tenantId,
            categories: {
              [Op.contains]: ['Sales Reps']
            },
            metadata: {
              [Op.jsonSupersetOf]: { repEmail: normalizedEmail }
            },
            processingStatus: 'completed'
        },
        order: [['createdAt', 'DESC']]
      });

      if (asset) {
        // Ensure the photo has a persistent public URL
        if (!asset.publicUrl && asset.filePath) {
          const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
          const fileName = path.basename(asset.filePath);
          const publicUrl = `${baseUrl}/uploads/content/assets/${fileName}`;
          await asset.update({ publicUrl });
          asset.publicUrl = publicUrl;
        }

        return {
          id: asset.id,
          url: asset.publicUrl || asset.url,
          thumbnailUrl: asset.thumbnailUrl
        };
      }

      return null;
    } catch (error) {
      console.error('Error fetching sales rep photo:', error);
      return null;
    }
  }

  /**
   * Get fallback photo for tenant
   */
  async getFallbackPhoto(tenantId) {
    try {
      // Look for fallback photo in tenant settings or designated asset
      const fallbackAsset = await this.models.ContentAsset.findOne({
          where: {
            tenantId,
            metadata: {
              [Op.jsonSupersetOf]: { isFallbackPhoto: true }
            },
            processingStatus: 'completed'
        }
      });

      if (fallbackAsset) {
        // Ensure fallback photo has a persistent public URL
        if (!fallbackAsset.publicUrl && fallbackAsset.filePath) {
          const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
          const fileName = path.basename(fallbackAsset.filePath);
          const publicUrl = `${baseUrl}/uploads/content/assets/${fileName}`;
          await fallbackAsset.update({ publicUrl });
          fallbackAsset.publicUrl = publicUrl;
        }

        return {
          id: fallbackAsset.id,
          url: fallbackAsset.publicUrl || fallbackAsset.url,
          thumbnailUrl: fallbackAsset.thumbnailUrl
        };
      }

      return null;
    } catch (error) {
      console.error('Error fetching fallback photo:', error);
      return null;
    }
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
   * Get target displays for announcement
   */
  async getAnnouncementTargetDisplays(tenantId, displaySelection, payload) {
    const { mode, displayIds, displayGroups, conditionalRules } = displaySelection;
    
    let targetDisplays = [];
    
    switch (mode) {
      case 'all':
        // Get all active displays
        targetDisplays = await this.models.OptisignsDisplay.findAll({
          where: {
            tenantId: tenantId.toString(),
            isActive: true,
            isOnline: true
          }
        });
        break;
        
      case 'specific':
        // Get specific displays by ID
        if (displayIds && displayIds.length > 0) {
          targetDisplays = await this.models.OptisignsDisplay.findAll({
            where: {
              id: { [Op.in]: displayIds },
              tenantId: tenantId.toString(),
              isActive: true
            }
          });
        }
        break;
        
      case 'group':
        // Get displays by group/location
        if (displayGroups && displayGroups.length > 0) {
          targetDisplays = await this.models.OptisignsDisplay.findAll({
            where: {
              location: { [Op.in]: displayGroups },
              tenantId: tenantId.toString(),
              isActive: true,
              isOnline: true
            }
          });
        }
        break;
        
      case 'conditional':
        // Apply conditional rules based on payload
        if (conditionalRules?.enabled && conditionalRules.conditions) {
          for (const rule of conditionalRules.conditions) {
            const fieldValue = this.getNestedValue(payload, rule.field);
            if (this.evaluateCondition(fieldValue, rule.operator, rule.value)) {
              const displays = await this.models.OptisignsDisplay.findAll({
                where: {
                  id: { [Op.in]: rule.displayIds },
                  tenantId: tenantId.toString(),
                  isActive: true
                }
              });
              targetDisplays.push(...displays);
            }
          }
        }
        break;
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