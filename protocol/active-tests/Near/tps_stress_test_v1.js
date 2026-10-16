// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
// npm install near-api-js
const { connect, keyStores, transactions, utils } = require('near-api-js');
const { functionCall } = transactions;
require('dotenv').config();

const NETWORK_ID = 'testnet';
const RPC_URL = process.env.NEAR_RPC || 'https://rpc.testnet.near.org';
const CONTRACT_ID = process.env.NEAR_CONTRACT_ID;
const SENDER_ID = process.env.NEAR_ACCOUNT_ID;
const SENDER_KEY = process.env.NEAR_PRIVATE_KEY; // use a proper KeyStore in production

async function main() {
  // Minimal in-memory keystore for demo. Use a secure keystore in prod.
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(NETWORK_ID, SENDER_ID, utils.KeyPair.fromString(SENDER_KEY));

  const connection = await connect({
    networkId: NETWORK_ID,
    nodeUrl: RPC_URL,
    deps: { keyStore },
  });

  const account = await connection.account(SENDER_ID);

  // build 50 actions
  const actions = [];
  const GAS_PER_CALL = '20000000000000'; // 20 TGas per call (example — tune)
  for (let i = 0; i < 50; i++) {
    const payload = { data: `payload #${i+1}` };
    actions.push(functionCall(
      'submit_data',
      Buffer.from(JSON.stringify(payload)),
      BigInt(GAS_PER_CALL),
      BigInt(0) // attached deposit in yoctoNEAR if needed
    ));
  }

  // sign & send a single transaction with 50 actions
  console.log('Sending one transaction containing', actions.length, 'functionCall actions...');
  const result = await account.signAndSendTransaction({
    receiverId: CONTRACT_ID,
    actions,
  });

  console.log('Transaction sent. Tx hash:', result.transaction.hash);
  console.log('Status:', result.status);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
