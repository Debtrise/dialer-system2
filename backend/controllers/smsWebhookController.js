const express = require('express');
const router = express.Router();
const smsService = require('../services/smsService');

router.post('/status-callback', async (req, res) => {
  try {
    const { MessageSid, MessageStatus } = req.body;
    
    if (MessageSid && MessageStatus) {
      await smsService.updateSmsStatus(MessageSid, MessageStatus);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('SMS webhook error:', error);
    res.status(500).send('Error processing webhook');
  }
});

module.exports = router;

// 6. Create SMS API routes for dashboard
// backend/routes/smsRoutes.js

const express = require('express');
const router = express.Router();
const smsService = require('../services/smsService');
const { Lead } = require('../models');
const authMiddleware = require('../middlewares/authMiddleware'); // Assuming you have this

// Send SMS to a specific lead
router.post('/send/:leadId', authMiddleware, async (req, res) => {
  try {
    const { leadId } = req.params;
    const { template, customData } = req.body;
    const tenantId = req.user.tenantId; // Assuming auth middleware sets this
    
    const lead = await Lead.findOne({
      where: { id: leadId, tenantId }
    });
    
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    
    const result = await smsService.sendSms(lead, template, customData);
    res.json(result);
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get SMS history for a lead
router.get('/history/:leadId', authMiddleware, async (req, res) => {
  try {
    const { leadId } = req.params;
    const tenantId = req.user.tenantId;
    
    const lead = await Lead.findOne({
      where: { id: leadId, tenantId },
      attributes: ['id', 'name', 'phone', 'smsAttempts', 'lastSmsAttempt', 'smsStatus', 'smsHistory']
    });
    
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    
    res.json({ 
      success: true, 
      data: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        smsAttempts: lead.smsAttempts,
        lastSmsAttempt: lead.lastSmsAttempt,
        smsStatus: lead.smsStatus,
        smsHistory: lead.smsHistory
      }
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update SMS template for a tenant
router.post('/templates', authMiddleware, async (req, res) => {
  try {
    // In a real implementation, you'd store these in the database
    // This is just a placeholder example
    res.json({ success: true, message: 'Templates updated' });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
