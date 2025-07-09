const express = require('express');
const { Readable } = require('stream');
const csv = require('csv-parser');
const DIDService = require('./did-service');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();
  const models = require('./lead-models')(sequelize);
  const didService = new DIDService({ ...models, sequelize });

  // ===== DID CRUD OPERATIONS =====

  // Create a new DID
  router.post('/dids', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const did = await didService.createDID(tenantId, req.body);
      
      res.status(201).json({
        message: 'DID created successfully',
        did
      });
    } catch (error) {
      console.error('Error creating DID:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get single DID with details and stats
  router.get('/dids/:id', authenticateToken, async (req, res) => {
    try {
      const didId = req.params.id;
      const tenantId = req.user.tenantId;
      
      const did = await didService.getDID(didId, tenantId);
      const stats = await didService.getDIDStats(didId);
      
      res.json({
        did: {
          ...did.toJSON(),
          stats
        }
      });
    } catch (error) {
      console.error('Error getting DID:', error);
      res.status(404).json({ error: error.message });
    }
  });

  // List DIDs with filtering and pagination
  router.get('/dids', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const result = await didService.listDIDs(tenantId, req.query);
      
      res.json(result);
    } catch (error) {
      console.error('Error listing DIDs:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Update DID
  router.put('/dids/:id', authenticateToken, async (req, res) => {
    try {
      const didId = req.params.id;
      const tenantId = req.user.tenantId;
      
      const did = await didService.updateDID(didId, tenantId, req.body);
      
      res.json({
        message: 'DID updated successfully',
        did
      });
    } catch (error) {
      console.error('Error updating DID:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Delete DID (soft delete by default)
  router.delete('/dids/:id', authenticateToken, async (req, res) => {
    try {
      const didId = req.params.id;
      const tenantId = req.user.tenantId;
      const force = req.query.force === 'true';
      
      await didService.deleteDID(didId, tenantId, force);
      
      res.json({
        message: force ? 'DID permanently deleted' : 'DID deactivated successfully',
        didId
      });
    } catch (error) {
      console.error('Error deleting DID:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== DID DISTRIBUTION OPERATIONS =====

  // Get next available DID for assignment
  router.post('/dids/next-available', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const { 
        distributionMode = 'even', 
        areaCode, 
        state, 
        excludeIds = [],
        leadData 
      } = req.body;
      
      const did = await didService.getNextAvailableDID(tenantId, distributionMode, {
        areaCode,
        state,
        excludeIds,
        leadData
      });
      
      res.json({
        message: 'Next available DID selected',
        did,
        distributionMode
      });
    } catch (error) {
      console.error('Error getting next available DID:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Assign DID to a specific call
  router.post('/dids/:id/assign-call', authenticateToken, async (req, res) => {
    try {
      const didId = req.params.id;
      const tenantId = req.user.tenantId;
      const { callLogId } = req.body;
      
      if (!callLogId) {
        return res.status(400).json({ error: 'callLogId is required' });
      }
      
      const result = await didService.assignDIDToCall(callLogId, didId, tenantId);
      
      res.json({
        message: 'DID assigned to call successfully',
        assignment: result
      });
    } catch (error) {
      console.error('Error assigning DID to call:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== DID ANALYTICS AND REPORTING =====

  // Get DID usage statistics
  router.get('/dids/:id/stats', authenticateToken, async (req, res) => {
    try {
      const didId = req.params.id;
      const tenantId = req.user.tenantId;
      
      // Verify DID belongs to tenant
      await didService.getDID(didId, tenantId);
      
      const stats = await didService.getDIDStats(didId);
      
      res.json({
        didId,
        stats,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting DID stats:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get DID performance report
  router.get('/dids/reports/performance', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const { startDate, endDate, limit } = req.query;
      
      const report = await didService.getDIDPerformanceReport(tenantId, {
        startDate,
        endDate,
        limit
      });
      
      res.json(report);
    } catch (error) {
      console.error('Error generating DID performance report:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get DID distribution summary
  router.get('/dids/reports/distribution', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      
      const summary = await models.DID.findAll({
        where: { tenantId },
        attributes: [
          'areaCode',
          'state',
          'isActive',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM', sequelize.col('usageCount')), 'totalUsage'],
          [sequelize.fn('AVG', sequelize.col('usageCount')), 'avgUsage']
        ],
        group: ['areaCode', 'state', 'isActive'],
        order: [['areaCode', 'ASC']]
      });
      
      res.json({
        distribution: summary,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error generating distribution report:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== BULK OPERATIONS =====

  // Bulk create DIDs from CSV
  router.post('/dids/bulk-import', authenticateToken, async (req, res) => {
    try {
      const { fileContent } = req.body;
      const tenantId = req.user.tenantId;
      
      if (!fileContent) {
        return res.status(400).json({ error: 'fileContent is required' });
      }
      
      // Parse CSV content
      const results = [];
      const stream = Readable.from(fileContent);
      
      await new Promise((resolve, reject) => {
        stream
          .pipe(csv())
          .on('data', (data) => results.push(data))
          .on('end', resolve)
          .on('error', reject);
      });
      
      // Transform CSV data to DID format
      const didsData = results.map(row => ({
        phoneNumber: row.phoneNumber || row.phone_number || row.phone || row.number,
        description: row.description || row.desc,
        areaCode: row.areaCode || row.area_code,
        state: row.state,
        isActive: row.isActive !== 'false' && row.is_active !== 'false'
      })).filter(did => did.phoneNumber); // Filter out rows without phone numbers
      
      if (didsData.length === 0) {
        return res.status(400).json({ error: 'No valid DID data found in CSV' });
      }
      
      const importResult = await didService.bulkImportDIDs(tenantId, didsData);
      
      res.status(201).json({
        message: `Bulk import completed: ${importResult.summary.successful} successful, ${importResult.summary.failed} failed, ${importResult.summary.duplicates} duplicates`,
        result: importResult
      });
    } catch (error) {
      console.error('Error bulk importing DIDs:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Bulk activate/deactivate DIDs
  router.post('/dids/bulk-status', authenticateToken, async (req, res) => {
    try {
      const { didIds, isActive } = req.body;
      const tenantId = req.user.tenantId;
      
      if (!Array.isArray(didIds) || didIds.length === 0) {
        return res.status(400).json({ error: 'didIds array is required' });
      }
      
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'isActive boolean is required' });
      }
      
      const [updatedCount] = await models.DID.update(
        { isActive },
        { 
          where: { 
            id: { [sequelize.Sequelize.Op.in]: didIds },
            tenantId 
          } 
        }
      );
      
      res.json({
        message: `${updatedCount} DIDs ${isActive ? 'activated' : 'deactivated'}`,
        updatedCount,
        isActive
      });
    } catch (error) {
      console.error('Error bulk updating DID status:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== INTEGRATION ENDPOINTS =====

  // Test DID distribution algorithm
  router.post('/dids/test-distribution', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const { 
        distributionMode = 'even', 
        iterations = 10,
        testLeadData 
      } = req.body;
      
      const testResults = [];
      
      for (let i = 0; i < iterations; i++) {
        try {
          const did = await didService.getNextAvailableDID(tenantId, distributionMode, {
            leadData: testLeadData
          });
          
          testResults.push({
            iteration: i + 1,
            selectedDID: {
              id: did.id,
              phoneNumber: did.phoneNumber,
              usageCount: did.usageCount,
              areaCode: did.areaCode
            }
          });
        } catch (error) {
          testResults.push({
            iteration: i + 1,
            error: error.message
          });
        }
      }
      
      res.json({
        distributionMode,
        iterations,
        testResults,
        summary: {
          successful: testResults.filter(r => !r.error).length,
          failed: testResults.filter(r => r.error).length
        }
      });
    } catch (error) {
      console.error('Error testing DID distribution:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get DID availability for a specific criteria
  router.post('/dids/check-availability', authenticateToken, async (req, res) => {
    try {
      const tenantId = req.user.tenantId;
      const { areaCode, state, requiredCount = 1 } = req.body;
      
      const where = {
        tenantId,
        isActive: true
      };
      
      if (areaCode) where.areaCode = areaCode;
      if (state) where.state = state;
      
      const availableDIDs = await models.DID.findAll({
        where,
        attributes: ['id', 'phoneNumber', 'areaCode', 'state', 'usageCount'],
        order: [['usageCount', 'ASC']]
      });
      
      res.json({
        criteria: { areaCode, state },
        available: availableDIDs.length,
        required: requiredCount,
        sufficient: availableDIDs.length >= requiredCount,
        dids: availableDIDs.slice(0, Math.min(requiredCount, availableDIDs.length))
      });
    } catch (error) {
      console.error('Error checking DID availability:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Register all routes with the app
  app.use('/api', router);
  
  console.log('✅ DID routes initialized successfully');
  console.log('📋 Available DID endpoints:');
  console.log('   📞 CRUD: GET/POST/PUT/DELETE /api/dids');
  console.log('   🎯 Distribution: POST /api/dids/next-available');
  console.log('   📊 Analytics: GET /api/dids/:id/stats');
  console.log('   📈 Reports: GET /api/dids/reports/performance');
  console.log('   📤 Bulk Import: POST /api/dids/bulk-import');
  console.log('   🔧 Testing: POST /api/dids/test-distribution');

  return {
    router,
    service: didService
  };
