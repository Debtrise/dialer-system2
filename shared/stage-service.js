// shared/stage-service.js
// Enhanced stage service with full CRUD and analytics

const { Op } = require('sequelize');

class StageService {
  constructor(models) {
    this.models = models;
  }

  /**
   * Create a new stage
   */
  async createStage(tenantId, data) {
    try {
      // Get the highest order number for this tenant
      const maxOrder = await this.models.Stage.max('order', {
        where: { tenantId }
      });
      
      const stageData = {
        ...data,
        tenantId,
        order: (maxOrder || 0) + 1
      };
      
      const stage = await this.models.Stage.create(stageData);
      console.log(`✅ Created stage "${stage.title}" for tenant ${tenantId}`);
      
      return stage;
    } catch (error) {
      console.error('Error creating stage:', error);
      throw error;
    }
  }

  /**
   * Get a single stage
   */
  async getStage(stageId, tenantId) {
    try {
      const stage = await this.models.Stage.findOne({
        where: {
          id: stageId,
          tenantId
        }
      });
      
      if (!stage) {
        throw new Error('Stage not found');
      }
      
      return stage;
    } catch (error) {
      console.error('Error getting stage:', error);
      throw error;
    }
  }

  /**
   * List all stages for a tenant
   */
  async listStages(tenantId) {
    try {
      const stages = await this.models.Stage.findAll({
        where: { 
          tenantId,
          isActive: true
        },
        order: [['order', 'ASC'], ['createdAt', 'ASC']]
      });
      
      return stages;
    } catch (error) {
      console.error('Error listing stages:', error);
      throw error;
    }
  }

  /**
   * Update a stage
   */
  async updateStage(stageId, tenantId, data) {
    try {
      const stage = await this.models.Stage.findOne({ 
        where: { 
          id: stageId, 
          tenantId 
        } 
      });
      
      if (!stage) {
        throw new Error('Stage not found');
      }
      
      await stage.update(data);
      console.log(`✅ Updated stage "${stage.title}" for tenant ${tenantId}`);
      
      return stage;
    } catch (error) {
      console.error('Error updating stage:', error);
      throw error;
    }
  }

  /**
   * Delete a stage
   */
  async deleteStage(stageId, tenantId, force = false) {
    try {
      const stage = await this.models.Stage.findOne({ 
        where: { 
          id: stageId, 
          tenantId 
        } 
      });
      
      if (!stage) {
        throw new Error('Stage not found');
      }
      
      // Check for leads in this stage
      const leadCount = await this.models.Lead.count({
        where: {
          stageId: stageId,
          tenantId,
          isActive: true
        }
      });
      
      if (leadCount > 0 && !force) {
        throw new Error(`Cannot delete stage with ${leadCount} leads. Use force option to delete anyway.`);
      }
      
      if (force && leadCount > 0) {
        // Remove stage from all leads
        await this.models.Lead.update(
          { stageId: null },
          {
            where: {
              stageId: stageId,
              tenantId
            }
          }
        );
        console.log(`⚠️ Removed ${leadCount} leads from stage before deletion`);
      }
      
      await stage.destroy();
      console.log(`✅ Deleted stage "${stage.title}" for tenant ${tenantId}`);
      
      return true;
    } catch (error) {
      console.error('Error deleting stage:', error);
      throw error;
    }
  }

  /**
   * Assign a lead to a stage
   */
  async assignLeadStage(leadId, tenantId, stageId) {
    try {
      // Verify the lead exists and belongs to tenant
      const lead = await this.models.Lead.findOne({ 
        where: { 
          id: leadId, 
          tenantId 
        } 
      });
      
      if (!lead) {
        throw new Error('Lead not found');
      }
      
      // Verify the stage exists and belongs to tenant
      if (stageId) {
        const stage = await this.models.Stage.findOne({
          where: {
            id: stageId,
            tenantId
          }
        });
        
        if (!stage) {
          throw new Error('Stage not found');
        }
      }
      
      // Update the lead's stage
      const previousStageId = lead.stageId;
      lead.stageId = stageId;
      await lead.save();
      
      console.log(`✅ Assigned lead ${leadId} to stage ${stageId} (was: ${previousStageId})`);
      
      return lead;
    } catch (error) {
      console.error('Error assigning lead to stage:', error);
      throw error;
    }
  }

  /**
   * Remove a lead from its current stage
   */
  async removeLeadStage(leadId, tenantId) {
    try {
      const lead = await this.models.Lead.findOne({ 
        where: { 
          id: leadId, 
          tenantId 
        } 
      });
      
      if (!lead) {
        throw new Error('Lead not found');
      }
      
      const previousStageId = lead.stageId;
      lead.stageId = null;
      await lead.save();
      
      console.log(`✅ Removed lead ${leadId} from stage ${previousStageId}`);
      
      return lead;
    } catch (error) {
      console.error('Error removing lead from stage:', error);
      throw error;
    }
  }

  /**
   * Bulk assign multiple leads to a stage
   */
  async bulkAssignLeadsToStage(leadIds, stageId, tenantId) {
    try {
      if (!Array.isArray(leadIds) || leadIds.length === 0) {
        throw new Error('leadIds must be a non-empty array');
      }
      
      // Verify the stage exists
      const stage = await this.models.Stage.findOne({
        where: {
          id: stageId,
          tenantId
        }
      });
      
      if (!stage) {
        throw new Error('Stage not found');
      }
      
      // Verify all leads exist and belong to tenant
      const leads = await this.models.Lead.findAll({
        where: {
          id: { [Op.in]: leadIds },
          tenantId
        }
      });
      
      const foundLeadIds = leads.map(l => l.id);
      const notFoundIds = leadIds.filter(id => !foundLeadIds.includes(parseInt(id)));
      
      // Update the leads that were found
      const [updatedCount] = await this.models.Lead.update(
        { stageId: stageId },
        {
          where: {
            id: { [Op.in]: foundLeadIds },
            tenantId
          }
        }
      );
      
      console.log(`✅ Bulk assigned ${updatedCount} leads to stage ${stageId}`);
      
      return {
        successful: updatedCount,
        failed: notFoundIds.length,
        notFoundIds,
        stageName: stage.title
      };
    } catch (error) {
      console.error('Error bulk assigning leads to stage:', error);
      throw error;
    }
  }

  /**
   * Move leads between stages
   */
  async moveLeadsBetweenStages(fromStageId, toStageId, tenantId, leadIds = null) {
    try {
      // Verify both stages exist
      const [fromStage, toStage] = await Promise.all([
        this.models.Stage.findOne({
          where: { id: fromStageId, tenantId }
        }),
        this.models.Stage.findOne({
          where: { id: toStageId, tenantId }
        })
      ]);
      
      if (!fromStage) {
        throw new Error('Source stage not found');
      }
      
      if (!toStage) {
        throw new Error('Destination stage not found');
      }
      
      // Build where clause
      const whereClause = {
        stageId: fromStageId,
        tenantId
      };
      
      if (leadIds && Array.isArray(leadIds) && leadIds.length > 0) {
        whereClause.id = { [Op.in]: leadIds };
      }
      
      // Move the leads
      const [updatedCount] = await this.models.Lead.update(
        { stageId: toStageId },
        { where: whereClause }
      );
      
      console.log(`✅ Moved ${updatedCount} leads from stage "${fromStage.title}" to "${toStage.title}"`);
      
      return {
        movedCount: updatedCount,
        fromStage: fromStage.title,
        toStage: toStage.title
      };
    } catch (error) {
      console.error('Error moving leads between stages:', error);
      throw error;
    }
  }

  /**
   * Get stage analytics overview
   */
  async getStageAnalytics(tenantId) {
    try {
      // Get all stages with lead counts
      const stages = await this.models.Stage.findAll({
        where: { tenantId, isActive: true },
        order: [['order', 'ASC']],
        include: [{
          model: this.models.Lead,
          as: 'leads',
          where: { isActive: true },
          required: false,
          attributes: []
        }],
        attributes: [
          'id',
          'title',
          'color',
          'order',
          [this.models.Stage.sequelize.fn('COUNT', this.models.Stage.sequelize.col('leads.id')), 'leadCount']
        ],
        group: ['Stage.id']
      });
      
      // Get total lead count
      const totalLeads = await this.models.Lead.count({
        where: { tenantId, isActive: true }
      });
      
      // Get leads without stage
      const leadsWithoutStage = await this.models.Lead.count({
        where: { 
          tenantId, 
          isActive: true,
          stageId: null
        }
      });
      
      // Calculate stage distribution
      const stageDistribution = stages.map(stage => ({
        stageId: stage.id,
        stageName: stage.title,
        leadCount: parseInt(stage.get('leadCount')) || 0,
        percentage: totalLeads > 0 ? 
          ((parseInt(stage.get('leadCount')) || 0) / totalLeads * 100).toFixed(1) : 0,
        color: stage.color
      }));
      
      return {
        totalLeads,
        leadsWithoutStage,
        leadsInStages: totalLeads - leadsWithoutStage,
        stageCount: stages.length,
        stageDistribution
      };
    } catch (error) {
      console.error('Error getting stage analytics:', error);
      throw error;
    }
  }

  /**
   * Get stage conversion funnel
   */
  async getStageFunnel(tenantId, options = {}) {
    try {
      const { startDate, endDate } = options;
      
      // Build date filter
      const dateFilter = {};
      if (startDate || endDate) {
        dateFilter.createdAt = {};
        if (startDate) dateFilter.createdAt[Op.gte] = new Date(startDate);
        if (endDate) dateFilter.createdAt[Op.lte] = new Date(endDate);
      }
      
      // Get stages in order
      const stages = await this.models.Stage.findAll({
        where: { tenantId, isActive: true },
        order: [['order', 'ASC']]
      });
      
      // Get lead counts for each stage
      const funnelData = [];
      let previousCount = 0;
      
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        
        const leadCount = await this.models.Lead.count({
          where: {
            tenantId,
            stageId: stage.id,
            isActive: true,
            ...dateFilter
          }
        });
        
        const conversionRate = i === 0 || previousCount === 0 ? 100 : 
          ((leadCount / previousCount) * 100).toFixed(1);
        
        funnelData.push({
          stageId: stage.id,
          stageName: stage.title,
          leadCount,
          conversionRate: parseFloat(conversionRate),
          dropOffCount: i === 0 ? 0 : previousCount - leadCount,
          dropOffRate: i === 0 ? 0 : 
            (((previousCount - leadCount) / previousCount) * 100).toFixed(1),
          color: stage.color,
          order: stage.order
        });
        
        previousCount = leadCount;
      }
      
      return {
        funnel: funnelData,
        dateRange: { startDate, endDate },
        totalStages: stages.length
      };
    } catch (error) {
      console.error('Error getting stage funnel:', error);
      throw error;
    }
  }

  /**
   * Reorder stages
   */
  async reorderStages(tenantId, stageOrders) {
    try {
      // stageOrders should be array of { stageId, order }
      if (!Array.isArray(stageOrders)) {
        throw new Error('stageOrders must be an array');
      }
      
      const updatePromises = stageOrders.map(({ stageId, order }) =>
        this.models.Stage.update(
          { order },
          {
            where: {
              id: stageId,
              tenantId
            }
          }
        )
      );
      
      await Promise.all(updatePromises);
      
      console.log(`✅ Reordered ${stageOrders.length} stages for tenant ${tenantId}`);
      
      return await this.listStages(tenantId);
    } catch (error) {
      console.error('Error reordering stages:', error);
      throw error;
    }
  }
}

module.exports = StageService;