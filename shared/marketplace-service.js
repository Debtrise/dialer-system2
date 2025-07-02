class MarketplaceService {
  constructor(models) {
    this.models = models;
  }

  createProvider(tenantId, data) {
    return this.models.LeadProvider.create({ ...data, tenantId });
  }

  listProviders() {
    return this.models.LeadProvider.findAll({ where: { isActive: true } });
  }

  createListing(providerId, data) {
    return this.models.LeadListing.create({ ...data, providerId });
  }

  listListings() {
    return this.models.LeadListing.findAll({ where: { isActive: true }, include: this.models.LeadProvider });
  }

  async purchaseLeads(buyerTenantId, listingId, quantity) {
    const listing = await this.models.LeadListing.findByPk(listingId);
    if (!listing || !listing.isActive) throw new Error('Listing not available');
    if (listing.availableLeads < quantity) throw new Error('Not enough leads');

    const totalCost = parseFloat(listing.pricePerLead) * quantity;

    const order = await this.models.LeadOrder.create({
      buyerTenantId,
      listingId,
      quantity,
      pricePerLead: listing.pricePerLead,
      totalCost,
      status: 'completed'
    });

    await listing.decrement('availableLeads', { by: quantity });
    return order;
  }

  listOrders(filter) {
    const where = {};
    if (filter.buyerTenantId) where.buyerTenantId = filter.buyerTenantId;
    return this.models.LeadOrder.findAll({ where, include: this.models.LeadListing });
  }
}

module.exports = MarketplaceService;
