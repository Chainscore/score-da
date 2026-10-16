// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
// node list_extrinsics.js
// npm i @polkadot/api
const { ApiPromise, WsProvider } = require('@polkadot/api');

const WS = process.env.WS || 'wss://rpc.polkadot.io'; // change to your node (e.g., JAM testnet RPC)

async function main(){
  const provider = new WsProvider(WS);
  const api = await ApiPromise.create({ provider });
  console.log("Connected to", WS);

  const modules = Object.keys(api.tx);
  for(const m of modules){
    try{
      const calls = Object.keys(api.tx[m]);
      // quick filter: print only modules that look like DA/Elves/Data
      if (/elves|da|data|parachain|paras/i.test(m)){
        console.log(`\n== ${m} ==`);
        for(const c of calls){
          // show arg list
          const meta = api.tx[m][c].meta;
          const args = meta.args.map(a => `${a.name}:${a.type.toString()}`).join(', ');
          console.log(`  - ${c}(${args})`);
        }
      }
    }catch(e){
      // ignore
    }
  }

  // also print any likely methods across all modules
  console.log('\nSearch for common DA method names across all pallets:');
  const keywords = ['submit', 'blob', 'data', 'submitBlob', 'submit_data', 'publish'];
  for(const m of modules){
    for(const c of Object.keys(api.tx[m])){
      if (keywords.some(k => c.toLowerCase().includes(k.toLowerCase()) || m.toLowerCase().includes(k.toLowerCase()))){
        const args = api.tx[m][c].meta.args.map(a => `${a.name}:${a.type.toString()}`).join(', ');
        console.log(`${m}.${c}(${args})`);
      }
    }
  }

  await api.disconnect();
}

main().catch(console.error);
