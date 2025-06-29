// Create a new file: worker/sms-service.js
const twilio = require('twilio');

class SmsService {
  /**
   * @param {Object} tenant - The tenant object with SMS configuration
   * @param {Object} models - Object containing Sequelize models { SmsLog, Lead }
   */
  constructor(tenant, models = {}) {
    this.tenant = tenant;
    this.models = models;
    this.twilioClient = null;

    if (
      tenant.smsConfig &&
      tenant.smsConfig.twilioAccountSid &&
      tenant.smsConfig.twilioAuthToken
    ) {
      this.twilioClient = twilio(
        tenant.smsConfig.twilioAccountSid,
        tenant.smsConfig.twilioAuthToken
      );
    }
  }
  
  async sendSms(lead, messageText) {
    if (!this.twilioClient) {
      throw new Error('Twilio client not configured');
    }
    
    try {
      // Create SMS log entry
      const smsLog = await this.models.SmsLog.create({
        tenantId: this.tenant.id.toString(),
        leadId: lead.id,
        from: this.tenant.smsConfig.twilioPhoneNumber,
        to: lead.phone,
        message: messageText,
        status: 'queued'
      });
      
      // Send SMS via Twilio
      const message = await this.twilioClient.messages.create({
        body: messageText,
        from: this.tenant.smsConfig.twilioPhoneNumber,
        to: lead.phone,
        statusCallback: `${process.env.BASE_URL}/api/sms/status-callback`
      });
      
      // Update SMS log with SID
      await smsLog.update({
        sid: message.sid,
        status: 'sent'
      });
      
      // Update lead
      await lead.update({
        smsAttempts: lead.smsAttempts + 1,
        lastSmsAttempt: new Date(),
        smsStatus: 'sent',
        smsHistory: [
          ...(lead.smsHistory || []),
          {
            date: new Date(),
            message: messageText,
            status: 'sent',
            sid: message.sid
          }
        ]
      });
      
      return {
        success: true,
        sid: message.sid,
        smsLogId: smsLog.id
      };
    } catch (error) {
      console.error(`Error sending SMS: ${error.message}`);
      
      // Update lead with failure
      if (lead) {
        await lead.update({
          smsStatus: 'failed',
          smsHistory: [
            ...(lead.smsHistory || []),
            {
              date: new Date(),
              message: messageText,
              status: 'failed',
              error: error.message
            }
          ]
        });
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Replace placeholders in template
  processTemplate(template, lead) {
    let message = template;
    
    // Replace basic fields
    message = message.replace(/{name}/g, lead.name || '');
    message = message.replace(/{phone}/g, lead.phone || '');
    message = message.replace(/{email}/g, lead.email || '');
    
    // Replace additional data fields
    if (lead.additionalData) {
      Object.entries(lead.additionalData).forEach(([key, value]) => {
        message = message.replace(new RegExp(`{${key}}`, 'g'), value || '');
      });
    }
    
    return message;
  }
}

module.exports = SmsService;
