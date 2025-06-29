// template-service.js - Fixed version with proper Sequelize initialization

const { Op } = require('sequelize');
const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');
const moment = require('moment-timezone');

class TemplateService {
  constructor(models, sequelize = null) {
    this.models = models;
    this.sequelize = sequelize || (models.sequelize ? models.sequelize : require('sequelize'));
    this.emailTransporters = new Map();
  }

  /**
   * Create a new template
   */
  async createTemplate(tenantId, data) {
    try {
      // Extract variables from content
      const variables = this.extractVariables(data.content);
      
      // If email template, extract from HTML content too
      if (data.type === 'email' && data.htmlContent) {
        const htmlVariables = this.extractVariables(data.htmlContent);
        variables.push(...htmlVariables);
      }
      
      // Remove duplicates
      const uniqueVariables = [...new Set(variables)];
      
      // Create template
      const template = await this.models.Template.create({
        tenantId,
        ...data,
        variables: uniqueVariables.map(v => ({
          name: v,
          description: `Variable: ${v}`,
          defaultValue: ''
        }))
      });
      
      return template;
    } catch (error) {
      console.error('Error creating template:', error);
      throw error;
    }
  }

  /**
   * Update a template
   */
  async updateTemplate(templateId, tenantId, data) {
    try {
      // Extract variables if content is being updated
      if (data.content || data.htmlContent) {
        const variables = [];
        
        if (data.content) {
          variables.push(...this.extractVariables(data.content));
        }
        
        if (data.htmlContent) {
          variables.push(...this.extractVariables(data.htmlContent));
        }
        
        const uniqueVariables = [...new Set(variables)];
        data.variables = uniqueVariables.map(v => ({
          name: v,
          description: `Variable: ${v}`,
          defaultValue: ''
        }));
      }
      
      const [updated] = await this.models.Template.update(data, {
        where: { id: templateId, tenantId }
      });
      
      if (!updated) {
        throw new Error('Template not found or access denied');
      }
      
      return this.getTemplate(templateId, tenantId);
    } catch (error) {
      console.error('Error updating template:', error);
      throw error;
    }
  }

  /**
   * Get a template
   */
  async getTemplate(templateId, tenantId) {
    const template = await this.models.Template.findOne({
      where: { id: templateId, tenantId },
      include: [{
        model: this.models.TemplateCategory,
        as: 'category'
      }]
    });
    
    if (!template) {
      throw new Error('Template not found');
    }
    
    return template;
  }

  /**
   * List templates
   */
  async listTemplates(tenantId, options = {}) {
    const { type, categoryId, isActive, page = 1, limit = 50 } = options;
    
    const query = {
      where: { tenantId },
      include: [{
        model: this.models.TemplateCategory,
        as: 'category'
      }],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
      order: [['name', 'ASC']]
    };
    
    if (type) query.where.type = type;
    if (categoryId) query.where.categoryId = categoryId;
    if (isActive !== undefined) query.where.isActive = isActive;
    
    const templates = await this.models.Template.findAll(query);
    const count = await this.models.Template.count({ where: query.where });
    
    return {
      templates,
      totalCount: count,
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / parseInt(limit))
    };
  }

  /**
   * Delete a template
   */
  async deleteTemplate(templateId, tenantId) {
    const result = await this.models.Template.destroy({
      where: { id: templateId, tenantId }
    });
    
    if (!result) {
      throw new Error('Template not found or access denied');
    }
    
    return { success: true };
  }

  /**
   * Render a template with variables
   */
  async renderTemplate(templateId, tenantId, variables = {}, context = {}) {
    try {
      const template = await this.getTemplate(templateId, tenantId);
      
      // Merge default values with provided variables
      const defaultVariables = {};
      if (template.variables) {
        template.variables.forEach(v => {
          if (v.defaultValue) {
            defaultVariables[v.name] = v.defaultValue;
          }
        });
      }
      
      const allVariables = {
        ...defaultVariables,
        ...this.getSystemVariables(),
        ...context,
        ...variables
      };
      
      // Render content
      let rendered = template.content;
      let renderedHtml = template.htmlContent;
      let renderedSubject = template.subject;
      
      // Replace variables
      Object.entries(allVariables).forEach(([key, value]) => {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        rendered = rendered.replace(regex, value || '');
        
        if (renderedHtml) {
          renderedHtml = renderedHtml.replace(regex, value || '');
        }
        
        if (renderedSubject) {
          renderedSubject = renderedSubject.replace(regex, value || '');
        }
      });
      
      // Track usage
      await this.trackUsage(templateId, tenantId, 'render', null, variables, rendered);
      
      return {
        content: rendered,
        htmlContent: renderedHtml,
        subject: renderedSubject,
        template
      };
    } catch (error) {
      console.error('Error rendering template:', error);
      throw error;
    }
  }

  /**
   * Get transfer group by brand and ingroup
   */
  async getTransferGroupByBrandIngroup(tenantId, brand, ingroup) {
    const group = await this.models.TransferGroup.findOne({
      where: { 
        tenantId, 
        brand,
        ingroup,
        isActive: true 
      },
      include: [{
        model: this.models.TransferNumber,
        as: 'numbers',
        where: { isActive: true },
        required: false,
        order: [['priority', 'ASC']]
      }]
    });
    
    return group;
  }

  /**
   * List transfer groups with brand/ingroup filtering
   */
  async listTransferGroups(tenantId, options = {}) {
    const { isActive, brand, ingroup, page = 1, limit = 50 } = options;
    
    const query = {
      where: { tenantId },
      include: [{
        model: this.models.TransferNumber,
        as: 'numbers'
      }],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
      order: [['name', 'ASC']]
    };
    
    if (isActive !== undefined) query.where.isActive = isActive;
    if (brand) query.where.brand = brand;
    if (ingroup) query.where.ingroup = ingroup;
    
    const groups = await this.models.TransferGroup.findAll(query);
    const count = await this.models.TransferGroup.count({ where: query.where });
    
    return {
      groups,
      totalCount: count,
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / parseInt(limit))
    };
  }

  /**
   * Get next transfer number based on brand/ingroup
   */
  async getNextTransferNumberByBrandIngroup(tenantId, brand, ingroup) {
    try {
      const group = await this.getTransferGroupByBrandIngroup(tenantId, brand, ingroup);
      
      if (!group || !group.numbers || group.numbers.length === 0) {
        // Fallback to default group without brand/ingroup
        const defaultGroup = await this.models.TransferGroup.findOne({
          where: { 
            tenantId,
            brand: null,
            ingroup: null,
            isActive: true 
          },
          include: [{
            model: this.models.TransferNumber,
            as: 'numbers',
            where: { isActive: true },
            required: true
          }]
        });
        
        if (!defaultGroup || !defaultGroup.numbers || defaultGroup.numbers.length === 0) {
          throw new Error('No transfer numbers available');
        }
        
        return this.selectNumberFromGroup(defaultGroup);
      }
      
      return this.selectNumberFromGroup(group);
    } catch (error) {
      console.error('Error getting transfer number by brand/ingroup:', error);
      throw error;
    }
  }

  /**
   * Select a number from a transfer group based on routing type
   */
  async selectNumberFromGroup(group) {
    const activeNumbers = group.numbers.filter(n => {
      if (!n.businessHours.enabled) return true;
      return this.isWithinBusinessHours(n.businessHours);
    });
    
    if (activeNumbers.length === 0) {
      throw new Error('No active transfer numbers available');
    }
    
    let selectedNumber;
    
    switch (group.type) {
      case 'roundrobin':
        // Get the number with least recent usage
        selectedNumber = activeNumbers.reduce((prev, curr) => {
          if (!prev.stats.lastCallAt) return prev;
          if (!curr.stats.lastCallAt) return curr;
          return new Date(prev.stats.lastCallAt) < new Date(curr.stats.lastCallAt) ? prev : curr;
        });
        break;
        
      case 'priority':
        // Get highest priority (lowest number)
        selectedNumber = activeNumbers.reduce((prev, curr) => 
          prev.priority < curr.priority ? prev : curr
        );
        break;
        
      case 'percentage':
        // Weighted random selection
        const totalWeight = activeNumbers.reduce((sum, n) => sum + n.weight, 0);
        let random = Math.random() * totalWeight;
        
        for (const number of activeNumbers) {
          random -= number.weight;
          if (random <= 0) {
            selectedNumber = number;
            break;
          }
        }
        break;
        
      case 'simultaneous':
        // Return all numbers for simultaneous ringing
        return activeNumbers.map(n => n.phoneNumber);
        
      default:
        selectedNumber = activeNumbers[0];
    }
    
    // Update stats
    if (selectedNumber) {
      await this.models.TransferNumber.update(
        {
          stats: {
            ...selectedNumber.stats,
            totalCalls: (selectedNumber.stats.totalCalls || 0) + 1,
            lastCallAt: new Date()
          }
        },
        {
          where: { id: selectedNumber.id }
        }
      );
      
      return selectedNumber.phoneNumber;
    }
    
    throw new Error('Could not select transfer number');
  }

  /**
   * Create a transfer group
   */
  async createTransferGroup(tenantId, data) {
    try {
      const group = await this.models.TransferGroup.create({
        tenantId,
        ...data
      });
      
      return group;
    } catch (error) {
      console.error('Error creating transfer group:', error);
      throw error;
    }
  }

  /**
   * Update a transfer group
   */
  async updateTransferGroup(groupId, tenantId, data) {
    try {
      const [updated] = await this.models.TransferGroup.update(data, {
        where: { id: groupId, tenantId }
      });
      
      if (!updated) {
        throw new Error('Transfer group not found or access denied');
      }
      
      return this.getTransferGroup(groupId, tenantId);
    } catch (error) {
      console.error('Error updating transfer group:', error);
      throw error;
    }
  }

  /**
   * Get a transfer group with numbers
   */
  async getTransferGroup(groupId, tenantId) {
    const group = await this.models.TransferGroup.findOne({
      where: { id: groupId, tenantId },
      include: [{
        model: this.models.TransferNumber,
        as: 'numbers',
        order: [['priority', 'ASC']]
      }]
    });
    
    if (!group) {
      throw new Error('Transfer group not found');
    }
    
    return group;
  }

  /**
   * Add number to transfer group
   */
  async addTransferNumber(groupId, tenantId, data) {
    try {
      // Verify group belongs to tenant
      const group = await this.models.TransferGroup.findOne({
        where: { id: groupId, tenantId }
      });
      
      if (!group) {
        throw new Error('Transfer group not found or access denied');
      }
      
      const number = await this.models.TransferNumber.create({
        groupId,
        ...data
      });
      
      return number;
    } catch (error) {
      console.error('Error adding transfer number:', error);
      throw error;
    }
  }

  /**
   * Update transfer number
   */
  async updateTransferNumber(numberId, groupId, data) {
    try {
      const [updated] = await this.models.TransferNumber.update(data, {
        where: { id: numberId, groupId }
      });
      
      if (!updated) {
        throw new Error('Transfer number not found');
      }
      
      return this.models.TransferNumber.findByPk(numberId);
    } catch (error) {
      console.error('Error updating transfer number:', error);
      throw error;
    }
  }

  /**
   * Remove transfer number
   */
  async removeTransferNumber(numberId, groupId) {
    const result = await this.models.TransferNumber.destroy({
      where: { id: numberId, groupId }
    });
    
    if (!result) {
      throw new Error('Transfer number not found');
    }
    
    return { success: true };
  }

  /**
   * Get next transfer number based on routing
   */
  async getNextTransferNumber(groupId, tenantId) {
    try {
      const group = await this.getTransferGroup(groupId, tenantId);
      
      if (!group || !group.isActive) {
        throw new Error('Transfer group not found or inactive');
      }
      
      // Filter active numbers
      let activeNumbers = group.numbers.filter(n => n.isActive);
      
      // Check business hours if enabled
      activeNumbers = activeNumbers.filter(n => {
        if (!n.businessHours.enabled) return true;
        return this.isWithinBusinessHours(n.businessHours);
      });
      
      if (activeNumbers.length === 0) {
        throw new Error('No active transfer numbers available');
      }
      
      let selectedNumber;
      
      switch (group.type) {
        case 'roundrobin':
          // Get the number with least recent usage
          selectedNumber = activeNumbers.reduce((prev, curr) => {
            if (!prev.stats.lastCallAt) return prev;
            if (!curr.stats.lastCallAt) return curr;
            return new Date(prev.stats.lastCallAt) < new Date(curr.stats.lastCallAt) ? prev : curr;
          });
          break;
          
        case 'priority':
          // Get highest priority (lowest number)
          selectedNumber = activeNumbers.reduce((prev, curr) => 
            prev.priority < curr.priority ? prev : curr
          );
          break;
          
        case 'percentage':
          // Weighted random selection
          const totalWeight = activeNumbers.reduce((sum, n) => sum + n.weight, 0);
          let random = Math.random() * totalWeight;
          
          for (const number of activeNumbers) {
            random -= number.weight;
            if (random <= 0) {
              selectedNumber = number;
              break;
            }
          }
          break;
          
        case 'simultaneous':
          // Return all numbers for simultaneous ringing
          return activeNumbers.map(n => n.phoneNumber);
          
        default:
          selectedNumber = activeNumbers[0];
      }
      
      // Update stats
      if (selectedNumber) {
        await this.models.TransferNumber.update(
          {
            stats: {
              ...selectedNumber.stats,
              totalCalls: (selectedNumber.stats.totalCalls || 0) + 1,
              lastCallAt: new Date()
            }
          },
          {
            where: { id: selectedNumber.id }
          }
        );
        
        return selectedNumber.phoneNumber;
      }
      
      throw new Error('Could not select transfer number');
    } catch (error) {
      console.error('Error getting next transfer number:', error);
      throw error;
    }
  }

  /**
   * Configure email settings
   */
  async configureEmail(tenantId, data) {
    try {
      const config = await this.models.EmailConfig.upsert({
        tenantId,
        ...data
      });
      
      // Clear cached transporter
      this.emailTransporters.delete(tenantId);
      
      return config[0];
    } catch (error) {
      console.error('Error configuring email:', error);
      throw error;
    }
  }

  /**
   * Get email transporter
   */
  async getEmailTransporter(tenantId) {
    // Check cache
    if (this.emailTransporters.has(tenantId)) {
      return this.emailTransporters.get(tenantId);
    }
    
    // Get config
    const config = await this.models.EmailConfig.findOne({
      where: { tenantId, isActive: true }
    });
    
    if (!config) {
      throw new Error('Email configuration not found');
    }
    
    let transporter;
    
    switch (config.provider) {
      case 'smtp':
        transporter = nodemailer.createTransport({
          host: config.settings.host,
          port: config.settings.port,
          secure: config.settings.secure,
          auth: {
            user: config.settings.user,
            pass: config.settings.pass
          }
        });
        break;
        
      case 'sendgrid':
        sgMail.setApiKey(config.settings.apiKey);
        transporter = {
          sendMail: async (options) => {
            const msg = {
              to: options.to,
              from: options.from,
              subject: options.subject,
              text: options.text,
              html: options.html
            };
            return sgMail.send(msg);
          }
        };
        break;
        
      // Add other providers as needed
      
      default:
        throw new Error(`Unsupported email provider: ${config.provider}`);
    }
    
    // Cache transporter
    this.emailTransporters.set(tenantId, transporter);
    
    return transporter;
  }

  /**
   * Send email using template
   */
  async sendTemplatedEmail(tenantId, options) {
    const { to, templateId, variables = {}, attachments = [] } = options;
    
    try {
      // Get email config
      const emailConfig = await this.models.EmailConfig.findOne({
        where: { tenantId, isActive: true }
      });
      
      if (!emailConfig) {
        throw new Error('Email configuration not found');
      }
      
      // Check daily limit
      if (emailConfig.sentToday >= emailConfig.dailyLimit) {
        throw new Error('Daily email limit reached');
      }
      
      // Render template
      const rendered = await this.renderTemplate(templateId, tenantId, variables);
      
      if (rendered.template.type !== 'email') {
        throw new Error('Template is not an email template');
      }
      
      // Get transporter
      const transporter = await this.getEmailTransporter(tenantId);
      
      // Send email
      const mailOptions = {
        from: `${emailConfig.fromName} <${emailConfig.fromEmail}>`,
        to,
        subject: rendered.subject,
        text: rendered.content,
        html: rendered.htmlContent || rendered.content,
        attachments
      };
      
      if (emailConfig.replyToEmail) {
        mailOptions.replyTo = emailConfig.replyToEmail;
      }
      
      const result = await transporter.sendMail(mailOptions);
      
      // Update sent count
      await emailConfig.increment('sentToday');
      
      // Track usage
      await this.trackUsage(templateId, tenantId, 'email', to, variables, rendered.content);
      
      return {
        success: true,
        messageId: result.messageId || result.id
      };
    } catch (error) {
      console.error('Error sending templated email:', error);
      throw error;
    }
  }

  /**
   * Extract variables from content
   */
  extractVariables(content) {
    const regex = /{{\\s*([^}]+)\\s*}}/g;
    const variables = [];
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      variables.push(match[1].trim());
    }
    
    return variables;
  }

  /**
   * Get system variables
   */
  getSystemVariables() {
    const now = moment();
    
    return {
      currentDate: now.format('MM/DD/YYYY'),
      currentTime: now.format('h:mm A'),
      currentDateTime: now.format('MM/DD/YYYY h:mm A'),
      currentYear: now.format('YYYY'),
      currentMonth: now.format('MMMM'),
      currentDay: now.format('dddd')
    };
  }

  /**
   * Check if within business hours
   */
  isWithinBusinessHours(businessHours) {
    const now = moment().tz(businessHours.timezone || 'America/New_York');
    const dayOfWeek = now.format('dddd').toLowerCase();
    const currentTime = now.format('HH:mm');
    
    const schedule = businessHours.schedule[dayOfWeek];
    
    if (!schedule || !schedule.enabled) {
      return false;
    }
    
    return currentTime >= schedule.start && currentTime <= schedule.end;
  }

  /**
   * Track template usage
   */
  async trackUsage(templateId, tenantId, usedFor, entityId, variables, renderedContent) {
    try {
      await this.models.TemplateUsage.create({
        tenantId,
        templateId,
        usedFor,
        entityType: usedFor,
        entityId,
        variables,
        renderedContent
      });
      
      // Use proper Sequelize syntax for increment
      await this.models.Template.increment(
        'usageCount',
        {
          where: { id: templateId }
        }
      );
      
      await this.models.Template.update(
        { lastUsed: new Date() },
        {
          where: { id: templateId }
        }
      );
    } catch (error) {
      console.error('Error tracking template usage:', error);
      // Don't throw here to avoid breaking the main flow
    }
  }

  /**
   * Reset daily email limits
   */
  async resetDailyEmailLimits() {
    const today = moment().format('YYYY-MM-DD');
    
    await this.models.EmailConfig.update(
      {
        sentToday: 0,
        lastResetDate: today
      },
      {
        where: {
          lastResetDate: {
            [Op.ne]: today
          }
        }
      }
    );
  }

  /**
   * Get template categories
   */
  async getCategories(tenantId, type = null) {
    const query = {
      where: { tenantId, isActive: true }
    };
    
    if (type) {
      query.where.type = type;
    }
    
    return this.models.TemplateCategory.findAll(query);
  }

  /**
   * Create template category
   */
  async createCategory(tenantId, data) {
    return this.models.TemplateCategory.create({
      tenantId,
      ...data
    });
  }
}

module.exports = TemplateService;
