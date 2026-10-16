// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
require('dotenv').config();
const { connect, keyStores, utils } = require('near-api-js');

const RPC = process.env.NEAR_RPC || 'https://rpc.testnet.near.org';
const ACCOUNT = process.env.FUNDING_ACCOUNT_ID || process.env.NEAR_ACCOUNT_ID;
const FUNDING_KEY = process.env.FUNDING_ACCOUNT_KEY || process.env.NEAR_PRIVATE_KEY;
const NEW_PUB = process.env.NEW_PUBKEY; // ed25519:...
const CONTRACT = process.env.NEAR_CONTRACT_ID; // receiver for function-call access
const METHOD_NAMES = (process.env.METHOD_NAMES || 'submit_data'); // comma-separated

if (!ACCOUNT || !FUNDING_KEY || !NEW_PUB || !CONTRACT) {
  console.error('Set FUNDING_ACCOUNT_ID (or NEAR_ACCOUNT_ID), FUNDING_ACCOUNT_KEY (or NEAR_PRIVATE_KEY), NEW_PUBKEY, and NEAR_CONTRACT_ID in .env');
  process.exit(1);
}

(async () => {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', ACCOUNT, utils.KeyPair.fromString(FUNDING_KEY));
  const near = await connect({ networkId: 'testnet', nodeUrl: RPC, deps: { keyStore } });
  const account = await near.account(ACCOUNT);

  // add function-call access key restricted to CONTRACT and methods
  // near-api-js account.addKey supports (publicKey, contractId, methodNames)
  try {
    await account.addKey(NEW_PUB, CONTRACT, METHOD_NAMES.split(',').map(s => s.trim()));
    console.log('Added function-call key', NEW_PUB, '->', CONTRACT, METHOD_NAMES);
  } catch (err) {
    console.error('Failed to add key:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
