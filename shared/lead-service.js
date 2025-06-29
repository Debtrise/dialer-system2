const { Op } = require('sequelize');

class LeadService {
  constructor(models) {
    this.models = models;
  }

  async updateDialerAssignment(id, tenantId, dialerAssignment) {
    const lead = await this.models.Lead.findOne({ where: { id, tenantId } });
    if (!lead) {
      throw new Error('Lead not found');
    }
    await lead.update({ dialerAssignment });
    return lead;
  }

  async bulkUpdateDialerAssignment(leadIds, tenantId, dialerAssignment) {
    const [count] = await this.models.Lead.update(
      { dialerAssignment },
      { where: { id: { [Op.in]: leadIds }, tenantId } }
    );
    return count;
  }

  async getDialerStats(tenantId) {
    return this.models.Lead.findAll({
      where: { tenantId },
      attributes: [
        'dialerAssignment',
        [this.models.sequelize.fn('COUNT', this.models.sequelize.col('id')), 'count'],
        [this.models.sequelize.fn('COUNT', this.models.sequelize.literal("CASE WHEN status = 'pending' THEN 1 END")), 'pendingCount']
      ],
      group: ['dialerAssignment'],
      raw: true
    });
  }

  async importLeads(tenantId, leads) {
    return this.models.Lead.bulkCreate(leads);
  }

  async getLead(id, tenantId) {
    const lead = await this.models.Lead.findOne({ where: { id, tenantId } });
    if (!lead) return null;
    const calls = await this.models.CallLog.findAll({
      where: { leadId: id, tenantId },
      order: [['startTime', 'DESC']]
    });
    const totalCalls = calls.length;
    const answeredCalls = calls.filter(c => c.status !== 'failed' && c.status !== 'initiated').length;
    const transferredCalls = calls.filter(c => c.status === 'transferred').length;
    const completedCalls = calls.filter(c => c.status === 'completed').length;
    const totalDuration = calls.reduce((sum, c) => sum + (c.duration || 0), 0);
    const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
    return {
      lead,
      callHistory: { calls, stats: { totalCalls, answeredCalls, transferredCalls, completedCalls, totalDuration, avgDuration } }
    };
  }

  async listLeads(tenantId, query) {
    const { page = 1, limit = 50 } = query;
    const where = { tenantId };
    if (query.status) where.status = query.status;
    if (query.phone) where.phone = { [Op.iLike]: `%${query.phone}%` };
    if (query.name) where.name = { [Op.iLike]: `%${query.name}%` };
    if (query.email) where.email = { [Op.iLike]: `%${query.email}%` };
    if (query.brand) where.brand = query.brand;
    if (query.source) where.source = query.source;

    const leads = await this.models.Lead.findAll({
      where,
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
      order: [['createdAt', 'DESC']]
    });
    const count = await this.models.Lead.count({ where });
    return { leads, totalPages: Math.ceil(count / parseInt(limit)), currentPage: parseInt(page), totalCount: count };
  }

  async deleteLead(id, tenantId) {
    const lead = await this.models.Lead.findOne({ where: { id, tenantId } });
    if (!lead) throw new Error('Lead not found');
    const activeCall = await this.models.CallLog.findOne({
      where: {
        leadId: id,
        tenantId,
        status: { [Op.in]: ['initiated', 'answered'] },
        endTime: null,
      },
    });
    if (activeCall) {
      throw new Error('Cannot delete lead with active calls');
    }
    await lead.destroy();
    return true;
  }

  async bulkDelete(ids, tenantId) {
    const activeCall = await this.models.CallLog.findOne({
      where: {
        leadId: { [Op.in]: ids },
        tenantId,
        status: { [Op.in]: ['initiated', 'answered'] },
        endTime: null,
      },
    });
    if (activeCall) {
      throw new Error('Cannot delete leads with active calls');
    }
    return this.models.Lead.destroy({ where: { id: { [Op.in]: ids }, tenantId } });
  }
}

module.exports = LeadService;
