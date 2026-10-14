const path = require('path');
const { Client } = require(path.resolve(__dirname, '../../api/node_modules/pg'));
require(path.resolve(__dirname, '../../api/node_modules/dotenv')).config({
  path: path.resolve(__dirname, '../../api/.env'),
});

async function seedData(targetRows = 100000) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not found in api/.env');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  console.log(`Connected to database. Starting benchmark data generation of ${targetRows.toLocaleString()} rows...`);
  const startTime = Date.now();

  try {
    // 1. Get or create sample warehouse and locations
    const whRes = await client.query(`SELECT id FROM inv_warehouses LIMIT 1;`);
    let whId = whRes.rows[0]?.id;
    if (!whId) {
      const insWh = await client.query(`
        INSERT INTO inv_warehouses (name, code, merchant_id)
        VALUES ('Benchmark WH', 'WH-BENCH', gen_random_uuid())
        RETURNING id;
      `);
      whId = insWh.rows[0].id;
    }

    const locRes = await client.query(`
      SELECT id, type FROM inv_locations WHERE warehouse_id = $1 LIMIT 2;
    `, [whId]);

    let sourceId = locRes.rows[0]?.id;
    let destId = locRes.rows[1]?.id;

    if (!sourceId || !destId) {
      const insLoc1 = await client.query(`
        INSERT INTO inv_locations (warehouse_id, name, code, type)
        VALUES ($1, 'Bench Vendor', 'BENCH-SUP', 'SUPPLIER')
        RETURNING id;
      `, [whId]);
      const insLoc2 = await client.query(`
        INSERT INTO inv_locations (warehouse_id, name, code, type)
        VALUES ($1, 'Bench Storage', 'BENCH-INT', 'INTERNAL')
        RETURNING id;
      `, [whId]);
      sourceId = insLoc1.rows[0].id;
      destId = insLoc2.rows[0].id;
    }

    console.log(`Using source location: ${sourceId}, dest location: ${destId}`);

    // 2. High-speed bulk generation via generate_series
    const insertQuery = `
      INSERT INTO inv_stock_moves (
        product_id,
        source_location_id,
        destination_location_id,
        quantity,
        state,
        reference_type,
        performed_by,
        created_at,
        done_date,
        updated_at
      )
      SELECT
        '11111111-1111-4111-8111-111111111111'::uuid,
        $1::uuid,
        $2::uuid,
        round((random() * 50 + 1)::numeric, 3),
        'DONE',
        'GRN',
        'bench-loader',
        NOW() - (random() * interval '60 days'),
        NOW() - (random() * interval '60 days'),
        NOW()
      FROM generate_series(1, $3);
    `;

    await client.query(insertQuery, [sourceId, destId, targetRows]);

    const countRes = await client.query(`SELECT count(*)::int AS total FROM inv_stock_moves;`);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`Successfully seeded ${targetRows.toLocaleString()} rows in ${duration}s!`);
    console.log(`Total movements now in inv_stock_moves: ${countRes.rows[0].total.toLocaleString()}`);
  } catch (err) {
    console.error('Error during data seeding:', err);
  } finally {
    await client.end();
  }
}

const rowsToGenerate = process.argv[2] ? parseInt(process.argv[2], 10) : 100000;
seedData(rowsToGenerate);
