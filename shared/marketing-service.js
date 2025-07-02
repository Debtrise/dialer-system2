class MarketingService {
  constructor(models, webhookService = null, LeadModel = null) {
    this.models = models;
    this.webhookService = webhookService;
    this.Lead = LeadModel;
    this.marketingEndpointKey = 'marketing_lead';
  }

  async linkAccount(tenantId, platform, accountId, tokens = {}, metadata = {}) {
    const [account] = await this.models.AdAccount.findOrCreate({
      where: { tenantId, platform, accountId },
      defaults: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.tokenExpiresAt,
        metadata
      }
    });

    if (!account.isNewRecord) {
      await account.update({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.tokenExpiresAt,
        metadata
      });
    }
    return account;
  }

  listAccounts(tenantId) {
    return this.models.AdAccount.findAll({ where: { tenantId } });
  }

  async createCampaign(tenantId, adAccountId, data) {
    const campaign = await this.models.AdCampaign.create({
      tenantId,
      adAccountId,
      externalId: data.externalId,
      name: data.name,
      params: data.params || {},
      cost: data.cost || 0,
      startDate: data.startDate,
      endDate: data.endDate
    });
    return campaign;
  }

  async recordLead(tenantId, campaignId, leadData) {
    const campaign = await this.models.AdCampaign.findByPk(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    const adLead = await this.models.AdLead.create({
      tenantId,
      adCampaignId: campaignId,
      externalLeadId: leadData.externalLeadId,
      leadId: leadData.leadId,
      data: leadData.data || {}
    });

    await campaign.increment('leads');

    if (leadData.leadId && this.Lead) {
      const lead = await this.Lead.findByPk(leadData.leadId);
      if (lead) {
        const additionalData = lead.additionalData || {};
        additionalData.marketing = additionalData.marketing || [];
        additionalData.marketing.push({
          campaignId,
          adAccountId: campaign.adAccountId,
          externalLeadId: leadData.externalLeadId,
          data: leadData.data || {}
        });
        await lead.update({ additionalData });
      }
    }

    if (this.webhookService && this.webhookService.processWebhook) {
      try {
        await this.webhookService.processWebhook(
          this.marketingEndpointKey,
          { tenantId, campaignId, leadData },
          {},
          'marketing-service'
        );
      } catch (err) {
        console.error('Marketing webhook failed:', err.message);
      }
    }

    return adLead;
  }

  async recordConversion(campaignId) {
    const campaign = await this.models.AdCampaign.findByPk(campaignId);
    if (campaign) {
      await campaign.increment('conversions');
    }
  }

  async getCampaignMetrics(campaignId) {
    const campaign = await this.models.AdCampaign.findByPk(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    const cpl = campaign.leads > 0 ? parseFloat(campaign.cost) / campaign.leads : 0;
    const cpa = campaign.conversions > 0 ? parseFloat(campaign.cost) / campaign.conversions : 0;

    return {
      cost: parseFloat(campaign.cost),
      leads: campaign.leads,
      conversions: campaign.conversions,
      cpl,
      cpa
    };
  }
}

module.exports = MarketingService;
