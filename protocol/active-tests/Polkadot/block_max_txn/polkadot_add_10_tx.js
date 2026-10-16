// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
//Uses utility.batch.
const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const BN = require('bn.js');

async function createApi() {
  // Using Paseo
  const WS = 'wss://pas-rpc.stakeworld.io';
  const provider = new WsProvider(WS);
  const api = await ApiPromise.create({ provider });

  const chain = await api.rpc.system.chain();
  const spec = await api.rpc.state.getRuntimeVersion();

  //check chain connected.
  console.log('Connected to chain:', chain.toString(), 'specName:', spec.specName.toString());
  return api;
}

async function main() {
  const SEED_PHRASE = process.env.SEED_PHRASE;

  if (!SEED_PHRASE) {
    console.error('Please set the SEED_PHRASE environment variable.');
    process.exit(1);
  }

  const api = await createApi();
  const keyring = new Keyring({ type: 'sr25519' });
  let account;
  try {
    account = keyring.addFromUri(SEED_PHRASE);
  } catch (e) {
    console.error('Failed to create account from SEED_PHRASE:', e.message || e);
    await api.disconnect();
    process.exit(1);
  }
  console.log('Using account:', account.address);

  const accInfo = await api.query.system.account(account.address);
  const free = (accInfo.data.free) / Math.pow(10, api.registry.chainDecimals[0]);
  console.log('Free balance:', free);

  const transactions = [];
  for (let i = 0; i < 10; i++) {
    const text = `DA-test-${i}`;
    const hex = '0x' + Buffer.from(text).toString('hex');
    const tx = api.tx.system.remark(hex);
    transactions.push(tx);
  }

  console.log('Sending transactions as one batch...');

  // Build a single batch extrinsic (use batchAll if you prefer atomic)
  const batchTx = api.tx.utility.batch(transactions); // or batchAll

  // Sign and send the batch, wait for finalization with timeout
  try {
    const batchResult = await new Promise((resolve, reject) => {
      let unsub = null;
      const timer = setTimeout(() => {
        if (unsub) unsub();
        reject(new Error('Batch transaction timeout (60s)'));
      }, 60000);

      batchTx.signAndSend(account, { nonce: -1 }, (result) => {
        console.log('Batch status:', result.status.type);

        if (result.status.isInBlock) {
          console.log('Batch included at block', result.status.asInBlock.toHex());
        }

        if (result.dispatchError) {
          clearTimeout(timer);
          if (result.dispatchError.isModule) {
            const decoded = api.registry.findMetaError(result.dispatchError.asModule);
            const { docs, name, section } = decoded;
            unsub && unsub();
            reject(new Error(`${section}.${name}: ${docs.join(' ')}`));
          } else {
            unsub && unsub();
            reject(new Error(result.dispatchError.toString()));
          }
          return;
        }

        if (result.status.isFinalized) {
          clearTimeout(timer);
          console.log('Batch finalized at', result.status.asFinalized.toHex());
          unsub && unsub();
          resolve(result.status.asFinalized.toHex());
        }
      }).then((_unsub) => { unsub = _unsub; }).catch(err => {
        clearTimeout(timer);
        reject(err);
      });
    });

    console.log('Batch transaction result:', batchResult);
  } catch (err) {
    console.error('Batch failed:', err);
  }

  await api.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
