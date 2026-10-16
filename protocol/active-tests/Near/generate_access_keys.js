// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
// generate_access_keys.js
require('dotenv').config();
const fs = require('fs');
const { connect, keyStores, utils } = require('near-api-js');

const RPC = process.env.NEAR_RPC || 'https://rpc.testnet.near.org';
const ACCOUNT_ID = process.env.NEAR_ACCOUNT_ID;
const PRIVATE_KEY = process.env.NEAR_PRIVATE_KEY;
const NUM_KEYS = parseInt(process.env.NUM_KEYS || '100', 10);
const OUTPUT = process.env.OUTPUT_FILE || 'generated_keys.json';

if (!ACCOUNT_ID || !PRIVATE_KEY) {
  console.error('Set FUNDING_ACCOUNT_ID and FUNDING_ACCOUNT_KEY in .env');
  process.exit(1);
}

async function main() {
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = utils.KeyPair.fromString(PRIVATE_KEY);
  await keyStore.setKey('testnet', ACCOUNT_ID, keyPair);

  const near = await connect({
    networkId: 'testnet',
    nodeUrl: RPC,
    deps: { keyStore },
  });

  const account = await near.account(ACCOUNT_ID);

  console.log(`Creating ${NUM_KEYS} full-access keys for account ${ACCOUNT_ID} (RPC: ${RPC})`);
  const result = [];
  for (let i = 0; i < NUM_KEYS; i++) {
    // create a new keypair
    const kp = utils.KeyPair.fromRandom('ed25519');
    const pub = kp.getPublicKey().toString(); // e.g. 'ed25519:...'
    const priv = kp.toString(); // 'ed25519:...'

    try {
      // near-api-js provides account.addKey for convenience in many versions.
      // If your near-api-js version lacks account.addKey, the fallback will use a transaction with addKey action.
      if (typeof account.addKey === 'function') {
        // Add full access key (no contract restriction)
        await account.addKey(pub);
      } else {
        // Fallback: use raw transaction to add full-access key
        const { transactions } = require('near-api-js');
        const accessKey = {
          nonce: 0,
          permission: { access_key: { nonce: 0, permission: 'FullAccess' } } // structure not used directly; using helper below is better
        };
        // If you hit this branch, your near-api-js likely older/newer; recommend updating near-api-js or use near-cli.
        throw new Error('account.addKey not available in this near-api-js version — please update near-api-js or use near-cli to add keys');
      }

      result.push({ public_key: pub, private_key: priv });
      if ((i + 1) % 10 === 0) console.log(`  created ${i + 1}/${NUM_KEYS}`);
    } catch (err) {
      console.error(`Failed to add key #${i + 1}:`, err && err.message ? err.message : err);
      // stop on error to avoid burning balance repeatedly
      break;
    }
  }

  // write keys to file
  fs.writeFileSync(OUTPUT, JSON.stringify({ account: ACCOUNT_ID, keys: result }, null, 2));
  console.log(`Wrote ${result.length} keys to ${OUTPUT}`);
  console.log('Example usage in .env for tps script:');
  if (result.length) {
    // show first 2 example entries
    console.log('NEAR_SENDER_IDS=' + result.slice(0, Math.min(5, result.length)).map((_, idx) => `${ACCOUNT_ID}-${idx}`).join(',') + '  # you can treat each key as an identity');
    console.log('NEAR_SENDER_KEYS=' + result.slice(0, Math.min(5, result.length)).map(k => k.private_key).join(','));
  }
  console.log('IMPORTANT: these keys are full-access. Keep generated_keys.json safe or delete keys you no longer need by removing them from the account.');
}

main().catch(err => {
  console.error('Fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
