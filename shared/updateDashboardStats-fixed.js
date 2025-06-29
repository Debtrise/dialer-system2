    async updateDashboardStats(tenantId) {
        try {
            // Ensure tenantId is always a string
            const tenantIdStr = tenantId ? String(tenantId) : null;
            if (!tenantIdStr) {
                console.error('No tenantId provided to updateDashboardStats');
                return;
            }
            
            const tenant = await this.models.Tenant.findByPk(tenantIdStr);
            if (!tenant) {
                console.error(`Tenant not found: ${tenantIdStr}`);
                return;
            }
            
            // Get active calls count - ensure tenantId is string in query
            const activeCalls = await this.models.CallLog.count({
                where: {
                    tenantId: tenantIdStr,
                    status: { [this.Sequelize.Op.in]: ['initiated', 'answered'] },
                    endTime: null
                }
            });
            
            // Get today's date range
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);
            
            // Get today's call statistics
            const todayStats = await this.models.CallLog.findAll({
                where: {
                    tenantId: tenantIdStr,
                    startTime: {
                        [this.Sequelize.Op.between]: [startOfDay, endOfDay]
                    }
                },
                attributes: [
                    [this.Sequelize.fn('COUNT', this.Sequelize.col('id')), 'totalCalls'],
                    [this.Sequelize.fn('COUNT', this.Sequelize.literal(`CASE WHEN status != 'failed' THEN 1 END`)), 'answeredCalls'],
                    [this.Sequelize.fn('COUNT', this.Sequelize.literal(`CASE WHEN status = 'transferred' THEN 1 END`)), 'transferredCalls'],
                    [this.Sequelize.fn('AVG', this.Sequelize.col('duration')), 'avgDuration']
                ]
            });
            
            const stats = todayStats[0]?.dataValues || {
                totalCalls: 0,
                answeredCalls: 0,
                transferredCalls: 0,
                avgDuration: 0
            };
            
            // Calculate rates
            const connectionRate = stats.totalCalls > 0 ? (stats.answeredCalls / stats.totalCalls) * 100 : 0;
            const transferRate = stats.answeredCalls > 0 ? (stats.transferredCalls / stats.answeredCalls) * 100 : 0;
            
            // Update or create dashboard stats
            await this.models.DashboardStats.upsert({
                tenantId: tenantIdStr,
                activeCalls: activeCalls || 0,
                todayTotalCalls: parseInt(stats.totalCalls) || 0,
                todayAnsweredCalls: parseInt(stats.answeredCalls) || 0,
                todayTransferredCalls: parseInt(stats.transferredCalls) || 0,
                todayConnectionRate: connectionRate,
                todayTransferRate: transferRate,
                todayAvgCallDuration: parseFloat(stats.avgDuration) || 0,
                lastUpdated: new Date()
            });
            
            console.log(`Updated dashboard stats for tenant ${tenantIdStr}`);
        } catch (error) {
            console.error('Error updating dashboard stats:', error);
            throw error;
        }
    }
