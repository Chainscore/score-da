// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
// measure_tps.js
// Node 18+
// npm i avail-js-sdk @polkadot/keyring @polkadot/util-crypto p-limit bn.js

import { SDK, Account } from 'avail-js-sdk'; // adjust if your SDK import differs
import pLimit from 'p-limit';
import BN from 'bn.js';
import { randomUUID } from 'crypto';

const SEED = process.env.SEED_PHRASE;
if (!SEED) {
  console.error('Set SEED env var to a test mnemonic: export SEED="..."');
  process.exit(1);
}

const WS = process.env.AVAIL_WS || 'wss://turing-rpc.avail.so/ws';
const APP_ID = Number(process.env.APP_ID || 463);
const TOTAL = Number(process.argv[2] || 20);
const CONCURRENCY = Number(process.argv[3] || 16); // safer default

function makePayload(i) {
  return JSON.stringify({ id: randomUUID(), seq: i, op: 'noop', ts: Date.now() });
}

async function main() {
  console.log('Connecting to SDK WS:', WS);
  const sdk = await SDK.New(WS);
  
  // --- ADD THIS CHECK ---
  // Ensure the underlying API is connected before proceeding
  // The SDK object should expose the Polkadot API object. Assuming it's 'sdk.api'
  if (!sdk.api.isReady) {
      // Wait for the API to connect and initialize
      await sdk.api.isReady;
      console.log('Polkadot API is Ready.');
  } else {
      console.log('Polkadot API was already Ready.');
  }
  // ----------------------

  const account = Account.new(SEED);
  const address = account.address;
  console.log('Account address (SS58):', address);

  // ... rest of your code ... 
  
  // get next nonce (account index) - BN or number depending on SDK
  let baseNonce;
  try {
    const resp = await sdk.api.rpc.system.accountNextIndex(address);
    // ...
    // resp may be a BN-like or number; normalize to BN
    baseNonce = new BN(resp.toString());
  } catch (e) {
    console.error('Failed to fetch accountNextIndex:', e);
    // fallback: try query.system.account -> nonce field
    const acct = await sdk.api.query.system.account(address);
    baseNonce = new BN((acct.nonce || acct.nonce?.toString?.()) || 0);
  }
  console.log('Base nonce:', baseNonce.toString());

  // small tip to avoid equal-priority replacement tie; set to zero if you don't want to pay
  const TIP = process.env.TIP ? new BN(process.env.TIP) : new BN('0'); // units depend on chain denom

  const limit = pLimit(CONCURRENCY);
  const start = Date.now();

  const tasks = [];
  for (let i = 0; i < TOTAL; i++) {
    tasks.push(limit(async () => {
      const data = makePayload(i);
      const nonce = baseNonce.add(new BN(i)); // explicit per-tx nonce
      try {
        // Build tx - change method name if your SDK is different
        const tx = sdk.tx.dataAvailability.submitData(data);
        // Use signAndSend with explicit nonce and tip options.
        // Polkadot-style: tx.signAndSend(account, { nonce: nonce.toString(), tip: TIP.toString(), app_id: APP_ID })
        const res = await tx.signAndSend(account, { nonce: nonce.toString(), tip: TIP.toString(), app_id: APP_ID });
        return { ok: true, res };
      } catch (e) {
        return { ok: false, error: e.message || e };
      }
    }));
  }

  const results = await Promise.all(tasks);
  const elapsed = (Date.now() - start) / 1000;
  const success = results.filter(r => r.ok).length;
  console.log(`Elapsed ${elapsed.toFixed(2)}s → ${(TOTAL/elapsed).toFixed(1)} submits/s`);
  console.log(`Success ${success}/${TOTAL}`);
  console.log('Sample results:', results.slice(0,8));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
