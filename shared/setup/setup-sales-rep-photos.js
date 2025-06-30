
const setupSalesRepPhotoFeature = async (sequelize, contentService) => {
  console.log('🚀 Setting up Sales Rep Photo Feature...');
  
  try {
    // 1. First check if template already exists
    const existingTemplate = await sequelize.models.ContentTemplate?.findOne({
      where: { 
        name: 'Deal Closed Celebration',
        tenantId: 'system'
      }
    });

    if (existingTemplate) {
      console.log('✅ Template already exists, skipping creation');
      return {
        templateId: existingTemplate.id,
        message: 'Template already exists',
        skipped: true
      };
    }

    // 2. Define the template directly here to avoid import issues
    const templateData = {
      name: "Deal Closed Celebration",
      description: "Celebrate closed deals with sales rep photo and achievement details",
      category: "announcement",
      subcategory: "celebrations",
      thumbnailUrl: "/assets/templates/deal-closed-thumb.png",
      isPublic: true,
      isFeatured: true,
      variables: [
        {
          name: "rep_name",
          displayName: "Sales Rep Name",
          dataType: "string",
          required: true,
          defaultValue: "Sales Champion"
        },
        {
          name: "rep_email",
          displayName: "Sales Rep Email",
          dataType: "string",
          required: true,
          description: "Used to look up the sales rep's photo"
        },
        {
          name: "rep_photo",
          displayName: "Sales Rep Photo",
          dataType: "image",
          required: false,
          description: "Automatically populated from sales rep photos"
        },
        {
          name: "deal_amount",
          displayName: "Deal Amount",
          dataType: "string",
          required: true,
          defaultValue: "$0"
        },
        {
          name: "company_name",
          displayName: "Client Company",
          dataType: "string",
          required: true,
          defaultValue: "New Client"
        },
        {
          name: "celebration_message",
          displayName: "Custom Message",
          dataType: "string",
          required: false,
          defaultValue: "Outstanding Achievement!"
        }
      ],
      canvasSize: {
        width: 1920,
        height: 1080
      },
      backgroundColor: "#1a1a2e",
      templateData: {
        elements: {
          background: {
            elementType: "shape",
            name: "Background Gradient",
            position: { x: 0, y: 0, z: 0 },
            size: { width: 1920, height: 1080 },
            properties: {
              shape: "rectangle",
              fill: "gradient",
              gradientType: "radial",
              gradientColors: ["#1a1a2e", "#16213e", "#0f3460"],
              gradientAngle: 45
            },
            styles: {
              opacity: 1
            }
          },
          confetti: {
            elementType: "animation",
            name: "Confetti Effect",
            position: { x: 0, y: 0, z: 10 },
            size: { width: 1920, height: 1080 },
            properties: {
              animationType: "confetti",
              particleCount: 100,
              duration: 5000,
              colors: ["#ffd700", "#ff6b6b", "#4ecdc4", "#45b7d1"],
              spread: 360,
              startVelocity: 45
            }
          },
          photoContainer: {
            elementType: "shape",
            name: "Photo Container",
            position: { x: 710, y: 200, z: 5 },
            size: { width: 500, height: 500 },
            properties: {
              shape: "circle",
              fill: "solid",
              fillColor: "#ffffff",
              borderWidth: 8,
              borderColor: "#ffd700",
              shadow: {
                enabled: true,
                offsetX: 0,
                offsetY: 10,
                blur: 30,
                color: "rgba(0, 0, 0, 0.3)"
              }
            },
            animations: [
              {
                type: "scale",
                from: { x: 0, y: 0 },
                to: { x: 1, y: 1 },
                duration: 800,
                easing: "easeOutBack",
                delay: 200
              }
            ]
          },
          salesRepPhoto: {
            elementType: "sales_rep_photo",
            name: "Sales Rep Photo",
            position: { x: 720, y: 210, z: 6 },
            size: { width: 480, height: 480 },
            properties: {
              src: "{rep_photo}",
              fit: "cover",
              borderRadius: "50%"
            },
            animations: [
              {
                type: "scale",
                from: { x: 0, y: 0 },
                to: { x: 1, y: 1 },
                duration: 800,
                easing: "easeOutBack",
                delay: 300
              }
            ]
          },
          congratsLabel: {
            elementType: "text",
            name: "Congratulations Label",
            position: { x: 960, y: 100, z: 7 },
            size: { width: 800, height: 80 },
            properties: {
              text: "🎉 CONGRATULATIONS! 🎉",
              fontSize: 48,
              fontFamily: "Montserrat",
              fontWeight: "800",
              color: "#ffd700",
              textAlign: "center",
              textShadow: "2px 2px 4px rgba(0,0,0,0.3)"
            },
            animations: [
              {
                type: "fadeIn",
                duration: 600,
                delay: 0
              }
            ]
          },
          repName: {
            elementType: "text",
            name: "Rep Name",
            position: { x: 960, y: 720, z: 7 },
            size: { width: 1200, height: 100 },
            properties: {
              text: "{rep_name}",
              fontSize: 72,
              fontFamily: "Montserrat",
              fontWeight: "700",
              color: "#ffffff",
              textAlign: "center",
              textShadow: "3px 3px 6px rgba(0,0,0,0.4)"
            },
            animations: [
              {
                type: "slideIn",
                from: "bottom",
                duration: 600,
                delay: 400
              }
            ]
          },
          achievementText: {
            elementType: "text",
            name: "Achievement Text",
            position: { x: 960, y: 820, z: 7 },
            size: { width: 1400, height: 60 },
            properties: {
              text: "just closed a deal with",
              fontSize: 36,
              fontFamily: "Open Sans",
              fontWeight: "400",
              color: "#e0e0e0",
              textAlign: "center"
            },
            animations: [
              {
                type: "fadeIn",
                duration: 600,
                delay: 600
              }
            ]
          },
          companyName: {
            elementType: "text",
            name: "Company Name",
            position: { x: 960, y: 880, z: 7 },
            size: { width: 1400, height: 80 },
            properties: {
              text: "{company_name}",
              fontSize: 64,
              fontFamily: "Montserrat",
              fontWeight: "700",
              color: "#4ecdc4",
              textAlign: "center",
              textShadow: "2px 2px 4px rgba(0,0,0,0.3)"
            },
            animations: [
              {
                type: "slideIn",
                from: "bottom",
                duration: 600,
                delay: 800
              }
            ]
          },
          amountContainer: {
            elementType: "shape",
            name: "Amount Container",
            position: { x: 660, y: 970, z: 6 },
            size: { width: 600, height: 100 },
            properties: {
              shape: "rectangle",
              fill: "solid",
              fillColor: "#ffd700",
              borderRadius: 50,
              shadow: {
                enabled: true,
                offsetX: 0,
                offsetY: 5,
                blur: 15,
                color: "rgba(255, 215, 0, 0.3)"
              }
            },
            animations: [
              {
                type: "scale",
                from: { x: 0, y: 1 },
                to: { x: 1, y: 1 },
                duration: 600,
                easing: "easeOutExpo",
                delay: 1000
              }
            ]
          },
          dealAmount: {
            elementType: "text",
            name: "Deal Amount",
            position: { x: 960, y: 1020, z: 7 },
            size: { width: 600, height: 100 },
            properties: {
              text: "{deal_amount}",
              fontSize: 56,
              fontFamily: "Montserrat",
              fontWeight: "800",
              color: "#1a1a2e",
              textAlign: "center"
            },
            animations: [
              {
                type: "fadeIn",
                duration: 400,
                delay: 1200
              }
            ]
          },
          celebrationMessage: {
            elementType: "text",
            name: "Celebration Message",
            position: { x: 960, y: 50, z: 7 },
            size: { width: 1200, height: 50 },
            properties: {
              text: "{celebration_message}",
              fontSize: 28,
              fontFamily: "Open Sans",
              fontWeight: "600",
              color: "#ffffff",
              textAlign: "center",
              textTransform: "uppercase",
              letterSpacing: 2
            },
            animations: [
              {
                type: "fadeIn",
                duration: 600,
                delay: 1400
              }
            ]
          }
        }
      },
      metadata: {
        source: 'sales-rep-photo-setup',
        version: '1.0.0'
      }
    };
    
    console.log('📝 Creating Deal Closed Celebration template...');
    console.log('Template data:', {
      name: templateData.name,
      category: templateData.category,
      elementsCount: Object.keys(templateData.templateData.elements).length
    });
    
    // FIXED: Correct parameter order - (tenantId, userId, templateData)
    const createdTemplate = await contentService.createTemplate(
      'system', // tenantId
      1, // userId
      templateData // templateData
    );
    
    console.log(`✅ Template created with ID: ${createdTemplate.id}`);
    
    // 3. Create webhook preset configuration
    const webhookPreset = {
      id: 'deal_closed_with_photo',
      name: 'Deal Closed Celebration with Photo',
      description: 'Celebrate closed deals with sales rep photo and achievement details',
      announcementConfig: {
        enabled: true,
        contentCreator: {
          templateId: createdTemplate.id,
          templateName: "Deal Closed Celebration",
          generateNewContent: true,
          variableMapping: {
            rep_name: "rep_name",
            rep_email: "rep_email",
            deal_amount: "deal_amount",
            company_name: "company_name",
            celebration_message: "message"
          },
          defaultValues: {
            rep_name: "Sales Champion",
            deal_amount: "Big Deal",
            company_name: "New Client",
            celebration_message: "Outstanding Achievement!"
          },
          projectSettings: {
            name: "Deal Closed - {rep_name}",
            addTimestamp: false,
            customNamePattern: "Deal Closed - {rep_name} - {company_name}"
          }
        },
        optisigns: {
          displaySelection: {
            mode: 'all'
          },
          takeover: {
            priority: 'HIGH',
            duration: 30,
            restoreAfter: true
          },
          scheduling: {
            immediate: true
          }
        }
      }
    };
    
    console.log('✅ Sales Rep Photo Feature setup complete!');
    
    return {
      templateId: createdTemplate.id,
      webhookPreset: webhookPreset,
      setupInstructions: {
        step1: 'Upload sales rep photos using the /api/sales-rep-photos/upload endpoint',
        step2: 'Set a fallback photo using /api/sales-rep-photos/fallback',
        step3: 'Create a webhook with the deal_closed_with_photo preset',
        step4: 'Map your webhook payload fields to match the template variables'
      }
    };
    
  } catch (error) {
    console.error('❌ Error setting up Sales Rep Photo Feature:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
    throw error;
  }
};

// Integration instructions
const integrationGuide = {
  overview: `
This feature allows you to dynamically display sales rep photos in OptiSign announcements
when deals are closed. Photos are stored as assets and matched by email address.
  `,
  
  quickTest: {
    uploadPhoto: `
curl -X POST http://localhost:3001/api/sales-rep-photos/upload \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -F "photo=@test.jpg" \\
  -F "repEmail=john@company.com" \\
  -F "repName=John Doe"
    `,
    
    testWebhook: `
curl -X POST http://localhost:3001/api/webhooks/endpoint/YOUR_ENDPOINT_KEY \\
  -H "Authorization: Bearer YOUR_WEBHOOK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "salesRep": {
      "name": "John Doe",
      "email": "john@company.com"
    },
    "deal": {
      "value": "$50,000"
    },
    "client": {
      "company": "Acme Corp"
    }
  }'
    `
  }
};

module.exports = {
  setupSalesRepPhotoFeature,
  integrationGuide
};