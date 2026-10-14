const autocannon = require('../api/node_modules/autocannon');
const fs = require('fs');
const path = require('path');

async function runScenario(name, url, method = 'GET', body = null, connections = 50, duration = 10) {
  console.log(`\n==================================================`);
  console.log(`Running Scenario: ${name}`);
  console.log(`URL: ${url} | Connections: ${connections} | Duration: ${duration}s`);
  console.log(`==================================================`);

  const opts = {
    url,
    method,
    connections,
    duration,
    headers: {
      'content-type': 'application/json',
    },
  };

  if (body) {
    opts.body = JSON.stringify(body);
  }

  return new Promise((resolve) => {
    autocannon(opts, (err, result) => {
      if (err) {
        console.error('Benchmark error:', err);
        resolve(null);
        return;
      }

      console.log(`Throughput: ${result.requests.average.toFixed(1)} req/sec`);
      console.log(`Latency p50: ${result.latency.p50} ms | p90: ${result.latency.p90} ms | p99: ${result.latency.p99} ms`);
      console.log(`Errors: ${result.errors} | Non-2xx: ${result.non2xx}`);

      resolve({
        scenario: name,
        connections,
        duration: `${duration}s`,
        reqPerSec: result.requests.average.toFixed(1),
        totalRequests: result.requests.total,
        latencyP50: result.latency.p50,
        latencyP90: result.latency.p90,
        latencyP99: result.latency.p99,
        latencyAvg: result.latency.average,
        errors: result.errors + result.non2xx,
      });
    });
  });
}

async function main() {
  const results = [];

  // 1. Stock On Hand (Quants Snapshot)
  const soh = await runScenario(
    'Stock-on-Hand Query (Quants Snapshot Table)',
    'http://localhost:3000/inventory/stock-on-hand?limit=20',
    'GET',
    null,
    50,
    10
  );
  if (soh) results.push(soh);

  // 2. Stock Moves History (Filtered Date & Type)
  const moves = await runScenario(
    'Stock Movements History (Audit Ledger with Pagination & Filter)',
    'http://localhost:3000/inventory/stock-moves?referenceType=GRN&limit=20',
    'GET',
    null,
    50,
    10
  );
  if (moves) results.push(moves);

  // 3. Ledger Reconciliation Engine
  const reconcile = await runScenario(
    'Ledger Reconciliation Audit Query',
    'http://localhost:3000/inventory/reconcile',
    'GET',
    null,
    20,
    10
  );
  if (reconcile) results.push(reconcile);

  // 4. Stock Movement Draft Creation
  const createMove = await runScenario(
    'Draft Movement Creation (Write Load)',
    'http://localhost:3000/inventory/stock-moves',
    'POST',
    {
      referenceType: 'TRANSFER',
      productId: '11111111-1111-4111-8111-111111111111',
      sourceLocationId: '7172f4fd-8c7c-4115-adff-9fd36ff84ecd',
      destinationLocationId: '5571a122-f657-452c-ae2f-7387005512a4',
      quantity: 1,
      performedBy: 'autocannon-bench',
    },
    20,
    10
  );
  if (createMove) results.push(createMove);

  console.log('\n==================================================');
  console.log('SUMMARY BENCHMARK REPORT TABLE');
  console.log('==================================================');
  console.table(results);

  // Write results to JSON in load/
  fs.writeFileSync(
    path.join(__dirname, 'benchmark-results.json'),
    JSON.stringify(results, null, 2),
    'utf-8'
  );
  console.log(`Saved results to ${path.join(__dirname, 'benchmark-results.json')}`);
}

main().catch(console.error);
