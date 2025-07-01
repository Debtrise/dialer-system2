const { Sequelize } = require('sequelize');
require('dotenv').config();

async function fixPriorityColumn() {
  const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
    host: 'localhost',
    dialect: 'postgres',
    logging: console.log
  });

  try {
    await sequelize.authenticate();
    console.log('Database connection established.');

    // Check current column definition
    const [result] = await sequelize.query(`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'optisigns_takeovers'
        AND column_name = 'priority'
    `);

    const column = result[0];
    const isEnum = column && column.data_type === 'USER-DEFINED' && column.udt_name === 'enum_optisigns_takeovers_priority';

    if (isEnum) {
      console.log('priority column already uses enum type.');
      await sequelize.close();
      return;
    }

    console.log('Fixing priority column type...');
    await sequelize.transaction(async (t) => {
      await sequelize.query('ALTER TABLE "optisigns_takeovers" ALTER COLUMN "priority" DROP DEFAULT', { transaction: t });
      await sequelize.query(
        `DO $$ BEGIN CREATE TYPE "public"."enum_optisigns_takeovers_priority" AS ENUM('EMERGENCY','HIGH','NORMAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
        { transaction: t }
      );
      await sequelize.query(
        'ALTER TABLE "optisigns_takeovers" ALTER COLUMN "priority" TYPE "public"."enum_optisigns_takeovers_priority" USING ("priority"::text::"public"."enum_optisigns_takeovers_priority")',
        { transaction: t }
      );
      await sequelize.query('ALTER TABLE "optisigns_takeovers" ALTER COLUMN "priority" SET DEFAULT \'NORMAL\'', { transaction: t });
      await sequelize.query('ALTER TABLE "optisigns_takeovers" ALTER COLUMN "priority" SET NOT NULL', { transaction: t });
    });

    console.log('priority column fixed successfully.');
  } catch (err) {
    console.error('Error fixing priority column:', err);
  } finally {
    await sequelize.close();
  }
}

fixPriorityColumn();
