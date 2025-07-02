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

  // Update the performance metrics for an order (e.g. number of closed leads)
  async updateOrderPerformance(orderId, closedLeads) {
    const order = await this.models.LeadOrder.findByPk(orderId);
    if (!order) throw new Error('Order not found');
    order.closedLeads = closedLeads;
    await order.save();
    return order;
  }

  // Get aggregated analytics for a lead provider across all orders
  async getProviderAnalytics(providerId) {
    const listings = await this.models.LeadListing.findAll({
      where: { providerId },
      include: this.models.LeadOrder
    });

    let totalSold = 0;
    let totalClosed = 0;
    const buyers = {};

    listings.forEach(listing => {
      listing.LeadOrders.forEach(order => {
        totalSold += order.quantity;
        totalClosed += order.closedLeads;
        if (!buyers[order.buyerTenantId]) {
          buyers[order.buyerTenantId] = { sold: 0, closed: 0 };
        }
        buyers[order.buyerTenantId].sold += order.quantity;
        buyers[order.buyerTenantId].closed += order.closedLeads;
      });
    });

    const buyerBreakdown = Object.entries(buyers).map(([tenantId, data]) => ({
      tenantId,
      leadsPurchased: data.sold,
      leadsClosed: data.closed,
      closeRate: data.sold > 0 ? (data.closed / data.sold * 100).toFixed(1) : '0'
    }));

    return {
      totalLeadsSold: totalSold,
      totalLeadsClosed: totalClosed,
      overallCloseRate: totalSold > 0 ? (totalClosed / totalSold * 100).toFixed(1) : '0',
      buyers: buyerBreakdown
    };
  }
}

module.exports = MarketplaceService;
