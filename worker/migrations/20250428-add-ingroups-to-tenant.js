'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Replace "Tenants" with your actual table name if different
    await queryInterface.sequelize.query(`
      UPDATE "Tenants"
      SET "apiConfig" = jsonb_set(
        "apiConfig",
        '{in_groups}',
        '"TaxSales"',
        true
      )
      WHERE id = 1;
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Remove the key on rollback
    await queryInterface.sequelize.query(`
      UPDATE "Tenants"
      SET "apiConfig" = apiConfig - 'in_groups'
      WHERE id = 1;
    `);
  }
};
