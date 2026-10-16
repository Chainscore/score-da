// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
// Polkadot Asset Hub Parallel TPS Benchmark Tool
// Targets a high-throughput Parachain (Asset Hub) with optimized, parallel submission.

const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const BN = require('bn.js');

// ====================================================================
// Configuration
// ====================================================================
const CONFIG = {
  // === CRITICAL CHANGE: TARGET ASSET HUB PARACHAIN ===
  // Provide an array of public endpoints for robustness
  WS_ENDPOINTS: [
    'wss://westend-rpc.dwellir.com', // Primary (original)
    'wss://asset-hub-polkadot-rpc.dwellir.com', // Dwellir
    'wss://paseo.rpc.amforc.com', // Dwellir (legacy name)
    'wss://paseo-rpc.dwellir.com'
  ],
  
  // --- PARALLEL TEST SETTINGS (Adjusted for Max Pressure) ---
  TARGET_BATCH_SIZE: 10000,
  NUM_PARALLEL_ATTEMPTS: 50,
  
  // New: Timeout for the initial API connection itself (15 seconds)
  CONNECTION_TIMEOUT_MS: 15000,
  
  TIMEOUT_MS: 90000, // Timeout for transaction confirmation
  SUBMISSION_DELAY_MS: 0, 
};

// --- OPTIMIZED TRANSACTION PAYLOAD ---
const MINIMAL_PAYLOAD = 'X';
const MINIMAL_HEX = '0x' + Buffer.from(MINIMAL_PAYLOAD).toString('hex');
// ====================================================================

// ====================================================================
// API Connection and Utility Functions
// ====================================================================

/**
 * Attempts to connect to the API with a timeout and retries using fallback endpoints.
 */
async function createApi() {
    for (const endpoint of CONFIG.WS_ENDPOINTS) {
        console.log(`\n🔌 Attempting connection to endpoint: ${endpoint}`);
        const provider = new WsProvider(endpoint);
        
        // Wrap ApiPromise.create with a timeout
        const apiPromise = new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Connection timeout after ${CONFIG.CONNECTION_TIMEOUT_MS / 1000}s`));
            }, CONFIG.CONNECTION_TIMEOUT_MS);

            try {
                const api = await ApiPromise.create({ provider });
                clearTimeout(timer);
                resolve(api);
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });

        try {
            console.log('⏳ Creating API instance with timeout...');
            const api = await apiPromise;

            const chain = await api.rpc.system.chain();
            const spec = await api.rpc.state.getRuntimeVersion();
            console.log('✅ Connected to chain:', chain.toString(), 'specName:', spec.specName.toString());
            return api;
        } catch (e) {
            console.error(`❌ Failed to connect to ${endpoint}: ${e.message}`);
            // If connection fails, try the next endpoint in the list
            if (provider.isConnected) {
                await provider.disconnect();
            }
        }
    }
    
    // If all endpoints fail
    throw new Error('All RPC endpoints failed to connect or timed out.');
}

/**
 * Submits multiple batch extrinsics in parallel, managing the nonce explicitly.
 */
async function submitParallelBatches(api, account, initialNonce) {
    const totalTransactions = CONFIG.TARGET_BATCH_SIZE * CONFIG.NUM_PARALLEL_ATTEMPTS;
    console.log(`\nStarting Parallel Submission: ${CONFIG.NUM_PARALLEL_ATTEMPTS} batches of ${CONFIG.TARGET_BATCH_SIZE} txs each.`);
    console.log(`Total transactions to submit: ${totalTransactions}`);

    const submissionPromises = [];
    const startTime = Date.now();
    
    // Nonce management: Use an explicit nonce starting from the account's current nonce.
    for (let i = 0; i < CONFIG.NUM_PARALLEL_ATTEMPTS; i++) {
        const currentNonce = initialNonce.add(new BN(i));
        const batchIndex = i + 1;
        
        // 1. Create the batch extrinsic with minimal payload
        const transactions = [];
        for (let j = 0; j < CONFIG.TARGET_BATCH_SIZE; j++) {
            // Using a minimal, fixed remark for max throughput
            transactions.push(api.tx.system.remark(MINIMAL_HEX));
        }
        const batchTx = api.tx.utility.batch(transactions);
        
        // 2. Submit the batch with the EXPLICIT nonce
        console.log(`   🔏 Submitting batch ${batchIndex.toString().padStart(2, '0')}/${CONFIG.NUM_PARALLEL_ATTEMPTS} with nonce ${currentNonce.toString().padStart(4)}...`);
        
        const promise = new Promise((resolve, reject) => {
            let unsub = null;
            const timer = setTimeout(() => {
                if (unsub) unsub();
                reject(new Error(`Timeout after ${CONFIG.TIMEOUT_MS/1000}s`));
            }, CONFIG.TIMEOUT_MS);

            // Use the explicit nonce here
            batchTx.signAndSend(account, { nonce: currentNonce }, async (result) => {
                
                if (result.dispatchError) {
                    clearTimeout(timer);
                    let errorMsg = result.dispatchError.toString();
                    if (result.dispatchError.isModule) {
                        const decoded = api.registry.findMetaError(result.dispatchError.asModule);
                        errorMsg = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
                    }
                    unsub && unsub();
                    reject(new Error(errorMsg));
                    return;
                }
                
                // Track success when included in a block
                if (result.status.isInBlock) {
                    clearTimeout(timer);
                    unsub && unsub();
                    
                    resolve({
                        batchIndex,
                        batchSize: CONFIG.TARGET_BATCH_SIZE,
                        success: true
                    });
                }
            }).then((_unsub) => { 
                unsub = _unsub;
            }).catch(err => {
                clearTimeout(timer);
                reject(err);
            });
        });

        submissionPromises.push(promise);
        
        // CRITICAL: Minimal/Zero pause to manage backpressure.
        if (CONFIG.SUBMISSION_DELAY_MS > 0) {
            await new Promise(r => setTimeout(r, CONFIG.SUBMISSION_DELAY_MS));
        }
    }
    
    // 3. Wait for ALL promises to settle (resolve or reject)
    const results = await Promise.allSettled(submissionPromises);
    const endTime = Date.now();
    const overallDuration = (endTime - startTime) / 1000;

    // 4. Process the results for statistics
    const successfulResults = [];
    const failedResults = [];
    
    results.forEach(res => {
        if (res.status === 'fulfilled' && res.value.success) {
            successfulResults.push(res.value);
        } else {
            failedResults.push({
                batchSize: CONFIG.TARGET_BATCH_SIZE,
                success: false, 
                error: (res.reason || { message: 'Unknown Error' }).message 
            });
        }
    });

    // Calculate total TPS based on the overall duration
    const finalTotalTxs = successfulResults.reduce((sum, r) => sum + r.batchSize, 0);
    const overallTPS = finalTotalTxs / overallDuration;
    
    return {
        overallTPS,
        finalTotalTxs,
        successfulCount: successfulResults.length,
        failedCount: failedResults.length,
        overallDuration
    };
}


// ====================================================================
// Main Execution
// ====================================================================

async function main() {
  const SEED_PHRASE = process.env.SEED_PHRASE;
  
  if (!SEED_PHRASE) {
    console.error('❌ Please set the SEED_PHRASE environment variable.');
    console.error('   Example: export SEED_PHRASE="your seed phrase here"');
    process.exit(1);
  }
  
  console.log('🚀 Starting Polkadot Asset Hub Parallel TPS Benchmark...');
  console.log('📈 Strategy: Max-pressure, minimal payload, Parachain target.\n');
  console.log('⏰ Start time:', new Date().toLocaleString());
  
  console.log('\n📡 Step 1: Connecting to API...');
  
  // NOTE: This call now handles retries and timeouts
  let api;
  try {
      api = await createApi();
  } catch (e) {
      console.error('\n💥 Fatal error: Could not connect to any RPC endpoint.');
      console.error(e.message);
      process.exit(1);
  }
  
  console.log('\n🔑 Step 2: Setting up account...');
  const keyring = new Keyring({ type: 'sr25519' });
  
  let account;
  try {
    account = keyring.addFromUri(SEED_PHRASE);
  } catch (e) {
    console.error('❌ Failed to create account from SEED_PHRASE:', e.message || e);
    await api.disconnect();
    process.exit(1);
  }
  
  console.log('Using account:', account.address);
  
  console.log('\n💰 Step 3: Checking account balance and nonce...');
  const accInfo = await api.query.system.account(account.address);
  const decimals = api.registry.chainDecimals[0];
  const free = accInfo.data.free.toBn().div(new BN(10).pow(new BN(decimals))).toNumber();
  const initialNonce = accInfo.nonce.toBn();
  
  console.log('Free balance:', free.toFixed(4), api.registry.chainTokens[0]);
  console.log('Initial Nonce:', initialNonce.toString());

  if (free < 1) { 
    console.error('❌ Insufficient balance. You need test tokens for fees.');
    await api.disconnect();
    process.exit(1);
  }
  
  console.log(`\n📋 Benchmark Configuration:`);
  console.log(`   Target Chain: Asset Hub (Polkadot)`);
  console.log(`   Individual Batch Size: ${CONFIG.TARGET_BATCH_SIZE} transactions`);
  console.log(`   Parallel Attempts: ${CONFIG.NUM_PARALLEL_ATTEMPTS}`);
  console.log(`   Total Transactions to submit: ${CONFIG.TARGET_BATCH_SIZE * CONFIG.NUM_PARALLEL_ATTEMPTS}`);
  console.log(`   Payload Size: ${MINIMAL_PAYLOAD.length} byte(s) per transaction (minimal)`);
  console.log(`   Submission Delay: ${CONFIG.SUBMISSION_DELAY_MS}ms (MAX pressure)`);
  console.log(`   Start Nonce: ${initialNonce.toString()}\n`);
  
  console.log('=' .repeat(80));
  console.log('🏁 Starting parallel submission...\n');
  
  try {
    // Run the parallel submission
    const stats = await submitParallelBatches(api, account, initialNonce);
    
    // --- Final Results Report ---
    console.log('\n' + '='.repeat(80));
    console.log('📈 FINAL PARALLEL TPS BENCHMARK RESULTS');
    console.log('='.repeat(80));
    
    console.log(`\n📊 Summary:`);
    console.log(`   Submitted batches: ${CONFIG.NUM_PARALLEL_ATTEMPTS}`);
    console.log(`   Successful batches: ${stats.successfulCount}`);
    console.log(`   Failed batches: ${stats.failedCount}`);
    
    console.log(`\n⏱️  Duration: ${stats.overallDuration.toFixed(2)}s`);
    console.log(`   Total transactions processed: ${stats.finalTotalTxs}`);
    
    console.log(`\n🏆 FINAL ACHIEVED TPS: ${stats.overallTPS.toFixed(2)}`);
    console.log(`   (Transactions / Overall Time)`);
    console.log('\n💡 NOTE: This measures a single Parachain\'s capacity.');
    console.log('   Polkadot\'s highest claimed TPS is the aggregate of all Parachain cores.');
    
    console.log('='.repeat(80));

  } catch (e) {
    console.error('\n💥 Fatal error during benchmark run:', e.message);
  }
  
  console.log('\n🔌 Disconnecting from API...');
  if (api) {
      await api.disconnect();
  }
  console.log('✅ Connection closed. Goodbye!');
  process.exit(0);
}

main().catch((e) => {
  console.error('💥 Script execution failed:', e);
  process.exit(1);
});