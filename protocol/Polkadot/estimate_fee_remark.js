// npm i @polkadot/api @polkadot/keyring
const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { u8aToHex } = require('@polkadot/util');

const WS = 'wss://westend-rpc.polkadot.io';

async function main() {
  const provider = new WsProvider(WS);
  const api = await ApiPromise.create({ provider });
  const keyring = new Keyring({ type: 'sr25519' });
  // replace with your test SS58 address or use a test key
  const alice = keyring.addFromUri('//Alice');

  // example payload (1 KB remark) - you can make this match your Python payload
  const payload = new Uint8Array(1024).map(() => Math.floor(Math.random()*256));
  const hex = u8aToHex(payload);

  const tx = api.tx.system.remark(hex);
  const info = await tx.paymentInfo(alice);
  console.log("Weight/partial fee info:", info.toHuman());
  console.log("Suggested partialFee (Planck):", info.partialFee.toString());
  await api.disconnect();
}

main().catch(console.error);
