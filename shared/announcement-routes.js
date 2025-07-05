const express = require('express');
const fs = require('fs').promises;

module.exports = function(app, sequelize, authenticateToken, contentService, optisignsService) {
  const router = express.Router();
  const { ContentAsset } = sequelize.models;
  const { Op } = sequelize.Sequelize;

  async function findRepPhoto(tenantId, email) {
    const lowerEmail = email.toLowerCase();
    return await ContentAsset.findOne({
      where: {
        tenantId: tenantId.toString(),
        categories: { [Op.overlap]: ['Sales Reps', 'sales_reps'] },
        [Op.or]: [
          sequelize.where(sequelize.fn('LOWER', sequelize.col("metadata->>'repEmail'")), lowerEmail),
          sequelize.where(sequelize.fn('LOWER', sequelize.col("metadata->>'rep_email'")), lowerEmail),
          sequelize.where(sequelize.fn('LOWER', sequelize.col("metadata->>'email'")), lowerEmail)
        ]
      },
      order: [['created_at', 'DESC']]
    });
  }

  router.post('/announcement/video', authenticateToken, async (req, res) => {
    try {
      const { repEmail, repName, dealAmount = '', companyName = '', displayIds } = req.body;
      if (!repEmail || !displayIds) {
        return res.status(400).json({ error: 'repEmail and displayIds are required' });
      }
      const ids = Array.isArray(displayIds) ? displayIds : [displayIds];
      const tenantId = req.user.tenantId;
      const repPhoto = await findRepPhoto(tenantId, repEmail);
      if (!repPhoto) {
        return res.status(404).json({ error: 'Sales rep photo not found' });
      }
      const videoInfo = await contentService.generateCelebrationVideo({
        repName: repName || repPhoto.metadata?.repName || repEmail,
        repPhotoUrl: repPhoto.publicUrl,
        dealAmount,
        companyName
      });
      const buffer = await fs.readFile(videoInfo.filePath);
      const uploaded = await optisignsService.uploadContent(
        tenantId,
        buffer,
        `celebration-${Date.now()}`,
        'celebration.mp4',
        { contentType: 'video/mp4' }
      );
      const pushResults = await optisignsService.pushContentToMultipleDevices(
        tenantId,
        ids,
        uploaded.id
      );
      res.json({ success: true, assetId: uploaded.id, pushResults });
    } catch (error) {
      console.error('Announcement video error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/announcement/image', authenticateToken, async (req, res) => {
    try {
      const { repEmail, repName, displayIds } = req.body;
      if (!repEmail || !displayIds) {
        return res.status(400).json({ error: 'repEmail and displayIds are required' });
      }
      const ids = Array.isArray(displayIds) ? displayIds : [displayIds];
      const tenantId = req.user.tenantId;
      const repPhoto = await findRepPhoto(tenantId, repEmail);
      if (!repPhoto) {
        return res.status(404).json({ error: 'Sales rep photo not found' });
      }
      const buffer = await fs.readFile(repPhoto.filePath);
      const uploaded = await optisignsService.uploadImageContent(
        tenantId,
        buffer,
        `rep-image-${Date.now()}`,
        { fileName: 'rep.png', contentType: repPhoto.mimeType || 'image/png' }
      );
      const pushResults = await optisignsService.pushContentToMultipleDevices(
        tenantId,
        ids,
        uploaded.id
      );
      res.json({ success: true, assetId: uploaded.id, pushResults });
    } catch (error) {
      console.error('Announcement image error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.use('/api', router);
};
