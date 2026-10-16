// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
require('dotenv').config();
const pLimit = require('p-limit');
const bs58 = require('bs58');
const { connect, keyStores, transactions, utils } = require('near-api-js');
const { functionCall } = transactions;

const RPC = process.env.NEAR_RPC || 'https://rpc.testnet.fastnear.com';
const SENDER_IDS = (process.env.NEAR_SENDER_IDS || process.env.NEAR_ACCOUNT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const SENDER_KEYS = (process.env.NEAR_SENDER_KEYS || process.env.NEAR_PRIVATE_KEY || '').split(',').map(s => s.trim()).filter(Boolean);
const CONTRACT = process.env.NEAR_CONTRACT_ID || (SENDER_IDS[0] || '');
const DURATION_MS = parseInt(process.env.DURATION_MS || '1000', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '400', 10);
const ACTIONS_PER_TX = parseInt(process.env.ACTIONS_PER_TX || '1', 10);
const GAS = BigInt(process.env.GAS || '30000000000000'); // BigInt
const METHOD = process.env.METHOD || 'submit_data';

if (SENDER_IDS.length === 0 || SENDER_KEYS.length === 0) {
  console.error('Set NEAR_SENDER_IDS and NEAR_SENDER_KEYS (or NEAR_ACCOUNT_ID / NEAR_PRIVATE_KEY) in .env (comma-separated lists).');
  process.exit(1);
}
if (SENDER_IDS.length !== SENDER_KEYS.length) {
  console.error('NEAR_SENDER_IDS and NEAR_SENDER_KEYS must have the same number of entries (or supply one sender/key).');
  process.exit(1);
}

async function buildAccounts() {
  const accounts = [];
  for (let i = 0; i < SENDER_IDS.length; i++) {
    const id = SENDER_IDS[i];
    const keyStr = SENDER_KEYS[i];

    const keyStore = new keyStores.InMemoryKeyStore();
    let keyPair;
    try {
      keyPair = utils.KeyPair.fromString(keyStr);
    } catch (err) {
      console.error('Invalid key format for sender', id, err);
      process.exit(1);
    }
    await keyStore.setKey('testnet', id, keyPair);

    const near = await connect({
      networkId: 'testnet',
      nodeUrl: RPC,
      deps: { keyStore },
    });

    const acc = await near.account(id);
    accounts.push({ id, acc, keyPair });
  }
  return accounts;
}

/**
 * Build, sign and return base64(signed_tx) using low-level transactions helpers.
 * Uses view_access_key to fetch nonce, status to fetch recent block hash.
 */
async function signTxToBase64(accountObj, receiverId, actions) {
  const provider = accountObj.acc.connection.provider;
  const publicKeyStr = accountObj.keyPair.getPublicKey().toString(); // e.g. 'ed25519:...'

  // get access key nonce
  const keyView = await provider.query({
    request_type: "view_access_key",
    account_id: accountObj.id,
    public_key: publicKeyStr,
  });

  if (typeof keyView.nonce !== 'number' && typeof keyView.nonce !== 'bigint') {
    throw new Error('Unexpected view_access_key response: ' + JSON.stringify(keyView));
  }
  const nonce = Number(keyView.nonce) + 1;

  // get recent block hash (base58 -> bytes)
  const status = await provider.sendJsonRpc('status', []);
  const latestBlockHashBase58 = status?.sync_info?.latest_block_hash;
  if (!latestBlockHashBase58) throw new Error('Failed to get latest_block_hash from status RPC');
  const recentBlockHash = bs58.decode(latestBlockHashBase58);

  // create transaction
  const tx = transactions.createTransaction(
    accountObj.id,
    accountObj.keyPair.getPublicKey(),
    receiverId,
    nonce,
    actions,
    recentBlockHash
  );

  // sign transaction with keyPair
  const signed = transactions.signTransaction(tx, accountObj.keyPair);

  // signed can have multiple shapes depending on near-api-js version:
  // - [signedTx, serializedTxBuffer]
  // - { signedTransaction: SignedTransaction, signature, transaction }
  // - SignedTransaction directly
  let serialized;
  if (Array.isArray(signed) && signed.length > 1 && signed[1]) {
    serialized = Buffer.from(signed[1]);
  } else if (signed && signed.signedTransaction && typeof signed.signedTransaction.encode === 'function') {
    const enc = signed.signedTransaction.encode();
    serialized = Buffer.from(enc instanceof Uint8Array ? enc : enc);
  } else if (signed && typeof signed.encode === 'function') {
    const enc = signed.encode();
    serialized = Buffer.from(enc instanceof Uint8Array ? enc : enc);
  } else {
    // fallback: try to JSON inspect for debugging
    throw new Error('Unexpected signTransaction return shape. Please console.log(signed) to inspect it.');
  }

  return serialized.toString('base64');
}

async function main() {
  console.log('Building accounts and keystores...');
  const accounts = await buildAccounts();
  console.log(`Loaded ${accounts.length} senders. RPC: ${RPC}`);

  // build actions array (ACTIONS_PER_TX actions per tx)
  const actions = [];
  for (let i = 0; i < ACTIONS_PER_TX; i++) {
    actions.push(functionCall(METHOD, Buffer.from(JSON.stringify({ data: 'tps-test' })), GAS, 0n));
  }

  const limiter = pLimit(CONCURRENCY);
  let sendCount = 0;
  let acceptedCount = 0;
  let failedCount = 0;
  const latencies = [];

  let rr = 0;
  const startTime = Date.now();
  const endTime = startTime + DURATION_MS;
  const tasks = [];

  console.log(`Starting blast for ${DURATION_MS}ms, concurrency ${CONCURRENCY}, senders ${accounts.length}...`);
  while (Date.now() < endTime) {
    const accObj = accounts[rr % accounts.length];
    rr++;

    const t = limiter(async () => {
      const sendStart = Date.now();
      sendCount++;
      try {
        // sign
        const b64 = await signTxToBase64(accObj, CONTRACT, actions);
        // broadcast async
        const provider = accObj.acc.connection.provider;
        await provider.sendJsonRpc('broadcast_tx_async', [b64]);
        acceptedCount++;
        latencies.push(Date.now() - sendStart);
        return { ok: true };
      } catch (err) {
        failedCount++;
        latencies.push(Date.now() - sendStart);
        // keep error string small
        return { ok: false, err: (err && err.message) ? err.message : String(err) };
      }
    }).catch(err => {
      failedCount++;
      return { ok: false, err: (err && err.message) ? err.message : String(err) };
    });

    tasks.push(t);
    // spin without awaiting, p-limit controls concurrency
  }

  // Wait for inflight sends (they may finish after window)
  console.log('Finished launching - waiting for inflight RPC responses to return...');
  await Promise.all(tasks);

  const totalTime = Date.now() - startTime;
  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  console.log('=== RESULTS ===');
  console.log('Window ms:', totalTime);
  console.log('Send attempts launched:', sendCount);
  console.log('Accepted for broadcast:', acceptedCount);
  console.log('Failed broadcasts:', failedCount);
  console.log('Approx accepted TPS:', (acceptedCount / (totalTime / 1000)).toFixed(2));
  console.log('Avg sign+broadcast latency (ms):', avgLatency.toFixed(1));

  const fs = require('fs');
  const out = {
    timestamp: new Date().toISOString(),
    rpc: RPC,
    senders: SENDER_IDS.length,
    launched: sendCount,
    accepted: acceptedCount,
    failed: failedCount,
    window_ms: totalTime,
    avg_ms: avgLatency,
  };
  fs.writeFileSync('tps_blast_summary.json', JSON.stringify(out, null, 2));
  console.log('Wrote tps_blast_summary.json');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err && err.message ? err.message : err);
  process.exit(1);
});
