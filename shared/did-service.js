const { Op } = require('sequelize');

class DIDService {
  constructor(models) {
    this.models = models;
  }

  /**
   * Create a new DID number
   */
  async createDID(tenantId, didData) {
    try {
      // Validate phone number format
      const phoneNumber = this.normalizePhoneNumber(didData.phoneNumber);
      
      // Check if DID already exists for this tenant
      const existing = await this.models.DID.findOne({
        where: { tenantId, phoneNumber }
      });
      
      if (existing) {
        throw new Error('DID already exists for this tenant');
      }

      // Extract area code from phone number if not provided
      const areaCode = didData.areaCode || this.extractAreaCode(phoneNumber);
      
      const did = await this.models.DID.create({
        tenantId,
        phoneNumber,
        description: didData.description || `DID ${phoneNumber}`,
        areaCode,
        state: didData.state,
        isActive: didData.isActive !== false, // Default to true
        usageCount: 0,
        lastUsed: null
      });

      console.log(`✅ Created DID ${phoneNumber} for tenant ${tenantId}`);
      return did;
    } catch (error) {
      console.error('Error creating DID:', error);
      throw error;
    }
  }

  /**
   * Get DID by ID with tenant validation
   */
  async getDID(didId, tenantId) {
    const did = await this.models.DID.findOne({
      where: { id: didId, tenantId },
      include: [
        {
          model: this.models.CallLog,
          as: 'callLogs',
          limit: 10,
          order: [['startTime', 'DESC']],
          required: false
        }
      ]
    });

    if (!did) {
      throw new Error('DID not found');
    }

    return did;
  }

  /**
   * List DIDs for a tenant with filtering and pagination
   */
  async listDIDs(tenantId, options = {}) {
    const { 
      page = 1, 
      limit = 50, 
      isActive, 
      areaCode, 
      state,
      search 
    } = options;

    const where = { tenantId };

    // Apply filters
    if (isActive !== undefined) {
      where.isActive = isActive === 'true' || isActive === true;
    }

    if (areaCode) {
      where.areaCode = areaCode;
    }

    if (state) {
      where.state = { [Op.iLike]: `%${state}%` };
    }

    if (search) {
      where[Op.or] = [
        { phoneNumber: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const dids = await this.models.DID.findAll({
      where,
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: this.models.CallLog,
          as: 'callLogs',
          attributes: ['id'],
          required: false
        }
      ]
    });

    const totalCount = await this.models.DID.count({ where });

    // Add call statistics to each DID
    const didsWithStats = await Promise.all(dids.map(async (did) => {
      const stats = await this.getDIDStats(did.id);
      return {
        ...did.toJSON(),
        stats
      };
    }));

    return {
      dids: didsWithStats,
      totalCount,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit))
    };
  }

  /**
   * Update DID information
   */
  async updateDID(didId, tenantId, updateData) {
    const did = await this.models.DID.findOne({
      where: { id: didId, tenantId }
    });

    if (!did) {
      throw new Error('DID not found');
    }

    // Normalize phone number if being updated
    if (updateData.phoneNumber) {
      updateData.phoneNumber = this.normalizePhoneNumber(updateData.phoneNumber);
      
      // Check for duplicates
      const existing = await this.models.DID.findOne({
        where: { 
          tenantId, 
          phoneNumber: updateData.phoneNumber,
          id: { [Op.ne]: didId }
        }
      });

      if (existing) {
        throw new Error('DID with this phone number already exists');
      }
    }

    // Extract area code if phone number changed
    if (updateData.phoneNumber && !updateData.areaCode) {
      updateData.areaCode = this.extractAreaCode(updateData.phoneNumber);
    }

    await did.update(updateData);
    
    console.log(`✅ Updated DID ${didId} for tenant ${tenantId}`);
    return did;
  }

  /**
   * Delete DID (soft delete by deactivating)
   */
  async deleteDID(didId, tenantId, force = false) {
    const did = await this.models.DID.findOne({
      where: { id: didId, tenantId }
    });

    if (!did) {
      throw new Error('DID not found');
    }

    // Check for active calls using this DID
    const activeCalls = await this.models.CallLog.count({
      where: {
        didId: didId,
        status: { [Op.in]: ['initiated', 'ringing', 'answered'] },
        endTime: null
      }
    });

    if (activeCalls > 0) {
      throw new Error('Cannot delete DID with active calls');
    }

    if (force) {
      // Hard delete
      await did.destroy();
      console.log(`🗑️ Hard deleted DID ${didId} for tenant ${tenantId}`);
    } else {
      // Soft delete by deactivating
      await did.update({ isActive: false });
      console.log(`⏸️ Deactivated DID ${didId} for tenant ${tenantId}`);
    }

    return true;
  }

  /**
   * Get next available DID using distribution algorithm
   */
  async getNextAvailableDID(tenantId, distributionMode = 'even', options = {}) {
    const { 
      areaCode, 
      state, 
      excludeIds = [],
      leadData = null 
    } = options;

    // Build query for available DIDs
    const where = {
      tenantId,
      isActive: true
    };

    if (areaCode) {
      where.areaCode = areaCode;
    }

    if (state) {
      where.state = state;
    }

    if (excludeIds.length > 0) {
      where.id = { [Op.notIn]: excludeIds };
    }

    const availableDIDs = await this.models.DID.findAll({
      where,
      order: this.getDistributionOrder(distributionMode)
    });

    if (availableDIDs.length === 0) {
      throw new Error('No available DIDs found for the specified criteria');
    }

    // Apply distribution algorithm
    let selectedDID;
    switch (distributionMode) {
      case 'even':
        selectedDID = this.selectDIDEvenDistribution(availableDIDs);
        break;
      case 'round_robin':
        selectedDID = this.selectDIDRoundRobin(availableDIDs);
        break;
      case 'least_used':
        selectedDID = this.selectDIDLeastUsed(availableDIDs);
        break;
      case 'random':
        selectedDID = this.selectDIDRandom(availableDIDs);
        break;
      case 'geographic':
        selectedDID = this.selectDIDGeographic(availableDIDs, leadData);
        break;
      default:
        selectedDID = availableDIDs[0]; // Default to first available
    }

    return selectedDID;
  }

  /**
   * Assign DID to a call and update usage tracking
   */
  async assignDIDToCall(callLogId, didId, tenantId) {
    try {
      // Verify call exists and belongs to tenant
      const callLog = await this.models.CallLog.findOne({
        where: { id: callLogId, tenantId }
      });

      if (!callLog) {
        throw new Error('Call log not found');
      }

      // Verify DID exists and belongs to tenant
      const did = await this.models.DID.findOne({
        where: { id: didId, tenantId, isActive: true }
      });

      if (!did) {
        throw new Error('DID not found or inactive');
      }

      // Update call log with DID assignment
      await callLog.update({ didId });

      // Update DID usage statistics
      await did.update({
        usageCount: did.usageCount + 1,
        lastUsed: new Date()
      });

      console.log(`📞 Assigned DID ${did.phoneNumber} to call ${callLogId}`);
      return { callLog, did };
    } catch (error) {
      console.error('Error assigning DID to call:', error);
      throw error;
    }
  }

  /**
   * Get DID usage statistics
   */
  async getDIDStats(didId) {
    const stats = await this.models.CallLog.findAll({
      where: { didId },
      attributes: [
        [this.models.sequelize.fn('COUNT', this.models.sequelize.col('id')), 'totalCalls'],
        [this.models.sequelize.fn('COUNT', this.models.sequelize.literal("CASE WHEN status = 'completed' THEN 1 END")), 'completedCalls'],
        [this.models.sequelize.fn('COUNT', this.models.sequelize.literal("CASE WHEN status = 'transferred' THEN 1 END")), 'transferredCalls'],
        [this.models.sequelize.fn('AVG', this.models.sequelize.col('duration')), 'avgDuration'],
        [this.models.sequelize.fn('SUM', this.models.sequelize.col('duration')), 'totalDuration']
      ],
      raw: true
    });

    return {
      totalCalls: parseInt(stats[0]?.totalCalls) || 0,
      completedCalls: parseInt(stats[0]?.completedCalls) || 0,
      transferredCalls: parseInt(stats[0]?.transferredCalls) || 0,
      avgDuration: Math.round(parseFloat(stats[0]?.avgDuration)) || 0,
      totalDuration: parseInt(stats[0]?.totalDuration) || 0,
      conversionRate: stats[0]?.totalCalls > 0 ? 
        ((parseInt(stats[0]?.completedCalls) / parseInt(stats[0]?.totalCalls)) * 100).toFixed(2) : 0
    };
  }

  /**
   * Get DID performance report for tenant
   */
  async getDIDPerformanceReport(tenantId, options = {}) {
    const { startDate, endDate, limit = 10 } = options;

    const whereClause = { tenantId };
    if (startDate && endDate) {
      whereClause.createdAt = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    const dids = await this.models.DID.findAll({
      where: whereClause,
      include: [
        {
          model: this.models.CallLog,
          as: 'callLogs',
          where: startDate && endDate ? {
            startTime: {
              [Op.between]: [new Date(startDate), new Date(endDate)]
            }
          } : {},
          required: false
        }
      ],
      limit: parseInt(limit),
      order: [['usageCount', 'DESC']]
    });

    const performanceData = await Promise.all(dids.map(async (did) => {
      const stats = await this.getDIDStats(did.id);
      return {
        ...did.toJSON(),
        performance: stats
      };
    }));

    return {
      reportDate: new Date().toISOString(),
      dateRange: { startDate, endDate },
      dids: performanceData,
      summary: {
        totalDIDs: performanceData.length,
        activeDIDs: performanceData.filter(d => d.isActive).length,
        totalCalls: performanceData.reduce((sum, d) => sum + d.performance.totalCalls, 0),
        avgConversionRate: performanceData.length > 0 ? 
          (performanceData.reduce((sum, d) => sum + parseFloat(d.performance.conversionRate), 0) / performanceData.length).toFixed(2) : 0
      }
    };
  }

  // ===== DISTRIBUTION ALGORITHMS =====

  /**
   * Select DID using even distribution (least used)
   */
  selectDIDEvenDistribution(dids) {
    return dids.reduce((min, current) => 
      current.usageCount < min.usageCount ? current : min
    );
  }

  /**
   * Select DID using round-robin distribution
   */
  selectDIDRoundRobin(dids) {
    // Simple round-robin based on last used timestamp
    return dids.sort((a, b) => {
      if (!a.lastUsed) return -1;
      if (!b.lastUsed) return 1;
      return new Date(a.lastUsed) - new Date(b.lastUsed);
    })[0];
  }

  /**
   * Select DID with least usage
   */
  selectDIDLeastUsed(dids) {
    return dids.sort((a, b) => a.usageCount - b.usageCount)[0];
  }

  /**
   * Select random DID
   */
  selectDIDRandom(dids) {
    return dids[Math.floor(Math.random() * dids.length)];
  }

  /**
   * Select DID based on geographic matching
   */
  selectDIDGeographic(dids, leadData) {
    if (!leadData || !leadData.phone) {
      return this.selectDIDEvenDistribution(dids);
    }

    const leadAreaCode = this.extractAreaCode(leadData.phone);
    
    // First try to match area code
    const matchingAreaCode = dids.filter(did => did.areaCode === leadAreaCode);
    if (matchingAreaCode.length > 0) {
      return this.selectDIDEvenDistribution(matchingAreaCode);
    }

    // Fallback to state matching if available
    if (leadData.state) {
      const matchingState = dids.filter(did => 
        did.state && did.state.toLowerCase() === leadData.state.toLowerCase()
      );
      if (matchingState.length > 0) {
        return this.selectDIDEvenDistribution(matchingState);
      }
    }

    // Fallback to even distribution
    return this.selectDIDEvenDistribution(dids);
  }

  /**
   * Get distribution order based on mode
   */
  getDistributionOrder(mode) {
    switch (mode) {
      case 'even':
      case 'least_used':
        return [['usageCount', 'ASC']];
      case 'round_robin':
        return [['lastUsed', 'ASC NULLS FIRST']];
      case 'random':
        return [this.models.sequelize.fn('RANDOM')];
      default:
        return [['createdAt', 'ASC']];
    }
  }

  // ===== UTILITY METHODS =====

  /**
   * Normalize phone number to consistent format
   */
  normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    
    // Remove all non-digit characters
    const digits = phoneNumber.replace(/\D/g, '');
    
    // Handle different formats
    if (digits.length === 10) {
      return `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    } else if (digits.startsWith('+')) {
      return phoneNumber;
    }
    
    return `+${digits}`;
  }

  /**
   * Extract area code from phone number
   */
  extractAreaCode(phoneNumber) {
    if (!phoneNumber) return null;
    
    const normalized = this.normalizePhoneNumber(phoneNumber);
    const digits = normalized.replace(/\D/g, '');
    
    // For US/Canada numbers (11 digits starting with 1)
    if (digits.length === 11 && digits.startsWith('1')) {
      return digits.substring(1, 4);
    }
    
    // For 10-digit numbers
    if (digits.length === 10) {
      return digits.substring(0, 3);
    }
    
    return null;
  }

  /**
   * Bulk import DIDs from CSV data
   */
  async bulkImportDIDs(tenantId, didsData) {
    const results = {
      successful: [],
      failed: [],
      duplicates: []
    };

    for (const didData of didsData) {
      try {
        const did = await this.createDID(tenantId, didData);
        results.successful.push(did);
      } catch (error) {
        if (error.message.includes('already exists')) {
          results.duplicates.push({ phoneNumber: didData.phoneNumber, error: error.message });
        } else {
          results.failed.push({ phoneNumber: didData.phoneNumber, error: error.message });
        }
      }
    }

    return {
      ...results,
      summary: {
        total: didsData.length,
        successful: results.successful.length,
        failed: results.failed.length,
        duplicates: results.duplicates.length
      }
    };
  }
}

module.exports = DIDService;