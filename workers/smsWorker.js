const smsService = require('../backend/services/smsService');
const { Lead } = require('.../models');
const smsConfig = require('../config/sms');

class SmsWorker {
  constructor() {
    this.isRunning = false;
    this.currentJobs = 0;
    this.maxConcurrentJobs = smsConfig.smsRateLimit.concurrentJobs;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('SMS Worker started');
    this.processQueue();
  }

  async stop() {
    this.isRunning = false;
    console.log('SMS Worker stopped');
  }

  async processQueue() {
    while (this.isRunning) {
      try {
        // Check if we can send more SMS
        const canSendMore = await smsService.canSendMoreSms();
        if (!canSendMore || this.currentJobs >= this.maxConcurrentJobs) {
          // Wait and check again
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        // Get tenants with pending SMS leads
        const tenants = await Lead.findAll({
          attributes: ['tenantId'],
          where: { smsStatus: 'pending' },
          group: ['tenantId']
        });

        if (tenants.length === 0) {
          // No pending leads, wait and check again
          await new Promise(resolve => setTimeout(resolve, 10000));
          continue;
        }

        // Process leads for each tenant
        for (const tenant of tenants) {
          if (!this.isRunning || this.currentJobs >= this.maxConcurrentJobs) break;
          
          // Get batch of leads for this tenant
          const leads = await smsService.getLeadsForSmsBatch(
            tenant.tenantId, 
            this.maxConcurrentJobs - this.currentJobs
          );
          
          // Process each lead
          for (const lead of leads) {
            if (!this.isRunning || this.currentJobs >= this.maxConcurrentJobs) break;
            
            // Increment job counter
            this.currentJobs++;
            
            // Send SMS asynchronously
            this.sendSmsToLead(lead).finally(() => {
              this.currentJobs--;
            });
          }
        }

        // Wait before checking again to avoid hammering the database
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('Error in SMS worker:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  async sendSmsToLead(lead) {
    try {
      // Get tenant-specific data
      // This is just an example - you'd need to implement how to get tenant data
      const tenantData = await this.getTenantData(lead.tenantId);
      
      // Send SMS with tenant data
      await smsService.sendSms(lead, 'default', {
        company: tenantData.companyName,
        message: tenantData.defaultMessage
      });
    } catch (error) {
      console.error(`Error sending SMS to lead ${lead.id}:`, error);
    }
  }

  // Helper method to get tenant-specific data
  // You'll need to implement this according to your tenant data storage
  async getTenantData(tenantId) {
    // Example implementation - replace with your actual data source
    return {
      companyName: 'Your Company',
      defaultMessage: 'Thanks for your interest in our services. Would you like to schedule a call?'
    };
  }
}

module.exports = new SmsWorker();
