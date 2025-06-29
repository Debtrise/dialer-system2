const twilio = require('twilio');
const smsConfig = require('../config/sms');
const { Lead } = require('../models');
const { Op } = require('sequelize');

class SmsService {
  constructor() {
    this.client = twilio(smsConfig.twilioAccountSid, smsConfig.twilioAuthToken);
    this.rateTracker = {
      hourlyCount: 0,
      lastReset: new Date()
    };
  }

  resetRateTrackerIfNeeded() {
    const now = new Date();
    if (now - this.rateTracker.lastReset >= 60 * 60 * 1000) { // 1 hour
      this.rateTracker.hourlyCount = 0;
      this.rateTracker.lastReset = now;
    }
  }

  async canSendMoreSms() {
    this.resetRateTrackerIfNeeded();
    return this.rateTracker.hourlyCount < smsConfig.smsRateLimit.perHour;
  }

  async sendSms(lead, templateName = 'default', customData = {}) {
    if (!await this.canSendMoreSms()) {
      console.log('SMS rate limit reached, deferring send');
      return { success: false, error: 'Rate limit reached' };
    }

    try {
      const template = smsConfig.templates[templateName] || smsConfig.templates.default;
      
      // Apply template variables
      let messageText = template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        if (varName === 'name') return lead.name;
        if (varName === 'company') return customData.company || 'Our Company';
        return customData[varName] || match;
      });

      // Send SMS via Twilio
      const message = await this.client.messages.create({
        body: messageText,
        from: smsConfig.twilioPhoneNumber,
        to: lead.phone
      });

      // Update rate tracker
      this.rateTracker.hourlyCount++;

      // Update lead record
      await Lead.update({
        smsAttempts: lead.smsAttempts + 1,
        lastSmsAttempt: new Date(),
        smsStatus: 'sent',
        smsHistory: [...(lead.smsHistory || []), {
          messageId: message.sid,
          template: templateName,
          timestamp: new Date(),
          status: message.status,
          content: messageText
        }]
      }, { 
        where: { id: lead.id } 
      });

      return {
        success: true,
        messageId: message.sid,
        status: message.status
      };
    } catch (error) {
      console.error('SMS sending error:', error);
      
      // Update lead record with failed status
      await Lead.update({
        smsAttempts: lead.smsAttempts + 1,
        lastSmsAttempt: new Date(),
        smsStatus: 'failed',
        smsHistory: [...(lead.smsHistory || []), {
          timestamp: new Date(),
          template: templateName,
          status: 'failed',
          error: error.message
        }]
      }, { 
        where: { id: lead.id } 
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async updateSmsStatus(messageId, status) {
    try {
      // Find lead with this messageId in smsHistory
      const lead = await Lead.findOne({
        where: {
          smsHistory: {
            [Op.contains]: [{ messageId }]
          }
        }
      });

      if (!lead) return { success: false, error: 'Lead not found' };

      // Update the specific message status in history
      const updatedHistory = lead.smsHistory.map(msg => {
        if (msg.messageId === messageId) {
          return { ...msg, status };
        }
        return msg;
      });

      // Update lead record
      await Lead.update({
        smsStatus: status === 'delivered' ? 'delivered' : 
                   status === 'failed' ? 'failed' : lead.smsStatus,
        smsHistory: updatedHistory
      }, { 
        where: { id: lead.id } 
      });

      return { success: true };
    } catch (error) {
      console.error('SMS status update error:', error);
      return { success: false, error: error.message };
    }
  }

  async getLeadsForSmsBatch(tenantId, batchSize) {
    // Find leads that are pending SMS or haven't been contacted recently
    const leads = await Lead.findAll({
      where: {
        tenantId,
        [Op.or]: [
          { smsStatus: 'pending' },
          { 
            smsStatus: { [Op.ne]: 'delivered' }, 
            lastSmsAttempt: { [Op.lt]: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Older than 24h
          }
        ]
      },
      order: [['lastSmsAttempt', 'ASC NULLS FIRST']],
      limit: batchSize
    });

    return leads;
  }
}

module.exports = new SmsService();
