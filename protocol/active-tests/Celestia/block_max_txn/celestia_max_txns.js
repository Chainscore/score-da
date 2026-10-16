// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs

// Usage:
//   export AUTH_TOKEN="$(celestia light auth admin --p2p.network mocha)"
//   node celestia_submit_multiple.js
const axios = require("axios");
const crypto = require("crypto");

const RPC = "http://127.0.0.1:26658/";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const args = process.argv.slice(2);
let numTransactions = 10; // Default number of transactions

const numTxnsIndex = args.indexOf('--num-txns');
if (numTxnsIndex > -1 && args[numTxnsIndex + 1]) {
  const value = parseInt(args[numTxnsIndex + 1], 10);
  if (!isNaN(value) && value > 0) {
    numTransactions = value;
  } else {
    console.warn('Invalid value for --num-txns. Using default of 10.');
  }
} else if (numTxnsIndex > -1 && !args[numTxnsIndex + 1]) {
    console.warn('No value provided for --num-txns. Using default of 10.');
}

const NUM_TRANSACTIONS = numTransactions; // Number of transactions to submit

if (!AUTH_TOKEN) {
  console.error('Export AUTH_TOKEN first: export AUTH_TOKEN="$(celestia light auth admin --p2p.network mocha)"');
  process.exit(1);
}

// Construct a 29-byte namespace.
function namespace29Base64() {
  const buf = Buffer.alloc(29);
  buf.fill(0);
  // The first 19 bytes must be 0 for a user-specified namespace.
  // The last 10 bytes can be random.
  const randomBytes = crypto.randomBytes(10);
  randomBytes.copy(buf, 19);
  return buf.toString("base64");
}

// Create a payload generator function
function createPayload(txIndex) {
  return JSON.stringify({
    message: `Transaction ${txIndex} from Celestia DA`,
    ts: new Date().toISOString(),
    txIndex: txIndex,
    author: "batch-submitter",
  });
}

// helper: base64 encode
function toBase64(s) {
  return Buffer.from(s, "utf8").toString("base64");
}

async function jsonRpc(method, params) {
  const body = { jsonrpc: "2.0", id: 1, method, params };
  try {
    const r = await axios.post(RPC, body, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      timeout: 600000,
    });
    return r.data;
  } catch (e) {
    if (e.response && e.response.data) return e.response.data;
    throw e;
  }
}

(async () => {
  console.log(`\n========== SUBMITTING ${NUM_TRANSACTIONS} TRANSACTIONS ==========\n`);
  
  const startTime = Date.now();
  const submissions = [];
  const results = [];

  // Create all submission promises without waiting
  for (let i = 1; i <= NUM_TRANSACTIONS; i++) {
    const ns = namespace29Base64();
    const payload = createPayload(i);
    const dataB64 = toBase64(payload);

    const params = [
      [
        {
          namespace: ns,
          data: dataB64,
          share_version: 0,
        },
      ],
      {
        "gas_limit": 80000,
        "fee": 2000
      }
    ];

    // Fire all requests immediately without awaiting
    const submissionPromise = jsonRpc("blob.Submit", params)
      .then(resp => {
        if (resp.error) {
          console.error(`❌ TX ${i} failed:`, resp.error.message);
          return { index: i, success: false, error: resp.error };
        }
        // console.log(`✅ TX ${i} submitted to height: ${resp.result}`);
        return { index: i, success: true, height: resp.result, namespace: ns };
      })
      .catch(err => {
        console.error(`❌ TX ${i} exception:`, err.message);
        return { index: i, success: false, error: err.message };
      });

    submissions.push(submissionPromise);
    
    // Optional: tiny delay to avoid overwhelming the node
    // Remove this if you want maximum speed
    if (i < NUM_TRANSACTIONS) {
      await new Promise(r => setTimeout(r, 10)); // 10ms delay between submissions
    }
  }

  // Wait for all submissions to complete
  console.log("\n⏳ Waiting for all submissions to complete...\n");
  const allResults = await Promise.all(submissions);
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;

  // Analyze results
  const successful = allResults.filter(r => r.success);
  const failed = allResults.filter(r => !r.success);
  
  // Group by block height
  const heightGroups = {};
  successful.forEach(r => {
    if (!heightGroups[r.height]) {
      heightGroups[r.height] = [];
    }
    heightGroups[r.height].push(r.index);
  });

  console.log("\n========== RESULTS ==========");
  console.log(`Total Transactions: ${NUM_TRANSACTIONS}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Duration: ${duration.toFixed(2)} seconds`);
  console.log(`Rate: ${(NUM_TRANSACTIONS / duration).toFixed(2)} tx/s`);
  
  console.log("\n📦 Transactions per block:");
  Object.keys(heightGroups).sort((a, b) => a - b).forEach(height => {
    const txIndices = heightGroups[height].sort((a, b) => a - b);
    console.log(`  Block ${height}: ${txIndices.length} transactions [${txIndices.slice(0, 10).join(', ')}${txIndices.length > 10 ? '...' : ''}]`);
  });

  if (failed.length > 0) {
    console.log("\n❌ Failed transactions:");
    failed.forEach(f => {
      console.log(`  TX ${f.index}: ${f.error}`);
    });
  }

  // Just in case if we want to retrive specific data : Retrieve data from one of the blocks
//   const targetHeight = Object.keys(heightGroups)[0];
//   if (targetHeight && heightGroups[targetHeight].length > 0) {
//     console.log(`\n🔍 Retrieving data from block ${targetHeight}...`);
//     await new Promise((r) => setTimeout(r, 3000));
    
//     const firstTxInBlock = successful.find(r => r.height == targetHeight);
//     const getAllResp = await jsonRpc("blob.GetAll", [Number(targetHeight), [firstTxInBlock.namespace]]);
    
//     if (!getAllResp.error && getAllResp.result) {
//       console.log(`Retrieved ${getAllResp.result.length} blob(s) from block ${targetHeight}`);
//       if (getAllResp.result.length > 0) {
//         const decodedData = Buffer.from(getAllResp.result[0].data, "base64").toString("utf8");
//         console.log("Sample payload:", decodedData);
//       }
//     }
//   }
})();