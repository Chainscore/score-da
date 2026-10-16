// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
// estimate_fee_remark.js
const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const BN = require('bn.js');

async function createApi() {
  // Using Paseo
  const WS = 'wss://paseo-rpc.dwellir.com';
  const provider = new WsProvider(WS);
  const api = await ApiPromise.create({ provider });

  const chain = await api.rpc.system.chain();
  const spec = await api.rpc.state.getRuntimeVersion();

  //check chain connected.
  console.log('Connected to chain:', chain.toString(), 'specName:', spec.specName.toString());
  return api;
}



async function main() {
  const SEED_PHRASE = process.env.SEED_PHRASE ;
  
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

  // build remark
  const text =  "DA-test";
  const hex = '0x' + Buffer.from(text).toString('hex');

  let tx;


  if (process.argv.includes('--preimage')) {
    console.log('Using preimage to submit data:', text);
    tx = api.tx.preimage.notePreimage(text);
  } else {
    console.log('Using remark to submit data:', text);
  // build preimage
  // refer https://polkadot.js.org/docs/polkadot/extrinsics/
  // is storage a good option ?? https://polkadot.js.org/docs/polkadot/storage

    tx = api.tx.system.remark(hex);
  }


  // estimate fee

  if (!process.argv.includes('--fees')) {
    console.log('Not sending. Rerun with tags --send --fees to estimate fees or submit remark.');
    await api.disconnect();
    process.exit(0);
  }
  const info = await tx.paymentInfo(account);

  // partialFee is the actual txn fee
  console.log('Estimated fee (partialFee):', info.partialFee.toString());

  // check balance
  const accInfo = await api.query.system.account(account.address);
  const free = (accInfo.data.free)/ Math.pow(10, api.registry.chainDecimals[0]);
  console.log('Free balance:', free);

  // existential deposit - fees needed just for the wallet to be valid 
  // refer the below docs https://polkadot.js.org/docs/api/cookbook/tx#how-do-i-estimate-the-transaction-fees

  
  const ED = api.consts.balances?.existentialDeposit ?? api.createType('Balance', 0);
  console.log('Existential Deposit (ED):', ED.toNumber()/Math.pow(10, api.registry.chainDecimals[0]));
  const required = new BN(info.partialFee.toString()).add(new BN(ED.toString()));
  console.log('Required funds (fee + existential deposit):', required.toNumber()/Math.pow(10, api.registry.chainDecimals[0]));
  console.log('txn cost', (required.toNumber() - ED.toNumber())/Math.pow(10, api.registry.chainDecimals[0]));
  if (!process.argv.includes('--send')) {
    console.log('Not sending. Rerun with --send to submit.');
    await api.disconnect();
    process.exit(0);
  }

  console.log('Sending transaction...');

  try {
    // Promise wrapper to wait until finalized or error
    const resultFinal = await new Promise((resolve, reject) => {
      let unsubCalled = false;
      let timeout = null;

      // signing and sending the transaction
      tx.signAndSend(account, { nonce: -1 }, async (result) => {
        // handle timeout
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          if (!unsubCalled) {
            console.warn('No final event received within timeout (60s). Resolving anyway.');
            resolve({ status: 'timeout' });
          }
        }, 60000); // 60s

        try {
          console.log('Status:', result.status.type);

          if (result.txHash) {
            console.log('TxHash:', result.txHash.toHex());
          }

          if (result.status.isInBlock) {
            console.log('Included in block:', result.status.asInBlock.toHex());
            // print events
            const blockHash = result.status.asInBlock;
            const signedBlock = await api.rpc.chain.getBlock(blockHash);
            const allEvents = await api.query.system.events.at(blockHash);
            console.log(`Events for block ${blockHash.toHex()}:`);
            allEvents.forEach((record) => {
              const { event, phase } = record;
              console.log(`  ${event.section}.${event.method}:: phase=${phase.toString()} data=${event.data.map(d => d.toString()).join(', ')}`);
            });
          }

          if (result.dispatchError) {
            // decode module error
            if (result.dispatchError.isModule) {
              const decoded = api.registry.findMetaError(result.dispatchError.asModule);
              const { docs, method, section } = decoded;
              console.error(`DispatchError: ${section}.${method} - ${docs.join(' ')}`);
            } else {
              console.error('DispatchError:', result.dispatchError.toString());
            }
            // reject(new Error('DispatchError: ' + result.dispatchError.toString()));
          }

          if (result.status.isFinalized) {
            console.log('Finalized at blockHash:', result.status.asFinalized.toHex());
            if (!unsubCalled && typeof unsub === 'function') {
              // unsub will be set in outer scope after signAndSend returns, but we cannot access it reliably here.
            }
            unsubCalled = true; // note for timeout
            clearTimeout(timeout);
            resolve({ status: 'finalized', blockHash: result.status.asFinalized.toHex() });
          }
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      }).then((unsub) => {
        // signAndSend returned; we capture unsubscribe function in the closure in case we want to call it later
        // But we don't auto-unsubscribe here; the callback will resolve/cleanup on finalized.
      }).catch((err) => {
        reject(err);
      });
    });

    console.log('Transaction result:', resultFinal);
  } catch (err) {
    console.error('Error while sending transaction:', err);
  } finally {
    // explicit short delay to ensure logs flushed
    await new Promise((r) => setTimeout(r, 500));
    await api.disconnect();
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
