// shared/content-creation-integration.js
// Enhanced Content Creation integration module with proper exports

const ContentCreationService = require('./content-creation-service');

/**
 * Main initialization function for Content Creation module
 */
function initContentCreation(app, sequelize, authenticateToken, optisignsModels = null) {
  console.log('Initializing Enhanced Content Creation Integration module...');
  
  try {
    // Initialize enhanced content creation models
    const contentModels = require('./content-creation-models')(sequelize, sequelize.Sequelize.DataTypes);
    console.log('Enhanced Content Creation models initialized successfully');
    
    // Initialize enhanced content creation service
    const contentService = new ContentCreationService(contentModels, optisignsModels);
    console.log('Enhanced Content Creation service initialized successfully');
    
    // Initialize enhanced content creation routes
    const contentRoutes = require('./content-creation-routes');
    const routeResult = contentRoutes(app, sequelize, authenticateToken, contentModels, optisignsModels);
    console.log('Enhanced Content Creation routes initialized successfully');
    
    // Setup model associations with existing models if available
    setupExternalAssociations(sequelize, contentModels);
    
    // Initialize default element library
    initializeElementLibrary(contentModels);
    
    console.log('Enhanced Content Creation Integration module initialized successfully');
    
    // Return enhanced module capabilities
    return {
      models: contentModels,
      services: {
        contentService
      },
      capabilities: {
        // Core Features
        templateSystem: true,
        projectManagement: true,
        dragAndDropCanvas: true,
        variableInjection: true,
        assetManagement: true,
        
        // Enhanced Features
        responsiveDesign: true,
        versionControl: true,
        elementLibrary: true,
        
        // Media Processing
        videoProcessing: true,
        imageProcessing: true,
        audioProcessing: true,
        thumbnailGeneration: true,
        streamingSupport: true,
        
        // Element Types
        textElements: true,
        mediaElements: true,
        interactiveElements: true,
        formElements: true,
        layoutElements: true,
        chartElements: true,
        socialElements: true,
        graphicsElements: true,
        effectsElements: true,
        advancedElements: true,
        
        // Export & Integration
        preview: true,
        multiDevicePreview: true,
        optisignsIntegration: !!optisignsModels
      },
      videoProcessingCapabilities: {
        thumbnailGeneration: true,
        multipleQualities: ['480p', '720p', '1080p'],
        formats: ['mp4', 'webm'],
        streaming: true,
        compression: ['high', 'medium', 'low']
      }
    };
  } catch (error) {
    console.error('Failed to initialize Enhanced Content Creation Integration module:', error);
    throw error;
  }
}

/**
 * Setup associations with external models if they exist
 */
function setupExternalAssociations(sequelize, contentModels) {
  try {
    console.log('Setting up Enhanced Content Creation external model associations...');
    
    // Get existing models
    const existingModels = sequelize.models;
    
    // User associations for created_by and uploaded_by fields
    if (existingModels.User) {
      console.log('Setting up Enhanced User associations...');
      
      // Templates
      contentModels.ContentTemplate.belongsTo(existingModels.User, {
        foreignKey: 'createdBy',
        as: 'creator',
        constraints: false
      });
      
      // Projects
      contentModels.ContentProject.belongsTo(existingModels.User, {
        foreignKey: 'createdBy',
        as: 'creator',
        constraints: false
      });
      
      contentModels.ContentProject.belongsTo(existingModels.User, {
        foreignKey: 'lastEditedBy',
        as: 'lastEditor',
        constraints: false
      });
      
      // Assets
      contentModels.ContentAsset.belongsTo(existingModels.User, {
        foreignKey: 'uploadedBy',
        as: 'uploader',
        constraints: false
      });
      
      // Exports
      contentModels.ContentExport.belongsTo(existingModels.User, {
        foreignKey: 'createdBy',
        as: 'creator',
        constraints: false
      });

      // Element Library
      contentModels.ElementLibrary.belongsTo(existingModels.User, {
        foreignKey: 'createdBy',
        as: 'creator',
        constraints: false
      });

      // Project Versions
      contentModels.ProjectVersion.belongsTo(existingModels.User, {
        foreignKey: 'createdBy',
        as: 'creator',
        constraints: false
      });
      
      console.log('✅ Enhanced User associations established');
    } else {
      console.log('⚠️  User model not found, skipping user associations');
    }
    
    // Lead associations for variable data context
    if (existingModels.Lead) {
      console.log('Setting up Enhanced Lead context associations...');
      
      // Add enhanced instance method to Lead for getting content context
      existingModels.Lead.prototype.getContentContext = function() {
        return {
          lead: {
            id: this.id,
            name: this.name,
            email: this.email,
            phone: this.phone,
            status: this.status,
            source: this.source,
            createdAt: this.createdAt,
            customFields: this.customFields || {}
          }
        };
      };
      
      console.log('✅ Enhanced Lead context methods added');
    } else {
      console.log('⚠️  Lead model not found, skipping lead associations');
    }
    
    // Tenant associations for multi-tenancy support
    if (existingModels.Tenant) {
      console.log('Setting up Enhanced Tenant associations...');
      
      // Add enhanced instance method to Tenant for getting content context
      existingModels.Tenant.prototype.getContentContext = function() {
        return {
          tenant: {
            id: this.id,
            name: this.name,
            timezone: this.timezone,
            apiConfig: this.apiConfig,
            schedule: this.schedule,
            dialerConfig: this.dialerConfig
          }
        };
      };
      
      console.log('✅ Enhanced Tenant context methods added');
    } else {
      console.log('⚠️  Tenant model not found, skipping tenant associations');
    }
    
    console.log('✅ Enhanced Content Creation external associations setup complete');
    
  } catch (error) {
    console.error('Error setting up enhanced external associations:', error);
    // Don't throw - this is not critical for core functionality
  }
}

/**
 * Initialize default element library with comprehensive element types
 */
async function initializeElementLibrary(contentModels) {
  try {
    console.log('Initializing Enhanced Element Library...');
    
    const defaultElements = [
      // Text Elements
      {
        name: 'Basic Text',
        description: 'Simple text element with customizable styling',
        elementType: 'text',
        category: 'Text',
        subcategory: 'Basic',
        isPublic: true,
        isFeatured: true,
        difficulty: 'beginner',
        tags: ['text', 'basic', 'typography'],
        defaultProperties: { 
          text: 'Your text here', 
          textAlign: 'left',
          fontFamily: 'Arial, sans-serif',
          fontWeight: '400',
          fontStyle: 'normal',
          textDecoration: 'none',
          textTransform: 'none',
          letterSpacing: '0px',
          lineHeight: '1.5'
        },
        defaultStyles: { 
          fontSize: '16px', 
          color: '#000000', 
          fontFamily: 'Arial, sans-serif',
          fontWeight: '400',
          letterSpacing: '0px',
          lineHeight: '1.5'
        }
      },
      {
        name: 'Marquee Text',
        description: 'Scrolling text element for announcements',
        elementType: 'marquee_text',
        category: 'Text',
        subcategory: 'Animated',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['text', 'animated', 'scrolling', 'marquee'],
        defaultProperties: { text: 'Breaking news...', direction: 'left', speed: 50 },
        defaultStyles: { fontSize: '24px', color: '#ffffff', backgroundColor: '#ef4444' }
      },
      {
        name: 'Typewriter Text',
        description: 'Text that appears character by character',
        elementType: 'typewriter_text',
        category: 'Text',
        subcategory: 'Animated',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['text', 'animated', 'typewriter', 'effect'],
        defaultProperties: { 
          text: 'Welcome to our service!',
          speed: 80,
          cursor: true,
          sound: false
        },
        defaultStyles: { 
          fontSize: '32px', 
          color: '#2563eb', 
          fontFamily: 'Courier New, monospace',
          fontWeight: 'bold'
        }
      },
      {
        name: 'Gradient Text',
        description: 'Text with gradient color effects',
        elementType: 'gradient_text',
        category: 'Text',
        subcategory: 'Styled',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['text', 'gradient', 'colorful', 'styled'],
        defaultProperties: { 
          text: 'Gradient Text',
          gradientType: 'linear',
          gradientAngle: 45,
          gradientColors: ['#667eea', '#764ba2']
        },
        defaultStyles: { 
          fontSize: '48px', 
          fontWeight: 'bold',
          fontFamily: 'Arial, sans-serif',
          background: 'linear-gradient(45deg, #667eea 0%, #764ba2 100%)',
          '-webkit-background-clip': 'text',
          '-webkit-text-fill-color': 'transparent'
        }
      },
      {
        name: 'Shadow Text',
        description: 'Text with customizable shadow effects',
        elementType: 'shadow_text',
        category: 'Text',
        subcategory: 'Styled',
        isPublic: true,
        difficulty: 'beginner',
        tags: ['text', 'shadow', 'styled', 'effect'],
        defaultProperties: { 
          text: 'Shadow Text',
          shadowType: 'drop',
          shadowBlur: 4,
          shadowOffsetX: 2,
          shadowOffsetY: 2,
          shadowColor: 'rgba(0,0,0,0.3)'
        },
        defaultStyles: { 
          fontSize: '36px', 
          color: '#1a202c',
          fontWeight: 'bold',
          textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
        }
      },
      {
        name: 'Outline Text',
        description: 'Text with outline stroke effect',
        elementType: 'outline_text',
        category: 'Text',
        subcategory: 'Styled',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['text', 'outline', 'stroke', 'styled'],
        defaultProperties: { 
          text: 'Outline Text',
          strokeWidth: 2,
          strokeColor: '#000000',
          fillColor: '#ffffff'
        },
        defaultStyles: { 
          fontSize: '42px', 
          color: '#ffffff',
          fontWeight: 'bold',
          '-webkit-text-stroke': '2px #000000',
          '-webkit-text-fill-color': '#ffffff'
        }
      },

      // Interactive Elements
      {
        name: 'Call-to-Action Button',
        description: 'Interactive button with hover effects',
        elementType: 'button',
        category: 'Interactive',
        subcategory: 'Buttons',
        isPublic: true,
        isFeatured: true,
        difficulty: 'beginner',
        tags: ['button', 'cta', 'interactive', 'click'],
        defaultProperties: { 
          text: 'Click Me!',
          action: 'redirect',
          url: '#',
          target: '_blank'
        },
        defaultStyles: { 
          backgroundColor: '#3b82f6',
          color: '#ffffff',
          padding: '12px 24px',
          borderRadius: '8px',
          border: 'none',
          fontSize: '16px',
          fontWeight: 'bold',
          cursor: 'pointer'
        }
      },
      {
        name: 'Image Hotspot',
        description: 'Interactive hotspot over images',
        elementType: 'image_hotspot',
        category: 'Interactive',
        subcategory: 'Advanced',
        isPublic: true,
        difficulty: 'advanced',
        tags: ['hotspot', 'interactive', 'image', 'tooltip'],
        defaultProperties: { 
          hotspots: [
            { x: 50, y: 50, label: 'Click here', action: 'tooltip', content: 'Information' }
          ],
          pulseAnimation: true,
          hotspotColor: '#ef4444'
        },
        defaultStyles: { 
          position: 'relative',
          width: '100%',
          height: '100%'
        }
      },
      {
        name: 'Accordion',
        description: 'Expandable content sections',
        elementType: 'accordion',
        category: 'Interactive',
        subcategory: 'Layout',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['accordion', 'expandable', 'interactive', 'faq'],
        defaultProperties: { 
          items: [
            { title: 'Section 1', content: 'Content for section 1', isOpen: true },
            { title: 'Section 2', content: 'Content for section 2', isOpen: false }
          ],
          allowMultiple: false,
          animationSpeed: 300
        },
        defaultStyles: { 
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          backgroundColor: '#ffffff'
        }
      },
      {
        name: 'Tabs',
        description: 'Tabbed content navigation',
        elementType: 'tabs',
        category: 'Interactive',
        subcategory: 'Layout',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['tabs', 'navigation', 'interactive', 'organize'],
        defaultProperties: { 
          tabs: [
            { id: 'tab1', label: 'Tab 1', content: 'Content for tab 1', active: true },
            { id: 'tab2', label: 'Tab 2', content: 'Content for tab 2', active: false }
          ],
          tabStyle: 'underline',
          tabPosition: 'top'
        },
        defaultStyles: { 
          backgroundColor: '#ffffff',
          borderRadius: '8px'
        }
      },

      // Effects Elements



      {
        name: 'Confetti Burst',
        description: 'Celebration confetti animation',
        elementType: 'confetti',
        category: 'Effects',
        subcategory: 'Animations',
        isPublic: true,
        isFeatured: true,
        difficulty: 'intermediate',
        tags: ['confetti', 'celebration', 'animation', 'particles'],
        defaultProperties: {
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'],
          duration: 3000,
          trigger: 'onLoad'
        },
        defaultStyles: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }
      },
      {
        name: 'Particle System',
        description: 'Customizable particle effects',
        elementType: 'particles',
        category: 'Effects',
        subcategory: 'Animations',
        isPublic: true,
        difficulty: 'advanced',
        tags: ['particles', 'effects', 'animation', 'background'],
        defaultProperties: {
          particleCount: 50,
          particleSize: { min: 2, max: 6 },
          particleSpeed: { min: 0.5, max: 2 },
          particleColor: '#3b82f6',
          movementType: 'float',
          interactive: false
        },
        defaultStyles: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }
      },
      {
        name: 'Snow Animation',
        description: 'Falling snow particle effect',
        elementType: 'snow_animation',
        category: 'Effects',
        subcategory: 'Seasonal',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['snow', 'winter', 'animation', 'particles', 'seasonal'],
        defaultProperties: {
          snowflakeCount: 100,
          fallSpeed: { min: 1, max: 3 },
          snowflakeSize: { min: 5, max: 15 },
          windEffect: true,
          accumulation: false
        },
        defaultStyles: { 
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        }
      },
      {
        name: 'Fireworks',
        description: 'Animated fireworks display',
        elementType: 'fireworks',
        category: 'Effects',
        subcategory: 'Celebration',
        isPublic: true,
        difficulty: 'advanced',
        tags: ['fireworks', 'celebration', 'animation', 'effects'],
        defaultProperties: {
          launchInterval: 1000,
          explosionSize: 100,
          colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'],
          soundEnabled: false,
          autoPlay: true,
          duration: 10000
        },
        defaultStyles: { 
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%'
        }
      },

      // Advanced Elements
      {
        name: 'QR Code Generator',
        description: 'Dynamic QR code with customizable data',
        elementType: 'qr_code',
        category: 'Advanced',
        subcategory: 'Utilities',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['qr', 'code', 'generator', 'scan'],
        defaultProperties: {
          data: 'https://example.com',
          size: 200,
          errorCorrectionLevel: 'M',
          includeMargin: true,
          backgroundColor: '#ffffff',
          foregroundColor: '#000000'
        },
        defaultStyles: { borderRadius: '8px', padding: '16px', backgroundColor: '#ffffff' }
      },

      // Chart Elements
      {
        name: 'Progress Bar',
        description: 'Animated progress indicator',
        elementType: 'progress_bar',
        category: 'Charts',
        subcategory: 'Indicators',
        isPublic: true,
        difficulty: 'beginner',
        tags: ['progress', 'bar', 'percentage', 'indicator'],
        defaultProperties: {
          value: 75,
          max: 100,
          showLabel: true,
          animated: true,
          duration: 2000
        },
        defaultStyles: {
          width: '300px',
          height: '20px',
          backgroundColor: '#e5e7eb',
          borderRadius: '10px'
        }
      },
      {
        name: 'Pie Chart',
        description: 'Interactive pie chart visualization',
        elementType: 'pie_chart',
        category: 'Charts',
        subcategory: 'Data',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['chart', 'pie', 'data', 'visualization'],
        defaultProperties: {
          data: [
            { label: 'Category A', value: 30, color: '#3b82f6' },
            { label: 'Category B', value: 25, color: '#ef4444' },
            { label: 'Category C', value: 45, color: '#10b981' }
          ],
          showLabels: true,
          showLegend: true,
          animateOnLoad: true
        },
        defaultStyles: {
          width: '400px',
          height: '400px'
        }
      },
      {
        name: 'Bar Chart',
        description: 'Responsive bar chart visualization',
        elementType: 'bar_chart',
        category: 'Charts',
        subcategory: 'Data',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['chart', 'bar', 'data', 'visualization', 'graph'],
        defaultProperties: {
          data: [
            { label: 'Jan', value: 65 },
            { label: 'Feb', value: 80 },
            { label: 'Mar', value: 75 },
            { label: 'Apr', value: 90 }
          ],
          orientation: 'vertical',
          showGrid: true,
          animateOnLoad: true,
          barColor: '#3b82f6'
        },
        defaultStyles: {
          width: '600px',
          height: '400px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          padding: '20px'
        }
      },
      {
        name: 'Line Chart',
        description: 'Smooth line chart for trends',
        elementType: 'line_chart',
        category: 'Charts',
        subcategory: 'Data',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['chart', 'line', 'trend', 'data', 'graph'],
        defaultProperties: {
          datasets: [
            {
              label: 'Sales',
              data: [30, 45, 60, 55, 70, 85, 90],
              color: '#3b82f6',
              smooth: true
            }
          ],
          xLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          showGrid: true,
          showDots: true,
          fillArea: false
        },
        defaultStyles: {
          width: '600px',
          height: '400px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          padding: '20px'
        }
      },
// Full Page Animation Elements
{
  name: 'Matrix Rain',
  description: 'Digital rain effect like the Matrix movie',
  elementType: 'matrix_rain',
  category: 'Effects',
  subcategory: 'Full Page',
  isPublic: true,
  difficulty: 'intermediate',
  tags: ['matrix', 'rain', 'digital', 'animation', 'fullpage'],
  defaultProperties: {
    dropSpeed: { min: 5, max: 15 },      // Character drop speed
    dropFrequency: 0.95,                  // Frequency of new drops (0-1)
    characters: '01',                     // Characters to use
    useKatakana: true,                    // Include Japanese characters
    fontSize: 16,                         // Character size
    columnGap: 20,                        // Space between columns
    fadeLength: 8,                        // Fade trail length
    glowEffect: true,                     // Glow effect on characters
    color: '#00ff00'                      // Character color
  },
  defaultStyles: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
    overflow: 'hidden',
    zIndex: -1
  }
},

{
  name: 'Starfield',
  description: 'Animated starfield with depth effect',
  elementType: 'starfield',
  category: 'Effects',
  subcategory: 'Full Page',
  isPublic: true,
  difficulty: 'intermediate',
  tags: ['stars', 'space', 'animation', 'fullpage', 'background'],
  defaultProperties: {
    starCount: 200,                       // Number of stars
    starSpeed: { min: 0.5, max: 3 },      // Star movement speed
    starSize: { min: 1, max: 3 },         // Star size range
    twinkle: true,                        // Twinkling effect
    shootingStars: true,                  // Enable shooting stars
    shootingStarFrequency: 0.01,          // Shooting star frequency
    direction: 'forward',                 // 'forward', 'backward', 'radial'
    colorVariation: true,                 // Vary star colors
    baseColors: ['#ffffff', '#ffffd0', '#ffffe0', '#e0e0ff']
  },
  defaultStyles: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#000033',
    overflow: 'hidden'
  }
},

{
  name: 'Ocean Waves',
  description: 'Animated ocean waves with foam effect',
  elementType: 'ocean_waves',
  category: 'Effects',
  subcategory: 'Full Page',
  isPublic: true,
  difficulty: 'advanced',
  tags: ['ocean', 'waves', 'water', 'animation', 'fullpage'],
  defaultProperties: {
    waveCount: 3,                         // Number of wave layers
    waveSpeed: 2,                         // Wave animation speed
    waveHeight: 100,                      // Wave height in pixels
    waveComplexity: 3,                    // Wave shape complexity
    foamEffect: true,                     // Show foam on waves
    reflections: true,                    // Water reflections
    particleSpray: true,                  // Spray particles
    colors: {
      deep: '#003366',                    // Deep water color
      shallow: '#0066cc',                 // Shallow water color
      foam: '#ffffff'                     // Foam color
    }
  },
  defaultStyles: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'linear-gradient(to bottom, #87ceeb 0%, #0066cc 50%, #003366 100%)',
    overflow: 'hidden'
  }
},

{
  name: 'Geometric Pulse',
  description: 'Pulsing geometric patterns',
  elementType: 'geometric_pulse',
  category: 'Effects',
  subcategory: 'Full Page',
  isPublic: true,
  difficulty: 'intermediate',
  tags: ['geometric', 'pulse', 'patterns', 'animation', 'fullpage'],
  defaultProperties: {
    shapeType: 'hexagon',                 // 'hexagon', 'triangle', 'square', 'circle'
    gridSize: 50,                         // Size of each shape
    pulseSpeed: 2,                        // Pulse animation speed
    pulseDelay: 0.1,                      // Delay between pulses
    rotateShapes: true,                   // Rotate shapes
    colorShift: true,                     // Color shifting effect
    strokeWidth: 2,                       // Shape stroke width
    fillOpacity: 0.1,                     // Shape fill opacity
    colors: ['#3b82f6', '#8b5cf6', '#ec4899']  // Color palette
  },
  defaultStyles: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#0a0a0a',
    overflow: 'hidden'
  }
},


{
  name: 'Raining Money',
  description: 'Money bills falling from the sky animation',
  elementType: 'raining_money',
  category: 'Effects',
  subcategory: 'Full Page',
  isPublic: true,
  isFeatured: true,
  difficulty: 'intermediate',
  tags: ['money', 'rain', 'cash', 'animation', 'celebration', 'fullpage'],
  defaultProperties: {
    billCount: 50,                        // Number of bills
    billTypes: ['$1', '$5', '$10', '$20', '$50', '$100'],  // Bill denominations
    fallSpeed: { min: 2, max: 5 },        // Fall speed range
    swayAmount: 100,                      // Horizontal sway amount
    rotationSpeed: { min: 1, max: 3 },    // Rotation speed
    billSize: { min: 60, max: 120 },      // Bill size range
    continuous: true,                     // Continuous generation
    duration: null,                       // Duration (null for infinite)
    currency: 'USD',                      // Currency type
    customImages: [],                     // Custom bill images
    sound: false,                         // Cash register sound
    fadeOut: true,                        // Fade bills at bottom
    colors: {
      '$1': '#85bb65',                    // Dollar bill green
      '$5': '#e8b5a6',                    // Light pink
      '$10': '#f7d7a8',                   // Light yellow
      '$20': '#b8c5d6',                   // Light blue
      '$50': '#d4a4c8',                   // Light purple
      '$100': '#85bb65'                   // Dollar bill green
    }
  },
  defaultStyles: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    overflow: 'hidden',
    zIndex: 100
  }
},

{
  name: 'Aurora Borealis',
  description: 'Northern lights animation effect',
  elementType: 'aurora_borealis',
  category: 'Effects',
  subcategory: 'Full Page',
  isPublic: true,
  difficulty: 'advanced',
  tags: ['aurora', 'northern lights', 'animation', 'fullpage', 'sky'],
  defaultProperties: {
    waveCount: 4,                         // Number of aurora waves
    waveSpeed: 0.5,                       // Wave movement speed
    intensity: 0.7,                       // Light intensity (0-1)
    shimmer: true,                        // Shimmering effect
    stars: true,                          // Background stars
    colors: [
      '#00ff00',                          // Green
      '#00ffff',                          // Cyan
      '#ff00ff',                          // Magenta
      '#ffff00'                           // Yellow
    ],
    blendMode: 'screen'                   // Color blend mode
  },
  defaultStyles: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#000033',
    overflow: 'hidden'
  }
},

{
  name: 'Bubble Float',
  description: 'Floating bubbles with physics',
  elementType: 'bubble_float',
  category: 'Effects',
  subcategory: 'Full Page',
  isPublic: true,
  difficulty: 'intermediate',
  tags: ['bubbles', 'float', 'animation', 'fullpage', 'fun'],
  defaultProperties: {
    bubbleCount: 30,                      // Number of bubbles
    sizeRange: { min: 20, max: 80 },      // Bubble size range
    riseSpeed: { min: 1, max: 3 },        // Rising speed
    wobbleAmount: 20,                     // Horizontal wobble
    popOnClick: true,                     // Pop bubbles on click
    generateNew: true,                    // Generate new bubbles
    opacity: 0.3,                         // Bubble opacity
    shimmer: true,                        // Shimmer effect
    colors: ['#ffffff', '#e0f2ff', '#c7e9ff']  // Bubble colors
  },
  defaultStyles: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'linear-gradient(to bottom, #87ceeb 0%, #e0f2ff 100%)',
    overflow: 'hidden'
  }
},

{
  name: 'Lightning Storm',
  description: 'Animated lightning strikes',
  elementType: 'lightning_storm',
  category: 'Effects',
  subcategory: 'Full Page',
  isPublic: true,
  difficulty: 'advanced',
  tags: ['lightning', 'storm', 'thunder', 'animation', 'fullpage'],
  defaultProperties: {
    strikeFrequency: 3,                   // Strikes per 10 seconds
    branchComplexity: 4,                  // Lightning branch complexity
    glowIntensity: 2,                     // Glow effect intensity
    thunderSound: false,                  // Enable thunder sound
    rainEffect: true,                     // Show rain
    flashDuration: 200,                   // Flash duration (ms)
    colors: {
      lightning: '#ffffff',               // Lightning color
      glow: '#9999ff',                    // Glow color
      sky: '#1a1a2e'                      // Sky color
    }
  },
  defaultStyles: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#1a1a2e',
    overflow: 'hidden'
  }
},

{
  name: 'Floating Hearts',
  description: 'Romantic floating hearts animation',
  elementType: 'floating_hearts',
  category: 'Effects',
  subcategory: 'Full Page',
  isPublic: true,
  difficulty: 'beginner',
  tags: ['hearts', 'love', 'romance', 'animation', 'fullpage'],
  defaultProperties: {
    heartCount: 20,                       // Number of hearts
    sizeRange: { min: 20, max: 60 },      // Heart size range
    floatSpeed: { min: 1, max: 3 },       // Float speed
    swayAmount: 30,                       // Horizontal sway
    rotationSpeed: 1,                     // Rotation speed
    fadeInOut: true,                      // Fade in/out effect
    pulseEffect: true,                    // Pulsing hearts
    colors: ['#ff1744', '#ff4569', '#ff6b96', '#ff8fab']  // Heart colors
  },
  defaultStyles: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'linear-gradient(to bottom, #ffe0e6 0%, #ffb3c1 100%)',
    overflow: 'hidden'
  }
},

{
  name: 'Falling Leaves',
  description: 'Autumn leaves falling animation',
  elementType: 'falling_leaves',
  category: 'Effects',
  subcategory: 'Full Page',
  isPublic: true,
  difficulty: 'intermediate',
  tags: ['leaves', 'autumn', 'fall', 'animation', 'fullpage'],
  defaultProperties: {
    leafCount: 30,                        // Number of leaves
    leafTypes: ['maple', 'oak', 'birch'], // Leaf shapes
    fallSpeed: { min: 1, max: 3 },        // Falling speed
    swayAmount: 50,                       // Horizontal sway
    rotationSpeed: { min: 0.5, max: 2 },  // Rotation speed
    sizeRange: { min: 30, max: 80 },      // Leaf size range
    colors: [
      '#ff6b35',                          // Orange
      '#f7931e',                          // Dark orange
      '#ff0000',                          // Red
      '#8b0000',                          // Dark red
      '#ffd700'                           // Gold
    ]
  },
  defaultStyles: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'linear-gradient(to bottom, #87ceeb 0%, #f0e68c 100%)',
    overflow: 'hidden'
  }
},

{
  name: 'Neon Pulse',
  description: 'Pulsing neon light effects',
  elementType: 'neon_pulse',
  category: 'Effects',
  subcategory: 'Full Page',
  isPublic: true,
  difficulty: 'intermediate',
  tags: ['neon', 'pulse', 'glow', 'animation', 'fullpage'],
  defaultProperties: {
    gridPattern: 'lines',                 // 'lines', 'grid', 'circuit', 'random'
    pulseSpeed: 2,                        // Pulse speed
    pulseIntensity: 0.8,                  // Pulse intensity (0-1)
    glowRadius: 20,                       // Glow blur radius
    lineWidth: 2,                         // Line thickness
    flickerEffect: true,                  // Random flicker
    traceAnimation: true,                 // Trace along lines
    colors: [
      '#ff00ff',                          // Magenta
      '#00ffff',                          // Cyan
      '#ffff00',                          // Yellow
      '#ff0099'                           // Pink
    ]
  },
  defaultStyles: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#0a0a0a',
    overflow: 'hidden'
  }
},

      // Media Elements
      {
        name: 'Video Player',
        description: 'Responsive video player with controls',
        elementType: 'video',
        category: 'Media',
        subcategory: 'Video',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['video', 'player', 'media', 'streaming'],
        defaultProperties: {
          src: '',
          autoplay: false,
          loop: false,
          muted: true,
          controls: true,
          poster: ''
        },
        defaultStyles: {
          width: '640px',
          height: '360px',
          borderRadius: '8px',
          backgroundColor: '#000000'
        }
      },
      {
        name: 'Standard Photo',
        description: 'Direct image from URL without upload requirement',
        elementType: 'standard_photo',
        category: 'Media',
        subcategory: 'Image',
        isPublic: true,
        difficulty: 'beginner',
        tags: ['photo', 'image', 'url', 'direct', 'standard'],
        defaultProperties: {
          imageUrl: '',
          alt: 'Standard Photo',
          objectFit: 'cover', // 'cover', 'contain', 'fill', 'scale-down', 'none'
          objectPosition: 'center',
          loading: 'lazy', // 'lazy', 'eager'
          crossOrigin: 'anonymous', // 'anonymous', 'use-credentials', null
          showPlaceholder: true,
          placeholderText: 'Enter image URL...',
          placeholderColor: '#f3f4f6',
          errorFallback: true,
          errorText: 'Image failed to load',
          errorColor: '#ef4444',
          showLoadingState: true,
          loadingText: 'Loading image...',
          loadingColor: '#6b7280'
        },
        defaultStyles: {
          width: '400px',
          height: '300px',
          borderRadius: '8px',
          backgroundColor: '#f9fafb',
          border: '1px solid #e5e7eb',
          objectFit: 'cover',
          objectPosition: 'center',
          display: 'block'
        }
      },
      
      {
        name: 'Image Carousel',
        description: 'Sliding image gallery',
        elementType: 'image_carousel',
        category: 'Media',
        subcategory: 'Gallery',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['carousel', 'slider', 'gallery', 'images'],
        defaultProperties: {
          images: [],
          autoPlay: true,
          interval: 3000,
          showIndicators: true,
          showArrows: true,
          transitionType: 'slide',
          infiniteLoop: true
        },
        defaultStyles: {
          width: '800px',
          height: '400px',
          borderRadius: '8px',
          overflow: 'hidden'
        }
      },
      {
        name: 'Audio Player',
        description: 'Custom audio player with visualizer',
        elementType: 'audio_player',
        category: 'Media',
        subcategory: 'Audio',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['audio', 'player', 'music', 'sound'],
        defaultProperties: {
          src: '',
          showVisualizer: true,
          visualizerType: 'bars',
          autoplay: false,
          loop: false,
          showPlaylist: false
        },
        defaultStyles: {
          width: '400px',
          height: '120px',
          backgroundColor: '#1a202c',
          borderRadius: '8px',
          padding: '20px'
        }
      },

      // Social Elements
      {
        name: 'Social Icons',
        description: 'Collection of social media icons',
        elementType: 'social_icons',
        category: 'Social',
        subcategory: 'Icons',
        isPublic: true,
        difficulty: 'beginner',
        tags: ['social', 'icons', 'media', 'links'],
        defaultProperties: {
          platforms: ['facebook', 'twitter', 'instagram', 'linkedin'],
          style: 'rounded',
          size: 'medium',
          gap: '12px'
        },
        defaultStyles: {
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }
      },

      // Form Elements
      {
        name: 'Contact Form',
        description: 'Basic contact form with validation',
        elementType: 'contact_form',
        category: 'Forms',
        subcategory: 'Input',
        isPublic: true,
        difficulty: 'intermediate',
        tags: ['form', 'contact', 'input', 'email'],
        defaultProperties: {
          fields: [
            { type: 'text', name: 'name', label: 'Name', required: true },
            { type: 'email', name: 'email', label: 'Email', required: true },
            { type: 'textarea', name: 'message', label: 'Message', required: true }
          ],
          submitText: 'Send Message',
          successMessage: 'Thank you for contacting us!',
          action: 'email',
          recipient: ''
        },
        defaultStyles: {
          width: '400px',
          padding: '20px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }
      },
      {
        name: 'Survey Form',
        description: 'Multi-step survey with progress indicator',
        elementType: 'survey_form',
        category: 'Forms',
        subcategory: 'Input',
        isPublic: true,
        difficulty: 'advanced',
        tags: ['form', 'survey', 'questionnaire', 'feedback'],
        defaultProperties: {
          steps: [
            {
              title: 'Step 1',
              questions: [
                { type: 'radio', question: 'How satisfied are you?', options: ['Very', 'Somewhat', 'Not'] }
              ]
            }
          ],
          showProgress: true,
          allowBack: true,
          submitAction: 'webhook',
          webhookUrl: ''
        },
        defaultStyles: {
          width: '600px',
          minHeight: '400px',
          padding: '30px',
          backgroundColor: '#ffffff',
          borderRadius: '12px'
        }
      }
    ];

    // Create default elements (only if they don't exist)
    let createdCount = 0;
    for (const elementData of defaultElements) {
      try {
        const [element, created] = await contentModels.ElementLibrary.findOrCreate({
          where: { 
            elementType: elementData.elementType,
            name: elementData.name,
            isPublic: true
          },
          defaults: {
            ...elementData,
            tenantId: 'system', // Use 'system' for global elements
            createdBy: 1 // System user
          }
        });
        
        if (created) {
          createdCount++;
        }
      } catch (error) {
        console.error(`Failed to create element "${elementData.name}":`, error.message);
      }
    }
    
    console.log(`✅ Initialized ${createdCount} new elements in Enhanced Element Library`);
    console.log(`📚 Total available element types: ${defaultElements.length}`);
    
  } catch (error) {
    console.error('Error initializing Enhanced Element Library:', error);
    // Don't throw - this is not critical for core functionality
  }
}

/**
 * Create enhanced default templates for a new tenant
 */
async function createDefaultTemplates(tenantId, userId, contentService) {
  try {
    console.log(`Creating enhanced default templates for tenant ${tenantId}...`);
    
    const defaultTemplates = [
      {
        name: 'Modern Welcome Screen',
        description: 'A sleek, modern welcome screen with animations',
        category: 'welcome_screen',
        canvasSize: { width: 1920, height: 1080 },
        responsiveBreakpoints: {
          mobile: { width: 375, height: 667 },
          tablet: { width: 768, height: 1024 },
          desktop: { width: 1920, height: 1080 }
        },
        elements: {
          background: {
            elementType: 'shape',
            position: { x: 0, y: 0, z: 0 },
            size: { width: 1920, height: 1080 },
            properties: { shape: 'rectangle' },
            styles: { 
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
            }
          },
          particles: {
            elementType: 'particles',
            position: { x: 0, y: 0, z: 1 },
            size: { width: 1920, height: 1080 },
            properties: {
              particleCount: 30,
              particleSize: { min: 2, max: 4 },
              particleSpeed: { min: 0.3, max: 1 },
              particleColor: '#ffffff',
              movementType: 'float',
              interactive: false
            }
          },
          title: {
            elementType: 'typewriter_text',
            position: { x: 960, y: 400, z: 2 },
            size: { width: 800, height: 120 },
            properties: { 
              text: 'Welcome, {lead.name}!',
              speed: 80,
              cursor: true
            },
            styles: {
              fontSize: '64px',
              fontWeight: 'bold',
              color: '#ffffff',
              fontFamily: 'Arial, sans-serif',
              textAlign: 'center'
            }
          },
          subtitle: {
            elementType: 'text',
            position: { x: 960, y: 550, z: 2 },
            size: { width: 600, height: 60 },
            properties: { 
              text: 'We\'re excited to help you succeed!'
            },
            styles: {
              fontSize: '24px',
              color: '#ffffff',
              fontFamily: 'Arial, sans-serif',
              textAlign: 'center',
              opacity: '0.9'
            }
          },
          cta_button: {
            elementType: 'button',
            position: { x: 960, y: 700, z: 2 },
            size: { width: 200, height: 60 },
            properties: { 
              text: 'Get Started',
              action: 'redirect',
              url: '#start'
            },
            styles: {
              backgroundColor: '#ffffff',
              color: '#667eea',
              fontSize: '18px',
              fontWeight: 'bold',
              borderRadius: '30px',
              border: 'none',
              boxShadow: '0 4px 15px rgba(255,255,255,0.3)'
            }
          }
        },
        variables: {
          'lead.name': { type: 'text', default: 'Friend' }
        },
        isPublic: false,
        tags: ['welcome', 'modern', 'animated', 'professional'],
        difficulty: 'beginner',
        estimatedTime: 15
      },
      
      // Emergency Announcement Template
      {
        name: 'Emergency Announcement',
        description: 'High-visibility emergency announcement template',
        category: 'announcement',
        canvasSize: { width: 1920, height: 1080 },
        elements: {
          background: {
            elementType: 'shape',
            position: { x: 0, y: 0, z: 0 },
            size: { width: 1920, height: 1080 },
            properties: { shape: 'rectangle' },
            styles: { 
              background: 'linear-gradient(45deg, #dc2626 0%, #991b1b 100%)'
            }
          },
          alert_icon: {
            elementType: 'icon',
            position: { x: 960, y: 200, z: 2 },
            size: { width: 120, height: 120 },
            properties: { 
              icon: 'warning',
              size: 'xl'
            },
            styles: {
              color: '#ffffff',
              animation: 'pulse 2s infinite'
            }
          },
          alert_text: {
            elementType: 'marquee_text',
            position: { x: 0, y: 350, z: 2 },
            size: { width: 1920, height: 100 },
            properties: { 
              text: 'EMERGENCY: {announcement.message}',
              direction: 'left',
              speed: 100
            },
            styles: {
              fontSize: '72px',
              fontWeight: 'bold',
              color: '#ffffff',
              backgroundColor: 'rgba(0,0,0,0.3)',
              padding: '20px'
            }
          },
          instructions: {
            elementType: 'text',
            position: { x: 960, y: 500, z: 2 },
            size: { width: 1200, height: 200 },
            properties: { 
              text: '{announcement.instructions}',
              textAlign: 'center'
            },
            styles: {
              fontSize: '36px',
              color: '#ffffff',
              lineHeight: '1.5',
              backgroundColor: 'rgba(0,0,0,0.2)',
              padding: '40px',
              borderRadius: '20px'
            }
          },
          countdown: {
            elementType: 'countdown_text',
            position: { x: 960, y: 750, z: 2 },
            size: { width: 600, height: 100 },
            properties: { 
              targetDate: '{announcement.expires}',
              format: 'MM:SS',
              showLabels: false
            },
            styles: {
              fontSize: '64px',
              fontWeight: 'bold',
              color: '#ffffff',
              textAlign: 'center',
              backgroundColor: 'rgba(0,0,0,0.5)',
              borderRadius: '20px',
              padding: '20px'
            }
          }
        },
        variables: {
          'announcement.message': { type: 'text', default: 'Emergency Alert' },
          'announcement.instructions': { type: 'text', default: 'Please follow emergency procedures and evacuate if necessary.' },
          'announcement.expires': { type: 'datetime', default: '' }
        },
        isPublic: true,
        tags: ['emergency', 'announcement', 'alert', 'urgent'],
        difficulty: 'intermediate',
        estimatedTime: 20
      }
    ];
    
    const createdTemplates = [];
    for (const templateData of defaultTemplates) {
      try {
        const template = await contentService.createTemplate(tenantId, userId, templateData);
        createdTemplates.push(template);
      } catch (error) {
        console.error(`Failed to create enhanced template "${templateData.name}":`, error.message);
      }
    }
    
    console.log(`✅ Created ${createdTemplates.length} enhanced default templates for tenant ${tenantId}`);
    return createdTemplates;
  } catch (error) {
    console.error('Error creating enhanced default templates:', error);
    return [];
  }
}

// Attach helper functions to the main export
initContentCreation.createDefaultTemplates = createDefaultTemplates;
initContentCreation.setupExternalAssociations = setupExternalAssociations;
initContentCreation.initializeElementLibrary = initializeElementLibrary;

// Export the main initialization function
module.exports = initContentCreation;