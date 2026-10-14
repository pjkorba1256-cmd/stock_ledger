const { Client } = require('pg');
require('dotenv').config({ path: './.env' });

async function inspectDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not configured in api/.env');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  console.log('\n======================================================');
  console.log(' DATABASE OVERVIEW: p02_stock_ledger');
  console.log('======================================================\n');

  // Warehouses
  const whRes = await client.query('SELECT id, name, code, is_default, is_active FROM inv_warehouses;');
  console.log(`📦 WAREHOUSES (${whRes.rowCount} found):`);
  console.table(whRes.rows);

  // Locations
  const locRes = await client.query('SELECT id, warehouse_id, name, code, type FROM inv_locations LIMIT 10;');
  console.log(`📍 LOCATIONS (First 10 of ${locRes.rowCount}+):`);
  console.table(locRes.rows);

  // Quants
  const quantRes = await client.query('SELECT id, product_id, location_id, quantity, reserved_quantity FROM inv_stock_quants;');
  console.log(`📊 STOCK QUANTS (${quantRes.rowCount} found):`);
  console.table(quantRes.rows);

  // Stock Moves Count & Sample
  const countMoves = await client.query('SELECT count(*)::int AS total FROM inv_stock_moves;');
  const sampleMoves = await client.query('SELECT id, reference_type, quantity, state, performed_by, created_at FROM inv_stock_moves ORDER BY created_at DESC LIMIT 5;');
  console.log(`📜 STOCK MOVES (Total: ${countMoves.rows[0].total.toLocaleString()} rows | Showing latest 5):`);
  console.table(sampleMoves.rows);

  console.log('\n======================================================\n');
  await client.end();
}

inspectDatabase().catch(console.error);
