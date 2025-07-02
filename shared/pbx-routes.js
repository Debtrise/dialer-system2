const express = require('express');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();

  const pbxModels = require('./pbx-models')(sequelize, sequelize.Sequelize.DataTypes);

  router.get('/pbx/config', authenticateToken, async (req, res) => {
    try {
      let config = await pbxModels.PBXConfig.findOne({ where: { id: 1 } });
      if (!config) {
        config = await pbxModels.PBXConfig.create({ id: 1, username: '1000', password: 'secret' });
      }
      const { password, ...safeConfig } = config.toJSON();
      res.json(safeConfig);
    } catch (error) {
      console.error('Error getting PBX config:', error);
      res.status(400).json({ error: error.message });
    }
  });

  router.put('/pbx/config', authenticateToken, async (req, res) => {
    try {
      const { serverUrl, websocketUrl, username, password, domain } = req.body;
      let config = await pbxModels.PBXConfig.findOne({ where: { id: 1 } });
      if (config) {
        await config.update({ serverUrl, websocketUrl, username, password, domain });
      } else {
        config = await pbxModels.PBXConfig.create({ id: 1, serverUrl, websocketUrl, username, password, domain });
      }
      res.json({ message: 'PBX configuration saved' });
    } catch (error) {
      console.error('Error saving PBX config:', error);
      res.status(400).json({ error: error.message });
    }
  });

  app.use('/api', router);

  return pbxModels;
};
