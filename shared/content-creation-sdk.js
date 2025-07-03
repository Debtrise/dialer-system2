// shared/content-creation-sdk.js
// Content Creation SDK - Replaces content-creation-service.js with enhanced SDK functionality

const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp'); // For image processing
const ffmpeg = require('fluent-ffmpeg'); // For video processing
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfprobePath(ffprobeInstaller.path);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const { Op, Sequelize } = require('sequelize');

class ContentCreationSDK {
  constructor(models, optisignsSDK = null) {
    this.models = models;
    this.optisignsSDK = optisignsSDK;
    this.uploadPath = process.env.CONTENT_UPLOAD_PATH || './uploads/content';
    this.publicPath = process.env.CONTENT_PUBLIC_PATH || '/uploads/content';
    
    // SDK Configuration
    this.config = {
      retryAttempts: 3,
      retryDelay: 1000,
      enableCaching: true,
      cacheTimeout: 300000, // 5 minutes
      enableLogging: true,
      enableBatchOperations: true,
      maxBatchSize: 50
    };
    
    // Initialize cache
    this.cache = new Map();
    
    // Enhanced directory structure
    this.directories = {
      assets: path.join(this.uploadPath, 'assets'),
      exports: path.join(this.uploadPath, 'exports'),
      thumbnails: path.join(this.uploadPath, 'thumbnails'),
      previews: path.join(this.uploadPath, 'previews'),
      streaming: path.join(this.uploadPath, 'streaming'),
      temp: path.join(this.uploadPath, 'temp'),
      optimized: path.join(this.uploadPath, 'optimized')
    };
    
    // Element type categorization
    this.elementCategories = {
      'Text': ['text', 'marquee_text', 'typewriter_text', 'countdown_text', 'gradient_text', 'outline_text', 'shadow_text'],
      'Media': ['image', 'video', 'audio', 'image_carousel', 'image_gallery', 'slideshow', 'video_playlist', 'audio_playlist'],
      'Interactive': ['button', 'slider', 'toggle', 'dropdown', 'tabs', 'accordion', 'modal', 'tooltip', 'hotspot', 'image_map'],
      'Forms': ['input_field', 'textarea', 'checkbox', 'radio_button', 'select_dropdown', 'file_upload', 'date_picker', 'color_picker'],
      'Layout': ['container', 'grid', 'flexbox', 'divider', 'spacer', 'columns', 'section', 'header', 'footer'],
      'Charts': ['chart', 'progress_bar', 'gauge', 'pie_chart', 'line_chart', 'bar_chart', 'area_chart', 'scatter_plot', 'heatmap', 'treemap'],
      'Social': ['social_feed', 'testimonial', 'rating_stars', 'share_buttons', 'social_icons', 'comment_section', 'like_button'],
      'Graphics': ['shape', 'icon', 'logo', 'badge', 'ribbon', 'stamp', 'arrow', 'line', 'border', 'frame'],
      'Effects': ['particles', 'confetti', 'animation', 'transition', 'gradient_overlay', 'mask', 'filter', 'glow', 'shadow'],
      'Advanced': ['qr_code', 'barcode', 'map', 'calendar', 'clock', 'timer', 'weather', 'news_feed', 'live_data']
    };
    
    this.log('Content Creation SDK initialized successfully');
    this.initializeDirectories();
  }

  /**
   * Initialize upload directories
   */
  async initializeDirectories() {
    try {
      for (const [name, dirPath] of Object.entries(this.directories)) {
        await fs.mkdir(dirPath, { recursive: true });
      }
      this.log('Upload directories initialized');
    } catch (error) {
      this.log('Error initializing directories:', error.message, 'error');
    }
  }

  // ===== PROJECT MANAGEMENT =====

  /**
   * Create a new project with enhanced validation
   */
  async createProject(tenantId, projectData) {
    try {
      this.validateTenantId(tenantId);
      this.validateRequired(projectData, ['name']);
      
      const project = await this.models.ContentProject.create({
        tenantId,
        name: projectData.name,
        description: projectData.description || '',
        templateId: projectData.templateId,
        canvasSettings: projectData.canvasSettings || {
          width: 1920,
          height: 1080,
          backgroundColor: '#ffffff',
          backgroundImage: null
        },
        variables: projectData.variables || {},
        metadata: projectData.metadata || {},
        status: 'draft',
        version: 1
      });

      // Initialize with system variables if none provided
      if (!projectData.variables || Object.keys(projectData.variables).length === 0) {
        await this.initializeSystemVariables(tenantId);
      }

      this.log(`Project "${project.name}" created for tenant ${tenantId}`);
      return project;
    } catch (error) {
      this.handleError('createProject', error);
    }
  }

  /**
   * Get project with elements and enhanced caching
   */
  async getProjectWithElements(projectId, tenantId) {
    try {
      const cacheKey = `project_${projectId}_${tenantId}`;
      
      // Check cache first
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.config.cacheTimeout) {
          return cached.data;
        }
        this.cache.delete(cacheKey);
      }

      const project = await this.models.ContentProject.findOne({
        where: { id: projectId, tenantId },
        include: [
          {
            model: this.models.ContentElement,
            as: 'elements',
            order: [['z_index', 'ASC'], ['created_at', 'ASC']]
          },
          {
            model: this.models.ContentTemplate,
            as: 'template',
            required: false
          }
        ]
      });

      if (!project) {
        throw new Error('Project not found');
      }

      // Cache the result
      this.cache.set(cacheKey, {
        data: project,
        timestamp: Date.now()
      });

      return project;
    } catch (error) {
      this.handleError('getProjectWithElements', error);
    }
  }

  /**
   * Update project with validation
   */
  async updateProject(projectId, tenantId, updateData) {
    try {
      const project = await this.models.ContentProject.findOne({
        where: { id: projectId, tenantId }
      });

      if (!project) {
        throw new Error('Project not found');
      }

      // Increment version on significant changes
      if (updateData.canvasSettings || updateData.elements) {
        updateData.version = (project.version || 1) + 1;
      }

      updateData.updatedAt = new Date();

      await project.update(updateData);

      // Clear cache
      this.clearProjectCache(projectId, tenantId);

      this.log(`Project ${projectId} updated for tenant ${tenantId}`);
      return project;
    } catch (error) {
      this.handleError('updateProject', error);
    }
  }

  /**
   * Delete project and cleanup
   */
  async deleteProject(projectId, tenantId) {
    try {
      const project = await this.models.ContentProject.findOne({
        where: { id: projectId, tenantId }
      });

      if (!project) {
        throw new Error('Project not found');
      }

      // Delete associated elements
      await this.models.ContentElement.destroy({
        where: { projectId }
      });

      // Delete project
      await project.destroy();

      // Clear cache
      this.clearProjectCache(projectId, tenantId);

      this.log(`Project ${projectId} deleted for tenant ${tenantId}`);
      return { success: true };
    } catch (error) {
      this.handleError('deleteProject', error);
    }
  }

  // ===== ELEMENT MANAGEMENT =====

  /**
   * Add element to project with enhanced validation
   */
  async addElement(projectId, tenantId, elementData) {
    try {
      const project = await this.getProjectWithElements(projectId, tenantId);
      
      if (!project) {
        throw new Error('Project not found');
      }

      // Validate element type
      this.validateElementType(elementData.type);

      // Set default properties based on element type
      const defaultProps = this.getDefaultElementProperties(elementData.type);
      
      const element = await this.models.ContentElement.create({
        projectId,
        type: elementData.type,
        properties: { ...defaultProps, ...elementData.properties },
        position: elementData.position || { x: 0, y: 0 },
        size: elementData.size || { width: 100, height: 50 },
        style: elementData.style || {},
        zIndex: elementData.zIndex || this.getNextZIndex(project.elements),
        isVisible: elementData.isVisible !== false,
        isLocked: elementData.isLocked || false,
        metadata: elementData.metadata || {}
      });

      // Clear project cache
      this.clearProjectCache(projectId, tenantId);

      this.log(`Element ${element.type} added to project ${projectId}`);
      return element;
    } catch (error) {
      this.handleError('addElement', error);
    }
  }

  /**
   * Update element with validation
   */
  async updateElement(elementId, tenantId, updateData) {
    try {
      const element = await this.models.ContentElement.findOne({
        where: { id: elementId },
        include: [{
          model: this.models.ContentProject,
          as: 'project',
          where: { tenantId }
        }]
      });

      if (!element) {
        throw new Error('Element not found');
      }

      // Validate element type if being changed
      if (updateData.type) {
        this.validateElementType(updateData.type);
      }

      await element.update(updateData);

      // Clear project cache
      this.clearProjectCache(element.projectId, tenantId);

      this.log(`Element ${elementId} updated`);
      return element;
    } catch (error) {
      this.handleError('updateElement', error);
    }
  }

  /**
   * Delete element
   */
  async deleteElement(elementId, tenantId) {
    try {
      const element = await this.models.ContentElement.findOne({
        where: { id: elementId },
        include: [{
          model: this.models.ContentProject,
          as: 'project',
          where: { tenantId }
        }]
      });

      if (!element) {
        throw new Error('Element not found');
      }

      const projectId = element.projectId;
      await element.destroy();

      // Clear project cache
      this.clearProjectCache(projectId, tenantId);

      this.log(`Element ${elementId} deleted`);
      return { success: true };
    } catch (error) {
      this.handleError('deleteElement', error);
    }
  }

  /**
   * Batch update elements
   */
  async batchUpdateElements(projectId, tenantId, elementsData) {
    try {
      if (!this.config.enableBatchOperations) {
        throw new Error('Batch operations are disabled');
      }

      if (elementsData.length > this.config.maxBatchSize) {
        throw new Error(`Batch size exceeds maximum allowed (${this.config.maxBatchSize})`);
      }

      const project = await this.getProjectWithElements(projectId, tenantId);
      if (!project) {
        throw new Error('Project not found');
      }

      const results = [];
      
      for (const elementData of elementsData) {
        try {
          if (elementData.id) {
            // Update existing element
            const element = await this.updateElement(elementData.id, tenantId, elementData);
            results.push({ success: true, element });
          } else {
            // Create new element
            const element = await this.addElement(projectId, tenantId, elementData);
            results.push({ success: true, element });
          }
        } catch (error) {
          results.push({ success: false, error: error.message, data: elementData });
        }
      }

      this.log(`Batch operation completed: ${results.filter(r => r.success).length}/${results.length} successful`);
      return results;
    } catch (error) {
      this.handleError('batchUpdateElements', error);
    }
  }

  // ===== ASSET MANAGEMENT =====

  /**
   * Upload asset with enhanced processing
   */
  async uploadAsset(tenantId, file, metadata = {}) {
    try {
      this.validateTenantId(tenantId);
      
      if (!file) {
        throw new Error('File is required');
      }

      const fileName = `${Date.now()}_${file.originalname}`;
      const filePath = path.join(this.directories.assets, fileName);
      const publicUrl = path.join(this.publicPath, 'assets', fileName).replace(/\\/g, '/');

      // Save file
      await fs.writeFile(filePath, file.buffer);

      // Process file based on type
      const processedData = await this.processAssetFile(file, filePath);

      const asset = await this.models.ContentAsset.create({
        tenantId,
        name: metadata.name || file.originalname,
        fileName,
        filePath,
        publicUrl,
        mimeType: file.mimetype,
        fileSize: file.size,
        category: this.categorizeAsset(file.mimetype),
        tags: metadata.tags || [],
        metadata: {
          ...metadata,
          ...processedData,
          originalName: file.originalname,
          uploadedAt: new Date().toISOString()
        },
        usageCount: 0,
        downloadCount: 0
      });

      this.log(`Asset "${asset.name}" uploaded for tenant ${tenantId}`);
      return asset;
    } catch (error) {
      this.handleError('uploadAsset', error);
    }
  }

  /**
   * Process uploaded asset file
   */
  async processAssetFile(file, filePath) {
    try {
      const processedData = {};

      if (file.mimetype.startsWith('image/')) {
        // Process image
        const metadata = await sharp(file.buffer).metadata();
        processedData.dimensions = {
          width: metadata.width,
          height: metadata.height
        };
        processedData.format = metadata.format;

        // Generate thumbnail
        const thumbnailPath = path.join(this.directories.thumbnails, `thumb_${path.basename(filePath)}`);
        await sharp(file.buffer)
          .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(thumbnailPath);
        
        processedData.thumbnailPath = thumbnailPath;
      } else if (file.mimetype.startsWith('video/')) {
        // Process video (basic metadata)
        processedData.type = 'video';
        // Note: Full video processing would require ffmpeg setup
      }

      return processedData;
    } catch (error) {
      this.log('Error processing asset file:', error.message, 'warn');
      return {};
    }
  }

  /**
   * Get assets with filtering and pagination
   */
  async getAssets(tenantId, options = {}) {
    try {
      const {
        category,
        search,
        tags,
        page = 1,
        limit = 20,
        sortBy = 'created_at'
      } = options;

      const whereClause = { tenantId };

      if (category) {
        whereClause.category = category;
      }

      if (search) {
        whereClause[Op.or] = [
          { name: { [Op.iLike]: `%${search}%` } },
          { fileName: { [Op.iLike]: `%${search}%` } }
        ];
      }

      if (tags && tags.length > 0) {
        whereClause.tags = { [Op.overlap]: tags };
      }

      const orderOptions = {
        name: ['name', 'ASC'],
        created_at: ['created_at', 'DESC'],
        file_size: ['file_size', 'DESC'],
        usage: ['usage_count', 'DESC'],
        downloads: ['download_count', 'DESC']
      };

      const assets = await this.models.ContentAsset.findAll({
        where: whereClause,
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        order: [orderOptions[sortBy] || ['created_at', 'DESC']],
        attributes: { exclude: ['metadata', 'exif_data'] }
      });

      const count = await this.models.ContentAsset.count({ where: whereClause });

      return {
        assets,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / parseInt(limit)),
          totalCount: count
        }
      };
    } catch (error) {
      this.handleError('getAssets', error);
    }
  }

  // ===== TEMPLATE MANAGEMENT =====

  /**
   * Create template from project
   */
  async createTemplate(tenantId, templateData) {
    try {
      this.validateTenantId(tenantId);
      this.validateRequired(templateData, ['name']);

      const template = await this.models.ContentTemplate.create({
        tenantId,
        name: templateData.name,
        description: templateData.description || '',
        category: templateData.category || 'custom',
        canvasSettings: templateData.canvasSettings || {},
        elements: templateData.elements || [],
        variables: templateData.variables || {},
        metadata: templateData.metadata || {},
        isPublic: templateData.isPublic || false,
        tags: templateData.tags || []
      });

      this.log(`Template "${template.name}" created for tenant ${tenantId}`);
      return template;
    } catch (error) {
      this.handleError('createTemplate', error);
    }
  }

  /**
   * Get templates with filtering
   */
  async getTemplates(tenantId, options = {}) {
    try {
      const {
        category,
        isPublic,
        search,
        page = 1,
        limit = 20
      } = options;

      const whereClause = { tenantId };

      if (category) {
        whereClause.category = category;
      }

      if (isPublic !== undefined) {
        whereClause.isPublic = isPublic;
      }

      if (search) {
        whereClause[Op.or] = [
          { name: { [Op.iLike]: `%${search}%` } },
          { description: { [Op.iLike]: `%${search}%` } }
        ];
      }

      const templates = await this.models.ContentTemplate.findAll({
        where: whereClause,
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        order: [['created_at', 'DESC']]
      });

      const count = await this.models.ContentTemplate.count({ where: whereClause });

      return {
        templates,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / parseInt(limit)),
          totalCount: count
        }
      };
    } catch (error) {
      this.handleError('getTemplates', error);
    }
  }

  // ===== VARIABLE MANAGEMENT =====

  /**
   * Create variable with enhanced validation
   */
  async createVariable(tenantId, variableData) {
    try {
      this.validateTenantId(tenantId);
      this.validateRequired(variableData, ['name', 'displayName', 'dataType']);

      const variable = await this.models.ContentVariable.create({
        tenantId,
        name: variableData.name,
        displayName: variableData.displayName,
        description: variableData.description,
        dataType: variableData.dataType,
        dataSource: variableData.dataSource,
        sourceField: variableData.sourceField,
        defaultValue: variableData.defaultValue,
        formatTemplate: variableData.formatTemplate,
        validationRules: variableData.validationRules || {},
        conditionalLogic: variableData.conditionalLogic || {},
        transformations: variableData.transformations || [],
        isRequired: variableData.isRequired || false,
        isGlobal: variableData.isGlobal || false,
        category: variableData.category,
        sortOrder: variableData.sortOrder || 0,
        icon: variableData.icon
      });

      this.log(`Variable "${variable.name}" created for tenant ${tenantId}`);
      return variable;
    } catch (error) {
      this.handleError('createVariable', error);
    }
  }

  /**
   * Get variables with filtering
   */
  async getVariables(tenantId, options = {}) {
    try {
      const { category, dataSource } = options;

      const whereClause = { tenantId };
      if (category) whereClause.category = category;
      if (dataSource) whereClause.dataSource = dataSource;

      const variables = await this.models.ContentVariable.findAll({
        where: whereClause,
        order: [['category', 'ASC'], ['sort_order', 'ASC'], ['display_name', 'ASC']]
      });

      return variables;
    } catch (error) {
      this.handleError('getVariables', error);
    }
  }

  // ===== PREVIEW AND EXPORT =====

  /**
   * Generate preview for project
   */
  async generatePreview(projectId, tenantId, options = {}) {
    try {
      const project = await this.getProjectWithElements(projectId, tenantId);
      
      if (!project) {
        throw new Error('Project not found');
      }

      const previewData = {
        project: {
          id: project.id,
          name: project.name,
          canvasSettings: project.canvasSettings
        },
        elements: project.elements.map(element => ({
          id: element.id,
          type: element.type,
          properties: element.properties,
          position: element.position,
          size: element.size,
          style: element.style,
          zIndex: element.zIndex,
          isVisible: element.isVisible
        })),
        variables: project.variables,
        metadata: {
          generatedAt: new Date().toISOString(),
          version: project.version,
          previewOptions: options
        }
      };

      // Apply variable substitution if requested
      if (options.applyVariables && options.variableValues) {
        previewData.elements = this.applyVariableSubstitution(
          previewData.elements, 
          options.variableValues
        );
      }

      this.log(`Preview generated for project ${projectId}`);
      return previewData;
    } catch (error) {
      this.handleError('generatePreview', error);
    }
  }

  /**
   * Publish to OptiSigns with enhanced integration
   */
  async publishToOptiSigns(projectId, tenantId, displayIds = []) {
    try {
      if (!this.optisignsSDK) {
        throw new Error('OptiSigns integration not available');
      }

      const project = await this.getProjectWithElements(projectId, tenantId);
      if (!project) {
        throw new Error('Project not found');
      }

      // Generate export data
      const exportData = await this.generatePreview(projectId, tenantId, {
        applyVariables: true,
        includeAssets: true
      });
      
      // Convert to OptiSigns format and upload
      const optisignsAsset = await this.convertToOptisignsFormat(exportData);
      
      // Upload to OptiSigns
      const uploadResult = await this.optisignsSDK.uploadAsset(
        tenantId,
        optisignsAsset.data,
        optisignsAsset.name,
        optisignsAsset.type
      );

      this.log(`Project ${projectId} published to OptiSigns as asset ${uploadResult._id}`);
      
      return {
        success: true,
        message: 'Project published to OptiSigns',
        assetId: uploadResult._id,
        displayIds
      };
    } catch (error) {
      this.handleError('publishToOptiSigns', error);
    }
  }

  // ===== UTILITY METHODS =====

  /**
   * Initialize system variables for tenant
   */
  async initializeSystemVariables(tenantId) {
    try {
      const systemVariables = [
        {
          name: 'lead.name',
          displayName: 'Lead Name',
          description: 'Full name of the lead',
          dataType: 'string',
          dataSource: 'lead',
          sourceField: 'name',
          defaultValue: 'Valued Customer',
          category: 'Lead Information',
          isSystemVariable: true,
          sortOrder: 1,
          icon: 'user'
        },
        {
          name: 'lead.email',
          displayName: 'Lead Email',
          description: 'Email address of the lead',
          dataType: 'string',
          dataSource: 'lead',
          sourceField: 'email',
          defaultValue: 'contact@example.com',
          category: 'Lead Information',
          isSystemVariable: true,
          sortOrder: 2,
          icon: 'mail'
        },
        {
          name: 'lead.phone',
          displayName: 'Lead Phone',
          description: 'Phone number of the lead',
          dataType: 'string',
          dataSource: 'lead',
          sourceField: 'phone',
          defaultValue: '(555) 123-4567',
          category: 'Lead Information',
          isSystemVariable: true,
          sortOrder: 3,
          icon: 'phone'
        },
        {
          name: 'current.date',
          displayName: 'Current Date',
          description: 'Current date',
          dataType: 'date',
          dataSource: 'system',
          sourceField: 'current_date',
          defaultValue: new Date().toLocaleDateString(),
          category: 'System',
          isSystemVariable: true,
          sortOrder: 10,
          icon: 'calendar'
        },
        {
          name: 'current.time',
          displayName: 'Current Time',
          description: 'Current time',
          dataType: 'time',
          dataSource: 'system',
          sourceField: 'current_time',
          defaultValue: new Date().toLocaleTimeString(),
          category: 'System',
          isSystemVariable: true,
          sortOrder: 11,
          icon: 'clock'
        }
      ];

      for (const varData of systemVariables) {
        try {
          await this.models.ContentVariable.findOrCreate({
            where: {
              tenantId,
              name: varData.name
            },
            defaults: {
              tenantId,
              ...varData
            }
          });
        } catch (error) {
          this.log(`Error creating system variable ${varData.name}:`, error.message, 'warn');
        }
      }

      this.log(`System variables initialized for tenant ${tenantId}`);
    } catch (error) {
      this.log('Error initializing system variables:', error.message, 'error');
    }
  }

  /**
   * Validate element type
   */
  validateElementType(type) {
    const allTypes = Object.values(this.elementCategories).flat();
    if (!allTypes.includes(type)) {
      throw new Error(`Invalid element type: ${type}`);
    }
  }

  /**
   * Get default properties for element type
   */
  getDefaultElementProperties(type) {
    const defaultProps = {
      text: { content: 'Sample Text', fontSize: 16, fontFamily: 'Arial', color: '#000000' },
      image: { src: '', alt: '', objectFit: 'cover' },
      video: { src: '', controls: true, autoplay: false },
      button: { text: 'Click Me', backgroundColor: '#007bff', color: '#ffffff' },
      shape: { shapeType: 'rectangle', fill: '#cccccc', stroke: '#000000' }
    };
    
    return defaultProps[type] || {};
  }

  /**
   * Get next z-index for elements
   */
  getNextZIndex(elements) {
    if (!elements || elements.length === 0) return 1;
    return Math.max(...elements.map(el => el.zIndex || 0)) + 1;
  }

  /**
   * Categorize asset by MIME type
   */
  categorizeAsset(mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType === 'application/pdf') return 'document';
    return 'other';
  }

  /**
   * Apply variable substitution to elements
   */
  applyVariableSubstitution(elements, variableValues) {
    return elements.map(element => {
      const newElement = { ...element };
      
      // Apply substitution to text content
      if (element.properties.content) {
        newElement.properties = {
          ...element.properties,
          content: this.substituteVariables(element.properties.content, variableValues)
        };
      }
      
      return newElement;
    });
  }

  /**
   * Substitute variables in text
   */
  substituteVariables(text, variables) {
    let result = text;
    
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      result = result.replace(regex, value);
    }
    
    return result;
  }

  /**
   * Convert project to OptiSigns format
   */
  async convertToOptisignsFormat(exportData) {
    // This would convert the project data to a format suitable for OptiSigns
    // For now, return a basic structure
    return {
      data: Buffer.from(JSON.stringify(exportData)),
      name: `project_${exportData.project.id}_${Date.now()}`,
      type: 'application/json'
    };
  }

  /**
   * Clear project cache
   */
  clearProjectCache(projectId, tenantId) {
    const cacheKey = `project_${projectId}_${tenantId}`;
    this.cache.delete(cacheKey);
  }

  /**
   * Validation helpers
   */
  validateTenantId(tenantId) {
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
  }

  validateRequired(data, fields) {
    for (const field of fields) {
      if (!data[field]) {
        throw new Error(`${field} is required`);
      }
    }
  }

  /**
   * Error handling
   */
  handleError(method, error) {
    this.log(`Error in ${method}:`, error.message, 'error');
    throw new Error(`${method} failed: ${error.message}`);
  }

  /**
   * Logging
   */
  log(message, data = null, level = 'info') {
    if (!this.config.enableLogging) return;
    
    const timestamp = new Date().toISOString();
    const prefix = `[Content SDK ${level.toUpperCase()}] ${timestamp}:`;
    
    if (data) {
      console[level](prefix, message, data);
    } else {
      console[level](prefix, message);
    }
  }

  /**
   * Get SDK capabilities
   */
  getCapabilities() {
    return {
      projectManagement: true,
      elementManagement: true,
      assetManagement: true,
      templateManagement: true,
      variableManagement: true,
      previewGeneration: true,
      optisignsIntegration: !!this.optisignsSDK,
      batchOperations: this.config.enableBatchOperations,
      caching: this.config.enableCaching,
      supportedElementTypes: Object.values(this.elementCategories).flat(),
      supportedAssetTypes: ['image/*', 'video/*', 'audio/*', 'application/pdf']
    };
  }
}

module.exports = ContentCreationSDK;