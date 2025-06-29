const express = require('express');
const { Readable } = require('stream');
const csv = require('csv-parser');
const LeadService = require('./lead-service');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();
  const models = require('./lead-models')(sequelize);
  const service = new LeadService({ ...models, sequelize });

  // Update dialer assignment for a single lead
  router.put('/leads/:id/dialer-assignment', authenticateToken, async (req, res) => {
    try {
      const lead = await service.updateDialerAssignment(req.params.id, req.user.tenantId, req.body.dialerAssignment);
      res.json({ message: 'Dialer assignment updated', leadId: lead.id, dialerAssignment: lead.dialerAssignment });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Bulk update dialer assignments
  router.post('/leads/bulk-dialer-assignment', authenticateToken, async (req, res) => {
    try {
      const count = await service.bulkUpdateDialerAssignment(req.body.leadIds, req.user.tenantId, req.body.dialerAssignment);
      res.json({ message: `Updated ${count} leads`, dialerAssignment: req.body.dialerAssignment });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get dialer assignment statistics
  router.get('/leads/dialer-stats', authenticateToken, async (req, res) => {
    try {
      const stats = await service.getDialerStats(req.user.tenantId);
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Upload leads from CSV content
  router.post('/leads/upload', authenticateToken, async (req, res) => {
    try {
      const { fileContent } = req.body;
      const tenantId = req.user.tenantId;
      const results = [];
      const stream = Readable.from(fileContent);
      await new Promise((resolve, reject) => {
        stream.pipe(csv()).on('data', d => results.push(d)).on('end', resolve).on('error', reject);
      });
      const leads = results.map(row => ({
        tenantId,
        phone: row.phone || row.Phone || row.PhoneNumber || row.phone_number || '',
        name: row.name || row.Name || row.FullName || row.full_name || '',
        email: row.email || row.Email || '',
        brand: row.brand || row.Brand,
        source: row.source || row.Source,
        additionalData: Object.fromEntries(Object.entries(row).filter(([k]) => !['phone','Phone','PhoneNumber','phone_number','name','Name','FullName','full_name','email','Email','brand','Brand','source','Source'].includes(k)))
      }));
      const valid = leads.filter(l => l.phone);
      if (valid.length === 0) return res.status(400).json({ error: 'No valid leads found' });
      await service.importLeads(tenantId, valid);
      res.status(201).json({ message: `${valid.length} leads imported successfully` });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get single lead with call history
  router.get('/leads/:id', authenticateToken, async (req, res) => {
    try {
      const data = await service.getLead(req.params.id, req.user.tenantId);
      if (!data) return res.status(404).json({ error: 'Lead not found' });
      res.json(data);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // List leads
  router.get('/leads', authenticateToken, async (req, res) => {
    try {
      const data = await service.listLeads(req.user.tenantId, req.query);
      res.json(data);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete single lead
  router.delete('/leads/:id', authenticateToken, async (req, res) => {
    try {
      await service.deleteLead(req.params.id, req.user.tenantId);
      res.json({ message: 'Lead deleted successfully', leadId: req.params.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Bulk delete
  router.post('/leads/delete', authenticateToken, async (req, res) => {
    try {
      const count = await service.bulkDelete(req.body.ids, req.user.tenantId);
      res.json({ message: `${count} leads deleted successfully`, count });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.use('/api', router);
  return router;
};
