// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
// submit_preimage_fixed.js
// Usage: WS=wss://westend-rpc.polkadot.io MNEMONIC="//Alice" node submit_preimage_fixed.js
const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { blake2AsU8a } = require('@polkadot/util-crypto');
const { u8aToHex } = require('@polkadot/util'); // <-- fixed import

const WS = process.env.WS || 'wss://westend-rpc.polkadot.io';
const MNEMONIC = process.env.SENDER_SEED || '//Bob';
const SIZE = '10'; // 1 KiB

async function main() {
  const api = await ApiPromise.create({ provider: new WsProvider(WS) });
  console.log('Connected to', WS);

  const keyring = new Keyring({ type: 'sr25519' });
  const acc = keyring.addFromUri(MNEMONIC);

  // payload as Uint8Array
  const payloadU8 = new Uint8Array(SIZE).fill(0x42);

  // compute blake2_256
  const hashU8 = blake2AsU8a(payloadU8, 256);
  const hashHex = u8aToHex(hashU8);
  console.log('Payload size', payloadU8.length, 'bytes');
  console.log('blake2_256 hash:', hashHex);

  // preimage call

  // refer https://polkadot.js.org/docs/polkadot/extrinsics/

  // is storage a good option ?? https://polkadot.js.org/docs/polkadot/storage

  const callFn = api.tx.preimage.notePreimage 

  if (!callFn) {
    console.error('preimage.notePreimage not found in metadata');
    process.exit(1);
  }

  // Send as hex (safe)
  const payloadHex = u8aToHex(payloadU8);

  console.log('Submitting extrinsic...');
  const unsub = await callFn(payloadHex).signAndSend(acc, { nonce: -1 }, (result) => {
    console.log('Status:', result.status.type);
    if (result.status.isInBlock) console.log('Included in', result.status.asInBlock.toHex());
    if (result.status.isFinalized) {
      console.log('Finalized in', result.status.asFinalized.toHex());
      unsub();
    }
  });

  // wait then query storage
  setTimeout(async () => {
    try {
      let stored = null;
      if (api.query.preimage && api.query.preimage.preimageFor) {
        stored = await api.query.preimage.preimageFor(hashU8);
      } else if (api.query.Preimage && api.query.Preimage.preimageFor) {
        stored = await api.query.Preimage.preimageFor(hashU8);
      } else {
        console.warn('api.query.preimage.preimageFor not found; inspect api.query');
        process.exit(0);
      }

      // console.log('Query result raw:', stored?.toString() || stored);

      // print a small hex sample if possible
      if (stored && stored.toHex) {
        console.log('Hex sample:', stored.toHex().slice(0, 200));
      } else if (stored && stored.isSome) {
        const v = stored.unwrap();
        if (v && v.toHex) console.log('Unwrapped hex sample:', v.toHex().slice(0,200));
      }
    } catch (e) {
      console.error('Error querying preimage:', e);
    } finally {
      process.exit(0);
    }
  }, 10_000);
}

main().catch(e => { console.error('Fatal', e); process.exit(1); });
