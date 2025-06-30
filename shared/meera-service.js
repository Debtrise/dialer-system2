// meera-service.js
const axios = require('axios');
const { Op } = require('sequelize');
const moment = require('moment-timezone');

class MeeraService {
  constructor(models) {
    this.models = models;
    this.clients = new Map(); // Cache API clients per tenant
  }

  /**
   * Get or create Meera API client for a tenant
   */
  async getMeeraClient(tenantId) {
    // Check cache
    if (this.clients.has(tenantId)) {
      return this.clients.get(tenantId);
    }

    // Get config from database
    const config = await this.models.MeeraConfig.findOne({
      where: { tenantId, isActive: true }
    });

    if (!config) {
      throw new Error('Meera configuration not found for tenant');
    }

    // Create axios instance with defaults
    const client = axios.create({
      baseURL: config.baseUrl || 'https://chatbot.meera.ai/api/v1',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey,
        'X-API-Secret': config.apiSecret || '',
        'User-Agent': 'Knittt/1.0'
      },
      timeout: 30000,
      validateStatus: function (status) {
        return status < 500; // Don't throw on 4xx errors
      }
    });

    // Add request interceptor for logging
    client.interceptors.request.use(request => {
      console.log(`Meera API Request: ${request.method?.toUpperCase()} ${request.baseURL}${request.url}`);
      return request;
    });

    // Add response interceptor for error handling
    client.interceptors.response.use(
      response => response,
      error => {
        if (error.code === 'ENOTFOUND') {
          console.error('Meera API endpoint not reachable:', config.baseUrl);
          throw new Error('Meera API is not accessible. Please check your network connection.');
        }
        throw error;
      }
    );

    // Cache client
    this.clients.set(tenantId, { client, config });

    return { client, config };
  }

  /**
   * Send an SMS message via Meera
   */
  async sendSms(tenantId, options) {
    const {
      to,
      from,
      body,
      leadId,
      templateId,
      metadata = {}
    } = options;

    let smsRecord;

    try {
      // Get Meera config
      const { client, config } = await this.getMeeraClient(tenantId);

      // Check rate limits
      await this.checkRateLimits(config);

      // Select from number if not provided
      const fromNumber = from || config.defaultFromNumber;

      // Create SMS record
      smsRecord = await this.models.SmsMessage.create({
        tenantId,
        leadId,
        from: fromNumber,
        to,
        body,
        direction: 'outbound',
        status: 'queued',
        provider: 'meera',
        templateId,
        metadata
      });

      // Prepare Meera API payload
      const payload = {
        to: this.formatPhoneNumber(to),
        from: fromNumber,
        text: body,
        type: config.settings.messageType || 'promotional',
        callback_url: config.settings.enableDeliveryReports ? 
          `${process.env.APP_URL}/api/webhooks/meera/status/${smsRecord.id}` : null,
        unicode: config.settings.enableUnicode ? 1 : 0,
        flash: config.settings.enableFlashMessage ? 1 : 0,
        max_parts: config.settings.maxSegments,
        reference_id: smsRecord.id.toString(),
        metadata: {
          tenant_id: tenantId,
          lead_id: leadId,
          ...metadata.customParams
        }
      };

      console.log('Sending SMS via Meera:', { to: payload.to, from: payload.from });

      // Send via Meera API
      const response = await client.post('/messages/send', payload);

      // Handle response
      if (response.status === 200 && response.data) {
        if (response.data.status === 'success' || response.data.success) {
          // Update SMS record with Meera response
          await smsRecord.update({
            status: 'sent',
            twilioSid: response.data.message_id || response.data.id,
            twilioStatus: response.data.status || 'sent',
            price: response.data.cost || response.data.price,
            priceUnit: response.data.currency || 'USD',
            sentAt: new Date()
          });

          // Update usage stats
          await this.updateConfigUsage(config, 'sent');

          // Update conversation if leadId provided
          if (leadId) {
            await this.updateConversation(tenantId, leadId, to);
            await this.updateLeadSmsStatus(leadId);
          }

          return {
            success: true,
            messageId: smsRecord.id,
            providerId: response.data.message_id || response.data.id,
            status: response.data.status || 'sent',
            provider: 'meera'
          };
        } else {
          throw new Error(response.data.error || response.data.message || 'Failed to send SMS via Meera');
        }
      } else {
        throw new Error(`Meera API returned status ${response.status}: ${response.data?.message || 'Unknown error'}`);
      }

    } catch (error) {
      console.error('Error sending SMS via Meera:', error.message || error);

      // Update SMS record if it exists
      if (smsRecord) {
        await smsRecord.update({
          status: 'failed',
          errorCode: error.response?.data?.error_code || error.code || 'UNKNOWN',
          errorMessage: error.response?.data?.message || error.message
        });
      }

      // Update failed count
      if (error.config) {
        const { config } = await this.getMeeraClient(tenantId);
        await this.updateConfigUsage(config, 'failed');
      }

      throw error;
    }
  }

  /**
   * Send SMS using a template
   */
  async sendTemplatedSms(tenantId, options) {
    const { to, templateId, variables = {}, leadId, from, metadata = {} } = options;

    try {
      // Get template
      const template = await this.models.Template.findOne({
        where: {
          id: templateId,
          tenantId,
          type: 'sms',
          isActive: true
        }
      });

      if (!template) {
        throw new Error('SMS template not found');
      }

      // Render template
      const body = await this.renderTemplate(template.content, variables, leadId);

      // Send SMS
      const result = await this.sendSms(tenantId, {
        to,
        from,
        body,
        leadId,
        templateId,
        metadata: {
          ...metadata,
          templateName: template.name
        }
      });

      // Track template usage
      await this.trackTemplateUsage(tenantId, templateId, 'sms', leadId, variables, body);

      return result;

    } catch (error) {
      console.error('Error sending templated SMS via Meera:', error);
      throw error;
    }
  }

  /**
   * Check account balance
   */
  async checkBalance(tenantId) {
    try {
      const { client, config } = await this.getMeeraClient(tenantId);
      
      console.log('Checking Meera balance...');
      
      const response = await client.get('/account/balance');
      
      if (response.status === 200 && response.data) {
        const balance = response.data.balance || response.data.credits || 0;
        const currency = response.data.currency || 'USD';
        
        // Update balance in config
        await config.update({
          usage: {
            ...config.usage,
            balance: balance,
            lastBalanceCheck: new Date()
          }
        });
        
        return {
          balance: balance,
          currency: currency,
          lastChecked: new Date()
        };
      } else if (response.status === 404) {
        // Endpoint might be different, try alternative
        const altResponse = await client.get('/account/credits');
        if (altResponse.status === 200 && altResponse.data) {
          const balance = altResponse.data.credits || 0;
          return {
            balance: balance,
            currency: 'Credits',
            lastChecked: new Date()
          };
        }
      }
      
      throw new Error(`Failed to check balance: ${response.data?.message || 'Unknown error'}`);
    } catch (error) {
      console.error('Error checking Meera balance:', error.message || error);
      
      if (error.code === 'ENOTFOUND') {
        throw new Error('Meera API is not accessible. Please check your internet connection and API endpoint.');
      } else if (error.response?.status === 401) {
        throw new Error('Invalid API credentials. Please check your API key and secret.');
      } else if (error.response?.status === 403) {
        throw new Error('Access denied. Your API key may not have permission to check balance.');
      }
      
      throw error;
    }
  }

  /**
   * Test connection to Meera API
   */
  async testConnection(tenantId) {
    try {
      const { client, config } = await this.getMeeraClient(tenantId);
      
      console.log('Testing Meera connection...');
      
      // Try to get account info or balance
      const response = await client.get('/account/info').catch(err => {
        if (err.response?.status === 404) {
          // Try alternative endpoint
          return client.get('/account/balance');
        }
        throw err;
      });
      
      if (response.status === 200) {
        return {
          success: true,
          message: 'Meera connection successful',
          accountInfo: response.data
        };
      } else if (response.status === 401) {
        throw new Error('Invalid API credentials');
      }
      
      throw new Error('Connection test failed');
    } catch (error) {
      console.error('Meera connection test failed:', error.message || error);
      
      if (error.code === 'ENOTFOUND') {
        throw new Error('Cannot reach Meera API. Please check your internet connection.');
      } else if (error.response?.status === 401) {
        throw new Error('Invalid API key or secret. Please check your credentials.');
      }
      
      throw error;
    }
  }

  /**
   * Handle incoming SMS webhook from Meera
   */
  async handleIncomingSms(data) {
    try {
      const { 
        from, 
        to, 
        text, 
        message_id, 
        received_at,
        metadata 
      } = data;

      // Find tenant by the To number
      const config = await this.models.MeeraConfig.findOne({
        where: { 
          defaultFromNumber: to,
          isActive: true
        }
      });

      if (!config) {
        console.error(`No tenant found for incoming SMS to ${to}`);
        return { success: false, error: 'Unknown recipient' };
      }

      const tenantId = config.tenantId;

      // Find or create lead
      const lead = await this.findOrCreateLeadByPhone(tenantId, from);

      // Create SMS record
      const smsRecord = await this.models.SmsMessage.create({
        tenantId,
        leadId: lead.id,
        from,
        to,
        body: text,
        direction: 'inbound',
        status: 'delivered',
        provider: 'meera',
        twilioSid: message_id,
        metadata: {
          receivedAt: received_at,
          ...metadata
        }
      });

      // Update conversation
      await this.updateConversation(tenantId, lead.id, from, true);

      // Trigger any automated responses or workflows
      await this.handleInboundSmsWorkflows(tenantId, lead.id, text, smsRecord.id);

      return {
        success: true,
        smsId: smsRecord.id,
        leadId: lead.id
      };

    } catch (error) {
      console.error('Error handling incoming SMS from Meera:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle SMS status webhook from Meera
   */
  async handleStatusWebhook(messageId, data) {
    try {
      const { 
        status, 
        delivered_at, 
        error_code, 
        error_message,
        message_id,
        reference_id 
      } = data;

      // Find SMS record by our ID or Meera's message ID
      let smsRecord = await this.models.SmsMessage.findByPk(messageId);
      
      if (!smsRecord && reference_id) {
        smsRecord = await this.models.SmsMessage.findByPk(reference_id);
      }
      
      if (!smsRecord && message_id) {
        smsRecord = await this.models.SmsMessage.findOne({
          where: { twilioSid: message_id }
        });
      }

      if (!smsRecord) {
        console.error(`SMS record not found for ID: ${messageId}`);
        return { success: false, error: 'Message not found' };
      }

      // Update status
      const updateData = {
        twilioStatus: status
      };

      // Map Meera status to our status
      switch (status.toLowerCase()) {
        case 'delivered':
        case 'success':
          updateData.status = 'delivered';
          updateData.deliveredAt = delivered_at ? new Date(delivered_at) : new Date();
          break;
        case 'failed':
        case 'rejected':
        case 'error':
          updateData.status = 'failed';
          updateData.errorCode = error_code;
          updateData.errorMessage = error_message;
          break;
        case 'pending':
        case 'queued':
          updateData.status = 'queued';
          break;
        case 'sent':
          updateData.status = 'sent';
          break;
      }

      await smsRecord.update(updateData);

      // Update config usage for delivered messages
      if (updateData.status === 'delivered') {
        const config = await this.models.MeeraConfig.findOne({
          where: { tenantId: smsRecord.tenantId }
        });
        if (config) {
          await this.updateConfigUsage(config, 'delivered');
        }
      }

      return {
        success: true,
        status: status
      };

    } catch (error) {
      console.error('Error handling SMS status webhook from Meera:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check rate limits
   */
  async checkRateLimits(config) {
    const now = moment();
    const secondAgo = now.clone().subtract(1, 'second');
    const minuteAgo = now.clone().subtract(1, 'minute');
    const hourAgo = now.clone().subtract(1, 'hour');

    // Check messages per second
    const messagesLastSecond = await this.models.SmsMessage.count({
      where: {
        tenantId: config.tenantId,
        provider: 'meera',
        direction: 'outbound',
        createdAt: { [Op.gte]: secondAgo.toDate() }
      }
    });

    if (messagesLastSecond >= config.rateLimits.messagesPerSecond) {
      throw new Error('Rate limit exceeded: messages per second');
    }

    // Check messages per minute
    const messagesLastMinute = await this.models.SmsMessage.count({
      where: {
        tenantId: config.tenantId,
        provider: 'meera',
        direction: 'outbound',
        createdAt: { [Op.gte]: minuteAgo.toDate() }
      }
    });

    if (messagesLastMinute >= config.rateLimits.messagesPerMinute) {
      throw new Error('Rate limit exceeded: messages per minute');
    }

    // Check messages per hour
    const messagesLastHour = await this.models.SmsMessage.count({
      where: {
        tenantId: config.tenantId,
        provider: 'meera',
        direction: 'outbound',
        createdAt: { [Op.gte]: hourAgo.toDate() }
      }
    });

    if (messagesLastHour >= config.rateLimits.messagesPerHour) {
      throw new Error('Rate limit exceeded: messages per hour');
    }

    // Check daily limit
    const today = moment().startOf('day');
    const messagesToday = await this.models.SmsMessage.count({
      where: {
        tenantId: config.tenantId,
        provider: 'meera',
        direction: 'outbound',
        createdAt: { [Op.gte]: today.toDate() }
      }
    });

    if (messagesToday >= config.rateLimits.messagesPerDay) {
      throw new Error('Rate limit exceeded: messages per day');
    }
  }

  /**
   * Update config usage stats
   */
  async updateConfigUsage(config, type) {
    const usage = { ...config.usage };
    
    switch (type) {
      case 'sent':
        usage.totalSent = (usage.totalSent || 0) + 1;
        break;
      case 'delivered':
        usage.totalDelivered = (usage.totalDelivered || 0) + 1;
        break;
      case 'failed':
        usage.totalFailed = (usage.totalFailed || 0) + 1;
        break;
    }

    await config.update({ usage });
  }

  /**
   * Format phone number for Meera API
   */
  formatPhoneNumber(phone, countryCode = '1') {
    if (!phone) return null;
    
    // Remove all non-numeric characters
    let cleaned = String(phone).replace(/\D/g, '');
    
    // Handle country code
    if (!cleaned.startsWith(countryCode) && cleaned.length === 10) {
      cleaned = countryCode + cleaned;
    }
    
    // Add + prefix if not present
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }
    
    return cleaned;
  }

  /**
   * Update or create SMS conversation
   */
  async updateConversation(tenantId, leadId, phoneNumber, isInbound = false) {
    const conversation = await this.models.SmsConversation.findOne({
      where: { tenantId, leadId }
    });

    if (conversation) {
      const updates = {
        lastMessageAt: new Date()
      };

      if (isInbound) {
        updates.unreadCount = conversation.unreadCount + 1;
      }

      await conversation.update(updates);
    } else {
      await this.models.SmsConversation.create({
        tenantId,
        leadId,
        phoneNumber,
        lastMessageAt: new Date(),
        unreadCount: isInbound ? 1 : 0
      });
    }
  }

  /**
   * Get SMS conversation for a lead
   */
  async getConversation(tenantId, leadId, options = {}) {
    const { page = 1, limit = 50 } = options;

    try {
      const conversation = await this.models.SmsConversation.findOne({
        where: { tenantId, leadId }
      });

      if (!conversation) {
        return {
          messages: [],
          totalCount: 0,
          unreadCount: 0
        };
      }

      const messages = await this.models.SmsMessage.findAll({
        where: { tenantId, leadId },
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      });

      const count = await this.models.SmsMessage.count({
        where: { tenantId, leadId }
      });

      if (options.markAsRead && conversation.unreadCount > 0) {
        await conversation.update({ unreadCount: 0 });
      }

      return {
        messages,
        totalCount: count,
        totalPages: Math.ceil(count / parseInt(limit)),
        currentPage: parseInt(page),
        unreadCount: conversation.unreadCount
      };

    } catch (error) {
      console.error('Error getting SMS conversation:', error);
      throw error;
    }
  }

  /**
   * Update lead SMS status
   */
  async updateLeadSmsStatus(leadId) {
    const lead = await this.models.Lead.findByPk(leadId);
    if (lead) {
      const updates = {
        smsAttempts: (lead.smsAttempts || 0) + 1,
        lastSmsAttempt: new Date()
      };
      
      if (lead.smsStatus) {
        updates.smsStatus = 'sent';
      }
      
      await lead.update(updates);
    }
  }

  /**
   * Find or create lead by phone number
   */
  async findOrCreateLeadByPhone(tenantId, phoneNumber) {
    let lead = await this.models.Lead.findOne({
      where: { tenantId, phone: phoneNumber }
    });

    if (!lead) {
      lead = await this.models.Lead.create({
        tenantId,
        phone: phoneNumber,
        name: 'SMS Lead',
        status: 'pending',
        source: 'SMS Inbound (Meera)'
      });
    }

    return lead;
  }

  /**
   * Render template with variables
   */
  async renderTemplate(template, variables, leadId) {
    let rendered = template;

    // Get lead data if leadId provided
    let leadData = {};
    if (leadId) {
      const lead = await this.models.Lead.findByPk(leadId);
      if (lead) {
        leadData = {
          name: lead.name,
          firstName: lead.name ? lead.name.split(' ')[0] : '',
          phone: lead.phone,
          email: lead.email,
          ...lead.additionalData
        };
      }
    }

    // Merge variables
    const allVariables = {
      ...leadData,
      ...variables,
      date: moment().format('MM/DD/YYYY'),
      time: moment().format('h:mm A'),
      datetime: moment().format('MM/DD/YYYY h:mm A')
    };

    // Replace variables in template
    Object.entries(allVariables).forEach(([key, value]) => {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      rendered = rendered.replace(regex, value || '');
    });

    return rendered;
  }

  /**
   * Track template usage
   */
  async trackTemplateUsage(tenantId, templateId, type, entityId, variables, renderedContent) {
    if (this.models.TemplateUsage) {
      await this.models.TemplateUsage.create({
        tenantId,
        templateId,
        usedFor: 'manual',
        entityType: type,
        entityId,
        variables,
        renderedContent
      });

      // Update template usage count
      await this.models.Template.increment('usageCount', {
        where: { id: templateId }
      });

      await this.models.Template.update(
        { lastUsed: new Date() },
        { where: { id: templateId } }
      );
    }
  }

  /**
   * Handle inbound SMS workflows
   */
  async handleInboundSmsWorkflows(tenantId, leadId, message, smsId) {
    // Check for opt-out keywords
    const optOutKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
    const messageUpper = message.toUpperCase().trim();
    
    if (optOutKeywords.includes(messageUpper)) {
      // Mark lead as opted out
      const lead = await this.models.Lead.findByPk(leadId);
      if (lead) {
        await lead.update({
          smsOptOut: true,
          smsOptOutDate: new Date()
        });
        console.log(`Lead ${leadId} opted out via SMS`);
      }
    }
    
    // Placeholder for additional automated workflows
    console.log(`Inbound SMS workflow for tenant ${tenantId}, lead ${leadId}: ${message}`);
  }

  /**
   * Send bulk SMS
   */
  async sendBulkSms(tenantId, options) {
    const { recipients, body, templateId, from, throttle = 10 } = options;
    const results = [];
    const errors = [];

    try {
      // Process in batches to avoid overwhelming the API
      for (let i = 0; i < recipients.length; i += throttle) {
        const batch = recipients.slice(i, i + throttle);
        
        const promises = batch.map(async (recipient) => {
          try {
            const smsOptions = {
              to: recipient.phone,
              leadId: recipient.leadId,
              from,
              metadata: recipient.metadata || {}
            };

            if (templateId) {
              smsOptions.templateId = templateId;
              smsOptions.variables = recipient.variables || {};
              return await this.sendTemplatedSms(tenantId, smsOptions);
            } else {
              smsOptions.body = body;
              return await this.sendSms(tenantId, smsOptions);
            }
          } catch (error) {
            errors.push({
              recipient: recipient.phone,
              error: error.message
            });
            return null;
          }
        });

        const batchResults = await Promise.all(promises);
        results.push(...batchResults.filter(r => r !== null));

        // Add delay between batches
        if (i + throttle < recipients.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      return {
        success: true,
        sent: results.length,
        failed: errors.length,
        results,
        errors
      };

    } catch (error) {
      console.error('Error in bulk SMS send:', error);
      throw error;
    }
  }

  /**
   * Get SMS history
   */
  async getSmsHistory(tenantId, options = {}) {
    const { 
      page = 1, 
      limit = 50, 
      leadId, 
      startDate, 
      endDate,
      status,
      direction 
    } = options;

    const where = { 
      tenantId,
      provider: 'meera'
    };

    if (leadId) where.leadId = leadId;
    if (status) where.status = status;
    if (direction) where.direction = direction;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const messages = await this.models.SmsMessage.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
      include: [{
        model: this.models.Lead,
        attributes: ['id', 'name', 'phone']
      }]
    });

    const count = await this.models.SmsMessage.count({ where });

    return {
      messages,
      totalCount: count,
      totalPages: Math.ceil(count / parseInt(limit)),
      currentPage: parseInt(page)
    };
  }

  /**
   * Invalidate cached client
   */
  invalidateClient(tenantId) {
    this.clients.delete(tenantId);
  }
}

module.exports = MeeraService;