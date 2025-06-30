const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp'); // For image processing
const ffmpeg = require('fluent-ffmpeg'); // For video processing
const { Op, Sequelize } = require('sequelize');
const axios = require('axios');
const crypto = require('crypto');


class ContentCreationService {
  constructor(models, optisignsModels = null, optisignsService = null) {
    this.models = models;
    this.optisignsModels = optisignsModels;
    this.optisignsService = optisignsService;
    this.uploadPath = process.env.CONTENT_UPLOAD_PATH || './uploads/content';
    this.publicPath = process.env.CONTENT_PUBLIC_PATH || '/uploads/content';
    
    // Initialize OptisignsService if models are provided but service isn't
    if (this.optisignsModels && !this.optisignsService) {
      try {
        const OptisignsService = require('./optisigns-service');
        this.optisignsService = new OptisignsService(this.optisignsModels);
        console.log('✅ OptisignsService initialized in ContentCreationService');
      } catch (error) {
        console.warn('⚠️ Could not initialize OptisignsService:', error.message);
        this.optisignsService = null;
      }
     }
    
    // Enhanced directory structure
    this.directories = {
      assets: path.join(this.uploadPath, 'assets'),
      exports: path.join(this.uploadPath, 'exports'),
      thumbnails: path.join(this.uploadPath, 'thumbnails'),
      previews: path.join(this.uploadPath, 'previews'),
      streaming: path.join(this.uploadPath, 'streaming'),
      temp: path.join(this.uploadPath, 'temp'),
      optimized: path.join(this.uploadPath, 'optimized'),
      downloaded: path.join(this.uploadPath, 'downloaded'), // for downloaded external images
      videos: path.join(this.uploadPath, 'videos'), // generated announcement videos
      salesRepThumbnails: path.join(this.uploadPath, 'sales-rep-thumbnails'),
      salesRepPreviews: path.join(this.uploadPath, 'sales-rep-previews')
    };

    // Ensure all directories exist on initialization
    this.ensureUploadDirectories();
    
    // Element type categorization
    this.elementCategories = {
      'Text': ['text', 'marquee_text', 'typewriter_text', 'countdown_text', 'gradient_text', 'outline_text', 'shadow_text'],
      'Media': ['image', 'standard_photo', 'video', 'audio', 'image_carousel', 'image_gallery', 'slideshow', 'video_playlist', 'audio_playlist'],
      'Interactive': ['button', 'slider', 'toggle', 'dropdown', 'tabs', 'accordion', 'modal', 'tooltip', 'hotspot', 'image_map'],
      'Forms': ['input_field', 'textarea', 'checkbox', 'radio_button', 'select_dropdown', 'file_upload', 'date_picker', 'color_picker'],
      'Layout': ['container', 'grid', 'flexbox', 'divider', 'spacer', 'columns', 'section', 'header', 'footer']
    };

    
    // Video processing settings
    this.videoSettings = {
      thumbnails: {
        count: 10,
        quality: 80,
        width: 320,
        height: 180
      },
      streaming: {
        qualities: ['480p', '720p', '1080p'],
        formats: ['mp4', 'webm']
      },
      compression: {
        high: { bitrate: '2000k', quality: 28 },
        medium: { bitrate: '1000k', quality: 32 },
        low: { bitrate: '500k', quality: 36 }
      }
    }
}
    
  ensureUploadDirectories() {
    try {
      const fs = require('fs');
      for (const [name, dirPath] of Object.entries(this.directories)) {
        fs.mkdirSync(dirPath, { recursive: true }); // ✅ Synchronous
        console.log(`✅ Directory created: ${name} -> ${dirPath}`);
      }
      console.log('✅ All content upload directories created');
    } catch (error) {
      console.error('Error creating upload directories:', error);
    }
  }

/**
 * NEW: Download and store external image immediately
 */
async downloadAndStoreImage(imageUrl, tenantId) {
  try {
    if (!this.isExternalUrl(imageUrl)) {
      return imageUrl; // Already local, return as-is
    }

    console.log(`📥 Downloading external image: ${imageUrl}`);
    
    // Create tenant-specific directory
    const tenantDir = path.join(this.directories.downloaded, tenantId.toString());
    await fs.mkdir(tenantDir, { recursive: true });
    
    // Download the image
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Knittt-Content-Creator/1.0'
      }
    });
    
    // Validate it's an image
    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
      console.warn(`⚠️ Skipping non-image URL: ${imageUrl}`);
      return imageUrl; // Return original URL if not an image
    }
    
    // Generate filename
    const urlHash = crypto.createHash('md5').update(imageUrl).digest('hex');
    const extension = this.getImageExtension(contentType, imageUrl);
    const filename = `img_${urlHash}${extension}`;
    const localPath = path.join(tenantDir, filename);
    
    // Save image locally
    await fs.writeFile(localPath, response.data);
    
    // Generate public URL
    const publicUrl = `${this.publicPath}/downloaded/${tenantId}/${filename}`;
    
    console.log(`✅ Downloaded and stored: ${filename} -> ${publicUrl}`);
    
    return publicUrl;
    
  } catch (error) {
    console.error(`❌ Failed to download image ${imageUrl}:`, error.message);
    return imageUrl; // Return original URL on failure
  }
}

/**
 * NEW: Convert image to base64 data URI
 */
async imageToBase64(imagePath, maxWidth = 1920, maxHeight = 1080) {
  try {
    let imageBuffer;
    
    // Handle different input types
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      // Download if it's a URL
      console.log(`📥 Downloading image for base64 conversion: ${imagePath}`);
      const response = await axios.get(imagePath, {
        responseType: 'arraybuffer',
        timeout: 10000
      });
      imageBuffer = Buffer.from(response.data);
    } else if (imagePath.startsWith('data:')) {
      // Already a data URI, return as-is
      return imagePath;
    } else {
      // Local file path
      const fullPath = imagePath.startsWith('/') ? 
        path.join(process.cwd(), imagePath.substring(1)) : 
        imagePath;
      
      try {
        imageBuffer = await fs.readFile(fullPath);
      } catch (fileError) {
        console.warn(`⚠️ Could not read local file: ${fullPath}`);
        return imagePath; // Return original if can't read
      }
    }
    
    // Optimize image with Sharp
    const optimizedBuffer = await sharp(imageBuffer)
      .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    
    // Convert to base64 data URI
    const base64Data = optimizedBuffer.toString('base64');
    const dataUri = `data:image/jpeg;base64,${base64Data}`;
    
    console.log(`✅ Converted image to base64 (${Math.round(base64Data.length / 1024)}KB)`);
    return dataUri;
    
  } catch (error) {
    console.error(`❌ Failed to convert image to base64: ${imagePath}`, error.message);
    return imagePath; // Return original on failure
  }
}

/**
 * NEW: Process all images in a project and convert to base64
 */
async processProjectImagesForExport(project) {
  try {
    console.log('🖼️ Processing all project images for self-contained export...');
    
    const elements = project.elements || [];
    let processedCount = 0;
    
    for (const element of elements) {
      if (element.elementType === 'image' || element.elementType === 'standard_photo') {
        const imageUrl = element.properties?.imageUrl || 
                        element.properties?.src || 
                        element.properties?.url;
        
        if (imageUrl) {
          console.log(`🔄 Converting image to base64: ${imageUrl}`);
          const base64DataUri = await this.imageToBase64(imageUrl);
          
          // Update the element properties with base64 data
          element.properties.src = base64DataUri;
          element.properties.imageUrl = base64DataUri;
          element.properties.url = base64DataUri;
          
          processedCount++;
        }
      }
      
      // Also check canvas background
      if (project.canvasBackground?.type === 'image' && project.canvasBackground?.url) {
        console.log(`🔄 Converting background image to base64: ${project.canvasBackground.url}`);
        const base64DataUri = await this.imageToBase64(project.canvasBackground.url);
        project.canvasBackground.url = base64DataUri;
      }
    }
    
    console.log(`✅ Processed ${processedCount} images for self-contained export`);
    return project;
    
  } catch (error) {
    console.error('❌ Error processing project images:', error);
    throw error;
  }
}

/**
 * Process all video elements and embed small videos as base64
 */
async processProjectVideosForExport(project, maxSizeMB = 5) {
  try {
    const elements = project.elements || [];
    for (const element of elements) {
      if (element.elementType === 'video') {
        const videoUrl = element.properties?.videoUrl || element.properties?.src || element.properties?.url;
        if (videoUrl) {
          const base64 = await this.videoToBase64(videoUrl, maxSizeMB);
          if (base64) {
            element.properties.src = base64;
            element.properties.videoUrl = base64;
            element.properties.url = base64;
          }
        }
      }
    }
    return project;
  } catch (error) {
    console.error('❌ Error processing project videos:', error);
    return project;
  }
}

async videoToBase64(videoPath, maxSizeMB = 5) {
  try {
    let data;
    if (videoPath.startsWith('http://') || videoPath.startsWith('https://')) {
      const response = await axios.get(videoPath, { responseType: 'arraybuffer', timeout: 15000 });
      data = Buffer.from(response.data);
    } else {
      const fsSync = require('fs');
      if (!fsSync.existsSync(videoPath)) return null;
      data = await fs.readFile(videoPath);
    }
    if (data.length > maxSizeMB * 1024 * 1024) {
      console.warn(`⚠️ Video too large to embed (${(data.length/1024/1024).toFixed(2)}MB)`);
      return null;
    }
    const ext = path.extname(videoPath).replace('.', '') || 'mp4';
    const mime = `video/${ext}`;
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (err) {
    console.warn('⚠️ Failed converting video to base64:', err.message);
    return null;
  }
}

// Helper method to check if URL is external
isExternalUrl(url) {
  if (!url || typeof url !== 'string') return false;
  
  try {
    const parsedUrl = new URL(url);
    const isHttp = parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    
    // Consider it external if it's HTTP/HTTPS and not our own domain
    if (isHttp) {
      const ourDomains = ['localhost', '127.0.0.1', '34.122.156.88', 'app.knittt.com'];
      const isOurDomain = ourDomains.some(domain => parsedUrl.hostname.includes(domain));
      return !isOurDomain;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

// Helper method that might be missing  
getImageExtension(contentType, url) {
  // Try to get extension from content type first
  const typeMap = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg', 
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg'
  };
  
  if (typeMap[contentType]) {
    return typeMap[contentType];
  }
  
  // Fallback to URL extension
  try {
    const urlPath = new URL(url).pathname;
    const extension = path.extname(urlPath);
    return extension || '.jpg'; // Default fallback
  } catch (error) {
    return '.jpg'; // Default fallback
  }
}

    


  // ===== TEMPLATE MANAGEMENT =====

  async getTemplates(tenantId, options = {}) {
    try {
      const {
        category,
        isPublic,
        search,
        sortBy = 'recent',
        page = 1,
        limit = 50
      } = options;

      const whereClause = {
        [Op.or]: [
          { tenantId },
          { isPublic: true }
        ],
        isActive: true
      };

      if (category) whereClause.category = category;
      if (isPublic !== undefined) whereClause.isPublic = isPublic;
      
      if (search) {
        whereClause[Op.or] = [
          { name: { [Op.iLike]: `%${search}%` } },
          { description: { [Op.iLike]: `%${search}%` } },
          { tags: { [Op.overlap]: [search] } }
        ];
      }

      const orderOptions = {
        recent: ['created_at', 'DESC'],
        popular: ['usage_count', 'DESC'],
        rating: ['rating', 'DESC'],
        name: ['name', 'ASC']
      };

      const templates = await this.models.ContentTemplate.findAll({
        where: whereClause,
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        order: [orderOptions[sortBy] || ['created_at', 'DESC']]
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
      console.error('Error getting templates:', error);
      throw new Error(`Failed to get templates: ${error.message}`);
    }
  }

 
  async createTemplate(tenantId, userId, templateData) {
    try {
      // Generate preview if not provided
      let previewImage = templateData.previewImage;
      if (!previewImage && templateData.elements) {
        previewImage = await this.generateTemplatePreview(templateData);
      }

      const template = await this.models.ContentTemplate.create({
        tenantId,
        name: templateData.name,
        description: templateData.description,
        category: templateData.category || 'custom',
        canvasSize: templateData.canvasSize || { width: 1920, height: 1080 },
        responsiveBreakpoints: templateData.responsiveBreakpoints || {
          mobile: { width: 375, height: 667 },
          tablet: { width: 768, height: 1024 },
          desktop: { width: 1920, height: 1080 }
        },
        previewImage,
        templateData: templateData.elements || {},
        variables: templateData.variables || {},
        isPublic: templateData.isPublic || false,
        isFeatured: templateData.isFeatured || false,
        tags: templateData.tags || [],
        difficulty: templateData.difficulty || 'beginner',
        estimatedTime: templateData.estimatedTime || 30,
        createdBy: userId,
        metadata: templateData.metadata || {}
      });

      console.log(`Enhanced template "${template.name}" created for tenant ${tenantId}`);
      return template;
    } catch (error) {
      console.error('Error creating template:', error);
      throw new Error(`Failed to create template: ${error.message}`);
    }
  }


  // ===== PROJECT MANAGEMENT =====

  async getProjects(tenantId, options = {}) {
    try {
      const {
        status,
        search,
        sortBy = 'recent',
        page = 1,
        limit = 50
      } = options;

      const whereClause = { tenantId };

      if (status) whereClause.status = status;
      
      if (search) {
        whereClause[Op.or] = [
          { name: { [Op.iLike]: `%${search}%` } },
          { description: { [Op.iLike]: `%${search}%` } },
          { tags: { [Op.overlap]: [search] } }
        ];
      }

      const orderOptions = {
        recent: ['updated_at', 'DESC'],
        created: ['created_at', 'DESC'],
        name: ['name', 'ASC'],
        status: ['status', 'ASC']
      };

      const projects = await this.models.ContentProject.findAll({
        where: whereClause,
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        order: [orderOptions[sortBy] || ['updated_at', 'DESC']],
        include: [{
          model: this.models.ContentTemplate,
          as: 'template',
          attributes: ['id', 'name', 'category']
        }]
      });

      const count = await this.models.ContentProject.count({ where: whereClause });

      return {
        projects,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / parseInt(limit)),
          totalCount: count
        }
      };
    } catch (error) {
      console.error('Error getting projects:', error);
      throw new Error(`Failed to get projects: ${error.message}`);
    }
  }

  async createProject(tenantId, projectData, userId) {
    try {
      const project = await this.models.ContentProject.create({
        tenantId,
        name: projectData.name,
        description: projectData.description,
        templateId: projectData.templateId || null,
        canvasSize: projectData.canvasSize || { width: 1920, height: 1080 },
        responsiveBreakpoints: projectData.responsiveBreakpoints || {
          mobile: { width: 375, height: 667 },
          tablet: { width: 768, height: 1024 },
          desktop: { width: 1920, height: 1080 }
        },
        canvasBackground: projectData.canvasBackground || { type: 'solid', color: '#ffffff' },
        projectData: projectData.projectData || {},
        variables: projectData.variables || {},
        globalStyles: projectData.globalStyles || {},
        interactions: projectData.interactions || [],
        status: 'draft',
        createdBy: userId,
        lastEditedBy: userId,
        tags: projectData.tags || []
      });

      // If created from template, copy elements
      if (projectData.templateId) {
        const template = await this.getTemplate(projectData.templateId, tenantId);
        if (template && template.templateData) {
          await this.copyTemplateElements(project.id, template.templateData);
        }
      }

      console.log(`Project "${project.name}" created for tenant ${tenantId}`);
      return project;
    } catch (error) {
      console.error('Error creating project:', error);
      throw new Error(`Failed to create project: ${error.message}`);
    }
  }

  async getProjectWithElements(projectId, tenantId) {
    try {
      const project = await this.models.ContentProject.findOne({
        where: { id: projectId, tenantId },
        include: [{
          model: this.models.ContentElement,
          as: 'elements',
          order: [['layer_order', 'ASC']],
          include: [{
            model: this.models.ContentAsset,
            as: 'asset'
          }]
        }]
      });

      if (!project) {
        throw new Error('Project not found');
      }

      return project;
    } catch (error) {
      console.error('Error getting project with elements:', error);
      throw new Error(`Failed to get project: ${error.message}`);
    }
  }

  async updateProject(projectId, tenantId, userId, updateData) {
    try {
      const project = await this.models.ContentProject.findOne({
        where: { id: projectId, tenantId }
      });

      if (!project) {
        throw new Error('Project not found');
      }

      // Update project
      await project.update({
        ...updateData,
        lastEditedBy: userId,
        version: project.version + 1
      });

      // Create version snapshot
      await project.createVersion(userId, 'Project updated', false);

      console.log(`Project "${project.name}" updated`);
      return project;
    } catch (error) {
      console.error('Error updating project:', error);
      throw new Error(`Failed to update project: ${error.message}`);
    }
  }

  async deleteProject(projectId, tenantId) {
    try {
      const project = await this.models.ContentProject.findOne({
        where: { id: projectId, tenantId }
      });

      if (!project) {
        throw new Error('Project not found');
      }

      await project.destroy();

      console.log(`Project "${project.name}" deleted`);
      return { success: true };
    } catch (error) {
      console.error('Error deleting project:', error);
      throw new Error(`Failed to delete project: ${error.message}`);
    }
  }
async getTemplate(templateId, tenantId) {
    try {
      const template = await this.models.ContentTemplate.findOne({
        where: {
          id: templateId,
          [Op.or]: [
            { tenantId },
            { isPublic: true }
          ],
          isActive: true
        }
      });

      if (!template) {
        throw new Error('Template not found');
      }

      return template;
    } catch (error) {
      console.error('Error getting template:', error);
      throw new Error(`Failed to get template: ${error.message}`);
    }
  }



  async copyTemplateElements(projectId, templateData) {
    try {
      if (!templateData || typeof templateData !== 'object') return;

      for (const [key, elementData] of Object.entries(templateData)) {
        if (elementData && elementData.elementType) {
          await this.models.ContentElement.create({
            projectId,
            ...elementData
          });
        }
      }
    } catch (error) {
      console.error('Error copying template elements:', error);
    }
  }

  // ===== ELEMENT MANAGEMENT =====

  async createElement(projectId, tenantId, elementData) {
    try {
      // Verify project exists and belongs to tenant
      const project = await this.models.ContentProject.findOne({
        where: { id: projectId, tenantId }
      });

      if (!project) {
        throw new Error('Project not found');
      }

      // NEW: Download external images immediately when creating image elements
      if ((elementData.elementType === 'image' || elementData.elementType === 'standard_photo') && elementData.properties) {
        const imageUrl = elementData.properties.imageUrl || 
                        elementData.properties.src || 
                        elementData.properties.url;
        
        if (imageUrl && this.isExternalUrl(imageUrl)) {
          console.log('📥 Downloading external image for new element...');
          const localUrl = await this.downloadAndStoreImage(imageUrl, tenantId);
          
          // Update element properties with local URL
          elementData.properties.imageUrl = localUrl;
          elementData.properties.src = localUrl;
          elementData.properties.url = localUrl;
          
          console.log(`✅ Image downloaded and stored locally: ${localUrl}`);
        }
      }

      // Get the highest layer order
      const maxLayerOrder = await this.models.ContentElement.max('layerOrder', {
        where: { projectId }
      }) || 0;

      const element = await this.models.ContentElement.create({
        projectId,
        elementType: elementData.elementType,
        position: elementData.position || { x: 0, y: 0, z: 0 },
        size: elementData.size || { width: 100, height: 100 },
        rotation: elementData.rotation || 0,
        scale: elementData.scale || { x: 1, y: 1 },
        skew: elementData.skew || { x: 0, y: 0 },
        opacity: elementData.opacity !== undefined ? elementData.opacity : 1,
        properties: elementData.properties || {},
        styles: elementData.styles || {},
        responsiveStyles: elementData.responsiveStyles || {},
        animations: elementData.animations || [],
        interactions: elementData.interactions || [],
        variables: elementData.variables || {},
        conditions: elementData.conditions || [],
        constraints: elementData.constraints || {},
        isLocked: elementData.isLocked || false,
        isVisible: elementData.isVisible !== undefined ? elementData.isVisible : true,
        isInteractive: elementData.isInteractive || false,
        layerOrder: maxLayerOrder + 1,
        groupId: elementData.groupId || null,
        parentId: elementData.parentId || null,
        assetId: elementData.assetId || null,
        linkedElements: elementData.linkedElements || [],
        customCSS: elementData.customCSS || null,
        customJS: elementData.customJS || null
      });

      console.log(`Element "${element.elementType}" created in project ${projectId}`);
      return element;
    } catch (error) {
      console.error('Error creating element:', error);
      throw new Error(`Failed to create element: ${error.message}`);
    }
  }

  async updateElement(elementId, projectId, tenantId, updateData) {
    try {
      // Verify project exists and belongs to tenant
      const project = await this.models.ContentProject.findOne({
        where: { id: projectId, tenantId }
      });

      if (!project) {
        throw new Error('Project not found');
      }

      const element = await this.models.ContentElement.findOne({
        where: { id: elementId, projectId }
      });

      if (!element) {
        throw new Error('Element not found');
      }

      // NEW: Download external images when updating image elements
      if ((element.elementType === 'image' || element.elementType === 'standard_photo') && updateData.properties) {
        const imageUrl = updateData.properties.imageUrl || 
                        updateData.properties.src || 
                        updateData.properties.url;
        
        if (imageUrl && this.isExternalUrl(imageUrl)) {
          console.log('📥 Downloading external image for updated element...');
          const localUrl = await this.downloadAndStoreImage(imageUrl, tenantId);
          
          // Update properties with local URL
          updateData.properties.imageUrl = localUrl;
          updateData.properties.src = localUrl;
          updateData.properties.url = localUrl;
          
          console.log(`✅ Image downloaded and stored locally: ${localUrl}`);
        }
      }

      await element.update(updateData);

      console.log(`Element ${elementId} updated`);
      return element;
    } catch (error) {
      console.error('Error updating element:', error);
      throw new Error(`Failed to update element: ${error.message}`);
    }
  }

  async deleteElement(elementId, projectId, tenantId) {
    try {
      const project = await this.models.ContentProject.findOne({
        where: { id: projectId, tenantId }
      });

      if (!project) {
        throw new Error('Project not found');
      }

      const element = await this.models.ContentElement.findOne({
        where: { id: elementId, projectId }
      });

      if (!element) {
        throw new Error('Element not found');
      }

      await element.destroy();

      console.log(`Element ${elementId} deleted from project ${projectId}`);
      return { success: true };
    } catch (error) {
      console.error('Error deleting element:', error);
      throw new Error(`Failed to delete element: ${error.message}`);
    }
  }

  async reorderElements(projectId, tenantId, elementOrders) {
    try {
      const project = await this.models.ContentProject.findOne({
        where: { id: projectId, tenantId }
      });

      if (!project) {
        throw new Error('Project not found');
      }

      for (const { elementId, layerOrder } of elementOrders) {
        await this.models.ContentElement.update(
          { layerOrder },
          { where: { id: elementId, projectId } }
        );
      }

      console.log(`Reordered ${elementOrders.length} elements in project ${projectId}`);
      return { success: true };
    } catch (error) {
      console.error('Error reordering elements:', error);
      throw new Error(`Failed to reorder elements: ${error.message}`);
    }
  }

  // ===== VARIABLE MANAGEMENT =====

  async getVariables(tenantId, options = {}) {
    try {
      const { category, dataSource } = options;

      const whereClause = {
        [Op.or]: [
          { tenantId },
          { isGlobal: true }
        ]
      };

      if (category) whereClause.category = category;
      if (dataSource) whereClause.dataSource = dataSource;

      const variables = await this.models.ContentVariable.findAll({
        where: whereClause,
        order: [['category', 'ASC'], ['sortOrder', 'ASC'], ['name', 'ASC']]
      });

      return variables;
    } catch (error) {
      console.error('Error getting variables:', error);
      throw new Error(`Failed to get variables: ${error.message}`);
    }
  }

  async createVariable(tenantId, variableData) {
    try {
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
        isSystemVariable: false,
        isGlobal: variableData.isGlobal || false,
        category: variableData.category,
        sortOrder: variableData.sortOrder || 999,
        icon: variableData.icon
      });

      console.log(`Variable "${variable.name}" created for tenant ${tenantId}`);
      return variable;
    } catch (error) {
      console.error('Error creating variable:', error);
      throw new Error(`Failed to create variable: ${error.message}`);
    }
  }

  // ===== EXPORT MANAGEMENT =====

  async getExportStatus(exportId, tenantId) {
  try {
    const exportRecord = await this.models.ContentExport.findOne({
      where: { id: exportId, tenantId }
    });
    if (!exportRecord) {
      throw new Error('Export not found');
    }
    return {
      exportId: exportRecord.id,
      status: exportRecord.processingStatus,
      progress: exportRecord.processingProgress,
      publicUrl: exportRecord.publicUrl,
      downloadUrl: exportRecord.downloadUrl,
      createdAt: exportRecord.createdAt,
      completedAt: exportRecord.processingStatus === 'completed' ? exportRecord.updatedAt : null
    };
  } catch (error) {
    console.error('Error getting export status:', error);
    throw new Error(`Failed to get export status: ${error.message}`);
  }
}

// ===== OPTISIGNS INTEGRATION =====
async checkOptiSignsIntegration(tenantId) {
  try {
    const hasOptisigns = !!this.optisignsModels;
    const isConfigured = hasOptisigns && this.optisignsService ? 
      await this.optisignsService.isConfigured(tenantId) : false;
    return {
      available: hasOptisigns,
      configured: isConfigured,
      method: 'optisync'
    };
  } catch (error) {
    console.error('Error checking OptiSigns integration:', error);
    return {
      available: false,
      configured: false,
      error: error.message
    };
  }
} // ← ADDED MISSING CLOSING BRACE HERE

async createOptiSignsApiGatewayConfig(projectId, tenantId, options = {}) {
  try {
    const project = await this.getProjectWithElements(projectId, tenantId);
    
    const config = {
      apiGateway: {
        endpoint: `/api/content/optisync/projects/${projectId}/feed`,
        method: 'GET',
        headers: {
          'X-Tenant-ID': tenantId
        },
        refreshInterval: options.refreshInterval || 300
      },
      webhook: {
        endpoint: `/api/content/optisync/projects/${projectId}/webhook`,
        method: 'POST',
        supportedActions: ['refresh', 'validate']
      },
      project: {
        id: project.id,
        name: project.name,
        lastUpdated: project.updatedAt
      }
    };
    return config;
  } catch (error) {
    console.error('Error creating OptiSigns config:', error);
    throw new Error(`Failed to create OptiSigns config: ${error.message}`);
  }
}

  // ===== ASSET MANAGEMENT =====

 // Replace the uploadAsset method in ContentCreationService (around line 901)
  async uploadAsset(tenantId, userId, file, metadata = {}) {
    try {
      console.log('📤 Uploading asset:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        hasBuffer: !!file.buffer,
        hasPath: !!file.path
      });

      const fileName = `${Date.now()}-${file.originalname}`;
      const filePath = path.join(this.directories.assets, fileName);
      
      // Generate absolute public URL for remote frontend access
      const baseUrl = process.env.BASE_URL || 'http://34.122.156.88:3001';
      const publicUrl = `${baseUrl}/uploads/content/assets/${fileName}`;

      console.log('🌐 Generated public URL:', publicUrl);

      // Handle both buffer (memoryStorage) and path (diskStorage) cases
      let fileBuffer;
      if (file.buffer) {
        // Memory storage - file is already in buffer
        fileBuffer = file.buffer;
        console.log('✅ Using file buffer from memory storage');
      } else if (file.path) {
        // Disk storage - read file from path
        console.log('📁 Reading file from disk storage path:', file.path);
        fileBuffer = await fs.readFile(file.path);
      } else {
        throw new Error('File has neither buffer nor path - invalid file object');
      }

      console.log('💾 Writing file to:', filePath);
      // Save original file
      await fs.writeFile(filePath, fileBuffer);

      // Determine asset type inline instead of using this.getAssetType
      let assetType;
      if (file.mimetype.startsWith('image/')) {
        assetType = 'image';
      } else if (file.mimetype.startsWith('video/')) {
        assetType = 'video';
      } else if (file.mimetype.startsWith('audio/')) {
        assetType = 'audio';
      } else if (file.mimetype === 'application/pdf') {
        assetType = 'document';
      } else if (file.mimetype.startsWith('font/') || file.mimetype.includes('font')) {
        assetType = 'font';
      } else {
        assetType = 'other';
      }

      console.log('📋 Detected asset type:', assetType);

      let dimensions = {};
      let thumbnailUrl = null;
      let previewUrls = {};
      let duration = null;
      let bitrate = null;
      let fps = null;

      // Process based on asset type - THIS IS KEY FOR THUMBNAILS
      switch (assetType) {
        case 'image':
          console.log('🖼️ Processing image for thumbnails and previews...');
          const imageResult = await this.processImage(file, fileName, baseUrl);
          dimensions = imageResult.dimensions;
          thumbnailUrl = imageResult.thumbnailUrl;
          previewUrls = imageResult.previewUrls;
          console.log('✅ Image processing complete:', {
            dimensions,
            thumbnailUrl,
            previewCount: Object.keys(previewUrls).length
          });
          break;

        case 'video':
          console.log('🎥 Processing video...');
          const videoResult = await this.processVideo(file, fileName, baseUrl);
          dimensions = videoResult.dimensions;
          duration = videoResult.duration;
          bitrate = videoResult.bitrate;
          fps = videoResult.fps;
          thumbnailUrl = videoResult.thumbnailUrl;
          previewUrls = videoResult.previewUrls;
          break;

        case 'audio':
          console.log('🎵 Processing audio...');
          const audioResult = await this.processAudio(file, fileName, baseUrl);
          duration = audioResult.duration;
          bitrate = audioResult.bitrate;
          thumbnailUrl = audioResult.waveformUrl;
          break;
      }

      const asset = await this.models.ContentAsset.create({
        tenantId,
        name: metadata.name || file.originalname,
        originalName: file.originalname,
        assetType,
        mimeType: file.mimetype,
        fileSize: file.size,
        filePath,
        publicUrl,
        thumbnailUrl,
        previewUrls,
        dimensions,
        duration,
        bitrate,
        fps,
        metadata: metadata.metadata || {},
        tags: metadata.tags || [],
        categories: metadata.categories || [],
        uploadedBy: userId,
        processingStatus: 'completed'
      });

      console.log(`✅ Asset "${asset.name}" uploaded successfully for tenant ${tenantId}`);
      console.log(`📊 Asset details:`, {
        id: asset.id,
        publicUrl: asset.publicUrl,
        thumbnailUrl: asset.thumbnailUrl,
        previewUrls: asset.previewUrls,
        dimensions: asset.dimensions
      });
      
      return asset;
    } catch (error) {
      console.error('❌ Error uploading asset:', error);
      throw new Error(`Failed to upload asset: ${error.message}`);
    }
  }

  // Also need to fix the processImage method to generate absolute URLs
  async processImage(file, fileName, baseUrl) {
    try {
      // Get the image buffer - handle both cases
      let imageBuffer;
      if (file.buffer) {
        imageBuffer = file.buffer;
      } else if (file.path) {
        imageBuffer = await fs.readFile(file.path);
      } else {
        throw new Error('No image buffer or path available');
      }

      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      
      const dimensions = {
        width: metadata.width,
        height: metadata.height
      };

      // Generate thumbnail with absolute URL
      const thumbnailName = `thumb_${fileName}`;
      const thumbnailPath = path.join(this.directories.thumbnails, thumbnailName);
      const thumbnailUrl = `${baseUrl}/uploads/content/thumbnails/${thumbnailName}`;

      await image
        .resize(320, 240, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(thumbnailPath);

      console.log('✅ Thumbnail generated:', thumbnailUrl);

      // Generate multiple preview sizes with absolute URLs
      const previewUrls = {};
      const sizes = [
        { name: 'small', width: 400, height: 300 },
        { name: 'medium', width: 800, height: 600 },
        { name: 'large', width: 1200, height: 900 }
      ];

      for (const size of sizes) {
        const previewName = `${size.name}_${fileName}`;
        const previewPath = path.join(this.directories.previews, previewName);
        previewUrls[size.name] = `${baseUrl}/uploads/content/previews/${previewName}`;

        await image
          .resize(size.width, size.height, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toFile(previewPath);

        console.log(`✅ ${size.name} preview generated:`, previewUrls[size.name]);
      }

      return { dimensions, thumbnailUrl, previewUrls };
    } catch (error) {
      console.error('❌ Error processing image:', error);
      return { dimensions: {}, thumbnailUrl: null, previewUrls: {} };
    }
  }

 async generateOptiSyncDataFeed(projectId, tenantId, options = {}) {
  try {
    if (!this.optisignsModels) {
      throw new Error('OptiSigns integration not available');
    }

    const project = await this.getProjectWithElements(projectId, tenantId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Generate data feed for OptiSigns synchronization
    const dataFeed = {
      projectId,
      name: project.name,
      elements: project.elements.map(element => ({
        id: element.id,
        type: element.elementType,
        properties: element.properties,
        position: element.position,
        size: element.size
      })),
      variables: options.variables || {},
      lastUpdated: new Date().toISOString()
    };

    console.log(`Generated OptiSync data feed for project ${projectId}`);
    return dataFeed;
  } catch (error) {
    console.error('Error generating OptiSync data feed:', error);
    throw new Error(`Failed to generate OptiSync data feed: ${error.message}`);
  }
}


// Add this method to ContentCreationService class (around line 1150, after existing methods)
  async getAssets(tenantId, options = {}) {
    try {
      const {
        assetType,
        search,
        tags,
        categories,
        isFavorite,
        sortBy = 'recent',
        page = 1,
        limit = 50
      } = options;

      const whereClause = { tenantId };

      if (assetType) whereClause.assetType = assetType;
      if (isFavorite !== undefined) whereClause.isFavorite = isFavorite;
      if (tags && tags.length > 0) whereClause.tags = { [Op.overlap]: tags };
      if (categories && categories.length > 0) whereClause.categories = { [Op.overlap]: categories };
      
      if (search) {
        whereClause[Op.or] = [
          { name: { [Op.iLike]: `%${search}%` } },
          { originalName: { [Op.iLike]: `%${search}%` } }
        ];
      }

      const orderOptions = {
        recent: ['created_at', 'DESC'],
        name: ['name', 'ASC'],
        size: ['file_size', 'DESC'],
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
      console.error('Error getting assets:', error);
      throw new Error(`Failed to get assets: ${error.message}`);
    }
  }

/**
 * UPDATED: publishToOptiSigns method with self-contained HTML
 */
async publishToOptiSigns(projectId, tenantId, displayIds = [], options = {}) {
  try {
    console.log('🔍 Publishing project to OptiSigns using self-contained HTML...');
    
    if (!this.optisignsService) {
      throw new Error('OptiSigns integration not available');
    }

    const project = await this.getProjectWithElements(projectId, tenantId);
    if (!project) {
      throw new Error('Project not found');
    }

    console.log(`🚀 Publishing project ${projectId} to OptiSigns for displays:`, displayIds);

    // Step 1: Create export record FIRST (this enables the public API endpoint)
    const { v4: uuidv4 } = require('uuid');
    const exportId = uuidv4();
    
    console.log('📝 Creating export record for public API serving...');
    
    const exportRecord = await this.models.ContentExport.create({
      id: exportId,
      tenantId: tenantId.toString(),
      projectId,
      exportType: 'optisigns',
      format: 'html', // Always HTML for OptiSigns
      quality: 'high',
      resolution: project.canvasSize || { width: 1920, height: 1080 },
      processingStatus: 'completed',
      variableData: options.variables || {},
      exportSettings: {
        publicServing: true,
        optisignsIntegration: true,
        selfContained: true,
        generatedAt: new Date().toISOString()
      },
      createdBy: options.userId || project.createdBy
    });

    // Step 2: Generate public API URL (no static files needed!)
    const baseUrl = process.env.BASE_URL || 'http://34.122.156.88:3001';
    const publicUrl = `${baseUrl}/api/content/public/${exportId}`;
    
    console.log('🌐 Content will be served via public API:', publicUrl);
    console.log('✅ HTML content generated dynamically with embedded images - no external dependencies');

    // Step 3: Create website asset in OptiSigns pointing to public API
    const assetName = `${project.name}_${Date.now()}`;
    console.log('📤 Creating OptiSigns website asset pointing to public API...');
    
    let uploadedAsset;
    
    try {
      uploadedAsset = await this.optisignsService.createWebsiteAsset(
        tenantId,
        publicUrl,
        assetName,
        options.teamId || null
      );
      
      console.log('✅ OptiSigns website asset created:', uploadedAsset.optisignsId);
      
    } catch (uploadError) {
      console.warn('⚠️ Failed to create OptiSigns asset:', uploadError.message);
      
      // Fallback: Create placeholder asset in database
      uploadedAsset = await this.optisignsModels.OptisignsContent.create({
        id: uuidv4(),
        tenantId: tenantId.toString(),
        optisignsId: `api-hosted-${Date.now()}`,
        name: assetName,
        type: 'web',
        fileType: 'html',
        fileSize: 0, // Dynamic content has no fixed size
        url: publicUrl,
        webLink: publicUrl,
        status: 'api_hosted',
        projectId: projectId,
        metadata: {
          uploadMethod: 'public_api',
          sourceProject: projectId,
          publicApiUrl: publicUrl,
          exportId: exportId,
          selfContained: true,
          imagesEmbedded: true
        }
      });
    }

    if (!uploadedAsset) {
      throw new Error('Failed to create asset in OptiSigns');
    }

    // Step 4: Update export record with OptiSigns asset ID
    await exportRecord.update({
      optisignsAssetId: uploadedAsset.optisignsId,
      publicUrl: publicUrl,
      downloadUrl: publicUrl
    });

    // Step 5: Push content to displays
    const pushResults = {
      successful: [],
      failed: [],
      asset: uploadedAsset
    };

    for (const displayId of displayIds) {
      try {
        console.log(`🔄 Assigning self-contained content to display ${displayId}...`);
        
        // Method 1: Try direct assignment
        try {
          await this.optisignsService.assignContentToDevice(
            tenantId,
            displayId,
            uploadedAsset.optisignsId,
            'ASSET'
          );
          
          pushResults.successful.push({
            displayId,
            method: 'self_contained_assignment',
            deviceName: displayId,
            publicUrl: publicUrl
          });
          
          console.log(`✅ Display ${displayId} assigned self-contained content successfully`);
          continue;
          
        } catch (assignError) {
          console.warn(`⚠️ Direct assignment failed: ${assignError.message}`);
        }
        
        // Method 2: Try takeover approach
        try {
          const takeoverResult = await this.optisignsService.takeoverDevice(
            tenantId,
            displayId,
            'ASSET',
            uploadedAsset.id,
            {
              priority: options.priority || 'HIGH',
              duration: options.duration || null,
              message: options.message || `Published: ${project.name}`,
              restoreAfter: options.restoreAfter !== false,
              initiatedBy: options.userId || 'system',
              teamId: options.teamId || null
            }
          );

          pushResults.successful.push({
            displayId,
            method: 'self_contained_takeover',
            takeoverId: takeoverResult.takeover?.id,
            deviceName: takeoverResult.device?.name || displayId,
            publicUrl: publicUrl
          });

          console.log(`✅ Display ${displayId} takeover successful with self-contained content`);
          
        } catch (takeoverError) {
          pushResults.failed.push({
            displayId,
            error: takeoverError.message,
            publicUrl: publicUrl
          });
          console.error(`❌ Display ${displayId} assignment failed:`, takeoverError.message);
        }
        
      } catch (error) {
        pushResults.failed.push({
          displayId,
          error: error.message,
          publicUrl: publicUrl
        });
        console.error(`❌ Display ${displayId} failed:`, error.message);
      }
    }

    const summary = {
      totalDisplays: displayIds.length,
      successfulPushes: pushResults.successful.length,
      failedPushes: pushResults.failed.length,
      assetUploaded: true,
      uploadMethod: 'self_contained_html',
      fileSize: 0, // Dynamic content
      format: 'html',
      publicApiUrl: publicUrl,
      exportId: exportId,
      selfContained: true,
      imagesEmbedded: true
    };

    console.log(`📊 Publish summary:`, summary);
    console.log(`🌐 Content accessible at: ${publicUrl}`);
    console.log(`✅ OptiSigns will load self-contained HTML with embedded images`);

    return {
      success: true,
      message: `Project published successfully. ${summary.successfulPushes}/${summary.totalDisplays} displays updated.`,
      asset: {
        id: uploadedAsset.id,
        optisignsId: uploadedAsset.optisignsId,
        name: uploadedAsset.name,
        url: publicUrl,
        type: 'self_contained_html'
      },
      export: {
        id: exportId,
        publicUrl: publicUrl,
        format: 'html',
        type: 'self_contained'
      },
      pushResults: pushResults,
      summary,
      displayIds: pushResults.successful.map(r => r.displayId)
    };
    
  } catch (error) {
    console.error('❌ Error publishing to OptiSigns:', error);
    throw new Error(`Failed to publish to OptiSigns: ${error.message}`);
  }
}

async generateProjectExport(projectId, tenantId, options = {}) {
  try {
    const project = await this.getProjectWithElements(projectId, tenantId);
    if (!project) {
      throw new Error('Project not found');
    }

    const format = options.format || 'html';
    const fileName = `${project.name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.${format}`;
    const filePath = path.join(this.directories.exports, fileName);

    await fs.mkdir(this.directories.exports, { recursive: true });

    let fileContent;
    let mimeType;

    switch (format) {
      case 'html':
        fileContent = await this.generateProjectHTML(project, options);
        mimeType = 'text/html';
        break;
      case 'png':
        fileContent = await this.generateProjectImage(project, options);
        mimeType = 'image/png';
        break;
      case 'jpg':
      case 'jpeg':
        fileContent = await this.generateProjectImage(project, { ...options, format: 'jpeg' });
        mimeType = 'image/jpeg';
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    await fs.writeFile(filePath, fileContent);

    const fileBuffer = Buffer.from(fileContent);
    const file = {
      buffer: fileBuffer,
      originalname: fileName,
      mimetype: mimeType,
      size: fileBuffer.length
    };

    const { v4: uuidv4 } = require('uuid');
    const exportId = uuidv4();
    const baseUrl = process.env.BASE_URL || 'http://34.122.156.88:3001';
    const publicUrl = `${baseUrl}/api/content/public/${exportId}`;

    const exportRecord = await this.models.ContentExport.create({
      id: exportId,
      projectId,
      tenantId: tenantId.toString(),
      exportType: options.exportType || 'final',
      format,
      quality: options.quality || 'high',
      resolution: project.canvasSize || { width: 1920, height: 1080 },
      filePath,
      fileSize: file.size,
      publicUrl,
      downloadUrl: publicUrl,
      processingStatus: 'completed',
      variableData: options.variables || {},
      exportSettings: options.exportSettings || {},
      createdBy: options.userId || project.createdBy
    });

    console.log(`✅ Project export generated: ${fileName} (${file.size} bytes)`);
    console.log(`🌐 Public URL: ${publicUrl}`);

    return {
      exportId: exportRecord.id,
      publicUrl,
      filePath,
      format,
      fileSize: file.size
    };
  } catch (error) {
    console.error('Error generating project export:', error);
    throw new Error(`Failed to generate export: ${error.message}`);
  }
}



/**
 * UPDATED HTML GENERATION WITH BASE64 EMBEDDED IMAGES
 */

async generateProjectHTML(project, options = {}) {
  try {
    console.log('🎨 Generating self-contained HTML with embedded images...');
    
    // STEP 1: Process all images to base64 for self-contained export
    const processedProject = await this.processProjectImagesForExport(JSON.parse(JSON.stringify(project)));
    // STEP 2: Process videos (embed small ones)
    await this.processProjectVideosForExport(processedProject);
    
    const canvasSize = processedProject.canvasSize || { width: 1920, height: 1080 };
    const elements = processedProject.elements || [];
    const canvasBackground = processedProject.canvasBackground || { type: 'solid', color: '#ffffff' };
    
    // Extract all fonts used in the project
    const fontsUsed = this.extractFontsFromProject(processedProject);
    const fontImports = this.generateFontImports(fontsUsed);

    let libraryScripts = '';
    if (elements.some(el => el.elementType === 'confetti')) {
      const confettiPath = path.join(__dirname, 'embedded-scripts', 'confetti.browser.min.js');
      const confettiLib = await fs.readFile(confettiPath, 'utf8');
      libraryScripts += `<script>${confettiLib}</script>`;
    }
    
    console.log('🔤 Fonts to import:', fontsUsed);

    let elementsHTML = '';
    for (const element of elements) {
      const elementHTML = await this.generateElementHTML(element, {
        ...options,
        tenantId: processedProject.tenantId,
        useBase64Images: true // Flag to indicate we're using base64
      });
      elementsHTML += elementHTML;
    }

    // Generate background style (background may also be base64 now)
    let backgroundStyle = '';
    if (canvasBackground.type === 'solid') {
      backgroundStyle = `background-color: ${canvasBackground.color || '#ffffff'};`;
    } else if (canvasBackground.type === 'gradient') {
      backgroundStyle = `background: ${canvasBackground.gradient || 'linear-gradient(to bottom, #ffffff, #f0f0f0)'};`;
    } else if (canvasBackground.type === 'image' && canvasBackground.url) {
      backgroundStyle = `background-image: url('${canvasBackground.url}'); background-size: cover; background-position: center;`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${processedProject.name}</title>
    
    <!-- Font Imports -->
    ${fontImports}
    ${libraryScripts}
    
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            overflow: hidden;
            width: 100vw;
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            background: #000;
        }
        
        .canvas {
            position: relative;
            width: ${canvasSize.width}px;
            height: ${canvasSize.height}px;
            max-width: 100vw;
            max-height: 100vh;
            ${backgroundStyle}
            overflow: hidden;
            transform-origin: center center;
        }
        
        /* Responsive scaling */
        @media (max-width: ${canvasSize.width}px) {
            .canvas {
                transform: scale(calc(100vw / ${canvasSize.width}px));
            }
        }
        
        @media (max-height: ${canvasSize.height}px) {
            .canvas {
                transform: scale(calc(100vh / ${canvasSize.height}px));
            }
        }
        
        .element {
            position: absolute;
            display: block;
        }
        
        /* Enhanced text rendering */
        .text-element {
            white-space: pre-wrap;
            word-wrap: break-word;
            line-height: 1.2;
            text-rendering: optimizeLegibility;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        
        /* Image optimization */
        .image-element {
            object-fit: cover;
            image-rendering: -webkit-optimize-contrast;
            image-rendering: crisp-edges;
        }
        
        /* Button styling */
        .button-element {
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
            text-decoration: none;
            border: none;
            outline: none;
        }
        
        .button-element:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        /* Shape elements */
        .shape-element {
            border-style: solid;
            border-width: 0;
        }
        
        ${this.generateProjectCSS(elements)}
    </style>
</head>
<body>
    <div class="canvas" id="main-canvas">
        ${elementsHTML}
    </div>
    
    <script>
        ${this.generateProjectJS(elements, options)}
        
        // Font loading detection
        if (document.fonts) {
            document.fonts.ready.then(() => {
                console.log('✅ All fonts loaded successfully');
            });
        }
        
        console.log('🎨 Self-contained project "${processedProject.name}" loaded with ${elements.length} elements');
        console.log('🖼️ All images embedded as base64 - no external dependencies');
    </script>
</body>
</html>`;

    console.log('✅ Self-contained HTML generated successfully with embedded images');
    return html;
    
  } catch (error) {
    console.error('❌ Error generating self-contained HTML:', error);
    return `<html><body><h1>Error generating content: ${error.message}</h1></body></html>`;
  }
}




async generateElementHTML(element, options = {}) {
  const position = element.position || { x: 0, y: 0 };
  const size = element.size || { width: 100, height: 100 };
  const styles = element.styles || {};
  const properties = element.properties || {};
  const elementId = element.id;

  console.log(`🔨 Generating HTML for ${element.elementType} element:`, elementId);

  // Build comprehensive inline styles
  let inlineStyles = `
    position: absolute;
    left: ${position.x}px;
    top: ${position.y}px;
    width: ${size.width}px;
    height: ${size.height}px;
  `;

  // Apply all custom styles from the element
  for (const [property, value] of Object.entries(styles)) {
    if (value !== undefined && value !== null && value !== '') {
      const cssProperty = this.convertToCSSProperty(property);
      inlineStyles += `${cssProperty}: ${value}; `;
    }
  }

  // Add opacity and transforms
  if (element.opacity !== undefined && element.opacity !== 1) {
    inlineStyles += `opacity: ${element.opacity}; `;
  }

  if (element.rotation) {
    inlineStyles += `transform: rotate(${element.rotation}deg); `;
  }

  // Add z-index for layering
  if (element.zIndex !== undefined) {
    inlineStyles += `z-index: ${element.zIndex}; `;
  }

  let content = '';
  
  switch (element.elementType) {
    case 'text':
      // Enhanced text rendering with proper font handling
      const textStyles = inlineStyles;
      const textContent = properties.text || properties.content || 'Text Element';
      
      content = `<div class="element text-element" 
                    data-element-id="${elementId}"
                    style="${textStyles}">
                    ${this.escapeHtml(textContent)}
                  </div>`;
      break;
      
    case 'image':
    case 'standard_photo':
      // NEW: Use base64 embedded images - no external URLs at all
      let imageUrl = properties.src || properties.url || properties.imageUrl || properties.assetId;
      
      if (imageUrl) {
        // At this point, imageUrl should already be a base64 data URI from processProjectImagesForExport
        const altText = properties.alt || properties.title || 'Image';
        
        console.log(`🖼️ Using embedded image (base64): ${imageUrl.substring(0, 50)}...`);
        
        content = `<img class="element image-element" 
                      data-element-id="${elementId}"
                      src="${imageUrl}"
                      alt="${this.escapeHtml(altText)}"
                      style="${inlineStyles}"
                      loading="eager" />`;
      } else {
        // Placeholder for missing image
        content = `<div class="element image-element" 
                      data-element-id="${elementId}"
                      style="${inlineStyles} background: #f0f0f0; display: flex; align-items: center; justify-content: center; color: #666; font-size: 14px;">
                      📷 Image
                    </div>`;
      }
      break;
      
    case 'button':
      const buttonText = properties.text || properties.label || 'Button';
      const buttonUrl = properties.url || properties.href || '#';
      
      content = `<button class="element button-element" 
                    data-element-id="${elementId}"
                    data-url="${buttonUrl}"
                    style="${inlineStyles}">
                    ${this.escapeHtml(buttonText)}
                  </button>`;
      break;
      
    case 'shape':
      const shape = properties.shape || 'rectangle';
      let shapeStyles = inlineStyles;
      
      if (shape === 'circle') {
        shapeStyles += 'border-radius: 50%; ';
      } else if (shape === 'rounded') {
        shapeStyles += `border-radius: ${properties.borderRadius || '8px'}; `;
      }
      
      content = `<div class="element shape-element ${shape}"
                    data-element-id="${elementId}"
                    style="${shapeStyles}">
                  </div>`;
      break;

    case 'confetti':
      content = `<canvas class="element confetti-canvas" data-element-id="${elementId}" style="${inlineStyles}"></canvas>`;
      break;

    case 'video':
      const videoUrl = properties.src || properties.url || properties.videoUrl;
      if (videoUrl) {
        const absoluteVideoUrl = this.makeAbsoluteUrl(videoUrl, options.baseUrl);
        const autoplay = properties.autoplay ? 'autoplay' : '';
        const loop = properties.loop ? 'loop' : '';
        const muted = properties.muted ? 'muted' : '';
        
        content = `<video class="element video-element" 
                      data-element-id="${elementId}"
                      src="${absoluteVideoUrl}"
                      style="${inlineStyles}"
                      ${autoplay} ${loop} ${muted}
                      controls="false"
                      playsinline>
                    </video>`;
      } else {
        content = `<div class="element video-element" 
                      data-element-id="${elementId}"
                      style="${inlineStyles} background: #000; display: flex; align-items: center; justify-content: center; color: #fff;">
                      🎥 Video
                    </div>`;
      }
      break;
      
    default:
      // Generic element fallback
      const defaultContent = properties.text || properties.content || element.elementType;
      content = `<div class="element ${element.elementType}-element" 
                    data-element-id="${elementId}"
                    style="${inlineStyles}">
                    ${this.escapeHtml(defaultContent)}
                  </div>`;
  }

  return content;
}

/**
 * Extract all fonts used in the project
 */
extractFontsFromProject(project) {
  const fonts = new Set();
  const elements = project.elements || [];
  
  elements.forEach(element => {
    const styles = element.styles || {};
    
    // Check for font-family in styles
    if (styles.fontFamily) {
      fonts.add(styles.fontFamily);
    }
    
    // Check for font-family in CSS string
    if (styles.font) {
      const fontMatch = styles.font.match(/font-family:\s*([^;]+)/);
      if (fontMatch) {
        fonts.add(fontMatch[1].replace(/['"]/g, ''));
      }
    }
  });
  
  return Array.from(fonts);
}

generateFontImports(fonts) {
  const googleFonts = [];
  const webFonts = [];
  
  fonts.forEach(font => {
    const cleanFont = font.replace(/['"]/g, '').trim();
    
    // Check if it's a Google Font (common ones)
    const commonGoogleFonts = [
      'Open Sans', 'Roboto', 'Lato', 'Montserrat', 'Source Sans Pro',
      'Raleway', 'Poppins', 'Oswald', 'Merriweather', 'Nunito',
      'Playfair Display', 'Dancing Script', 'Cabin', 'Lora', 'Crimson Text'
    ];
    
    if (commonGoogleFonts.includes(cleanFont)) {
      googleFonts.push(cleanFont);
    } else if (cleanFont.startsWith('http')) {
      webFonts.push(cleanFont);
    }
  });
  
  let imports = '';
  
  // Google Fonts import
  if (googleFonts.length > 0) {
    const googleFontUrl = 'https://fonts.googleapis.com/css2?family=' + 
      googleFonts.map(font => font.replace(/\s+/g, '+')).join('&family=') + 
      '&display=swap';
    imports += `<link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="${googleFontUrl}" rel="stylesheet">
    `;
  }
  
  // Web font imports
  webFonts.forEach(fontUrl => {
    imports += `<link href="${fontUrl}" rel="stylesheet">
    `;
  });
  
  return imports;
}

/**
 * Convert camelCase to CSS property
 */
convertToCSSProperty(property) {
  return property.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/**
 * Resolve asset ID to actual HTTP URL
 */
async resolveAssetUrl(assetReference, tenantId) {
  try {
    // Check if it's already a full URL
    if (assetReference.startsWith('http://') || assetReference.startsWith('https://') || assetReference.startsWith('data:')) {
      return assetReference;
    }
    
    // Check if it looks like a UUID (asset ID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (uuidRegex.test(assetReference)) {
      console.log(`🔍 Resolving asset ID: ${assetReference}`);
      
      // Look up the asset in the database
      const asset = await this.models.ContentAsset.findOne({
        where: {
          id: assetReference,
          tenantId: tenantId || 'unknown'
        }
      });
      
      if (asset) {
        console.log(`✅ Asset found: ${asset.name}`);
        
        // Use publicUrl if available
        if (asset.publicUrl) {
          return asset.publicUrl;
        }
        
        // Construct URL from filePath
        if (asset.filePath) {
          // Convert file path to URL path
          const urlPath = asset.filePath.replace(/\\/g, '/'); // Convert Windows paths
          
          // If it starts with uploads, use as-is, otherwise add uploads prefix
          if (urlPath.startsWith('/uploads/') || urlPath.startsWith('uploads/')) {
            return urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
          } else {
            // Assume it's in the content assets directory
            return `/uploads/content/assets/${path.basename(urlPath)}`;
          }
        }
        
        console.warn(`⚠️ Asset ${assetReference} found but no URL available`);
        return null;
      } else {
        console.warn(`⚠️ Asset ${assetReference} not found in database`);
        return null;
      }
    }
    
    // If it's not a UUID, treat as a regular path
    return assetReference;
    
  } catch (error) {
    console.error(`❌ Error resolving asset ${assetReference}:`, error.message);
    return assetReference; // Return original as fallback
  }
}

/**
 * Make URL absolute
 */
makeAbsoluteUrl(url, baseUrl) {
  if (!url) return '';
  
  // Already absolute
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  
  // Relative URL - make absolute
  if (baseUrl && !url.startsWith('/')) {
    return `${baseUrl.replace(/\/$/, '')}/${url}`;
  } else if (baseUrl) {
    return `${baseUrl.replace(/\/$/, '')}${url}`;
  }
  
  return url;
}

/**
 * Escape HTML content (server-safe version)
 */
escapeHtml(text) {
  if (typeof text !== 'string') return text;
  
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Enhanced CSS generation with better font handling
generateProjectCSS(elements) {
  let css = `
    /* Enhanced animations */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    @keyframes slideIn {
      from { transform: translateX(-100%); }
      to { transform: translateX(0); }
    }
    
    @keyframes marquee {
      0% { transform: translateX(100%); }
      100% { transform: translateX(-100%); }
    }
    
    /* Typewriter effect */
    .typewriter-cursor {
      animation: blink 1s infinite;
    }
    
    @keyframes blink {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0; }
    }
    
    /* Enhanced text rendering */
    .text-element {
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    
    /* Image optimization */
    .image-element {
      image-rendering: -webkit-optimize-contrast;
      backface-visibility: hidden;
    }
  `;
  
  // Add element-specific styles and animations
  elements.forEach(element => {
    const id = element.id;
    const styles = element.styles || {};
    
    // Add custom animations
    if (element.animations && element.animations.length > 0) {
      element.animations.forEach(animation => {
        css += `
          @keyframes ${animation.name}-${id} {
            ${animation.keyframes || ''}
          }
          [data-element-id="${id}"] {
            animation: ${animation.name}-${id} ${animation.duration || '1s'} ${animation.timing || 'ease'} ${animation.delay || '0s'} ${animation.iterations || 'infinite'};
          }
        `;
      });
    }
    
    // Add hover effects
    if (element.hoverEffects) {
      css += `
        [data-element-id="${id}"]:hover {
          ${element.hoverEffects}
        }
      `;
    }
  });
  
  return css;
}
generateProjectJS(elements, options = {}) {
    let js = `
      console.log('Project loaded with ${elements.length} elements');
      
      // Auto-refresh if specified
      ${options.autoRefresh ? `setTimeout(() => location.reload(), ${options.autoRefresh * 1000});` : ''}
      
      // Typewriter effect
      document.querySelectorAll('.typewriter-text').forEach(element => {
        const text = element.getAttribute('data-text');
        const speed = parseInt(element.getAttribute('data-speed')) || 80;
        const contentEl = element.querySelector('.typewriter-content');
        if (contentEl && text) {
          let i = 0;
          function typeWriter() {
            if (i < text.length) {
              contentEl.textContent += text.charAt(i);
              i++;
              setTimeout(typeWriter, speed);
            }
          }
          typeWriter();
        }
      });
      
  
  `;


  for (const element of elements) {
      if (element.elementType === 'confetti') {
        js += `\n(function(){\n  const el = document.querySelector('[data-element-id="${element.id}"]');\n  if(el && window.confetti){\n    const cf = window.confetti.create(el,{resize:true,useWorker:true});\n    cf({particleCount:${element.properties?.particleCount || 100},spread:${element.properties?.spread || 70},origin:{y:${(element.properties?.origin?.y ?? 0.6)}},colors:${JSON.stringify(element.properties?.colors || [])}});\n  }\n})();\n`;
      }
      if (element.interactions && element.interactions.length > 0) {
        js += `
          // Interactions for ${element.elementType} ${element.id}
          (function() {
            const element = document.querySelector('[data-element-id="${element.id}"]');
            if (element) {
              ${element.interactions.map(interaction => {
                if (interaction.trigger === 'click' && interaction.action === 'redirect') {
                  return `element.addEventListener('click', () => { window.location.href = '${interaction.url || '#'}'; });`;
                }
                return '';
              }).join('\n')}
            }
          })();
        `;
      }
    }
    
    return js;
  }

async generateProjectImage(project, options = {}) {
  try {
    const sharp = require('sharp');
    const canvasSize = project.canvasSize || { width: 1920, height: 1080 };
    
    // Create a simple image with project info
    const svg = `
      <svg width="${canvasSize.width}" height="${canvasSize.height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${canvasSize.width}" height="${canvasSize.height}" fill="${project.canvasBackground?.color || '#ffffff'}"/>
        <text x="${canvasSize.width/2}" y="${canvasSize.height/2}" 
              font-family="Arial, sans-serif" 
              font-size="48" 
              fill="#333333" 
              text-anchor="middle">
          ${project.name}
        </text>
        <text x="${canvasSize.width/2}" y="${canvasSize.height/2 + 60}" 
              font-family="Arial, sans-serif" 
              font-size="24" 
              fill="#666666" 
              text-anchor="middle">
          Generated from Knittt Content Creator
        </text>
      </svg>
    `;
    
    const image = await sharp(Buffer.from(svg))
      .png()
      .toBuffer();
    
    return image;

  } catch (error) {
    console.error('Error generating image:', error);
    // Return minimal PNG buffer
    return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  }
 }

  /**
   * Generate a short celebration video using ffmpeg and return local path
   * and public URL. The video shows the rep photo and basic deal info.
   */
  async generateCelebrationVideo(data = {}) {
    try {
      const {
        repName = 'Sales Rep',
        repPhotoUrl,
        dealAmount = '',
        companyName = ''
      } = data;

      if (!repPhotoUrl) {
        throw new Error('repPhotoUrl is required to generate the video');
      }

      await fs.mkdir(this.directories.videos, { recursive: true });
      await fs.mkdir(this.directories.temp, { recursive: true });

      const tempPhoto = path.join(this.directories.temp, `photo_${Date.now()}.png`);

      if (repPhotoUrl.startsWith('http')) {
        const response = await axios.get(repPhotoUrl, { responseType: 'arraybuffer' });
        await fs.writeFile(tempPhoto, response.data);
      } else {
        await fs.copyFile(repPhotoUrl, tempPhoto);
      }

      const outputName = `celebration_${Date.now()}.mp4`;
      const outputPath = path.join(this.directories.videos, outputName);
      const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input('color=c=black:s=1920x1080:d=5')
          .input(tempPhoto)
          .complexFilter([
            '[1:v] scale=500:500 [photo]',
            '[0:v][photo] overlay=(W-w)/2:(H-h)/2',
            `drawtext=fontfile=${fontPath}:text='${repName}':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=50`,
            `drawtext=fontfile=${fontPath}:text='${dealAmount} ${companyName}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=H-120`
          ])
          .outputOptions(['-t 5', '-pix_fmt yuv420p', '-r 30'])
          .save(outputPath)
          .on('end', resolve)
          .on('error', reject);
      });

      const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
      const publicUrl = `${baseUrl}/uploads/content/videos/${outputName}`;

      return { filePath: outputPath, publicUrl };
    } catch (err) {
      console.error('Error generating celebration video:', err);
      throw err;
    }
  }
}


module.exports = ContentCreationService;