// shared/content-creation-models.js
// Enhanced Database models for Content Creation System with expanded element types and video processing

module.exports = function(sequelize, DataTypes) {
  
  // Content Templates - Pre-built templates with configurable elements
  const ContentTemplate = sequelize.define('ContentTemplate', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    category: {
      type: DataTypes.ENUM(
        'welcome_screen', 
        'promotional_banner', 
        'data_dashboard', 
        'call_to_action', 
        'announcement', 
        'celebration',
        'interactive_form',
        'media_showcase',
        'social_display',
        'analytics_dashboard',
        'custom'
      ),
      defaultValue: 'custom'
    },
    canvasSize: {
      type: DataTypes.JSONB,
      defaultValue: { width: 1920, height: 1080 },
      field: 'canvas_size'
    },
    responsiveBreakpoints: {
      type: DataTypes.JSONB,
      defaultValue: {
        mobile: { width: 375, height: 667 },
        tablet: { width: 768, height: 1024 },
        desktop: { width: 1920, height: 1080 }
      },
      field: 'responsive_breakpoints'
    },
    previewImage: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'preview_image'
    },
    previewVideo: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'preview_video'
    },
    templateData: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'template_data'
    },
    variables: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'variables'
    },
    isPublic: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_public'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active'
    },
    isFeatured: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_featured'
    },
    usageCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'usage_count'
    },
    rating: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
      validate: { min: 0, max: 5 }
    },
    ratingCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'rating_count'
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    difficulty: {
      type: DataTypes.ENUM('beginner', 'intermediate', 'advanced'),
      defaultValue: 'beginner'
    },
    estimatedTime: {
      type: DataTypes.INTEGER,
      defaultValue: 30,
      field: 'estimated_time',
      comment: 'Estimated setup time in minutes'
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'created_by'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'content_templates',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['tenant_id', 'category']
      },
      {
        fields: ['tenant_id', 'is_active']
      },
      {
        fields: ['is_public', 'category']
      },
      {
        fields: ['is_featured', 'rating']
      },
      {
        fields: ['tags'],
        using: 'gin'
      },
      {
        fields: ['created_by']
      }
    ]
  });

  // Content Projects - User-created design projects
  const ContentProject = sequelize.define('ContentProject', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    templateId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'template_id',
      references: {
        model: 'content_templates',
        key: 'id'
      }
    },
    canvasSize: {
      type: DataTypes.JSONB,
      defaultValue: { width: 1920, height: 1080 },
      field: 'canvas_size'
    },
    responsiveBreakpoints: {
      type: DataTypes.JSONB,
      defaultValue: {
        mobile: { width: 375, height: 667 },
        tablet: { width: 768, height: 1024 },
        desktop: { width: 1920, height: 1080 }
      },
      field: 'responsive_breakpoints'
    },
    canvasBackground: {
      type: DataTypes.JSONB,
      defaultValue: { type: 'solid', color: '#ffffff' },
      field: 'canvas_background'
    },
    projectData: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'project_data'
    },
    variables: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'variables'
    },
    globalStyles: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'global_styles'
    },
    interactions: {
      type: DataTypes.JSONB,
      defaultValue: [],
      field: 'interactions'
    },
    status: {
      type: DataTypes.ENUM('draft', 'published', 'archived'),
      defaultValue: 'draft'
    },
    version: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    },
    versionHistory: {
      type: DataTypes.JSONB,
      defaultValue: [],
      field: 'version_history'
    },
    lastPreviewUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'last_preview_url'
    },
    lastExportUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'last_export_url'
    },
    publishedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'published_at'
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'created_by'
    },
    lastEditedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'last_edited_by'
    },
    collaborators: {
      type: DataTypes.ARRAY(DataTypes.INTEGER),
      defaultValue: []
    },
    isTemplate: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_template'
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'content_projects',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['tenant_id', 'status']
      },
      {
        fields: ['tenant_id', 'created_by']
      },
      {
        fields: ['template_id']
      },
      {
        fields: ['created_by']
      },
      {
        fields: ['published_at']
      },
      {
        fields: ['collaborators'],
        using: 'gin'
      },
      {
        fields: ['tags'],
        using: 'gin'
      }
    ]
  });

  // Content Elements - Individual canvas elements with massive expansion
  const ContentElement = sequelize.define('ContentElement', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    projectId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'project_id',
      references: {
        model: 'content_projects',
        key: 'id'
      }
    },
elementType: {
  type: DataTypes.ENUM(
    // Text Elements
    'text', 'marquee_text', 'typewriter_text', 'countdown_text', 
    'gradient_text', 'outline_text', 'shadow_text',
    
    // Media Elements
    'image', 'standard_photo', 'video', 'audio', 'image_carousel', 'image_gallery', 
    'slideshow', 'video_playlist', 'audio_playlist',
    
    // Interactive Elements
    'button', 'slider', 'toggle', 'dropdown', 'tabs', 'accordion', 
    'modal', 'tooltip', 'hotspot', 'image_map',
    
    // Form Elements
    'input_field', 'textarea', 'checkbox', 'radio_button', 
    'select_dropdown', 'file_upload', 'date_picker', 'color_picker',
    
    // Layout Elements
    'container', 'grid', 'flexbox', 'divider', 'spacer', 
    'columns', 'section', 'header', 'footer',
    
    // Data Visualization
    'chart', 'progress_bar', 'gauge', 'pie_chart', 'line_chart', 
    'bar_chart', 'area_chart', 'scatter_plot', 'heatmap', 'treemap',
    
    // Social Elements
    'social_feed', 'testimonial', 'rating_stars', 'share_buttons', 
    'social_icons', 'comment_section', 'like_button',
    
    // Graphics & Shapes
    'shape', 'icon', 'logo', 'badge', 'ribbon', 'stamp', 
    'arrow', 'line', 'border', 'frame',
    
    // Effects & Animations
    'particles', 'confetti', 'animation', 'transition', 
    'gradient_overlay', 'mask', 'filter', 'glow', 'shadow',
    
    // Advanced Elements
    'qr_code', 'barcode', 'map', 'calendar', 'clock', 'timer', 
    'weather', 'news_feed', 'rss_feed', 'embed_code'
  ),
  allowNull: false,
  field: 'element_type'
},
    position: {
      type: DataTypes.JSONB,
      defaultValue: { x: 0, y: 0, z: 0 },
      allowNull: false
    },
    size: {
      type: DataTypes.JSONB,
      defaultValue: { width: 100, height: 100 },
      allowNull: false
    },
    rotation: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    scale: {
      type: DataTypes.JSONB,
      defaultValue: { x: 1, y: 1 }
    },
    skew: {
      type: DataTypes.JSONB,
      defaultValue: { x: 0, y: 0 }
    },
    opacity: {
      type: DataTypes.FLOAT,
      defaultValue: 1,
      validate: {
        min: 0,
        max: 1
      }
    },
    properties: {
      type: DataTypes.JSONB,
      defaultValue: {},
      allowNull: false
    },
    styles: {
      type: DataTypes.JSONB,
      defaultValue: {},
      allowNull: false
    },
    responsiveStyles: {
      type: DataTypes.JSONB,
      defaultValue: {
        mobile: {},
        tablet: {},
        desktop: {}
      },
      field: 'responsive_styles'
    },
    animations: {
      type: DataTypes.JSONB,
      defaultValue: [],
      allowNull: false
    },
    interactions: {
      type: DataTypes.JSONB,
      defaultValue: [],
      allowNull: false
    },
    variables: {
      type: DataTypes.JSONB,
      defaultValue: {},
      allowNull: false
    },
    conditions: {
      type: DataTypes.JSONB,
      defaultValue: [],
      allowNull: false
    },
    constraints: {
      type: DataTypes.JSONB,
      defaultValue: {},
      allowNull: false
    },
    isLocked: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_locked'
    },
    isVisible: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_visible'
    },
    isInteractive: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_interactive'
    },
    layerOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'layer_order'
    },
    groupId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'group_id'
    },
    parentId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'parent_id'
    },
    assetId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'asset_id',
      references: {
        model: 'content_assets',
        key: 'id'
      }
    },
    linkedElements: {
      type: DataTypes.ARRAY(DataTypes.UUID),
      defaultValue: [],
      field: 'linked_elements'
    },
    customCSS: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'custom_css'
    },
    customJS: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'custom_js'
    }
  }, {
    tableName: 'content_elements',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['project_id', 'layer_order']
      },
      {
        fields: ['project_id', 'element_type']
      },
      {
        fields: ['asset_id']
      },
      {
        fields: ['project_id', 'is_visible']
      },
      {
        fields: ['group_id']
      },
      {
        fields: ['parent_id']
      },
      {
        fields: ['linked_elements'],
        using: 'gin'
      }
    ]
  });

  // Enhanced Content Assets with video processing
  const ContentAsset = sequelize.define('ContentAsset', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    originalName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'original_name'
    },
    assetType: {
      type: DataTypes.ENUM(
        'image',
        'video', 
        'audio',
        'font',
        'animation',
        'icon',
        'document',
        'svg',
        'gif',
        'lottie',
        'threejs',
        'other'
      ),
      allowNull: false,
      field: 'asset_type'
    },
    mimeType: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'mime_type'
    },
    fileSize: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'file_size'
    },
    filePath: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'file_path'
    },
    publicUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'public_url'
    },
    streamingUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'streaming_url'
    },
    thumbnailUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'thumbnail_url'
    },
    previewUrls: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'preview_urls',
      comment: 'Different quality/size previews'
    },
    dimensions: {
      type: DataTypes.JSONB,
      defaultValue: {},
      allowNull: true
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Duration in seconds for video/audio files'
    },
    bitrate: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Bitrate for video/audio files'
    },
    fps: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Frames per second for video files'
    },
    colorProfile: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'color_profile'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    exifData: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'exif_data'
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    categories: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    isPublic: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_public'
    },
    isFavorite: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_favorite'
    },
    usageCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'usage_count'
    },
    downloadCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'download_count'
    },
    uploadedBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'uploaded_by'
    },
    processingStatus: {
      type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed', 'optimizing'),
      defaultValue: 'pending',
      field: 'processing_status'
    },
    processingData: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'processing_data'
    },
    compressionSettings: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'compression_settings'
    },
    aiAnalysis: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'ai_analysis',
      comment: 'AI-generated tags, descriptions, etc.'
    }
  }, {
    tableName: 'content_assets',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['tenant_id', 'asset_type']
      },
      {
        fields: ['tenant_id', 'uploaded_by']
      },
      {
        fields: ['asset_type', 'is_public']
      },
      {
        fields: ['processing_status']
      },
      {
        fields: ['tags'],
        using: 'gin'
      },
      {
        fields: ['categories'],
        using: 'gin'
      },
      {
        fields: ['is_favorite']
      }
    ]
  });

  // Enhanced Content Variables with conditional logic
  const ContentVariable = sequelize.define('ContentVariable', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Variable name like "lead.name" or "company.address"'
    },
    displayName: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'display_name',
      comment: 'Human-readable name for UI'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    dataType: {
      type: DataTypes.ENUM('string', 'number', 'date', 'boolean', 'image', 'url', 'array', 'object'),
      allowNull: false,
      field: 'data_type'
    },
    dataSource: {
      type: DataTypes.ENUM('lead', 'call', 'tenant', 'system', 'external_api', 'static', 'user_input', 'calculation'),
      allowNull: false,
      field: 'data_source'
    },
    sourceField: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'source_field',
      comment: 'Field path in source data like "additionalData.customerType"'
    },
    defaultValue: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'default_value'
    },
    formatTemplate: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'format_template',
      comment: 'Format string like "Hello {value}!" or date format'
    },
    validationRules: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'validation_rules'
    },
    conditionalLogic: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'conditional_logic'
    },
    transformations: {
      type: DataTypes.JSONB,
      defaultValue: [],
      field: 'transformations'
    },
    isRequired: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_required'
    },
    isSystemVariable: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_system_variable'
    },
    isGlobal: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_global'
    },
    category: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Category for organizing variables in UI'
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'sort_order'
    },
    icon: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Icon for UI display'
    }
  }, {
    tableName: 'content_variables',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['tenant_id', 'name']
      },
      {
        fields: ['tenant_id', 'data_source']
      },
      {
        fields: ['tenant_id', 'category']
      },
      {
        fields: ['is_system_variable']
      },
      {
        fields: ['is_global']
      }
    ]
  });

  // Update the ContentExport model in your content-creation-models.js file
// Find the ContentExport definition and replace it with this corrected version:

const ContentExport = sequelize.define('ContentExport', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  projectId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'project_id',
    references: {
      model: 'content_projects',
      key: 'id'
    }
  },
  tenantId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'tenant_id'
  },
  exportType: {
    type: DataTypes.ENUM('preview', 'final', 'optisigns', 'video', 'image', 'pdf', 'html', 'json', 'gif'),
    allowNull: false,
    field: 'export_type'
  },
  format: {
    type: DataTypes.ENUM('png', 'jpg', 'gif', 'mp4', 'webm', 'html', 'json', 'pdf', 'svg', 'zip'),
    allowNull: true,  // Changed from false to true
    defaultValue: null
  },
  quality: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'ultra'),
    defaultValue: 'high'
  },
  resolution: {
    type: DataTypes.JSONB,
    defaultValue: { width: 1920, height: 1080 }
  },
  filePath: {
    type: DataTypes.STRING,
    allowNull: true,  // Changed from false to true
    field: 'file_path'
  },
  publicUrl: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'public_url'
  },
  downloadUrl: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'download_url'
  },
  fileSize: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'file_size'
  },
  duration: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Duration in seconds for video exports'
  },
  frameRate: {
    type: DataTypes.FLOAT,
    allowNull: true,
    field: 'frame_rate'
  },
  variableData: {
    type: DataTypes.JSONB,
    defaultValue: {},
    field: 'variable_data',
    comment: 'Variable values used in this export'
  },
  exportSettings: {
    type: DataTypes.JSONB,
    defaultValue: {},
    field: 'export_settings'
  },
  processingStatus: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
    defaultValue: 'pending',
    field: 'processing_status'
  },
  processingProgress: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    field: 'processing_progress'
  },
  processingLog: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'processing_log'
  },
  optisignsAssetId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'optisigns_asset_id',
    comment: 'OptiSigns asset ID if uploaded'
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'expires_at',
    comment: 'When this export should be cleaned up'
  },
  downloadCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'download_count'
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'created_by'
  }
}, {
  tableName: 'content_exports',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['project_id', 'export_type']
    },
    {
      fields: ['tenant_id', 'processing_status']
    },
    {
      fields: ['expires_at']
    },
    {
      fields: ['created_by']
    }
  ]
});

  // New: Element Library for categorizing and organizing elements
  const ElementLibrary = sequelize.define('ElementLibrary', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'tenant_id'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    elementType: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'element_type'
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false
    },
    subcategory: {
      type: DataTypes.STRING,
      allowNull: true
    },
    thumbnailUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'thumbnail_url'
    },
    previewUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'preview_url'
    },
    defaultProperties: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'default_properties'
    },
    defaultStyles: {
      type: DataTypes.JSONB,
      defaultValue: {},
      field: 'default_styles'
    },
    isPublic: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_public'
    },
    isFeatured: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_featured'
    },
    usageCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'usage_count'
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    difficulty: {
      type: DataTypes.ENUM('beginner', 'intermediate', 'advanced'),
      defaultValue: 'beginner'
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'created_by'
    }
  }, {
    tableName: 'element_library',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['tenant_id', 'element_type']
      },
      {
        fields: ['category', 'subcategory']
      },
      {
        fields: ['is_public', 'is_featured']
      },
      {
        fields: ['tags'],
        using: 'gin'
      }
    ]
  });

  // New: Project Versions for undo/redo functionality
  const ProjectVersion = sequelize.define('ProjectVersion', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    projectId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'project_id',
      references: {
        model: 'content_projects',
        key: 'id'
      }
    },
    versionNumber: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'version_number'
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true
    },
    snapshot: {
      type: DataTypes.JSONB,
      allowNull: false,
      comment: 'Complete project snapshot'
    },
    isAutoSave: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_auto_save'
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'created_by'
    }
  }, {
    tableName: 'project_versions',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['project_id', 'version_number']
      },
      {
        fields: ['created_at']
      }
    ]
  });

  // Set up associations

  // Template associations
  ContentTemplate.hasMany(ContentProject, { 
    foreignKey: 'templateId', 
    as: 'projects',
    onDelete: 'SET NULL'
  });

  // Project associations
  ContentProject.belongsTo(ContentTemplate, { 
    foreignKey: 'templateId', 
    as: 'template'
  });
  ContentProject.hasMany(ContentElement, { 
    foreignKey: 'projectId', 
    as: 'elements',
    onDelete: 'CASCADE'
  });
  ContentProject.hasMany(ContentExport, { 
    foreignKey: 'projectId', 
    as: 'exports',
    onDelete: 'CASCADE'
  });
  ContentProject.hasMany(ProjectVersion, { 
    foreignKey: 'projectId', 
    as: 'versions',
    onDelete: 'CASCADE'
  });

  // Element associations
  ContentElement.belongsTo(ContentProject, { 
    foreignKey: 'projectId', 
    as: 'project'
  });
  ContentElement.belongsTo(ContentAsset, { 
    foreignKey: 'assetId', 
    as: 'asset'
  });
  ContentElement.belongsTo(ContentElement, { 
    foreignKey: 'parentId', 
    as: 'parent'
  });
  ContentElement.hasMany(ContentElement, { 
    foreignKey: 'parentId', 
    as: 'children'
  });

  // Asset associations
  ContentAsset.hasMany(ContentElement, { 
    foreignKey: 'assetId', 
    as: 'elements',
    onDelete: 'SET NULL'
  });

  // Export associations
  ContentExport.belongsTo(ContentProject, { 
    foreignKey: 'projectId', 
    as: 'project'
  });

  // Version associations
  ProjectVersion.belongsTo(ContentProject, { 
    foreignKey: 'projectId', 
    as: 'project'
  });

  // Instance methods for easier operations

  // Project methods
  ContentProject.prototype.getElementsOrdered = function() {
    return this.getElements({
      order: [['layer_order', 'ASC'], ['created_at', 'ASC']]
    });
  };

  ContentProject.prototype.duplicateProject = async function(newName, userId) {
    const newProject = await ContentProject.create({
      tenantId: this.tenantId,
      name: newName,
      description: `Copy of ${this.name}`,
      templateId: this.templateId,
      canvasSize: this.canvasSize,
      responsiveBreakpoints: this.responsiveBreakpoints,
      canvasBackground: this.canvasBackground,
      projectData: this.projectData,
      variables: this.variables,
      globalStyles: this.globalStyles,
      interactions: this.interactions,
      createdBy: userId
    });

    // Copy all elements
    const elements = await this.getElements();
    for (const element of elements) {
      await ContentElement.create({
        projectId: newProject.id,
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

    return newProject;
  };

  ContentProject.prototype.createVersion = async function(userId, description = null, isAutoSave = true) {
    const versionNumber = await ProjectVersion.count({
      where: { projectId: this.id }
    }) + 1;

    const elements = await this.getElements();
    
    const snapshot = {
      project: {
        name: this.name,
        description: this.description,
        canvasSize: this.canvasSize,
        responsiveBreakpoints: this.responsiveBreakpoints,
        canvasBackground: this.canvasBackground,
        projectData: this.projectData,
        variables: this.variables,
        globalStyles: this.globalStyles,
        interactions: this.interactions
      },
      elements: elements.map(el => ({
        id: el.id,
        elementType: el.elementType,
        position: el.position,
        size: el.size,
        rotation: el.rotation,
        scale: el.scale,
        skew: el.skew,
        opacity: el.opacity,
        properties: el.properties,
        styles: el.styles,
        responsiveStyles: el.responsiveStyles,
        animations: el.animations,
        interactions: el.interactions,
        variables: el.variables,
        conditions: el.conditions,
        constraints: el.constraints,
        isLocked: el.isLocked,
        isVisible: el.isVisible,
        isInteractive: el.isInteractive,
        layerOrder: el.layerOrder,
        groupId: el.groupId,
        parentId: el.parentId,
        assetId: el.assetId,
        linkedElements: el.linkedElements,
        customCSS: el.customCSS,
        customJS: el.customJS
      }))
    };

    return await ProjectVersion.create({
      projectId: this.id,
      versionNumber,
      description,
      snapshot,
      isAutoSave,
      createdBy: userId
    });
  };

  // Element methods
  ContentElement.prototype.moveToLayer = async function(newLayerOrder) {
    await this.update({ layerOrder: newLayerOrder });
  };

  ContentElement.prototype.updatePosition = async function(x, y, z = null) {
    const newPosition = { ...this.position, x, y };
    if (z !== null) newPosition.z = z;
    await this.update({ position: newPosition });
  };

  ContentElement.prototype.updateSize = async function(width, height) {
    await this.update({ 
      size: { ...this.size, width, height }
    });
  };

  ContentElement.prototype.clone = async function(offsetX = 20, offsetY = 20) {
    const clonedElement = await ContentElement.create({
      projectId: this.projectId,
      elementType: this.elementType,
      position: {
        x: this.position.x + offsetX,
        y: this.position.y + offsetY,
        z: this.position.z
      },
      size: this.size,
      rotation: this.rotation,
      scale: this.scale,
      skew: this.skew,
      opacity: this.opacity,
      properties: this.properties,
      styles: this.styles,
      responsiveStyles: this.responsiveStyles,
      animations: this.animations,
      interactions: this.interactions,
      variables: this.variables,
      conditions: this.conditions,
      constraints: this.constraints,
      isLocked: false,
      isVisible: this.isVisible,
      isInteractive: this.isInteractive,
      layerOrder: this.layerOrder + 1,
      groupId: this.groupId,
      parentId: this.parentId,
      assetId: this.assetId,
      linkedElements: [],
      customCSS: this.customCSS,
      customJS: this.customJS
    });

    return clonedElement;
  };

  // Asset methods
  ContentAsset.prototype.incrementUsage = async function() {
    await this.update({ 
      usageCount: this.usageCount + 1 
    });
  };

  ContentAsset.prototype.incrementDownload = async function() {
    await this.update({ 
      downloadCount: this.downloadCount + 1 
    });
  };

  // Template methods
  ContentTemplate.prototype.createProjectFromTemplate = async function(projectName, userId, tenantId) {
    const project = await ContentProject.create({
      tenantId,
      name: projectName,
      templateId: this.id,
      canvasSize: this.canvasSize,
      responsiveBreakpoints: this.responsiveBreakpoints,
      canvasBackground: this.templateData.canvasBackground || { type: 'solid', color: '#ffffff' },
      projectData: this.templateData,
      variables: this.variables,
      createdBy: userId
    });

    // Create elements from template
    if (this.templateData.elements) {
      for (const elementData of this.templateData.elements) {
        await ContentElement.create({
          projectId: project.id,
          ...elementData
        });
      }
    }

    // Increment usage count
    await this.update({ usageCount: this.usageCount + 1 });

    return project;
  };

  return {
    ContentTemplate,
    ContentProject, 
    ContentElement,
    ContentAsset,
    ContentVariable,
    ContentExport,
    ElementLibrary,
    ProjectVersion
  };
};