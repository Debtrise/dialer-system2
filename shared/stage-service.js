class StageService {
  constructor(models) {
    this.models = models;
  }

  async createStage(tenantId, data) {
    return this.models.Stage.create({ ...data, tenantId });
  }

  async listStages(tenantId) {
    return this.models.Stage.findAll({
      where: { tenantId },
      order: [['createdAt', 'ASC']]
    });
  }

  async updateStage(id, tenantId, data) {
    const stage = await this.models.Stage.findOne({ where: { id, tenantId } });
    if (!stage) throw new Error('Stage not found');
    await stage.update(data);
    return stage;
  }

  async deleteStage(id, tenantId) {
    const stage = await this.models.Stage.findOne({ where: { id, tenantId } });
    if (!stage) throw new Error('Stage not found');
    await stage.destroy();
    return true;
  }

  async assignLeadStage(leadId, tenantId, stageId) {
    const lead = await this.models.Lead.findOne({ where: { id: leadId, tenantId } });
    if (!lead) throw new Error('Lead not found');
    lead.stageId = stageId;
    await lead.save();
    return lead;
  }
}

module.exports = StageService;
