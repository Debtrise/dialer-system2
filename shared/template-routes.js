const express = require('express');
const { Op } = require('sequelize');
const TemplateService = require('./template-service');

module.exports = function(app, sequelize, authenticateToken, contentService = null) {
  const router = express.Router();
  
  // Initialize models
  const templateModels = require('./template-models')(sequelize, sequelize.Sequelize.DataTypes);
  
  // Initialize service
  const templateService = new TemplateService({
    ...templateModels,
    Lead: sequelize.models.Lead
  }, sequelize);  

  // ===== Email Configuration Routes =====
  
  // Get email configuration
  router.get('/email/config', authenticateToken, async (req, res) => {
    try {
      const config = await templateModels.EmailConfig.findOne({
        where: { tenantId: req.user.tenantId }
      });
      
      if (config && config.settings) {
        // Hide sensitive data for security
        const safeConfig = {
          ...config.toJSON(),
          settings: {
            ...config.settings
          }
        };
        
        // Hide API keys and passwords
        if (safeConfig.settings.pass) {
          safeConfig.settings.pass = '***HIDDEN***';
        }
        if (safeConfig.settings.apiKey) {
          safeConfig.settings.apiKey = safeConfig.settings.apiKey.substring(0, 8) + '***HIDDEN***';
        }
        if (safeConfig.settings.secretAccessKey) {
          safeConfig.settings.secretAccessKey = '***HIDDEN***';
        }
        
        res.json(safeConfig);
      } else {
        res.json({
          provider: 'smtp',
          fromEmail: '',
          fromName: '',
          isActive: false,
          settings: {}
        });
      }
    } catch (error) {
      console.error('Error getting email config:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Save/update email configuration
  router.post('/email/config', authenticateToken, async (req, res) => {
    try {
      const { provider, fromEmail, fromName, replyToEmail, dailyLimit = 1000, settings } = req.body;
      
      // Validate provider
      if (!['smtp', 'sendgrid', 'mailgun', 'ses'].includes(provider)) {
        return res.status(400).json({ error: 'Invalid email provider' });
      }
      
      // Validate required fields
      if (!fromEmail || !fromName) {
        return res.status(400).json({ error: 'From email and name are required' });
      }
      
      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(fromEmail)) {
        return res.status(400).json({ error: 'Invalid from email format' });
      }
      
      if (replyToEmail && !emailRegex.test(replyToEmail)) {
        return res.status(400).json({ error: 'Invalid reply-to email format' });
      }
      
      // Provider-specific validation
      let validatedSettings = { ...settings };
      
      switch (provider) {
        case 'smtp':
          if (!settings.host || !settings.port || !settings.user || !settings.pass) {
            return res.status(400).json({ 
              error: 'SMTP requires host, port, user, and password' 
            });
          }
          break;
          
        case 'sendgrid':
          if (!settings.apiKey) {
            return res.status(400).json({ 
              error: 'SendGrid requires API key' 
            });
          }
          break;
          
        case 'mailgun':
          if (!settings.apiKey || !settings.domain) {
            return res.status(400).json({ 
              error: 'Mailgun requires API key and domain' 
            });
          }
          
          // Validate domain format
          const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-_.]*[a-zA-Z0-9]$/;
          if (!domainRegex.test(settings.domain)) {
            return res.status(400).json({ 
              error: 'Invalid Mailgun domain format' 
            });
          }
          
          // Set default host if not provided
          if (!settings.host) {
            validatedSettings.host = 'api.mailgun.net';
          }
          
          // Validate region-specific host
          if (settings.host && !['api.mailgun.net', 'api.eu.mailgun.net'].includes(settings.host)) {
            return res.status(400).json({ 
              error: 'Invalid Mailgun host. Use api.mailgun.net or api.eu.mailgun.net' 
            });
          }
          
          break;
          
        case 'ses':
          if (!settings.accessKeyId || !settings.secretAccessKey || !settings.region) {
            return res.status(400).json({ 
              error: 'AWS SES requires access key ID, secret access key, and region' 
            });
          }
          break;
      }
      
      // Get existing config to preserve sensitive data if not being updated
      const existingConfig = await templateModels.EmailConfig.findOne({
        where: { tenantId: req.user.tenantId }
      });
      
      // Preserve existing sensitive data if new values are hidden
      if (existingConfig && existingConfig.settings) {
        if (validatedSettings.pass === '***HIDDEN***') {
          validatedSettings.pass = existingConfig.settings.pass;
        }
        if (validatedSettings.apiKey && validatedSettings.apiKey.includes('***HIDDEN***')) {
          validatedSettings.apiKey = existingConfig.settings.apiKey;
        }
        if (validatedSettings.secretAccessKey === '***HIDDEN***') {
          validatedSettings.secretAccessKey = existingConfig.settings.secretAccessKey;
        }
      }
      
      const config = await templateService.configureEmail(req.user.tenantId, {
        provider,
        fromEmail,
        fromName,
        replyToEmail,
        dailyLimit,
        settings: validatedSettings,
        isActive: true
      });
      
      // Return safe config (hide sensitive data)
      const safeConfig = {
        ...config.toJSON(),
        settings: {
          ...config.settings
        }
      };
      
      if (safeConfig.settings.pass) {
        safeConfig.settings.pass = '***HIDDEN***';
      }
      if (safeConfig.settings.apiKey) {
        safeConfig.settings.apiKey = safeConfig.settings.apiKey.substring(0, 8) + '***HIDDEN***';
      }
      if (safeConfig.settings.secretAccessKey) {
        safeConfig.settings.secretAccessKey = '***HIDDEN***';
      }
      
      res.json({
        message: 'Email configuration saved successfully',
        config: safeConfig
      });
    } catch (error) {
      console.error('Error saving email config:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Test email configuration
  router.post('/email/test', authenticateToken, async (req, res) => {
    try {
      const { to, testType = 'basic' } = req.body;
      
      if (!to) {
        return res.status(400).json({ error: 'To address is required' });
      }
      
      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(to)) {
        return res.status(400).json({ error: 'Invalid email address format' });
      }
      
      // Get email config
      const config = await templateModels.EmailConfig.findOne({
        where: { tenantId: req.user.tenantId, isActive: true }
      });
      
      if (!config) {
        return res.status(400).json({ error: 'Email configuration not found. Please configure email settings first.' });
      }
      
      if (testType === 'verify' && config.provider === 'mailgun') {
        // Test Mailgun domain verification
        try {
          const verification = await templateService.testEmailConfiguration(req.user.tenantId);
          return res.json({
            success: true,
            message: 'Mailgun domain verification successful',
            verification
          });
        } catch (error) {
          return res.status(400).json({
            success: false,
            error: error.message,
            provider: config.provider
          });
        }
      }
      
      // Create a test template
      const testTemplate = await templateService.createTemplate(req.user.tenantId, {
        name: `Test Email - ${Date.now()}`,
        type: 'email',
        subject: 'Test Email from {{companyName}}',
        content: `Hello,

This is a test email from your ${config.provider.toUpperCase()} email configuration in the Knittt dialer system.

If you receive this email, your email configuration is working correctly!

Configuration Details:
- Provider: ${config.provider.toUpperCase()}
- From: {{fromEmail}}
- Test sent at: {{currentDateTime}}

Best regards,
The Knittt Team`,
        htmlContent: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Test Email from {{companyName}}</h2>
          <p>Hello,</p>
          <p>This is a test email from your <strong>${config.provider.toUpperCase()}</strong> email configuration in the Knittt dialer system.</p>
          <p>If you receive this email, your email configuration is working correctly!</p>
          
          <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-radius: 5px;">
            <h4 style="margin: 0 0 10px 0;">Configuration Details:</h4>
            <ul style="margin: 0; padding-left: 20px;">
              <li><strong>Provider:</strong> ${config.provider.toUpperCase()}</li>
              <li><strong>From:</strong> {{fromEmail}}</li>
              <li><strong>Test sent at:</strong> {{currentDateTime}}</li>
            </ul>
          </div>
          
          <p style="color: #666; font-size: 14px;">
            Best regards,<br>
            The Knittt Team
          </p>
        </div>`,
        isActive: false
      });
      
      try {
        const result = await templateService.sendTemplatedEmail(req.user.tenantId, {
          to,
          templateId: testTemplate.id,
          variables: {
            companyName: 'Knittt Dialer System',
            fromEmail: config.fromEmail
          },
          tags: ['test', 'configuration']
        });
        
        // Delete test template
        await templateService.deleteTemplate(testTemplate.id, req.user.tenantId);
        
        res.json({ 
          success: true, 
          message: `Test email sent successfully via ${config.provider.toUpperCase()}`,
          messageId: result.messageId,
          provider: config.provider,
          sentTo: to
        });
      } catch (error) {
        // Delete test template even if send fails
        await templateService.deleteTemplate(testTemplate.id, req.user.tenantId);
        throw error;
      }
    } catch (error) {
      console.error('Error testing email:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });
  
  // Get email provider options and requirements
  router.get('/email/providers', authenticateToken, async (req, res) => {
    try {
      const providers = [
        {
          id: 'smtp',
          name: 'SMTP',
          description: 'Standard SMTP server configuration',
          fields: [
            { name: 'host', label: 'SMTP Host', type: 'text', required: true, placeholder: 'smtp.gmail.com' },
            { name: 'port', label: 'Port', type: 'number', required: true, placeholder: '587' },
            { name: 'secure', label: 'Use SSL/TLS', type: 'boolean', required: false },
            { name: 'user', label: 'Username', type: 'text', required: true, placeholder: 'your-email@gmail.com' },
            { name: 'pass', label: 'Password', type: 'password', required: true, placeholder: 'Your password or app password' }
          ]
        },
        {
          id: 'sendgrid',
          name: 'SendGrid',
          description: 'SendGrid email service',
          fields: [
            { name: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'SG.xxxxxxxxxxxxxxxx' }
          ]
        },
        {
          id: 'mailgun',
          name: 'Mailgun',
          description: 'Mailgun email service with advanced tracking',
          fields: [
            { name: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'key-xxxxxxxxxxxxxxxx' },
            { name: 'domain', label: 'Domain', type: 'text', required: true, placeholder: 'mg.yourdomain.com' },
            { 
              name: 'host', 
              label: 'Region', 
              type: 'select', 
              required: false,
              options: [
                { value: 'api.mailgun.net', label: 'US (api.mailgun.net)' },
                { value: 'api.eu.mailgun.net', label: 'EU (api.eu.mailgun.net)' }
              ],
              defaultValue: 'api.mailgun.net'
            },
            { name: 'tracking', label: 'Enable Tracking', type: 'boolean', required: false, defaultValue: true },
            { name: 'trackingClicks', label: 'Track Clicks', type: 'select', required: false, options: [
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
              { value: 'htmlonly', label: 'HTML Only' }
            ], defaultValue: 'yes' },
            { name: 'trackingOpens', label: 'Track Opens', type: 'boolean', required: false, defaultValue: true },
            { name: 'tags', label: 'Default Tags (comma-separated)', type: 'text', required: false, placeholder: 'marketing,campaign' }
          ]
        },
        {
          id: 'ses',
          name: 'Amazon SES',
          description: 'Amazon Simple Email Service',
          fields: [
            { name: 'accessKeyId', label: 'Access Key ID', type: 'text', required: true, placeholder: 'AKIAXXXXXXXXXXXXXXXX' },
            { name: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true, placeholder: 'Your secret access key' },
            { 
              name: 'region', 
              label: 'AWS Region', 
              type: 'select', 
              required: true,
              options: [
                { value: 'us-east-1', label: 'US East (N. Virginia)' },
                { value: 'us-west-2', label: 'US West (Oregon)' },
                { value: 'eu-west-1', label: 'Europe (Ireland)' },
                { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' }
              ],
              defaultValue: 'us-east-1'
            }
          ]
        }
      ];
      
      res.json(providers);
    } catch (error) {
      console.error('Error getting email providers:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get email statistics
  router.get('/email/stats', authenticateToken, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      const stats = await templateService.getEmailStatistics(
        req.user.tenantId,
        startDate,
        endDate
      );
      
      // Get current configuration
      const config = await templateModels.EmailConfig.findOne({
        where: { tenantId: req.user.tenantId }
      });
      
      res.json({
        ...stats,
        dailyLimit: config?.dailyLimit || 0,
        sentToday: config?.sentToday || 0,
        lastResetDate: config?.lastResetDate
      });
    } catch (error) {
      console.error('Error getting email statistics:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Reset daily email counter (admin only)
  router.post('/email/reset-daily-limit', authenticateToken, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      
      await templateModels.EmailConfig.update(
        {
          sentToday: 0,
          lastResetDate: new Date()
        },
        {
          where: { tenantId: req.user.tenantId }
        }
      );
      
      res.json({ message: 'Daily email limit reset successfully' });
    } catch (error) {
      console.error('Error resetting daily limit:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== Template Category Routes =====
  
  // List template categories
  router.get('/templates/categories', authenticateToken, async (req, res) => {
    try {
      const { type } = req.query;
      const categories = await templateService.getCategories(req.user.tenantId, type);
      res.json(categories);
    } catch (error) {
      console.error('Error getting template categories:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Create template category
  router.post('/templates/categories', authenticateToken, async (req, res) => {
    try {
      const category = await templateService.createCategory(req.user.tenantId, req.body);
      res.status(201).json(category);
    } catch (error) {
      console.error('Error creating template category:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Template Routes =====
  
  // List templates
  router.get('/templates', authenticateToken, async (req, res) => {
    try {
      const result = await templateService.listTemplates(req.user.tenantId, req.query);
      res.json(result);
    } catch (error) {
      console.error('Error listing templates:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Combined list of communication and content templates
  router.get('/templates/combined', authenticateToken, async (req, res) => {
    try {
      const communication = await templateService.listTemplates(req.user.tenantId, req.query);
      let content = { templates: [], pagination: {} };
      if (contentService && contentService.getTemplates) {
        content = await contentService.getTemplates(req.user.tenantId, req.query);
      }
      res.json({ communication, content });
    } catch (error) {
      console.error('Error listing combined templates:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get template
  router.get('/templates/:id', authenticateToken, async (req, res) => {
    try {
      const template = await templateService.getTemplate(req.params.id, req.user.tenantId);
      res.json(template);
    } catch (error) {
      console.error('Error getting template:', error);
      res.status(404).json({ error: error.message });
    }
  });
  
  // Create template
  router.post('/templates', authenticateToken, async (req, res) => {
    try {
      const template = await templateService.createTemplate(req.user.tenantId, req.body);
      res.status(201).json(template);
    } catch (error) {
      console.error('Error creating template:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Update template
  router.put('/templates/:id', authenticateToken, async (req, res) => {
    try {
      const template = await templateService.updateTemplate(
        req.params.id,
        req.user.tenantId,
        req.body
      );
      res.json(template);
    } catch (error) {
      console.error('Error updating template:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Delete template
  router.delete('/templates/:id', authenticateToken, async (req, res) => {
    try {
      await templateService.deleteTemplate(req.params.id, req.user.tenantId);
      res.json({ message: 'Template deleted successfully' });
    } catch (error) {
      console.error('Error deleting template:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Render template preview
  router.post('/templates/:id/render', authenticateToken, async (req, res) => {
    try {
      const { variables, context } = req.body;
      const rendered = await templateService.renderTemplate(
        req.params.id,
        req.user.tenantId,
        variables,
        context
      );
      res.json(rendered);
    } catch (error) {
      console.error('Error rendering template:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Clone template
  router.post('/templates/:id/clone', authenticateToken, async (req, res) => {
    try {
      const original = await templateService.getTemplate(req.params.id, req.user.tenantId);
      
      const cloned = await templateService.createTemplate(req.user.tenantId, {
        ...original.toJSON(),
        name: `${original.name} (Copy)`,
        isDefault: false,
        usageCount: 0,
        lastUsed: null
      });
      
      res.status(201).json(cloned);
    } catch (error) {
      console.error('Error cloning template:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Send templated email directly
  router.post('/email/send', authenticateToken, async (req, res) => {
    try {
      const { to, templateId, variables, attachments, tags, campaignId } = req.body;
      
      if (!to || !templateId) {
        return res.status(400).json({ error: 'To and templateId are required' });
      }
      
      const result = await templateService.sendTemplatedEmail(req.user.tenantId, {
        to,
        templateId,
        variables,
        attachments,
        tags,
        campaignId
      });
      
      res.json(result);
    } catch (error) {
      console.error('Error sending email:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== Transfer Group Routes =====
  
  // List transfer groups
  router.get('/transfer-groups', authenticateToken, async (req, res) => {
    try {
      const result = await templateService.listTransferGroups(req.user.tenantId, req.query);
      res.json(result);
    } catch (error) {
      console.error('Error listing transfer groups:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get transfer group
  router.get('/transfer-groups/:id', authenticateToken, async (req, res) => {
    try {
      const group = await templateService.getTransferGroup(req.params.id, req.user.tenantId);
      res.json(group);
    } catch (error) {
      console.error('Error getting transfer group:', error);
      res.status(404).json({ error: error.message });
    }
  });
  
router.post('/transfer-groups', authenticateToken, async (req, res) => {
  try {
    const { 
      name, 
      description, 
      brand, 
      ingroup, 
      type = 'roundrobin', 
      settings, 
      isActive = true,
      apiConfig,
      dialerContext
    } = req.body;
    
    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Transfer group name is required' });
    }
    
    // Validate API config if provided
    if (apiConfig) {
      if (!apiConfig.url || !apiConfig.user || !apiConfig.password) {
        return res.status(400).json({ 
          error: 'API config must include url, user, and password' 
        });
      }
    }
    
    // Check if a transfer group already exists with the same brand/ingroup combination
    if (brand && ingroup) {
      const existingGroup = await templateModels.TransferGroup.findOne({
        where: {
          tenantId: req.user.tenantId,
          brand,
          ingroup
        }
      });
      
      if (existingGroup) {
        return res.status(409).json({ 
          error: 'A transfer group already exists for this brand and ingroup combination',
          existingGroup: {
            id: existingGroup.id,
            name: existingGroup.name,
            brand: existingGroup.brand,
            ingroup: existingGroup.ingroup
          }
        });
      }
    }
    
    // Create the transfer group
    const group = await templateService.createTransferGroup(req.user.tenantId, {
      name,
      description,
      brand: brand || null,
      ingroup: ingroup || null,
      type,
      settings: settings || {
        ringTimeout: 30,
        voicemailEnabled: false,
        voicemailTemplateId: null,
        callRecording: true,
        whisperMessage: null
      },
      apiConfig: apiConfig || null,
      dialerContext: dialerContext || null,
      isActive
    });
    
    res.status(201).json(group);
  } catch (error) {
    console.error('Error creating transfer group:', error);
    
    // Handle specific database errors
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ 
        error: 'A transfer group with this brand and ingroup combination already exists',
        details: error.fields
      });
    }
    
    res.status(400).json({ error: error.message });
  }
});

// Update transfer group (updated to include apiConfig and dialerContext)
router.put('/transfer-groups/:id', authenticateToken, async (req, res) => {
  try {
    const { 
      name, 
      description, 
      brand, 
      ingroup, 
      type, 
      settings, 
      isActive,
      apiConfig,
      dialerContext
    } = req.body;
    const groupId = req.params.id;
    
    // Validate API config if provided
    if (apiConfig !== undefined && apiConfig !== null) {
      if (!apiConfig.url || !apiConfig.user || !apiConfig.password) {
        return res.status(400).json({ 
          error: 'API config must include url, user, and password' 
        });
      }
    }
    
    // If brand/ingroup are being updated, check for conflicts
    if (brand !== undefined || ingroup !== undefined) {
      const existingGroup = await templateModels.TransferGroup.findOne({
        where: {
          tenantId: req.user.tenantId,
          brand: brand || null,
          ingroup: ingroup || null,
          id: { [Op.ne]: groupId } // Exclude current group
        }
      });
      
      if (existingGroup) {
        return res.status(409).json({ 
          error: 'Another transfer group already exists for this brand and ingroup combination',
          existingGroup: {
            id: existingGroup.id,
            name: existingGroup.name,
            brand: existingGroup.brand,
            ingroup: existingGroup.ingroup
          }
        });
      }
    }
    
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (brand !== undefined) updateData.brand = brand || null;
    if (ingroup !== undefined) updateData.ingroup = ingroup || null;
    if (type !== undefined) updateData.type = type;
    if (settings !== undefined) updateData.settings = settings;
    if (apiConfig !== undefined) updateData.apiConfig = apiConfig;
    if (dialerContext !== undefined) updateData.dialerContext = dialerContext;
    if (isActive !== undefined) updateData.isActive = isActive;
    
    const group = await templateService.updateTransferGroup(
      groupId,
      req.user.tenantId,
      updateData
    );
    
    res.json(group);
  } catch (error) {
    console.error('Error updating transfer group:', error);
    
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ 
        error: 'A transfer group with this brand and ingroup combination already exists',
        details: error.fields
      });
    }
    
    res.status(400).json({ error: error.message });
  }
});

// Create or update transfer group (upsert) - updated to include apiConfig and dialerContext
router.post('/transfer-groups/upsert', authenticateToken, async (req, res) => {
  try {
    const { 
      name, 
      description, 
      brand, 
      ingroup, 
      type = 'roundrobin', 
      settings, 
      isActive = true, 
      numbers = [],
      apiConfig,
      dialerContext
    } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Transfer group name is required' });
    }
    
    // Validate API config if provided
    if (apiConfig && (!apiConfig.url || !apiConfig.user || !apiConfig.password)) {
      return res.status(400).json({ 
        error: 'API config must include url, user, and password' 
      });
    }
    
    let group;
    let created = false;
    
    // Try to find existing group if brand/ingroup provided
    if (brand && ingroup) {
      group = await templateModels.TransferGroup.findOne({
        where: {
          tenantId: req.user.tenantId,
          brand,
          ingroup
        }
      });
      
      if (group) {
        // Update existing group
        await group.update({
          name,
          description,
          type,
          settings: settings || group.settings,
          apiConfig: apiConfig !== undefined ? apiConfig : group.apiConfig,
          dialerContext: dialerContext !== undefined ? dialerContext : group.dialerContext,
          isActive
        });
      }
    }
    
    // Create new group if not found
    if (!group) {
      group = await templateService.createTransferGroup(req.user.tenantId, {
        name,
        description,
        brand: brand || null,
        ingroup: ingroup || null,
        type,
        settings: settings || {
          ringTimeout: 30,
          voicemailEnabled: false,
          voicemailTemplateId: null,
          callRecording: true,
          whisperMessage: null
        },
        apiConfig: apiConfig || null,
        dialerContext: dialerContext || null,
        isActive
      });
      created = true;
    }
    
    // Add numbers if provided
    if (numbers && numbers.length > 0) {
      for (const number of numbers) {
        try {
          await templateService.addTransferNumber(
            group.id,
            req.user.tenantId,
            number
          );
        } catch (error) {
          console.error(`Error adding number ${number.phoneNumber}:`, error);
        }
      }
    }
    
    // Reload with numbers
    group = await templateService.getTransferGroup(group.id, req.user.tenantId);
    
    res.status(created ? 201 : 200).json({
      group,
      created,
      message: created ? 'Transfer group created' : 'Transfer group updated'
    });
  } catch (error) {
    console.error('Error upserting transfer group:', error);
    res.status(400).json({ error: error.message });
  }
});

// Test transfer group configuration (new endpoint)
router.post('/transfer-groups/:id/test-config', authenticateToken, async (req, res) => {
  try {
    const group = await templateService.getTransferGroup(req.params.id, req.user.tenantId);
    
    if (!group) {
      return res.status(404).json({ error: 'Transfer group not found' });
    }
    
    const results = {
      transferGroupId: group.id,
      name: group.name,
      brand: group.brand,
      ingroup: group.ingroup,
      dialerContext: group.dialerContext,
      hasApiConfig: !!group.apiConfig,
      hasTransferNumbers: group.numbers && group.numbers.length > 0,
      tests: {}
    };
    
    // Test transfer number selection
    if (group.numbers && group.numbers.length > 0) {
      try {
        const selectedNumber = await templateService.getNextTransferNumber(group.id, req.user.tenantId);
        results.tests.transferNumber = {
          success: true,
          selectedNumber: selectedNumber,
          routingType: group.type
        };
      } catch (error) {
        results.tests.transferNumber = {
          success: false,
          error: error.message
        };
      }
    } else {
      results.tests.transferNumber = {
        success: false,
        error: 'No transfer numbers configured'
      };
    }
    
    // Test API config if available
    if (group.apiConfig && group.apiConfig.url) {
      try {
        const axios = require('axios');
        
        const apiParams = {
          source: group.apiConfig.source || 'admin',
          user: group.apiConfig.user,
          pass: group.apiConfig.password,
          stage: 'csv',
          function: 'in_group_status',
          header: 'YES',
          in_groups: group.ingroup || 'test'
        };
        
        const response = await axios.get(group.apiConfig.url, { 
          params: apiParams,
          timeout: 10000
        });
        
        results.tests.apiConfig = {
          success: true,
          statusCode: response.status,
          hasData: !!response.data
        };
      } catch (error) {
        results.tests.apiConfig = {
          success: false,
          error: error.message
        };
      }
    } else {
      results.tests.apiConfig = {
        success: false,
        error: 'No API config provided'
      };
    }
    
    res.json(results);
  } catch (error) {
    console.error('Error testing transfer group config:', error);
    res.status(400).json({ error: error.message });
  }
});

  
  // Delete transfer group
  router.delete('/transfer-groups/:id', authenticateToken, async (req, res) => {
    try {
      await templateModels.TransferGroup.destroy({
        where: {
          id: req.params.id,
          tenantId: req.user.tenantId
        }
      });
      res.json({ message: 'Transfer group deleted successfully' });
    } catch (error) {
      console.error('Error deleting transfer group:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Transfer Number Routes =====
  
  // Add number to transfer group
  router.post('/transfer-groups/:groupId/numbers', authenticateToken, async (req, res) => {
    try {
      const number = await templateService.addTransferNumber(
        req.params.groupId,
        req.user.tenantId,
        req.body
      );
      res.status(201).json(number);
    } catch (error) {
      console.error('Error adding transfer number:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Update transfer number
  router.put('/transfer-groups/:groupId/numbers/:id', authenticateToken, async (req, res) => {
    try {
      const number = await templateService.updateTransferNumber(
        req.params.id,
        req.params.groupId,
        req.body
      );
      res.json(number);
    } catch (error) {
      console.error('Error updating transfer number:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Remove transfer number
  router.delete('/transfer-groups/:groupId/numbers/:id', authenticateToken, async (req, res) => {
    try {
      await templateService.removeTransferNumber(req.params.id, req.params.groupId);
      res.json({ message: 'Transfer number removed successfully' });
    } catch (error) {
      console.error('Error removing transfer number:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get next transfer number (for testing routing)
  router.get('/transfer-groups/:id/next-number', authenticateToken, async (req, res) => {
    try {
      const number = await templateService.getNextTransferNumber(
        req.params.id,
        req.user.tenantId
      );
      res.json({ number });
    } catch (error) {
      console.error('Error getting next transfer number:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Template Usage Routes =====
  
  // Get template usage history
  router.get('/templates/:id/usage', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 50 } = req.query;
      
      const usage = await templateModels.TemplateUsage.findAll({
        where: {
          templateId: req.params.id,
          tenantId: req.user.tenantId
        },
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      });
      
      const count = await templateModels.TemplateUsage.count({
        where: {
          templateId: req.params.id,
          tenantId: req.user.tenantId
        }
      });
      
      res.json({
        usage,
        totalCount: count,
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / parseInt(limit))
      });
    } catch (error) {
      console.error('Error getting template usage:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Register routes
  app.use('/api', router);
  
  // Schedule daily email limit reset
  const cron = require('node-cron');
  cron.schedule('0 0 * * *', async () => {
    try {
      await templateService.resetDailyEmailLimits();
      console.log('Daily email limits reset');
    } catch (error) {
      console.error('Error resetting daily email limits:', error);
    }
  });
  
  return templateModels;
};