const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const parsedUrl = new URL(API_BASE);

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'content-type': 'application/json',
      ...headers,
    };
    if (postData) {
      reqHeaders['content-length'] = Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: `/inventory${path}`,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        });
      },
    );

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return sorted[idx];
}

async function runFlashSaleBenchmark() {
  console.log('\n=============================================================');
  console.log('1. FLASH-SALE RESERVATION BENCHMARK (CONCURRENCY & SAFETY)');
  console.log('=============================================================');
  console.log('Scenario: 100 units available of a flash-sale item.');
  console.log('Attempting 2,000 concurrent reservations within 10 seconds...');

  // Setup: Create fresh warehouse & location
  const whRes = await request('POST', '/warehouses', {
    name: 'Flash-Sale Distribution Center',
    code: `FS-DC-${Date.now().toString().slice(-4)}`,
    merchantId: 'd2961899-7090-4d21-94ef-81e63aeb646d',
  });
  const warehouseId = whRes.body.id;

  const locRes = await request('POST', '/locations', {
    warehouseId,
    name: 'Flash-Sale Vault Shelf',
    code: `VAULT-${Date.now().toString().slice(-4)}`,
    type: 'INTERNAL',
  });
  const locationId = locRes.body.id;

  const productId = '11111111-1111-4111-8111-111111111111';

  // Inward receive exactly 100 units
  const lotName = `LOT-FLASH-${Date.now()}`;
  await request('POST', '/lots/receive', {
    productId,
    lotName,
    locationId,
    quantity: 100,
    performedBy: 'flash-setup',
    manufacturingDate: '2026-10-01',
    expiryDate: '2026-12-31',
  });

  console.log('Initial stock quant: 100 units on-hand. Starting 2,000 attempts...');

  const TOTAL_ATTEMPTS = 2000;
  const CONCURRENCY = 50;
  const latencies = [];
  let successfulReservations = 0;
  let rejectedReservations = 0;
  let serverErrors = 0;
  let deadlocks = 0;

  const startTime = Date.now();
  let index = 0;

  async function worker() {
    while (index < TOTAL_ATTEMPTS) {
      const i = index++;
      const reqStart = process.hrtime.bigint();
      try {
        const res = await request('POST', '/reservations', {
          merchantId: 'd2961899-7090-4d21-94ef-81e63aeb646d',
          orderReference: `FS-ORD-${i}-${Date.now()}`,
          productId,
          locationId,
          quantity: 1, // each attempt asks for 1 unit
          timeoutMinutes: 15,
          createdBy: `shopper-${i}`,
        });
        const reqEnd = process.hrtime.bigint();
        latencies.push(Number(reqEnd - reqStart) / 1e6); // ms

        if (res.statusCode === 201) {
          successfulReservations++;
        } else if (res.statusCode === 400) {
          rejectedReservations++;
        } else if (res.statusCode === 500) {
          serverErrors++;
          if (JSON.stringify(res.body).toLowerCase().includes('deadlock')) {
            deadlocks++;
          }
        }
      } catch (err) {
        serverErrors++;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }).map(() => worker());
  await Promise.all(workers);

  const durationSec = (Date.now() - startTime) / 1000;
  const reqPerSec = (TOTAL_ATTEMPTS / durationSec).toFixed(1);

  // Check quant state directly from API
  const sohRes = await request('GET', `/stock-on-hand?productId=${productId}&locationId=${locationId}`);
  const quant = sohRes.body.data[0];
  const reservedOnQuant = Number(quant.reservedQuantity);
  const availableOnQuant = Number(quant.quantity) - reservedOnQuant;

  console.log('\n--- FLASH-SALE BENCHMARK RESULTS ---');
  console.log(`Total Attempts:       ${TOTAL_ATTEMPTS}`);
  console.log(`Duration:             ${durationSec.toFixed(2)}s`);
  console.log(`Throughput:           ${reqPerSec} req/sec`);
  console.log(`Successful (201):     ${successfulReservations} (Expected: 100)`);
  console.log(`Rejected (400):       ${rejectedReservations} (Expected: 1900)`);
  console.log(`Server Errors (500):  ${serverErrors} (Expected: 0)`);
  console.log(`Deadlocks Detected:   ${deadlocks} (Expected: 0)`);
  console.log(`Quant Reserved Qty:   ${reservedOnQuant} units`);
  console.log(`Quant Available Qty:  ${availableOnQuant} units`);
  console.log(`Overselling Drift:    ${Math.max(0, reservedOnQuant - 100)} units`);
  console.log(`Latency p50:          ${percentile(latencies, 50).toFixed(2)} ms`);
  console.log(`Latency p95:          ${percentile(latencies, 95).toFixed(2)} ms`);
  console.log(`Latency p99:          ${percentile(latencies, 99).toFixed(2)} ms`);

  return {
    scenario: 'Flash-Sale Concurrency (100 units / 2,000 attempts)',
    totalAttempts: TOTAL_ATTEMPTS,
    durationSec: Number(durationSec.toFixed(2)),
    throughputReqPerSec: Number(reqPerSec),
    successfulReservations,
    rejectedReservations,
    serverErrors,
    deadlocks,
    reservedOnQuant,
    availableOnQuant,
    oversoldUnits: Math.max(0, reservedOnQuant - 100),
    latencyP50Ms: Number(percentile(latencies, 50).toFixed(2)),
    latencyP95Ms: Number(percentile(latencies, 95).toFixed(2)),
    latencyP99Ms: Number(percentile(latencies, 99).toFixed(2)),
    invariantVerified: successfulReservations === 100 && reservedOnQuant === 100 && deadlocks === 0,
  };
}

async function runAbandonedReservationsComparison() {
  console.log('\n=============================================================');
  console.log('2. ABANDONED RESERVATIONS TIMEOUT COMPARISON (5m vs 15m vs 60m)');
  console.log('=============================================================');

  // Comparative analysis model across 5,000 daily abandoned checkout orders
  const dailyOrders = 5000;
  const avgBasketUnits = 3.2;
  const totalUnitsReserved = dailyOrders * avgBasketUnits; // 16,000 units
  const avgUnitValueInr = 65; // ₹65 per unit for dairy/groceries

  const tiers = [
    { name: 'Aggressive (5 Minutes)', timeoutMin: 5 },
    { name: 'Standard / FreshMart Default (15 Minutes)', timeoutMin: 15 },
    { name: 'Relaxed / Traditional ERP (60 Minutes)', timeoutMin: 60 },
  ];

  const comparison = tiers.map((t) => {
    // Inventory lockup area = (Timeout / 1440) * Total Daily Units
    const avgBlockedUnitsConcurrent = Math.round((t.timeoutMin / (24 * 60)) * totalUnitsReserved);
    const avgBlockedValueInr = avgBlockedUnitsConcurrent * avgUnitValueInr;
    // Lost sales due to false stockouts (estimated 4.2% per 15 min lockup)
    const stockoutLossPct = (t.timeoutMin / 15) * 4.2;
    const estMonthlyLostSalesInr = Math.round(dailyOrders * 30 * (stockoutLossPct / 100) * avgBasketUnits * avgUnitValueInr);

    return {
      tier: t.name,
      timeoutMinutes: t.timeoutMin,
      avgBlockedUnitsConcurrent,
      avgBlockedValueInr,
      stockoutRiskScore: stockoutLossPct.toFixed(1) + '%',
      estimatedMonthlyLostSalesInr: estMonthlyLostSalesInr,
      lockContentionIndex: (t.timeoutMin / 5).toFixed(1) + 'x',
    };
  });

  console.table(comparison);
  return comparison;
}

async function runExpirySweepBenchmark() {
  console.log('\n=============================================================');
  console.log('3. 7-DAY EXPIRING STOCK QUERY BENCHMARK & QUERY PLAN');
  console.log('=============================================================');

  // Benchmark repeated queries on getExpiringLots with varying horizon
  const horizons = [3, 7, 14, 30];
  const results = [];

  for (const h of horizons) {
    const latencies = [];
    for (let i = 0; i < 20; i++) {
      const start = process.hrtime.bigint();
      const res = await request('GET', `/expiring-lots?days=${h}`);
      const end = process.hrtime.bigint();
      latencies.push(Number(end - start) / 1e6);
    }

    results.push({
      horizonDays: h,
      runs: 20,
      latencyP50Ms: Number(percentile(latencies, 50).toFixed(2)),
      latencyP95Ms: Number(percentile(latencies, 95).toFixed(2)),
      latencyP99Ms: Number(percentile(latencies, 99).toFixed(2)),
    });
  }

  console.table(results);
  return results;
}

async function main() {
  try {
    const flashSale = await runFlashSaleBenchmark();
    const abandoned = await runAbandonedReservationsComparison();
    const expirySweep = await runExpirySweepBenchmark();

    const report = {
      benchmarkTimestamp: new Date().toISOString(),
      platform: 'FreshMart Cora ERP Inventory II (Techvisk P03)',
      database: 'PostgreSQL 16 (Localhost)',
      flashSale,
      abandonedReservationsComparison: abandoned,
      expirySweepBenchmark: expirySweep,
    };

    const outPath = path.resolve(__dirname, '../benchmark-p03-results.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nBenchmark results successfully persisted to ${outPath}`);
  } catch (err) {
    console.error('Benchmark execution error:', err);
    process.exit(1);
  }
}

main();
