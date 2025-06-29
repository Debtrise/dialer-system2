const twilio = require('twilio');
const { Op } = require('sequelize');
const moment = require('moment-timezone');

class TwilioService {
  constructor(models) {
    this.models = models;
    this.clients = new Map(); // Cache Twilio clients per tenant
  }

  /**
   * Get or create Twilio client for a tenant
   */
  async getTwilioClient(tenantId) {
    // Check cache
    if (this.clients.has(tenantId)) {
      return this.clients.get(tenantId);
    }

    // Get config from database
    const config = await this.models.TwilioConfig.findOne({
      where: { tenantId, isActive: true }
    });

    if (!config) {
      throw new Error('Twilio configuration not found for tenant');
    }

    // Create and cache client
    const client = twilio(config.accountSid, config.authToken);
    this.clients.set(tenantId, client);

    return client;
  }

  /**
   * Send an SMS message
   */
async sendSms(tenantId, options) {
  const {
    to,
    from,
    body,
    leadId,
    templateId,
    mediaUrl,
    statusCallback,
    metadata = {}
  } = options;

  let smsRecord; // Declare here, outside the try block

  try {
    // Get Twilio config
    const config = await this.models.TwilioConfig.findOne({
      where: { tenantId, isActive: true }
    });

    if (!config) {
      throw new Error('Twilio configuration not found');
    }

      // Check rate limits
      await this.checkRateLimits(config);

      // Select from number if not provided
      const fromNumber = from || await this.selectFromNumber(tenantId, to);

      // Create SMS record
      const smsRecord = await this.models.SmsMessage.create({
        tenantId,
        leadId,
        from: fromNumber,
        to,
        body,
        direction: 'outbound',
        status: 'queued',
        templateId,
        metadata
      });

      // Get Twilio client
      const client = await this.getTwilioClient(tenantId);

      // Prepare message options
      const messageOptions = {
        from: fromNumber,
        to,
        body
      };

      // Add optional parameters
      if (mediaUrl) {
        messageOptions.mediaUrl = Array.isArray(mediaUrl) ? mediaUrl : [mediaUrl];
      }

      if (statusCallback || config.settings.statusCallbackUrl) {
        messageOptions.statusCallback = statusCallback || config.settings.statusCallbackUrl;
      }

      // Use messaging service if configured
      if (config.settings.useMessagingService && config.settings.messagingServiceSid) {
        delete messageOptions.from;
        messageOptions.messagingServiceSid = config.settings.messagingServiceSid;
      }

      // Send via Twilio
      const message = await client.messages.create(messageOptions);

      // Update SMS record
      await smsRecord.update({
        status: 'sent',
        twilioSid: message.sid,
        twilioStatus: message.status,
        price: message.price,
        priceUnit: message.priceUnit,
        sentAt: new Date()
      });

      // Update from number usage
      if (!config.settings.useMessagingService) {
        await this.updateFromNumberUsage(fromNumber);
      }

      // Update config usage
      await this.updateConfigUsage(config, 'sent');

      // Update or create conversation
      await this.updateConversation(tenantId, leadId, to);

      // Update lead SMS status if leadId provided
      if (leadId) {
        await this.updateLeadSmsStatus(leadId);
      }

      return {
        success: true,
        messageId: smsRecord.id,
        twilioSid: message.sid,
        status: message.status
      };

    } catch (error) {
      console.error('Error sending SMS:', error);

      // Update SMS record if it exists
      if (smsRecord) {
        await smsRecord.update({
          status: 'failed',
          errorCode: error.code || 'UNKNOWN',
          errorMessage: error.message
        });
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
      console.error('Error sending templated SMS:', error);
      throw error;
    }
  }

  /**
   * Send bulk SMS
   */
  async sendBulkSms(tenantId, options) {
    const { recipients, body, templateId, from, throttle = 10 } = options;
    const results = [];
    const errors = [];

    try {
      // Process in batches to avoid overwhelming Twilio
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
   * Handle incoming SMS webhook
   */
  async handleIncomingSms(data) {
    try {
      const { From, To, Body, MessageSid, NumMedia, MediaUrl0 } = data;

      // Find tenant by the To number
      const smsNumber = await this.models.SmsPhoneNumber.findOne({
        where: { phoneNumber: To }
      });

      if (!smsNumber) {
        console.error(`No tenant found for incoming SMS to ${To}`);
        return;
      }

      const tenantId = smsNumber.tenantId;

      // Find or create lead
      const lead = await this.findOrCreateLeadByPhone(tenantId, From);

      // Create SMS record
      const smsRecord = await this.models.SmsMessage.create({
        tenantId,
        leadId: lead.id,
        from: From,
        to: To,
        body: Body,
        direction: 'inbound',
        status: 'delivered',
        twilioSid: MessageSid,
        metadata: {
          numMedia: NumMedia,
          mediaUrl: MediaUrl0
        }
      });

      // Update conversation
      await this.updateConversation(tenantId, lead.id, From, true);

      // Trigger any automated responses or workflows
      await this.handleInboundSmsWorkflows(tenantId, lead.id, Body, smsRecord.id);

      return {
        success: true,
        smsId: smsRecord.id,
        leadId: lead.id
      };

    } catch (error) {
      console.error('Error handling incoming SMS:', error);
      throw error;
    }
  }

  /**
   * Handle SMS status webhook
   */
  async handleStatusWebhook(data) {
    try {
      const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = data;

      // Find SMS record
      const smsRecord = await this.models.SmsMessage.findOne({
        where: { twilioSid: MessageSid }
      });

      if (!smsRecord) {
        console.error(`SMS record not found for SID: ${MessageSid}`);
        return;
      }

      // Update status
      const updateData = {
        twilioStatus: MessageStatus
      };

      // Map Twilio status to our status
      switch (MessageStatus) {
        case 'delivered':
          updateData.status = 'delivered';
          updateData.deliveredAt = new Date();
          break;
        case 'failed':
        case 'undelivered':
          updateData.status = 'failed';
          updateData.errorCode = ErrorCode;
          updateData.errorMessage = ErrorMessage;
          break;
      }

      await smsRecord.update(updateData);

      // Update config usage for delivered messages
      if (MessageStatus === 'delivered') {
        const config = await this.models.TwilioConfig.findOne({
          where: { tenantId: smsRecord.tenantId }
        });
        if (config) {
          await this.updateConfigUsage(config, 'delivered');
        }
      }

      return {
        success: true,
        status: MessageStatus
      };

    } catch (error) {
      console.error('Error handling SMS status webhook:', error);
      throw error;
    }
  }

  /**
   * Get SMS conversation for a lead
   */
  async getConversation(tenantId, leadId, options = {}) {
    const { page = 1, limit = 50 } = options;

    try {
      // Get conversation info
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

      // Get messages
      const messages = await this.models.SmsMessage.findAll({
        where: { tenantId, leadId },
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      });

      const count = await this.models.SmsMessage.count({
        where: { tenantId, leadId }
      });

      // Mark as read if requested
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
   * Check rate limits
   */
  async checkRateLimits(config) {
    const now = moment();
    const minuteAgo = now.clone().subtract(1, 'minute');
    const hourAgo = now.clone().subtract(1, 'hour');

    // Check messages per minute
    const messagesLastMinute = await this.models.SmsMessage.count({
      where: {
        tenantId: config.tenantId,
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
        direction: 'outbound',
        createdAt: { [Op.gte]: today.toDate() }
      }
    });

    if (messagesToday >= config.rateLimits.messagesPerDay) {
      throw new Error('Rate limit exceeded: messages per day');
    }
  }

  /**
   * Select best from number for SMS
   */
  async selectFromNumber(tenantId, toNumber) {
    // Get config
    const config = await this.models.TwilioConfig.findOne({
      where: { tenantId, isActive: true }
    });

    if (!config) {
      throw new Error('Twilio configuration not found');
    }

    // If using messaging service, return default
    if (config.settings.useMessagingService) {
      return config.defaultFromNumber;
    }

    // Try to find a local number
    const toAreaCode = toNumber.replace(/\D/g, '').substring(0, 3);
    
    const localNumber = await this.models.SmsPhoneNumber.findOne({
      where: {
        tenantId,
        isActive: true,
        phoneNumber: {
          [Op.like]: `%${toAreaCode}%`
        }
      },
      order: [['usageCount', 'ASC'], ['lastUsed', 'ASC']]
    });

    if (localNumber) {
      return localNumber.phoneNumber;
    }

    // Get any available number
    const anyNumber = await this.models.SmsPhoneNumber.findOne({
      where: {
        tenantId,
        isActive: true
      },
      order: [['usageCount', 'ASC'], ['lastUsed', 'ASC']]
    });

    return anyNumber ? anyNumber.phoneNumber : config.defaultFromNumber;
  }

  /**
   * Update from number usage stats
   */
  async updateFromNumberUsage(phoneNumber) {
    await this.models.SmsPhoneNumber.update(
      {
        usageCount: this.sequelize.literal('usage_count + 1'),
        lastUsed: new Date()
      },
      {
        where: { phoneNumber }
      }
    );
  }

  /**
   * Update config usage stats
   */
  async updateConfigUsage(config, type) {
    const updates = {};
    
    if (type === 'sent') {
      updates.usage = {
        ...config.usage,
        totalSent: config.usage.totalSent + 1
      };
    } else if (type === 'delivered') {
      updates.usage = {
        ...config.usage,
        totalDelivered: config.usage.totalDelivered + 1
      };
    } else if (type === 'failed') {
      updates.usage = {
        ...config.usage,
        totalFailed: config.usage.totalFailed + 1
      };
    }

    await config.update(updates);
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
   * Update lead SMS status
   */
  async updateLeadSmsStatus(leadId) {
    const lead = await this.models.Lead.findByPk(leadId);
    if (lead) {
      await lead.update({
        smsAttempts: lead.smsAttempts + 1,
        lastSmsAttempt: new Date(),
        smsStatus: 'sent'
      });
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
        source: 'SMS Inbound'
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
          firstName: lead.name.split(' ')[0],
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
    await this.models.Template.update(
      {
        usageCount: this.sequelize.literal('usage_count + 1'),
        lastUsed: new Date()
      },
      {
        where: { id: templateId }
      }
    );
  }

  /**
   * Handle inbound SMS workflows (placeholder for automation)
   */
  async handleInboundSmsWorkflows(tenantId, leadId, message, smsId) {
    // This is where you'd implement:
    // - Auto-responses
    // - Keyword detection
    // - Journey triggers
    // - Notifications
    console.log(`Inbound SMS workflow for tenant ${tenantId}, lead ${leadId}: ${message}`);
  }

  /**
   * Get Twilio phone numbers
   */
  async getTwilioNumbers(tenantId) {
    try {
      const client = await this.getTwilioClient(tenantId);
      const numbers = await client.incomingPhoneNumbers.list();
      
      return numbers.map(num => ({
        phoneNumber: num.phoneNumber,
        friendlyName: num.friendlyName,
        capabilities: {
          sms: num.capabilities.sms,
          mms: num.capabilities.mms,
          voice: num.capabilities.voice
        },
        dateCreated: num.dateCreated
      }));
    } catch (error) {
      console.error('Error fetching Twilio numbers:', error);
      throw error;
    }
  }

  /**
   * Sync Twilio numbers to database
   */
  async syncTwilioNumbers(tenantId) {
    try {
      const twilioNumbers = await this.getTwilioNumbers(tenantId);
      
      for (const num of twilioNumbers) {
        await this.models.SmsPhoneNumber.upsert({
          tenantId,
          phoneNumber: num.phoneNumber,
          friendlyName: num.friendlyName,
          capabilities: num.capabilities,
          isActive: true
        });
      }
      
      return {
        success: true,
        synced: twilioNumbers.length
      };
    } catch (error) {
      console.error('Error syncing Twilio numbers:', error);
      throw error;
    }
  }
}

module.exports = TwilioService;
