// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
// Celestia DA High-Throughput TPS Benchmark (Modified for Fast Inclusion)
// Submits transactions and measures actual block inclusion TPS, considering
// a transaction valid immediately upon detection in a block.
//
// Usage:
//   export AUTH_TOKEN="$(celestia light auth admin --p2p.network mocha)"
//   node celestia_tps_benchmark.js --num-txns 1000 --concurrency 50

const axios = require("axios");
const crypto = require("crypto");

// ====================================================================
// CONFIGURATION
// ====================================================================
const CONFIG = {
  RPC: "http://127.0.0.1:26658/",
  AUTH_TOKEN: process.env.AUTH_TOKEN || "",
  
  // Test parameters
  NUM_TRANSACTIONS: 1000,      // Total transactions to submit
  CONCURRENCY: 50,             // Parallel submissions
  INITIAL_BATCH: 100,          // Start with this many
  BATCH_MULTIPLIER: 2,         // Double each time
  MAX_BATCH_SIZE: 10000,       // Safety limit
  USE_PROGRESSIVE: true,       // Progressive mode (like Polkadot benchmark)
  
  // Blob parameters
  PAYLOAD_SIZE: 256,           // Bytes per blob (adjust as needed)
  GAS_LIMIT: 80000,
  FEE: 2000,
  
  // Timeouts
  SUBMISSION_TIMEOUT: 30000,   // 30s per submission
  DELAY_BETWEEN_BATCHES: 3000, // 3s between batches
  POLL_INTERVAL: 2000,         // Poll every 2s
  MAX_POLL_TIME: 60000,        // 60s max to detect inclusion
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  
  for (let i = 0; i < args.length; i++) {
    switch(args[i]) {
      case '--num-txns':
        CONFIG.NUM_TRANSACTIONS = parseInt(args[++i]) || CONFIG.NUM_TRANSACTIONS;
        break;
      case '--concurrency':
        CONFIG.CONCURRENCY = parseInt(args[++i]) || CONFIG.CONCURRENCY;
        break;
      case '--initial-batch':
        CONFIG.INITIAL_BATCH = parseInt(args[++i]) || CONFIG.INITIAL_BATCH;
        break;
      case '--payload-size':
        CONFIG.PAYLOAD_SIZE = parseInt(args[++i]) || CONFIG.PAYLOAD_SIZE;
        break;
      case '--progressive':
        CONFIG.USE_PROGRESSIVE = true;
        break;
      case '--single-batch':
        CONFIG.USE_PROGRESSIVE = false;
        break;
    }
  }
}

parseArgs();

// ====================================================================
// HELPERS
// ====================================================================

/**
 * Generates a 29-byte random namespace and returns it Base64 encoded.
 * @returns {string} The base64-encoded namespace ID.
 */
function namespace29Base64() {
  const buf = Buffer.alloc(29);
  buf.fill(0);
  // Copy 10 random bytes into the last 10 bytes of the 29-byte namespace
  const randomBytes = crypto.randomBytes(10);
  randomBytes.copy(buf, 19);
  return buf.toString("base64");
}

/**
 * Creates a payload string, padding it with 'X' characters to reach the target size.
 * @param {number} txIndex - The transaction index for identification.
 * @param {number} size - The desired payload size in bytes.
 * @returns {string} The JSON payload string.
 */
function createPayload(txIndex, size) {
  const base = {
    msg: `TX-${txIndex}`,
    ts: Date.now(),
    idx: txIndex,
  };
  let json = JSON.stringify(base);
  
  // Pad to desired size
  if (json.length < size) {
    const padding = 'X'.repeat(size - json.length);
    json = JSON.stringify({ ...base, padding });
  }
  
  return json;
}

/**
 * Converts a UTF-8 string to Base64.
 * @param {string} s - The input string.
 * @returns {string} The Base64 encoded string.
 */
function toBase64(s) {
  return Buffer.from(s, "utf8").toString("base64");
}

/**
 * Sends a JSON-RPC request to the Celestia node.
 * @param {string} method - The RPC method name.
 * @param {Array<any>} params - The parameters for the method.
 * @returns {Promise<any>} The response data.
 */
async function jsonRpc(method, params) {
  const body = { jsonrpc: "2.0", id: 1, method, params };
  try {
    const r = await axios.post(CONFIG.RPC, body, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.AUTH_TOKEN}`,
      },
      timeout: CONFIG.SUBMISSION_TIMEOUT,
    });
    return r.data;
  } catch (e) {
    if (e.response && e.response.data) return e.response.data;
    throw e;
  }
}

// ====================================================================
// SUBMISSION ENGINE
// ====================================================================

class CelestiaSubmitter {
  constructor() {
    this.activeSubmissions = 0;
    this.maxConcurrency = CONFIG.CONCURRENCY;
  }

  /**
   * Submits a single transaction (blob).
   * @param {number} txIndex - The transaction index.
   * @param {string} namespace - The Base64 encoded namespace.
   * @returns {Promise<object>} The submission result object.
   */
  async submitOne(txIndex, namespace) {
    const payload = createPayload(txIndex, CONFIG.PAYLOAD_SIZE);
    const dataB64 = toBase64(payload);

    const params = [
      [{
        namespace: namespace,
        data: dataB64,
        share_version: 0,
      }],
      {
        gas_limit: CONFIG.GAS_LIMIT,
        fee: CONFIG.FEE,
      }
    ];

    try {
      const resp = await jsonRpc("blob.Submit", params);
      
      if (resp.error) {
        return { 
          index: txIndex, 
          success: false, 
          error: resp.error.message,
          namespace 
        };
      }
      
      return { 
        index: txIndex, 
        success: true, 
        height: resp.result,
        namespace 
      };
    } catch (err) {
      return { 
        index: txIndex, 
        success: false, 
        error: err.message,
        namespace 
      };
    }
  }

  /**
   * Submits a batch of transactions concurrently.
   * @param {number} startIdx - The starting transaction index.
   * @param {number} count - The number of transactions to submit.
   * @param {string|null} sharedNamespace - An optional namespace to reuse.
   * @returns {Promise<object>} The batch result including timestamps.
   */
  async submitBatch(startIdx, count, sharedNamespace) {
    console.log(`\n📤 Submitting ${count} transactions (concurrency: ${this.maxConcurrency})...`);
    
    // Capture start time before the first submission attempt
    const startTime = Date.now();
    const submissions = [];
    const namespace = sharedNamespace || namespace29Base64();
    
    // Use semaphore-like pattern for concurrency control
    const runningTasks = new Set();
    let completed = 0;
    
    for (let i = 0; i < count; i++) {
      const txIndex = startIdx + i;
      
      // Wait if at max concurrency
      while (runningTasks.size >= this.maxConcurrency) {
        await Promise.race(runningTasks);
      }
      
      const task = this.submitOne(txIndex, namespace)
        .then(result => {
          completed++;
          if (completed % 100 === 0 || completed === count) {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = completed / elapsed;
            process.stdout.write(`\r   Progress: ${completed}/${count} (${rate.toFixed(1)} tx/s)`);
          }
          runningTasks.delete(task);
          return result;
        })
        .catch(err => {
          runningTasks.delete(task);
          return { 
            index: txIndex, 
            success: false, 
            error: err.message,
            namespace 
          };
        });
      
      runningTasks.add(task);
      submissions.push(task);
    }
    
    // Wait for all to complete
    const results = await Promise.all(submissions);
    const endTime = Date.now(); // Capture end time after all submissions return
    
    console.log(); // New line after progress
    
    const duration = (endTime - startTime) / 1000;
    const successful = results.filter(r => r.success);
    
    console.log(`   ✅ Submitted: ${successful.length}/${count} in ${duration.toFixed(2)}s`);
    console.log(`   📊 Submission rate: ${(successful.length / duration).toFixed(2)} tx/s`);
    
    return {
      results,
      startTime, // <-- Added for E2E calculation
      endTime,   // <-- Added for E2E calculation
      duration,
      namespace,
      successful: successful.length,
      failed: count - successful.length,
    };
  }
}

// ====================================================================
// BLOCK INCLUSION CHECKER
// ====================================================================

/**
 * Checks a specific block height for transactions in the given namespace.
 * @param {number} height - The block height to check.
 * @param {string} namespace - The Base64 encoded namespace.
 * @returns {Promise<number>} The number of blobs found in that block.
 */
async function checkBlockInclusion(height, namespace) {
  try {
    // blob.GetAll returns all blobs for the given height and namespaces
    const resp = await jsonRpc("blob.GetAll", [height, [namespace]]);
    if (!resp.error && resp.result) {
      return resp.result.length;
    }
  } catch (e) {
    // Ignore errors for polling failures (e.g., node is catching up)
  }
  return 0;
}

/**
 * Polls the Celestia node to confirm transaction inclusion.
 * @param {object} submissionResults - The results from the submission batch.
 * @param {string} namespace - The namespace used for submission.
 * @returns {Promise<object|null>} Inclusion details or null if timeout.
 */
async function waitForInclusion(submissionResults, namespace) {
  console.log(`\n⏳ Checking for block inclusion...`);
  
  const successful = submissionResults.results.filter(r => r.success);
  if (successful.length === 0) {
    console.log(`   ❌ No successful submissions to check`);
    return null;
  }
  
  // Get unique block heights the txs were included in (as reported by submit)
  const heights = [...new Set(successful.map(r => r.height))].sort((a, b) => a - b);
  
  console.log(`   📦 Transactions submitted to ${heights.length} block(s): ${heights.join(', ')}`);
  
  const startPoll = Date.now();
  const deadline = startPoll + CONFIG.MAX_POLL_TIME;
  
  let totalFound = 0;
  const blockResults = {};
  
  // Poll each height
  while (Date.now() < deadline && totalFound < successful.length) {
    for (const height of heights) {
      if (!blockResults[height]) {
        const count = await checkBlockInclusion(height, namespace);
        if (count > 0) {
          blockResults[height] = count;
          totalFound += count;
          console.log(`   ✅ Block ${height}: Found ${count} blob(s)`);
        }
      }
    }
    
    if (totalFound >= successful.length) break;
    
    await new Promise(r => setTimeout(r, CONFIG.POLL_INTERVAL));
  }
  
  const endPollTime = Date.now(); // <-- Capture end time of polling
  const pollDuration = (endPollTime - startPoll) / 1000;
  
  if (totalFound > 0) {
    console.log(`   🎉 Confirmed ${totalFound} transactions in ${pollDuration.toFixed(2)}s`);
    return {
      found: totalFound,
      pollDuration,
      endPollTime, // <-- Added for E2E calculation
      blockResults,
    };
  } else {
    console.log(`   ⚠️  No confirmations after ${pollDuration.toFixed(2)}s`);
    return null;
  }
}

// ====================================================================
// TPS CALCULATION
// ====================================================================

/**
 * Calculates Submission TPS and End-to-End Inclusion TPS.
 * @param {object} submissionResult - The submission results.
 * @param {object|null} inclusionResult - The inclusion results.
 * @returns {object} The calculated TPS metrics.
 */
function calculateTPS(submissionResult, inclusionResult) {
  const successful = submissionResult.successful;
  const submissionTime = submissionResult.duration;
  
  // Submission TPS is based purely on how fast the RPC endpoint accepted the transactions.
  const submissionTPS = successful / submissionTime;
  
  let e2eInclusionTPS = null;
  let totalTimeSeconds = null;
  
  if (inclusionResult && inclusionResult.found > 0) {
    // E2E Time: Time from the very start of the submission batch
    // to the point where all submitted transactions were confirmed in a block.
    const totalTimeMs = inclusionResult.endPollTime - submissionResult.startTime;
    totalTimeSeconds = totalTimeMs / 1000;
    
    // E2E Inclusion TPS = Total Confirmed Transactions / Total Time (Submission Start to Confirmation End)
    e2eInclusionTPS = inclusionResult.found / totalTimeSeconds;
  }
  
  return {
    submissionTPS,
    e2eInclusionTPS, // <-- Renamed and calculated for faster metric
    successful,
    submissionTime,
    inclusionTime: inclusionResult ? totalTimeSeconds : null,
  };
}

// ====================================================================
// PROGRESSIVE BENCHMARK
// ====================================================================

async function runProgressiveBenchmark(submitter) {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 PROGRESSIVE TPS BENCHMARK');
  console.log('='.repeat(70));
  console.log(`Strategy: Start at ${CONFIG.INITIAL_BATCH}, multiply by ${CONFIG.BATCH_MULTIPLIER} each time`);
  console.log(`Max batch size: ${CONFIG.MAX_BATCH_SIZE}`);
  
  const results = [];
  let currentBatch = CONFIG.INITIAL_BATCH;
  let txIndex = 1;
  let consecutiveFailures = 0;
  
  while (currentBatch <= CONFIG.MAX_BATCH_SIZE && consecutiveFailures < 2) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📦 BATCH SIZE: ${currentBatch} transactions`);
    
    const submissionResult = await submitter.submitBatch(txIndex, currentBatch, null);
    
    // Check inclusion
    const inclusionResult = await waitForInclusion(submissionResult, submissionResult.namespace);
    
    const tps = calculateTPS(submissionResult, inclusionResult);
    
    const success = inclusionResult && inclusionResult.found >= currentBatch * 0.5; // 50% threshold
    
    results.push({
      batchSize: currentBatch,
      success,
      ...tps,
      inclusionResult,
    });
    
    console.log(`\n   📊 Batch Results:`);
    console.log(`      Submission TPS: ${tps.submissionTPS.toFixed(2)}`);
    if (tps.e2eInclusionTPS) {
      console.log(`      🏆 E2E Inclusion TPS: ${tps.e2eInclusionTPS.toFixed(2)}`);
    }
    
    if (success) {
      consecutiveFailures = 0;
      txIndex += currentBatch;
      currentBatch = Math.floor(currentBatch * CONFIG.BATCH_MULTIPLIER);
      
      if (currentBatch <= CONFIG.MAX_BATCH_SIZE) {
        console.log(`\n   ⏸️  Waiting ${CONFIG.DELAY_BETWEEN_BATCHES / 1000}s before next batch...`);
        await new Promise(r => setTimeout(r, CONFIG.DELAY_BETWEEN_BATCHES));
      }
    } else {
      consecutiveFailures++;
      console.log(`   ⚠️  Batch failed (${consecutiveFailures}/2)`);
      if (consecutiveFailures < 2) {
        console.log(`   🔄 Retrying same batch size...`);
        await new Promise(r => setTimeout(r, CONFIG.DELAY_BETWEEN_BATCHES));
      }
    }
  }
  
  return results;
}

// ====================================================================
// SINGLE BATCH BENCHMARK
// ====================================================================

async function runSingleBatchBenchmark(submitter) {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 SINGLE BATCH TPS BENCHMARK');
  console.log('='.repeat(70));
  console.log(`Transactions: ${CONFIG.NUM_TRANSACTIONS}`);
  console.log(`Concurrency: ${CONFIG.CONCURRENCY}`);
  
  const submissionResult = await submitter.submitBatch(1, CONFIG.NUM_TRANSACTIONS, null);
  const inclusionResult = await waitForInclusion(submissionResult, submissionResult.namespace);
  const tps = calculateTPS(submissionResult, inclusionResult);
  
  return [{
    batchSize: CONFIG.NUM_TRANSACTIONS,
    success: inclusionResult && inclusionResult.found > 0,
    ...tps,
    inclusionResult,
  }];
}

// ====================================================================
// FINAL STATISTICS
// ====================================================================

function printFinalStats(results) {
  console.log('\n' + '='.repeat(70));
  console.log('📊 FINAL BENCHMARK RESULTS');
  console.log('='.repeat(70));
  
  const successful = results.filter(r => r.success);
  
  if (successful.length === 0) {
    console.log('\n❌ No successful batches');
    return;
  }
  
  console.log(`\n✅ Successful batches: ${successful.length}/${results.length}`);
  
  const submissionTPS = successful.map(r => r.submissionTPS);
  const e2eInclusionTPS = successful.filter(r => r.e2eInclusionTPS).map(r => r.e2eInclusionTPS);
  
  console.log(`\n📤 SUBMISSION SPEED (RPC Acceptance Rate):`);
  console.log(`   Peak: ${Math.max(...submissionTPS).toFixed(2)} TPS`);
  console.log(`   Average: ${(submissionTPS.reduce((a,b) => a+b, 0) / submissionTPS.length).toFixed(2)} TPS`);
  
  if (e2eInclusionTPS.length > 0) {
    console.log(`\n🎯 E2E INCLUSION TPS (Actual Throughput):`);
    console.log(`   Peak: ${Math.max(...e2eInclusionTPS).toFixed(2)} TPS`);
    console.log(`   Average: ${(e2eInclusionTPS.reduce((a,b) => a+b, 0) / e2eInclusionTPS.length).toFixed(2)} TPS`);
  }
  
  console.log(`\n📋 Batch Progression:`);
  successful.forEach(r => {
    const blockTpsStr = r.e2eInclusionTPS ? `${r.e2eInclusionTPS.toFixed(2)} TPS` : 'N/A';
    console.log(`   ${String(r.batchSize).padStart(5)} txs → ${r.submissionTime.toFixed(2)}s → ${blockTpsStr}`);
  });
  
  const totalTxs = successful.reduce((sum, r) => sum + r.successful, 0);
  console.log(`\n📈 Total successful transactions: ${totalTxs}`);
  
  const lastSuccess = successful[successful.length - 1];
  console.log(`🏆 Largest successful batch: ${lastSuccess.batchSize}`);
  
  console.log('\n' + '='.repeat(70));
}

// ====================================================================
// MAIN
// ====================================================================

(async () => {
  if (!CONFIG.AUTH_TOKEN) {
    console.error('❌ AUTH_TOKEN not set!');
    console.error('   Run: export AUTH_TOKEN="$(celestia light auth admin --p2p.network mocha)"');
    process.exit(1);
  }
  
  console.log('🌟 Celestia DA TPS Benchmark Tool');
  console.log('   Measuring time from submission start to block inclusion.');
  console.log('='.repeat(70));
  console.log(`RPC: ${CONFIG.RPC}`);
  console.log(`Mode: ${CONFIG.USE_PROGRESSIVE ? 'Progressive' : 'Single Batch'}`);
  console.log(`Payload size: ${CONFIG.PAYLOAD_SIZE} bytes`);
  
  const submitter = new CelestiaSubmitter();
  
  let results;
  if (CONFIG.USE_PROGRESSIVE) {
    results = await runProgressiveBenchmark(submitter);
  } else {
    results = await runSingleBatchBenchmark(submitter);
  }
  
  printFinalStats(results);
  
  console.log('\n✅ Benchmark complete!');
})().catch(err => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});