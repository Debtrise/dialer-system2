// SMS Backend Application

// Required packages
const express = require('express');
const multer = require('multer');
const csv = require('fast-csv');
const fs = require('fs');
const { Sequelize, DataTypes, Op } = require('sequelize');
const Twilio = require('twilio');
const path = require('path');

// PostgreSQL connection
const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
  host: 'localhost',
  dialect: 'postgres',
  logging: false
});

// Define models
const TwilioNumber = sequelize.define('TwilioNumber', {
  phoneNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  accountSid: {
    type: DataTypes.STRING,
    allowNull: false
  },
  authToken: {
    type: DataTypes.STRING,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('available', 'in_use', 'disabled'),
    defaultValue: 'available'
  },
  lastUsed: {
    type: DataTypes.DATE,
    allowNull: true
  },
  messagesCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
});

const Contact = sequelize.define('Contact', {
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'failed', 'replied'),
    defaultValue: 'pending'
  },
  customFields: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  twilioNumberId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'TwilioNumbers',
      key: 'id'
    }
  },
  lastConversationAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
});

const Message = sequelize.define('Message', {
  contactId: {
    type: DataTypes.INTEGER,
    references: {
      model: Contact,
      key: 'id'
    }
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  direction: {
    type: DataTypes.ENUM('outbound', 'inbound'),
    defaultValue: 'outbound'
  },
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'failed', 'delivered', 'received'),
    defaultValue: 'pending'
  },
  sentAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  twilioSid: {
    type: DataTypes.STRING,
    allowNull: true
  },
  twilioNumberId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'TwilioNumbers',
      key: 'id'
    }
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  }
});

const Campaign = sequelize.define('Campaign', {
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  messageTemplate: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  rateLimit: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 60 // messages per hour
  },
  status: {
    type: DataTypes.ENUM('draft', 'active', 'paused', 'completed'),
    defaultValue: 'draft'
  },
  totalContacts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  sentCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  failedCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  replyTemplate: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  autoReplyEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
});

// NEW: Notification model
const Notification = sequelize.define('Notification', {
  type: {
    type: DataTypes.ENUM('message_received', 'campaign_completed', 'send_failed', 'system', 'custom'),
    allowNull: false
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high'),
    defaultValue: 'medium'
  }
});

// Create associations
Campaign.hasMany(Contact);
Contact.belongsTo(Campaign);
Contact.hasMany(Message);
Message.belongsTo(Contact);
Contact.belongsTo(TwilioNumber, { foreignKey: 'twilioNumberId' });
TwilioNumber.hasMany(Contact, { foreignKey: 'twilioNumberId' });
Message.belongsTo(TwilioNumber, { foreignKey: 'twilioNumberId' });
TwilioNumber.hasMany(Message, { foreignKey: 'twilioNumberId' });

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Function to get a Twilio client for a specific number
function getTwilioClient(twilioNumber) {
  return new Twilio(
    twilioNumber.accountSid,
    twilioNumber.authToken
  );
}

// NEW: Function to create a system notification
async function createNotification(type, title, message, metadata = {}, priority = 'medium') {
  try {
    await Notification.create({
      type,
      title,
      message,
      metadata,
      priority
    });
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

// Create a new campaign
app.post('/campaigns', async (req, res) => {
  try {
    const { name, messageTemplate, rateLimit } = req.body;
    
    if (!name || !messageTemplate) {
      return res.status(400).json({ error: 'Name and message template are required' });
    }
    
    const campaign = await Campaign.create({
      name,
      messageTemplate,
      rateLimit: rateLimit || 60
    });
    
    res.status(201).json(campaign);
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// Upload contacts CSV for a campaign
app.post('/campaigns/:campaignId/upload', upload.single('contacts'), async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10); // Parse as integer
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    let contactCount = 0;
    const contacts = [];
    const errors = [];
    
    // Process CSV
    fs.createReadStream(req.file.path)
      .pipe(csv.parse({ headers: true }))
      .on('error', error => {
        console.error('Error parsing CSV:', error);
        return res.status(400).json({ error: 'Invalid CSV file' });
      })
      .on('data', async row => {
        // Validate phone number (basic check)
        const phone = row.phone?.trim();
        if (!phone) {
          errors.push(`Missing phone number in row: ${JSON.stringify(row)}`);
          return;
        }
        
        // Extract known fields
        const { name, email, ...customFields } = row;
        
        contacts.push({
          phone,
          name: name || null,
          email: email || null,
          customFields,
          CampaignId: campaignId,
          status: 'pending'
        });
        
        contactCount++;
      })
      .on('end', async () => {
        try {
          if (contacts.length === 0) {
            // Delete temp file
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ 
              error: 'No valid contacts found in CSV',
              errors
            });
          }
          
          // Bulk insert contacts
          const createdContacts = await Contact.bulkCreate(contacts, {
            ignoreDuplicates: true
          });
          
          // Update campaign stats
          await campaign.update({
            totalContacts: campaign.totalContacts + createdContacts.length
          });
          
          // Delete temp file
          fs.unlinkSync(req.file.path);
          
          res.json({ 
            message: `Uploaded ${createdContacts.length} contacts`,
            campaign: await Campaign.findByPk(campaignId),
            errors: errors.length > 0 ? errors : undefined
          });
        } catch (error) {
          console.error('Error saving contacts:', error);
          res.status(500).json({ error: 'Failed to save contacts' });
        }
      });
  } catch (error) {
    console.error('Error uploading contacts:', error);
    res.status(500).json({ error: 'Failed to upload contacts' });
  }
});

// Import CSV with campaign assignment
app.post('/contacts/import', upload.single('contacts'), async (req, res) => {
  try {
    // Get campaign ID from query params or body
    const campaignId = parseInt(req.query.campaignId || req.body.campaignId, 10);
    
    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    let contactCount = 0;
    const contacts = [];
    const errors = [];
    
    // Process CSV
    fs.createReadStream(req.file.path)
      .pipe(csv.parse({ headers: true }))
      .on('error', error => {
        console.error('Error parsing CSV:', error);
        return res.status(400).json({ error: 'Invalid CSV file' });
      })
      .on('data', async row => {
        // Validate phone number (basic check)
        const phone = row.phone?.trim();
        if (!phone) {
          errors.push(`Missing phone number in row: ${JSON.stringify(row)}`);
          return;
        }
        
        // Extract known fields and campaign ID if specified
        const { name, email, campaignId: rowCampaignId, ...customFields } = row;
        
        // Use row-specific campaign ID if provided, otherwise use the default
        const useCampaignId = rowCampaignId ? parseInt(rowCampaignId, 10) : campaignId;
        
        if (isNaN(useCampaignId)) {
          errors.push(`Invalid campaign ID for row: ${JSON.stringify(row)}`);
          return;
        }
        
        contacts.push({
          phone,
          name: name || null,
          email: email || null,
          customFields,
          CampaignId: useCampaignId,
          status: 'pending'
        });
        
        contactCount++;
      })
      .on('end', async () => {
        try {
          if (contacts.length === 0) {
            // Delete temp file
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ 
              error: 'No valid contacts found in CSV',
              errors
            });
          }
          
          // Bulk insert contacts
          const createdContacts = await Contact.bulkCreate(contacts, {
            ignoreDuplicates: true
          });
          
          // Update campaign stats for each affected campaign
          const campaignCounts = {};
          
          for (const contact of contacts) {
            campaignCounts[contact.CampaignId] = (campaignCounts[contact.CampaignId] || 0) + 1;
          }
          
          for (const [camId, count] of Object.entries(campaignCounts)) {
            const camp = await Campaign.findByPk(camId);
            if (camp) {
              await camp.update({
                totalContacts: camp.totalContacts + count
              });
            }
          }
          
          // Delete temp file
          fs.unlinkSync(req.file.path);
          
          res.json({ 
            message: `Uploaded ${createdContacts.length} contacts`,
            campaignCounts,
            errors: errors.length > 0 ? errors : undefined
          });
        } catch (error) {
          console.error('Error saving contacts:', error);
          res.status(500).json({ error: 'Failed to save contacts' });
        }
      });
  } catch (error) {
    console.error('Error importing contacts:', error);
    res.status(500).json({ error: 'Failed to import contacts' });
  }
});

// NEW: Enhanced CSV import with field mapping
app.post('/contacts/import-with-mapping', upload.single('contacts'), async (req, res) => {
  try {
    // Get campaign ID from query params or body
    const campaignId = parseInt(req.query.campaignId || req.body.campaignId, 10);
    
    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    // Get field mapping from request body
    const fieldMapping = req.body.fieldMapping;
    if (!fieldMapping || typeof fieldMapping !== 'object') {
      return res.status(400).json({ error: 'Field mapping is required' });
    }
    
    // Validate required mappings
    if (!fieldMapping.phone) {
      return res.status(400).json({ error: 'Phone field mapping is required' });
    }
    
    let contactCount = 0;
    const contacts = [];
    const errors = [];
    
    // Process CSV with field mapping
    fs.createReadStream(req.file.path)
      .pipe(csv.parse({ headers: true }))
      .on('error', error => {
        console.error('Error parsing CSV:', error);
        return res.status(400).json({ error: 'Invalid CSV file' });
      })
      .on('data', async row => {
        // Apply field mapping
        const phone = row[fieldMapping.phone]?.trim();
        if (!phone) {
          errors.push(`Missing phone number in row: ${JSON.stringify(row)}`);
          return;
        }
        
        // Extract mapped fields
        let name = null;
        if (fieldMapping.name) {
          name = row[fieldMapping.name];
        } else if (fieldMapping.firstName && fieldMapping.lastName) {
          name = `${row[fieldMapping.firstName] || ''} ${row[fieldMapping.lastName] || ''}`.trim();
        }
        
        const email = fieldMapping.email ? row[fieldMapping.email] : null;
        
        // Handle custom fields
        const customFields = {};
        Object.entries(row).forEach(([key, value]) => {
          // Skip fields that are already mapped
          if (key !== fieldMapping.phone && 
              key !== fieldMapping.name && 
              key !== fieldMapping.email &&
              key !== fieldMapping.firstName &&
              key !== fieldMapping.lastName) {
            customFields[key] = value;
          }
        });
        
        contacts.push({
          phone,
          name: name || null,
          email: email || null,
          customFields,
          CampaignId: campaignId,
          status: 'pending'
        });
        
        contactCount++;
      })
      .on('end', async () => {
        try {
          if (contacts.length === 0) {
            // Delete temp file
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ 
              error: 'No valid contacts found in CSV',
              errors
            });
          }
          
          // Bulk insert contacts
          const createdContacts = await Contact.bulkCreate(contacts, {
            ignoreDuplicates: true
          });
          
          // Update campaign stats
          await campaign.update({
            totalContacts: campaign.totalContacts + createdContacts.length
          });
          
          // Delete temp file
          fs.unlinkSync(req.file.path);
          
          // Create a notification
          await createNotification(
            'system',
            'Contacts Imported',
            `Successfully imported ${createdContacts.length} contacts to campaign "${campaign.name}"`,
            {
              campaignId: campaign.id,
              campaignName: campaign.name,
              contactCount: createdContacts.length,
              errorCount: errors.length
            }
          );
          
          res.json({ 
            message: `Imported ${createdContacts.length} contacts with field mapping`,
            campaign: await Campaign.findByPk(campaignId),
            errors: errors.length > 0 ? errors : undefined
          });
        } catch (error) {
          console.error('Error saving contacts:', error);
          res.status(500).json({ error: 'Failed to save contacts' });
        }
      });
  } catch (error) {
    console.error('Error importing contacts with mapping:', error);
    res.status(500).json({ error: 'Failed to import contacts' });
  }
});

// Assign leads to a campaign
app.post('/campaigns/:campaignId/assign-leads', async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const { leads } = req.body;
    
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'Leads array is required and cannot be empty' });
    }
    
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    const contacts = [];
    const errors = [];
    
    // Process each lead
    for (const lead of leads) {
      // Validate phone number (basic check)
      const phone = lead.phone?.trim();
      if (!phone) {
        errors.push(`Missing phone number for lead: ${JSON.stringify(lead)}`);
        continue;
      }
      
      // Extract known fields
      const { name, email, campaignId: leadCampaignId, ...customFields } = lead;
      
      // Use lead-specific campaign ID if provided, otherwise use the default
      const useCampaignId = leadCampaignId ? parseInt(leadCampaignId, 10) : campaignId;
      
      if (isNaN(useCampaignId)) {
        errors.push(`Invalid campaign ID for lead: ${JSON.stringify(lead)}`);
        continue;
      }
      
      contacts.push({
        phone,
        name: name || null,
        email: email || null,
        customFields,
        CampaignId: useCampaignId,
        status: 'pending'
      });
    }
    
    // Bulk insert contacts
    const createdContacts = await Contact.bulkCreate(contacts, {
      ignoreDuplicates: true
    });
    
    // Update campaign stats for each affected campaign
    const campaignCounts = {};
    
    for (const contact of contacts) {
      campaignCounts[contact.CampaignId] = (campaignCounts[contact.CampaignId] || 0) + 1;
    }
    
    for (const [camId, count] of Object.entries(campaignCounts)) {
      const camp = await Campaign.findByPk(camId);
      if (camp) {
        await camp.update({
          totalContacts: camp.totalContacts + count
        });
      }
    }
    
    res.status(200).json({
      message: `Assigned ${createdContacts.length} leads to campaigns`,
      campaignCounts,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error assigning leads:', error);
    res.status(500).json({ error: 'Failed to assign leads' });
  }
});

// Assign a single lead to a campaign
app.post('/campaigns/:campaignId/lead', async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const leadData = req.body;
    
    if (!leadData || !leadData.phone) {
      return res.status(400).json({ error: 'Lead data with phone number is required' });
    }
    
    // Allow overriding campaign ID in the lead data
    const targetCampaignId = leadData.campaignId ? parseInt(leadData.campaignId, 10) : campaignId;
    
    const campaign = await Campaign.findByPk(targetCampaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    // Extract known fields
    const { phone, name, email, campaignId: _, ...customFields } = leadData;
    
    // Create the contact
    const [contact, created] = await Contact.findOrCreate({
      where: {
        phone: phone.trim(),
        CampaignId: targetCampaignId
      },
      defaults: {
        name: name || null,
        email: email || null,
        customFields,
        status: 'pending'
      }
    });
    
    // If the contact already existed, we can optionally update it
    if (!created && req.query.update === 'true') {
      await contact.update({
        name: name || contact.name,
        email: email || contact.email,
        customFields: { ...contact.customFields, ...customFields }
      });
    }
    
    // Only update campaign stats if we created a new contact
    if (created) {
      await campaign.update({
        totalContacts: campaign.totalContacts + 1
      });
    }
    
    res.status(created ? 201 : 200).json({
      message: created ? 'Lead assigned to campaign' : 'Lead already exists in campaign',
      contact,
      created
    });
  } catch (error) {
    console.error('Error assigning lead:', error);
    res.status(500).json({ error: 'Failed to assign lead' });
  }
});

// Move contacts between campaigns
app.post('/contacts/move', async (req, res) => {
  try {
    const { contactIds, targetCampaignId } = req.body;
    
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ error: 'Contact IDs array is required and cannot be empty' });
    }
    
    if (!targetCampaignId) {
      return res.status(400).json({ error: 'Target campaign ID is required' });
    }
    
    const targetCampaign = await Campaign.findByPk(targetCampaignId);
    if (!targetCampaign) {
      return res.status(404).json({ error: 'Target campaign not found' });
    }
    
    // Get the current campaigns for these contacts to update stats
    const contacts = await Contact.findAll({
      where: {
        id: contactIds
      },
      attributes: ['id', 'CampaignId']
    });
    
    if (contacts.length === 0) {
      return res.status(404).json({ error: 'No contacts found with the provided IDs' });
    }
    
    // Count contacts per campaign
    const campaignCounts = {};
    for (const contact of contacts) {
      campaignCounts[contact.CampaignId] = (campaignCounts[contact.CampaignId] || 0) + 1;
    }
    
    // Move contacts to the new campaign
    await Contact.update(
      { CampaignId: targetCampaignId },
      { where: { id: contactIds } }
    );
    
    // Update campaign stats for source campaigns (decrease count)
    for (const [camId, count] of Object.entries(campaignCounts)) {
      const camp = await Campaign.findByPk(camId);
      if (camp) {
        await camp.update({
          totalContacts: Math.max(0, camp.totalContacts - count)
        });
      }
    }
    
    // Update target campaign stats (increase count)
    await targetCampaign.update({
      totalContacts: targetCampaign.totalContacts + contacts.length
    });
    
    res.json({
      message: `Moved ${contacts.length} contacts to campaign ${targetCampaignId}`,
      affectedCampaigns: Object.keys(campaignCounts).concat(targetCampaignId)
    });
  } catch (error) {
    console.error('Error moving contacts:', error);
    res.status(500).json({ error: 'Failed to move contacts' });
  }
});

// Get all leads/contacts for a campaign
app.get('/campaigns/:campaignId/leads', async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    // Parse query parameters
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = (page - 1) * limit;
    
    // Filter by status if provided
    const whereClause = { 
      CampaignId: campaignId 
    };
    
    if (req.query.status) {
      whereClause.status = req.query.status;
    }
    
    // Search by phone or name if provided
    if (req.query.search) {
      whereClause[Op.or] = [
        { phone: { [Op.iLike]: `%${req.query.search}%` } },
        { name: { [Op.iLike]: `%${req.query.search}%` } },
        { email: { [Op.iLike]: `%${req.query.search}%` } }
      ];
    }
   
    // Get contacts with pagination
    const { count, rows: contacts } = await Contact.findAndCountAll({
      where: whereClause,
      limit,
      offset,
      order: [['id', 'ASC']]
    });
    
    res.json({
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
      contacts
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// Start a campaign
app.post('/campaigns/:campaignId/start', async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (campaign.status === 'completed') {
      return res.status(400).json({ error: 'Campaign already completed' });
    }
    
    await campaign.update({ status: 'active' });
    
    // Start the SMS sending process
    processCampaign(campaignId);
    
    res.json({ message: 'Campaign started', campaign });
  } catch (error) {
    console.error('Error starting campaign:', error);
    res.status(500).json({ error: 'Failed to start campaign' });
  }
});

// Pause a campaign
app.post('/campaigns/:campaignId/pause', async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (campaign.status !== 'active') {
      return res.status(400).json({ error: 'Campaign is not active' });
    }
    
    await campaign.update({ status: 'paused' });
    
    res.json({ message: 'Campaign paused', campaign });
  } catch (error) {
    console.error('Error pausing campaign:', error);
    res.status(500).json({ error: 'Failed to pause campaign' });
  }
});

// Get campaign status
app.get('/campaigns/:campaignId', async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    // Get contact counts by status
    const contactStats = await Contact.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: { CampaignId: campaignId },
      group: ['status']
    });
    
    // Format the stats
    const stats = {
      pending: 0,
      sent: 0,
      failed: 0,
      replied: 0
    };
    
    contactStats.forEach(stat => {
      stats[stat.status] = parseInt(stat.get('count'), 10);
    });
    
    res.json({
      ...campaign.toJSON(),
      contactStats: stats
    });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// List all campaigns
app.get('/campaigns', async (req, res) => {
  try {
    // Parse query parameters
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;
    
    // Filter by status if provided
    const whereClause = {};
    
    if (req.query.status) {
      whereClause.status = req.query.status;
    }
    
    // Search by name if provided
    if (req.query.search) {
      whereClause.name = { [Op.iLike]: `%${req.query.search}%` };
    }
    
    const { count, rows: campaigns } = await Campaign.findAndCountAll({
      where: whereClause,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });
    
    res.json({
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
      campaigns
    });
  } catch (error) {
    console.error('Error listing campaigns:', error);
    res.status(500).json({ error: 'Failed to list campaigns' });
  }
});

// Update campaign rate limit
app.patch('/campaigns/:campaignId/rate-limit', async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const { rateLimit } = req.body;
    
    if (!rateLimit || rateLimit <= 0) {
      return res.status(400).json({ error: 'Invalid rate limit' });
    }
    
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    await campaign.update({ rateLimit });
    
    res.json({ message: 'Rate limit updated', campaign });
  } catch (error) {
    console.error('Error updating rate limit:', error);
    res.status(500).json({ error: 'Failed to update rate limit' });
  }
});

// Set up auto-reply for a campaign
app.patch('/campaigns/:campaignId/auto-reply', async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const { autoReplyEnabled, replyTemplate } = req.body;
    
    if (autoReplyEnabled && !replyTemplate) {
      return res.status(400).json({ error: 'Reply template is required when enabling auto-reply' });
    }
    
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    await campaign.update({ 
      autoReplyEnabled: autoReplyEnabled ?? campaign.autoReplyEnabled,
      replyTemplate: replyTemplate ?? campaign.replyTemplate
    });
    
    res.json({ message: 'Auto-reply settings updated', campaign });
  } catch (error) {
    console.error('Error updating auto-reply settings:', error);
    res.status(500).json({ error: 'Failed to update auto-reply settings' });
  }
});

// NEW: Clear all unresponded messages for a campaign
app.post('/campaigns/:campaignId/clear-unresponded', async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    // Find all replied contacts in this campaign
    const contacts = await Contact.findAll({
      where: {
        CampaignId: campaignId,
        status: 'replied'
      }
    });
    
    const resolvedContacts = [];
    
    // For each contact, check if their last message is inbound
    for (const contact of contacts) {
      const lastMessage = await Message.findOne({
        where: { contactId: contact.id },
        order: [['sentAt', 'DESC']]
      });
      
      if (lastMessage && lastMessage.direction === 'inbound') {
        // Create a system message to mark as resolved
        await Message.create({
          contactId: contact.id,
          content: '[Bulk resolved by system]',
          direction: 'outbound',
          status: 'sent',
          sentAt: new Date(),
          twilioNumberId: contact.twilioNumberId
        });
        
        resolvedContacts.push(contact.id);
      }
    }
    
    // Create a notification
    await createNotification(
      'system',
      'Unresponded Messages Cleared',
      `Cleared ${resolvedContacts.length} unresponded messages for campaign "${campaign.name}"`,
      {
        campaignId,
        campaignName: campaign.name,
        resolvedCount: resolvedContacts.length
      }
    );
    
    res.json({
      message: `Cleared ${resolvedContacts.length} unresponded messages for campaign ${campaignId}`,
      resolvedCount: resolvedContacts.length
    });
  } catch (error) {
    console.error('Error clearing unresponded messages:', error);
    res.status(500).json({ error: 'Failed to clear unresponded messages' });
  }
});

// Add Twilio number
app.post('/twilio-numbers', async (req, res) => {
  try {
    const { phoneNumber, accountSid, authToken } = req.body;
    
    if (!phoneNumber || !accountSid || !authToken) {
      return res.status(400).json({ error: 'Phone number, account SID, and auth token are required' });
    }
    
    // Validate the Twilio credentials
    try {
      const testClient = new Twilio(accountSid, authToken);
      await testClient.api.accounts(accountSid).fetch();
    } catch (error) {
      return res.status(400).json({ error: 'Invalid Twilio credentials' });
    }
    
    const twilioNumber = await TwilioNumber.create({
      phoneNumber,
      accountSid,
      authToken,
      status: 'available'
    });
    
    // Remove auth token from response for security
    const numberResponse = twilioNumber.toJSON();
    delete numberResponse.authToken;
    
    res.status(201).json(numberResponse);
  } catch (error) {
    console.error('Error adding Twilio number:', error);
    res.status(500).json({ error: 'Failed to add Twilio number' });
  }
});

// Upload Twilio numbers via CSV
app.post('/twilio-numbers/upload', upload.single('numbers'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    let numbersCount = 0;
    const numbers = [];
    let errors = [];
    
    // Process CSV
    fs.createReadStream(req.file.path)
      .pipe(csv.parse({ headers: true }))
      .on('error', error => {
        console.error('Error parsing CSV:', error);
        return res.status(400).json({ error: 'Invalid CSV file' });
      })
      .on('data', async row => {
        const phoneNumber = row.phoneNumber?.trim();
        const accountSid = row.accountSid?.trim();
        const authToken = row.authToken?.trim();
        
        if (!phoneNumber || !accountSid || !authToken) {
          errors.push(`Row missing required fields: ${JSON.stringify(row)}`);
          return;
        }
        
        numbers.push({
          phoneNumber,
          accountSid,
          authToken,
          status: 'available'
        });
        
        numbersCount++;
      })
      .on('end', async () => {
        try {
          // Bulk insert Twilio numbers
          await TwilioNumber.bulkCreate(numbers, {
            ignoreDuplicates: true
          });
          
          // Delete temp file
          fs.unlinkSync(req.file.path);
          
          res.json({ 
            message: `Uploaded ${numbersCount} Twilio numbers`,
            errors: errors.length > 0 ? errors : undefined
          });
        } catch (error) {
          console.error('Error saving Twilio numbers:', error);
          res.status(500).json({ error: 'Failed to save Twilio numbers' });
        }
      });
  } catch (error) {
    console.error('Error uploading Twilio numbers:', error);
    res.status(500).json({ error: 'Failed to upload Twilio numbers' });
  }
});

// List Twilio numbers
app.get('/twilio-numbers', async (req, res) => {
  try {
    const twilioNumbers = await TwilioNumber.findAll({
      attributes: { exclude: ['authToken'] } // Exclude auth token for security
    });
    res.json(twilioNumbers);
  } catch (error) {
    console.error('Error listing Twilio numbers:', error);
    res.status(500).json({ error: 'Failed to list Twilio numbers' });
  }
});

// NEW: Delete a Twilio number
app.delete('/twilio-numbers/:numberId', async (req, res) => {
  try {
    const numberId = parseInt(req.params.numberId, 10);
    
    // Check if number exists
    const twilioNumber = await TwilioNumber.findByPk(numberId);
    if (!twilioNumber) {
      return res.status(404).json({ error: 'Twilio number not found' });
    }
    
    // Check if number is in use with active campaigns
    const activeContacts = await Contact.count({
      where: {
        twilioNumberId: numberId,
        status: 'pending'
      },
      include: [{
        model: Campaign,
        where: {
          status: 'active'
        },
        required: true
      }]
    });
    
    if (activeContacts > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete Twilio number that is in use by active campaigns',
        activeContacts
      });
    }
    
    // Find all contacts using this number
    const affectedContacts = await Contact.count({
      where: { twilioNumberId: numberId }
    });
    
    // Find all messages using this number
    const affectedMessages = await Message.count({
      where: { twilioNumberId: numberId }
    });
    
    // Decide based on query param whether to reassign or delete related records
    const shouldReassign = req.query.reassign === 'true';
    
    if (shouldReassign) {
      // Find another available number to reassign
      const replacementNumber = await TwilioNumber.findOne({
        where: {
          id: { [Op.ne]: numberId },
          status: ['available', 'in_use']
        }
      });
      
      if (replacementNumber) {
        // Reassign contacts and messages
        await Contact.update(
          { twilioNumberId: replacementNumber.id },
          { where: { twilioNumberId: numberId } }
        );
        
        await Message.update(
          { twilioNumberId: replacementNumber.id },
          { where: { twilioNumberId: numberId } }
        );
        
        // Update replacement number stats
        await replacementNumber.update({
          messagesCount: replacementNumber.messagesCount + affectedMessages,
          lastUsed: new Date(),
          status: 'in_use'
        });
      } else {
        // No replacement found, just null out the references
        await Contact.update(
          { twilioNumberId: null },
          { where: { twilioNumberId: numberId } }
        );
        
        // Keep the message history intact but remove the association
        await Message.update(
          { twilioNumberId: null },
          { where: { twilioNumberId: numberId } }
        );
      }
    }
    
    // Delete the Twilio number
    await twilioNumber.destroy();
    
    // Create a system notification about the deletion
    await createNotification(
      'system',
      'Twilio Number Deleted',
      `Twilio number ${twilioNumber.phoneNumber} has been deleted from the system.${
        shouldReassign ? ' Associated contacts and messages have been reassigned.' : ''
      }`,
      {
        phoneNumber: twilioNumber.phoneNumber,
        affectedContacts,
        affectedMessages,
        reassigned: shouldReassign
      }
    );
    
    res.json({
      message: 'Twilio number deleted successfully',
      affectedContacts,
      affectedMessages,
      reassigned: shouldReassign
    });
  } catch (error) {
    console.error('Error deleting Twilio number:', error);
    res.status(500).json({ error: 'Failed to delete Twilio number' });
  }
});

// NEW: Bulk delete Twilio numbers
app.post('/twilio-numbers/bulk-delete', async (req, res) => {
  try {
    const { numberIds } = req.body;
    
    if (!Array.isArray(numberIds) || numberIds.length === 0) {
      return res.status(400).json({ error: 'Number IDs array is required' });
    }
    
    // Check if numbers exist
    const twilioNumbers = await TwilioNumber.findAll({
      where: { id: numberIds }
    });
    
    if (twilioNumbers.length !== numberIds.length) {
      return res.status(404).json({ 
        error: 'One or more Twilio numbers not found',
        found: twilioNumbers.length,
        requested: numberIds.length
      });
    }
    
    // Check if numbers are in use with active campaigns
    const activeContacts = await Contact.count({
      where: {
        twilioNumberId: numberIds,
        status: 'pending'
      },
      include: [{
        model: Campaign,
        where: {
          status: 'active'
        },
        required: true
      }]
    });
    
    if (activeContacts > 0 && req.query.force !== 'true') {
      return res.status(400).json({ 
        error: 'Cannot delete Twilio numbers that are in use by active campaigns. Use ?force=true to override.',
        activeContacts
      });
    }
    
    // Find all contacts using these numbers
    const affectedContacts = await Contact.count({
      where: { twilioNumberId: numberIds }
    });
    
    // Find all messages using these numbers
    const affectedMessages = await Message.count({
      where: { twilioNumberId: numberIds }
    });
    
    // Decide based on query param whether to reassign or delete related records
    const shouldReassign = req.query.reassign === 'true';
    
    if (shouldReassign) {
      // Null out references for now (could be more sophisticated)
      await Contact.update(
        { twilioNumberId: null },
        { where: { twilioNumberId: numberIds } }
      );
      
      await Message.update(
        { twilioNumberId: null },
        { where: { twilioNumberId: numberIds } }
      );
    }
    
    // Delete the Twilio numbers
    const deleted = await TwilioNumber.destroy({
      where: { id: numberIds }
    });
    
    // Create a system notification about the deletion
    await createNotification(
      'system',
      'Multiple Twilio Numbers Deleted',
      `${deleted} Twilio numbers have been deleted from the system.`,
      {
        numberCount: deleted,
        affectedContacts,
        affectedMessages,
        reassigned: shouldReassign
      }
    );
    
    res.json({
      message: `${deleted} Twilio numbers deleted successfully`,
      affectedContacts,
      affectedMessages,
      reassigned: shouldReassign
    });
  } catch (error) {
    console.error('Error bulk deleting Twilio numbers:', error);
    res.status(500).json({ error: 'Failed to delete Twilio numbers' });
  }
});

// Send manual reply to a contact
app.post('/contacts/:contactId/reply', async (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const contact = await Contact.findByPk(contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    // If no twilio number is associated yet, assign one
    let twilioNumber;
    if (!contact.twilioNumberId) {
      twilioNumber = await TwilioNumber.findOne({
        where: {
          status: 'available'
        },
        order: [
          ['lastUsed', 'ASC'],
          ['messagesCount', 'ASC']
        ]
      });
      
      if (!twilioNumber) {
        twilioNumber = await TwilioNumber.findOne({
          where: {
            status: 'in_use'
          },
          order: [
            ['lastUsed', 'ASC'],
            ['messagesCount', 'ASC']
          ]
        });
      }
      
      if (!twilioNumber) {
        return res.status(400).json({ error: 'No available Twilio numbers found' });
      }
      
      // Update contact with the Twilio number
      await contact.update({ twilioNumberId: twilioNumber.id });
    } else {
      twilioNumber = await TwilioNumber.findByPk(contact.twilioNumberId);
      if (!twilioNumber) {
        return res.status(404).json({ error: 'Associated Twilio number not found' });
      }
    }
    
    // Send the reply
    const sentMessage = await sendReply(contactId, twilioNumber.id, message);
    
    res.json({ message: 'Reply sent', sentMessage });
  } catch (error) {
    console.error('Error sending reply:', error);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

// Get conversation for a contact
app.get('/contacts/:contactId/conversation', async (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    
    const contact = await Contact.findByPk(contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    const messages = await Message.findAll({
      where: { contactId },
      order: [['sentAt', 'ASC']]
    });
    
    res.json({
      contact,
      messages
    });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// NEW: Get all unresponded messages
app.get('/unresponded-messages', async (req, res) => {
  try {
    // Parse query parameters
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = (page - 1) * limit;
    
    // Filter by campaign if provided
    const whereClause = {};
    if (req.query.campaignId) {
      whereClause.CampaignId = parseInt(req.query.campaignId, 10);
    }
    
    // Get all contacts with replied status
    const { count, rows: contacts } = await Contact.findAndCountAll({
      where: {
        ...whereClause,
        status: 'replied'
      },
      include: [
        {
          model: Message,
          required: true,
          order: [['sentAt', 'DESC']],
          limit: 1,
          where: {
            direction: 'inbound'
          }
        },
        {
          model: Campaign,
          attributes: ['id', 'name']
        }
      ],
      limit,
      offset,
      order: [['lastConversationAt', 'DESC']]
    });
    
    // Get the last message for each contact
    const contactsWithLastMessage = await Promise.all(
      contacts.map(async contact => {
        const lastMessage = await Message.findOne({
          where: { contactId: contact.id },
          order: [['sentAt', 'DESC']]
        });
        
        const lastInboundMessage = await Message.findOne({
          where: { 
            contactId: contact.id,
            direction: 'inbound'
          },
          order: [['sentAt', 'DESC']]
        });
        
        const lastOutboundMessage = await Message.findOne({
          where: { 
            contactId: contact.id,
            direction: 'outbound'
          },
          order: [['sentAt', 'DESC']]
        });
        
        // Calculate if this is unresponded (last message was inbound)
        const isUnresponded = lastMessage && 
                            lastMessage.direction === 'inbound' &&
                            (!lastOutboundMessage || 
                             new Date(lastInboundMessage.sentAt) > new Date(lastOutboundMessage.sentAt));
        
        return {
          ...contact.toJSON(),
          lastMessage,
          lastInboundMessage,
          lastOutboundMessage,
          isUnresponded,
          unrespondedDuration: isUnresponded ? 
            Math.floor((new Date() - new Date(lastInboundMessage.sentAt)) / (1000 * 60)) : // minutes
            0
        };
      })
    );
    
    // Filter to only truly unresponded messages
    const unrespondedContacts = contactsWithLastMessage.filter(contact => contact.isUnresponded);
    
    res.json({
      total: unrespondedContacts.length,
      page,
      totalPages: Math.ceil(unrespondedContacts.length / limit),
      unrespondedContacts
    });
  } catch (error) {
    console.error('Error fetching unresponded messages:', error);
    res.status(500).json({ error: 'Failed to fetch unresponded messages' });
  }
});

// NEW: Mark messages as responded/resolved
app.post('/unresponded-messages/mark-resolved', async (req, res) => {
  try {
    const { contactIds } = req.body;
    
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ error: 'Contact IDs array is required' });
    }
    
    // Create a system message for each contact
    const systemResponses = [];
    
    for (const contactId of contactIds) {
      const contact = await Contact.findByPk(contactId);
      if (!contact) {
        continue;
      }
      
      // Create a system message to mark as resolved
      const message = await Message.create({
        contactId,
        content: '[Marked as resolved by system]',
        direction: 'outbound',
        status: 'sent',
        sentAt: new Date(),
        twilioNumberId: contact.twilioNumberId
      });
      
      systemResponses.push(message);
    }
    
    res.json({
      message: `Marked ${systemResponses.length} conversations as resolved`,
      resolvedCount: systemResponses.length
    });
  } catch (error) {
    console.error('Error marking messages as resolved:', error);
    res.status(500).json({ error: 'Failed to mark messages as resolved' });
  }
});

// NEW: Send bulk replies to unresponded messages
app.post('/unresponded-messages/bulk-reply', async (req, res) => {
  try {
    const { contactIds, message, campaignId } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Reply message is required' });
    }
    
    let contacts = [];
    
    // Either use provided contact IDs or get all unresponded for a campaign
    if (Array.isArray(contactIds) && contactIds.length > 0) {
      contacts = await Contact.findAll({
        where: { id: contactIds }
      });
    } else if (campaignId) {
      // Find all replied contacts in this campaign
      const campaignContacts = await Contact.findAll({
        where: {
          CampaignId: campaignId,
          status: 'replied'
        }
      });
      
      // Filter to only truly unresponded
      for (const contact of campaignContacts) {
        const lastMessage = await Message.findOne({
          where: { contactId: contact.id },
          order: [['sentAt', 'DESC']]
        });
        
        if (lastMessage && lastMessage.direction === 'inbound') {
          contacts.push(contact);
        }
      }
    } else {
      return res.status(400).json({ 
        error: 'Either contactIds array or campaignId is required' 
      });
    }
    
    if (contacts.length === 0) {
      return res.status(404).json({ error: 'No contacts found to send replies to' });
    }
    
    // Send replies
    const sentReplies = [];
    const failedReplies = [];
    
    for (const contact of contacts) {
      try {
        if (!contact.twilioNumberId) {
          // Find an available Twilio number
          const twilioNumber = await TwilioNumber.findOne({
            where: {
              status: ['available', 'in_use']
            },
            order: [
              ['lastUsed', 'ASC'],
              ['messagesCount', 'ASC']
            ]
          });
          
          if (!twilioNumber) {
            failedReplies.push({
              contactId: contact.id,
              reason: 'No available Twilio number'
            });
            continue;
          }
          
          // Update contact with the Twilio number
          await contact.update({ twilioNumberId: twilioNumber.id });
        }
        
        // Send the reply
        const sentMessage = await sendReply(contact.id, contact.twilioNumberId, message);
        sentReplies.push(sentMessage);
      } catch (error) {
        console.error(`Error sending bulk reply to contact ${contact.id}:`, error);
        failedReplies.push({
          contactId: contact.id,
          reason: error.message
        });
      }
    }
    
    // Create a notification
    await createNotification(
      'system',
      'Bulk Replies Sent',
      `Sent ${sentReplies.length} bulk replies to unresponded messages`,
      {
        sentCount: sentReplies.length,
        failedCount: failedReplies.length,
        campaignId: campaignId || null
      }
    );
    
    res.json({
      message: `Sent ${sentReplies.length} bulk replies`,
      sentCount: sentReplies.length,
      failedCount: failedReplies.length,
      failedReplies: failedReplies.length > 0 ? failedReplies : undefined
    });
  } catch (error) {
    console.error('Error sending bulk replies:', error);
    res.status(500).json({ error: 'Failed to send bulk replies' });
  }
});

// NEW: Get dashboard stats including unresponded count
app.get('/dashboard/stats', async (req, res) => {
  try {
    // Get active campaigns count
    const activeCampaignsCount = await Campaign.count({
      where: { status: 'active' }
    });
    
    // Get total contacts count
    const totalContactsCount = await Contact.count();
    
    // Get sent messages count for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const sentTodayCount = await Message.count({
      where: {
        direction: 'outbound',
        status: 'sent',
        sentAt: {
          [Op.gte]: today
        }
      }
    });
    
    // Get unresponded messages count
    const repliedContacts = await Contact.findAll({
      where: { status: 'replied' },
      attributes: ['id']
    });
    
    let unrespondedCount = 0;
    
    for (const contact of repliedContacts) {
      const lastMessage = await Message.findOne({
        where: { contactId: contact.id },
        order: [['sentAt', 'DESC']]
      });
      
      if (lastMessage && lastMessage.direction === 'inbound') {
        unrespondedCount++;
      }
    }
    
    // Get available Twilio numbers count
    const availableNumbersCount = await TwilioNumber.count({
      where: { status: 'available' }
    });
    
    res.json({
      activeCampaigns: activeCampaignsCount,
      totalContacts: totalContactsCount,
      sentToday: sentTodayCount,
      unrespondedMessages: unrespondedCount,
      availableNumbers: availableNumbersCount
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// NEW: Get all notifications
app.get('/notifications', async (req, res) => {
  try {
    // Parse query parameters
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;
    
    // Filter by read status if provided
    const whereClause = {};
    if (req.query.isRead !== undefined) {
      whereClause.isRead = req.query.isRead === 'true';
    }
    
    // Filter by type if provided
    if (req.query.type) {
      whereClause.type = req.query.type;
    }
    
    const { count, rows: notifications } = await Notification.findAndCountAll({
      where: whereClause,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });
    
    res.json({
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
      notifications
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// NEW: Mark notifications as read
app.patch('/notifications/mark-read', async (req, res) => {
  try {
    const { notificationIds } = req.body;
    
    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return res.status(400).json({ error: 'Notification IDs array is required' });
    }
    
    await Notification.update(
      { isRead: true },
      { where: { id: notificationIds } }
    );
    
    res.json({ message: `Marked ${notificationIds.length} notifications as read` });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// NEW: Create a custom notification
app.post('/notifications', async (req, res) => {
  try {
    const { title, message, type = 'custom', metadata = {}, priority = 'medium' } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }
    
    const notification = await Notification.create({
      title,
      message,
      type,
      metadata,
      priority
    });
    
    res.status(201).json(notification);
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

// NEW: Delete notification
app.delete('/notifications/:notificationId', async (req, res) => {
  try {
    const notificationId = parseInt(req.params.notificationId, 10);
    
    const deleted = await Notification.destroy({
      where: { id: notificationId }
    });
    
    if (deleted === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// NEW: Preview CSV file before import
app.post('/csv/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Get max rows to preview from query param, default to 10
    const maxRows = parseInt(req.query.rows, 10) || 10;
    
    // Track headers and rows
    let headers = [];
    const previewRows = [];
    let rowCount = 0;
    let totalRows = 0;
    let complete = false;
    
    // Create a new promise to handle CSV streaming
    const previewPromise = new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv.parse({ headers: true }))
        .on('error', error => {
          console.error('Error parsing CSV:', error);
          reject(new Error('Invalid CSV file'));
        })
        .on('headers', (hdrs) => {
          headers = hdrs;
        })
        .on('data', row => {
          totalRows++;
          
          // Only collect up to maxRows for preview
          if (rowCount < maxRows) {
            previewRows.push(row);
            rowCount++;
          }
        })
        .on('end', () => {
          complete = true;
          resolve();
        });
    });
    
    // Wait for parsing to complete or timeout after 10 seconds
    try {
      await Promise.race([
        previewPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('CSV parsing timeout')), 10000))
      ]);
    } catch (error) {
      // Delete temp file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: error.message });
    }
    
    // Analyze headers
    const headerAnalysis = headers.map(header => {
      // Count non-empty values for this column
      const nonEmptyCount = previewRows.filter(row => row[header] && row[header].trim() !== '').length;
      
      // Detect potential data type
      let dataType = 'unknown';
      let exampleValues = [];
      
      // Get sample values for analysis
      const samples = previewRows
        .map(row => row[header])
        .filter(val => val && val.trim() !== '')
        .slice(0, 5);
      
      if (samples.length > 0) {
        // Check if all values are numbers
        const isNumeric = samples.every(val => !isNaN(val) && !isNaN(parseFloat(val)));
        if (isNumeric) {
          dataType = 'number';
        } 
        // Check for date format
        else if (samples.every(val => !isNaN(Date.parse(val)))) {
          dataType = 'date';
        }
        // Check if email
        else if (samples.every(val => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val))) {
          dataType = 'email';
        }
        // Check if phone - simple check for now
        else if (samples.every(val => /^[\d\+\-\(\)\s\.]+$/.test(val))) {
          dataType = 'phone';
        }
        else {
          dataType = 'text';
        }
        
        exampleValues = samples;
      }
      
      return {
        name: header,
        nonEmptyCount,
        fillRate: previewRows.length > 0 ? (nonEmptyCount / previewRows.length) * 100 : 0,
        dataType,
        exampleValues
      };
    });
    
    // Make recommendations for field mappings
    const recommendedMappings = {};
    
    // Try to identify phone field
    const phoneFields = headerAnalysis.filter(h => 
      h.dataType === 'phone' || 
      h.name.toLowerCase().includes('phone') || 
      h.name.toLowerCase().includes('mobile') ||
      h.name.toLowerCase().includes('cell')
    );
    
    if (phoneFields.length > 0) {
      // Sort by fill rate and name relevance
      const bestPhoneField = phoneFields.sort((a, b) => {
        // First priority: exact match
        if (a.name.toLowerCase() === 'phone' && b.name.toLowerCase() !== 'phone') return -1;
        if (b.name.toLowerCase() === 'phone' && a.name.toLowerCase() !== 'phone') return 1;
        
        // Second priority: fill rate
        return b.fillRate - a.fillRate;
      })[0];
      
      recommendedMappings.phone = bestPhoneField.name;
    }
    
    // Try to identify name field
    const nameFields = headerAnalysis.filter(h => 
      h.dataType === 'text' && 
      (h.name.toLowerCase().includes('name') || 
       h.name.toLowerCase().includes('contact') ||
       h.name.toLowerCase() === 'customer')
    );
    
    if (nameFields.length > 0) {
      // First check for "full name" or just "name"
      const exactNameField = nameFields.find(h => 
        h.name.toLowerCase() === 'name' || 
        h.name.toLowerCase() === 'full name' ||
        h.name.toLowerCase() === 'fullname'
      );
      
      if (exactNameField) {
        recommendedMappings.name = exactNameField.name;
      } else {
        // Look for first name + last name pattern
        const firstNameField = nameFields.find(h => 
          h.name.toLowerCase() === 'first name' || 
          h.name.toLowerCase() === 'firstname'
        );
        
        const lastNameField = nameFields.find(h => 
          h.name.toLowerCase() === 'last name' || 
          h.name.toLowerCase() === 'lastname'
        );
        
        if (firstNameField && lastNameField) {
          recommendedMappings.firstName = firstNameField.name;
          recommendedMappings.lastName = lastNameField.name;
          recommendedMappings.nameCombine = true;
        } else {
          // Just use the first name-related field with highest fill rate
          recommendedMappings.name = nameFields.sort((a, b) => b.fillRate - a.fillRate)[0].name;
        }
      }
    }
    
    // Try to identify email field
    const emailFields = headerAnalysis.filter(h => 
      h.dataType === 'email' || 
      h.name.toLowerCase().includes('email')
    );
    
    if (emailFields.length > 0) {
      recommendedMappings.email = emailFields[0].name;
    }
    
    // Delete temporary file
    fs.unlinkSync(req.file.path);
    
    res.json({
      fileName: req.file.originalname,
      headers,
      previewRows,
      rowCount: previewRows.length,
      totalRowsEstimate: complete ? totalRows : `${totalRows}+`,
      headerAnalysis,
      recommendedMappings
    });
  } catch (error) {
    console.error('Error previewing CSV:', error);
    
    // Make sure to delete the temp file in case of error
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting temp file:', unlinkError);
      }
    }
    
    res.status(500).json({ error: 'Failed to preview CSV file' });
  }
});

// Helper function to send a reply to a contact
async function sendReply(contactId, twilioNumberId, messageContent) {
  try {
    const contact = await Contact.findByPk(contactId);
    if (!contact) {
      throw new Error(`Contact not found: ${contactId}`);
    }
    
    const twilioNumber = await TwilioNumber.findByPk(twilioNumberId);
    if (!twilioNumber) {
      throw new Error(`Twilio number not found: ${twilioNumberId}`);
    }
    
    // Create message record
    const message = await Message.create({
      contactId: contact.id,
      content: messageContent,
      status: 'pending',
      direction: 'outbound',
      twilioNumberId: twilioNumber.id
    });
    
    // Get Twilio client for this number
    const twilioClient = getTwilioClient(twilioNumber);
    
    // Send the SMS via Twilio
    const twilioResponse = await twilioClient.messages.create({
      body: messageContent,
      from: twilioNumber.phoneNumber,
      to: contact.phone
    });
    
    // Update message status
    await message.update({
      status: 'sent',
      sentAt: new Date(),
      twilioSid: twilioResponse.sid
    });
    
    // Update contact's last conversation time
    await contact.update({
      lastConversationAt: new Date()
    });
    
    // Update Twilio number
    await twilioNumber.update({
      lastUsed: new Date(),
      messagesCount: twilioNumber.messagesCount + 1
    });
    
    console.log(`Reply sent to ${contact.phone} from ${twilioNumber.phoneNumber}: ${twilioResponse.sid}`);
    
    return message;
  } catch (error) {
    console.error(`Error sending reply to contact ${contactId}:`, error);
    throw error;
  }
}

// Campaign processing function
async function processCampaign(campaignId) {
  try {
    console.log(`Processing campaign ${campaignId}`);
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign || campaign.status !== 'active') {
      console.log(`Campaign ${campaignId} is not active, status: ${campaign?.status}`);
      return;
    }
    
    // Debug contact count
    const pendingCount = await Contact.count({
      where: {
        CampaignId: campaignId,
        status: 'pending'
      }
    });
    console.log(`Campaign ${campaignId} has ${pendingCount} pending contacts`);
    
    // Check if we have available Twilio numbers
    const availableNumbers = await TwilioNumber.count({
      where: {
        status: ['available', 'in_use']
      }
    });
    
    if (availableNumbers === 0) {
      console.error(`No available Twilio numbers for campaign ${campaignId}`);
      await campaign.update({ status: 'paused' });
      return;
    }
    
    // Calculate how many messages to send per batch based on rate limit
    const messagesPerBatch = Math.ceil(campaign.rateLimit / 60); // For a roughly even distribution
    
    // Get pending contacts
    const contacts = await Contact.findAll({
      where: {
        CampaignId: campaignId,
        status: 'pending'
      },
      limit: messagesPerBatch
    });
    
    if (contacts.length === 0) {
      // Check if there are any contacts for this campaign at all
      const totalContacts = await Contact.count({
        where: {
          CampaignId: campaignId
        }
      });
      
      if (totalContacts === 0) {
        console.log(`No contacts found for campaign ${campaignId}`);
        // Don't mark as completed if there are no contacts at all
        setTimeout(() => processCampaign(campaignId), 60000);
        return;
      }
      
      const pendingContacts = await Contact.count({
        where: {
          CampaignId: campaignId,
          status: 'pending'
        }
      });
      
      if (pendingContacts === 0) {
        // All contacts processed
        console.log(`All contacts processed for campaign ${campaignId}, marking as completed`);
        await campaign.update({ status: 'completed' });
        
        // NEW: Add notification for campaign completion
        await createNotification(
          'campaign_completed',
          'Campaign Completed',
          `Campaign "${campaign.name}" has been completed.`,
          { campaignId: campaign.id, campaignName: campaign.name },
          'medium'
        );
        
        return;
      }
      
      // If we still have pending contacts but didn't get any in this batch,
      // it might be a pagination issue or concurrency - try again
      setTimeout(() => processCampaign(campaignId), 60000);
      return;
    }
    
    // Process each contact
    for (const contact of contacts) {
      await sendSMS(contact, campaign);
      // Small delay between messages to avoid flooding
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Schedule the next batch
    setTimeout(() => processCampaign(campaignId), 60000); // Run every minute
  } catch (error) {
    console.error(`Error processing campaign ${campaignId}:`, error);
    
    // Try again in a minute
    setTimeout(() => processCampaign(campaignId), 60000);
  }
}

// Function to send an SMS to a contact
async function sendSMS(contact, campaign) {
  let message;
  try {
    // Find an available Twilio number
    let twilioNumber = await TwilioNumber.findOne({
      where: {
        status: 'available'
      },
      order: [
        ['lastUsed', 'ASC'],
        ['messagesCount', 'ASC']
      ]
    });
    
    if (!twilioNumber) {
      twilioNumber = await TwilioNumber.findOne({
        where: {
          status: 'in_use'
        },
        order: [
          ['lastUsed', 'ASC'],
          ['messagesCount', 'ASC']
        ]
      });
    }
    
    if (!twilioNumber) {
      throw new Error('No available Twilio numbers found');
    }
    
    // Mark the Twilio number as in use
    await twilioNumber.update({
      status: 'in_use',
      lastUsed: new Date(),
      messagesCount: twilioNumber.messagesCount + 1
    });
    
    // Parse message template and replace variables
    let messageContent = campaign.messageTemplate;
    
    // Replace basic fields
    messageContent = messageContent
      .replace(/\{name\}/g, contact.name || '')
      .replace(/\{phone\}/g, contact.phone)
      .replace(/\{email\}/g, contact.email || '');
    
    // Replace custom fields
    if (contact.customFields) {
      for (const [key, value] of Object.entries(contact.customFields)) {
        messageContent = messageContent.replace(
          new RegExp(`\\{${key}\\}`, 'g'),
          value || ''
        );
      }
    }
    
    // Create message record
    message = await Message.create({
      contactId: contact.id,
      content: messageContent,
      status: 'pending',
      direction: 'outbound',
      twilioNumberId: twilioNumber.id
    });
    
    // Get Twilio client for this number
    const twilioClient = getTwilioClient(twilioNumber);
    
    // Send the SMS via Twilio
    const twilioResponse = await twilioClient.messages.create({
      body: messageContent,
      from: twilioNumber.phoneNumber,
      to: contact.phone
    });
    
    // Update message status
    await message.update({
      status: 'sent',
      sentAt: new Date(),
      twilioSid: twilioResponse.sid
    });
    
    // Update contact status and associate with the Twilio number
    await contact.update({ 
      status: 'sent', 
      twilioNumberId: twilioNumber.id,
      lastConversationAt: new Date()
    });
    
    // Update campaign stats
    await campaign.update({
      sentCount: campaign.sentCount + 1
    });
    
    console.log(`SMS sent to ${contact.phone} from ${twilioNumber.phoneNumber}: ${twilioResponse.sid}`);
    
  } catch (error) {
    console.error(`Error sending SMS to ${contact.phone}:`, error);
    
    // Update message status
    if (message) {
      await message.update({
        status: 'failed',
        errorMessage: error.message
      });
    }
    
    // Update contact status
    await contact.update({ status: 'failed' });
    
    // Update campaign stats
    await campaign.update({
      failedCount: campaign.failedCount + 1
    });
    
    // NEW: Add notification for failed message
    await createNotification(
      'send_failed',
      'Message Failed to Send',
      `Failed to send message to ${contact.phone}: ${error.message}`,
      {
        contactId: contact.id,
        campaignId: campaign.id,
        phoneNumber: contact.phone,
        error: error.message
      },
      'high'
    );
  }
}

// Set up webhook for incoming messages
app.post('/webhook/sms', async (req, res) => {
  try {
    // Extract data from the Twilio webhook
    const { Body, From, To, MessageSid } = req.body;
    
    console.log(`Received message from ${From} to ${To}: ${Body}`);
    
    // Find the Twilio number
    const twilioNumber = await TwilioNumber.findOne({ 
      where: { phoneNumber: To }
    });
    
    if (!twilioNumber) {
      console.error(`Received message for unknown Twilio number: ${To}`);
      return res.status(404).send('<Response></Response>');
    }
    
    // Find the contact associated with this phone number and Twilio number
    let contact = await Contact.findOne({
      where: { 
        phone: From,
        twilioNumberId: twilioNumber.id
      }
    });
    
    if (!contact) {
      console.log(`Received message from unknown contact with Twilio number: ${From}`);
      // If no specific contact found, try to find any contact with this phone
      contact = await Contact.findOne({
        where: { phone: From }
      });
      
      if (!contact) {
        console.error(`No contact found for phone number: ${From}`);
        return res.status(404).send('<Response></Response>');
      }
      
      // Update contact with the Twilio number association
      await contact.update({ 
        twilioNumberId: twilioNumber.id 
      });
    }
    
    // Create a message record for the incoming SMS
    await Message.create({
      contactId: contact.id,
      content: Body,
      direction: 'inbound',
      status: 'received',
      twilioNumberId: twilioNumber.id,
      twilioSid: MessageSid,
      sentAt: new Date()
    });
    
    // Update contact status
    await contact.update({ 
      status: 'replied',
      lastConversationAt: new Date()
    });
    
    // NEW: Add notification for new message
    await createNotification(
      'message_received',
      'New Message Received',
      `New message from ${From}: "${Body.substring(0, 50)}${Body.length > 50 ? '...' : ''}"`,
      {
        contactId: contact.id,
        contactPhone: From,
        twilioNumber: To,
        campaignId: contact.CampaignId
      },
      'medium'
    );
    
    // Check if we need to auto-reply
    const campaign = await Campaign.findByPk(contact.CampaignId);
    if (campaign && campaign.autoReplyEnabled && campaign.replyTemplate) {
      // Send auto-reply
      setTimeout(() => sendReply(contact.id, twilioNumber.id, campaign.replyTemplate), 
        Math.floor(Math.random() * 60000) + 30000); // Random delay between 30-90 seconds
    }
    
    // Send TwiML response
    res.writeHead(200, {'Content-Type': 'text/xml'});
    res.end('<Response></Response>');
    
  } catch (error) {
    console.error('Error processing incoming SMS:', error);
    res.status(500).send('<Response></Response>');
  }
});

// Sync database and start server
async function startServer() {
  try {
    // Sync all models with database
    await sequelize.sync({ alter: true }); // Use alter:true to update existing tables
    console.log('Database synchronized');
    
    // Start the server
    const PORT = process.env.PORT || 3100;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
    
    // Start processing any active campaigns
    const activeCampaigns = await Campaign.findAll({
      where: { status: 'active' }
    });
    
    console.log(`Found ${activeCampaigns.length} active campaigns to process`);
    
    activeCampaigns.forEach(campaign => {
      processCampaign(campaign.id);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
  }
}

startServer();
