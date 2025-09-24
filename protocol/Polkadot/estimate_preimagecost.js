// estimate_preimage_cost.js  (fixed)
const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { blake2AsU8a } = require('@polkadot/util-crypto');
const { u8aToHex } = require('@polkadot/util');

const WS = process.env.WS || 'wss://westend-rpc.polkadot.io';
const MNEMONIC = process.env.MNEMONIC || '//Alice';
const SIZE = parseInt(process.env.SIZE || '1024', 10);

async function main() {
  const api = await ApiPromise.create({ provider: new WsProvider(WS) });
  console.log('Connected to', WS);

  const keyring = new Keyring({ type: 'sr25519' });
  const alice = keyring.addFromUri(MNEMONIC);

  const payload = new Uint8Array(SIZE).fill(0x42);
  const payloadHex = u8aToHex(payload);
  const hash = u8aToHex(blake2AsU8a(payload, 256));

  console.log('Payload bytes:', SIZE);
  console.log('Preimage hash (blake2_256):', hash);

  // find the call
  const callFn = (api.tx.preimage && (api.tx.preimage.notePreimage || api.tx.preimage.note_preimage))
             || (api.tx.Preimage && (api.tx.Preimage.notePreimage || api.tx.Preimage.note_preimage));

  if (!callFn) {
    console.error('Preimage call not found in metadata. Inspect api.tx');
    await api.disconnect();
    return;
  }

  const call = callFn(payloadHex);

  // 1) Try call.paymentInfo (preferred)
  let info = null;
  try {
    info = await call.paymentInfo(alice.address);
    console.log('paymentInfo (call.paymentInfo):', info.toHuman());
  } catch (e) {
    console.warn('call.paymentInfo failed:', e.message || e);
  }

  // 2) Fallback to rpc.payment.queryInfo using unsigned extrinsic hex
  if (!info) {
    try {
      // create unsigned extrinsic hex via api.createType('Extrinsic', call.toHex())
      const txHex = api.createType('Extrinsic', call).toHex();
      const q = await api.rpc.payment.queryInfo(txHex, alice.address);
      info = q;
      console.log('rpc.payment.queryInfo ->', q.toHuman());
    } catch (e) {
      console.warn('rpc.payment.queryInfo failed:', e.message || e);
    }
  }

  // Show estimated fee (partialFee)
  if (info && info.partialFee) {
    console.log('Estimated partialFee (Planck):', info.partialFee.toString());
  } else {
    console.warn('Could not obtain partialFee estimate.');
  }

  // account balances
  const { data: bal } = await api.query.system.account(alice.address);
  console.log('Account free balance (Planck):', bal.free.toString());
  console.log('Account reserved (Planck):', bal.reserved.toString());

  // Try to read deposit constants under api.consts.preimage (many runtimes)
  let depositBase = null;
  let depositPerByte = null;
  try {
    const c = api.consts.preimage || api.consts.Preimage;
    if (c) {
      depositBase = c.baseDeposit || c.depositBase || c.deposit_base || c.deposit_base;
      depositPerByte = c.byteDeposit || c.depositPerByte || c.deposit_per_byte || c.byte_deposit;
    }
  } catch (e) {
    // ignore
  }

  // If not found, scan for likely constants to print guesses
  if (!depositBase || !depositPerByte) {
    console.log('Scanning all consts for likely deposit constants...');
    for (const modName of Object.keys(api.consts)) {
      const mod = api.consts[modName];
      for (const key of Object.keys(mod)) {
        const low = key.toLowerCase();
        if (low.includes('deposit') || low.includes('preimage') || low.includes('byte')) {
          try {
            console.log(`api.consts.${modName}.${key} =`, mod[key].toString());
          } catch (e) { /* ignore */ }
        }
      }
    }
  }

  if (depositBase && depositPerByte) {
    const base = BigInt(depositBase.toString());
    const per = BigInt(depositPerByte.toString());
    const est = base + per * BigInt(SIZE);
    console.log(`Estimated preimage deposit (Planck): ${est.toString()} (base=${base}, perByte=${per})`);
    const est1MB = base + per * BigInt(1024*1024);
    console.log(`Estimated preimage deposit for 1 MB (Planck): ${est1MB.toString()}`);
  } else {
    console.log('No explicit preimage deposit constants found in api.consts; deposit may be handled differently by runtime.');
  }

  // convert Planck -> DOT-like units
  const decimals = (api.registry.chainDecimals && api.registry.chainDecimals[0]) || 12;
  const token = (api.registry.chainTokens && api.registry.chainTokens[0]) || 'UNIT';
  const planckToHuman = (planckStr) => {
    const p = BigInt(planckStr);
    const denom = BigInt(10) ** BigInt(decimals);
    // print as decimal string with fraction (simple)
    const whole = p / denom;
    const frac = p % denom;
    return `${whole.toString()}.${frac.toString().padStart(decimals,'0')} ${token}`;
  };

  if (info && info.partialFee) {
    console.log('Estimated tx fee:', planckToHuman(info.partialFee.toString()));
  }

  // rough total
  try {
    const feePlanck = info && info.partialFee ? BigInt(info.partialFee.toString()) : BigInt(0);
    const depositPlanck = (depositBase && depositPerByte) ? (BigInt(depositBase.toString()) + BigInt(depositPerByte.toString()) * BigInt(SIZE)) : BigInt(0);
    const total = feePlanck + depositPlanck;
    console.log('Rough total (fee + deposit) Planck:', total.toString());
    if (depositPlanck !== BigInt(0)) console.log('=>', planckToHuman(total.toString()));
  } catch (e) { /* ignore */ }

  await api.disconnect();
}

main().catch(console.error);
