// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
// ...existing code...
// #!/usr/bin/env node
// generate_avail_wallets.js
// Node 18+
// npm i @polkadot/keyring @polkadot/util-crypto

import fs from 'fs';
import { mnemonicGenerate } from '@polkadot/util-crypto';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';

const COUNT = Number(process.argv[2] || 5);
const OUT_DIR = process.argv[3] || '.';
const mnemonicFile = `${OUT_DIR}/mnemonics.txt`;
const addressFile = `${OUT_DIR}/addresses.txt`;

async function main() {
  // ensure wasm crypto is initialized before any Keyring/crypto calls
  await cryptoWaitReady();

  const mnemonics = [];
  const addresses = [];
  const keyring = new Keyring({ type: 'sr25519' });

  for (let i = 0; i < COUNT; i++) {
    const mnemonic = mnemonicGenerate(12); // 12-word mnemonic
    const pair = keyring.addFromMnemonic(mnemonic);
    mnemonics.push(mnemonic);
    addresses.push(pair.address);
    console.log(`#${i + 1}\nAddress: ${pair.address}\nMnemonic: ${mnemonic}\n`);
  }

  // write files
  fs.writeFileSync(mnemonicFile, mnemonics.join('\n'), { encoding: 'utf8', flag: 'w' });
  fs.writeFileSync(addressFile, addresses.join('\n'), { encoding: 'utf8', flag: 'w' });

  console.log(`Saved ${COUNT} mnemonics -> ${mnemonicFile}`);
  console.log(`Saved ${COUNT} addresses -> ${addressFile}`);
  console.log('Next: open the faucet (https://faucet.avail.tools) and paste each address to claim test AVAIL (CAPTCHA required).');
}

main().catch(e => { console.error(e); process.exit(1); });
// ...existing code...