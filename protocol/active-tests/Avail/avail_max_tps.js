// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
// submit_big_blob.js
import * as dotenv from "dotenv";
import { Account, SDK } from "avail-js-sdk";
dotenv.config();

const RPC = process.env.RPC ?? "wss://turing-rpc.avail.so/ws";
const SEED = process.env.SEED_PHRASE || process.env.SEED;
if (!SEED) throw new Error("SEED not set");

const BLOB_COUNT = parseInt(process.env.BLOB_COUNT ?? "5", 10); // how many big blobs to send
const N_LOGICAL_TX_PER_BLOB = parseInt(process.env.N_LOGICAL_TX_PER_BLOB ?? "500", 10);
const PAYLOAD_SIZE = parseInt(process.env.PAYLOAD_SIZE ?? "256", 10); // bytes per logical tx
const APP_ID = parseInt(process.env.APP_ID ?? "463", 10);
const WAIT_BETWEEN_MS = parseInt(process.env.WAIT_BETWEEN_MS ?? "200", 10); // ms between blob submissions

function mkLogicalPayload(i) {
  const base = `tx-${i}-${Date.now()}-`;
  let s = base;
  while (Buffer.byteLength(s, "utf8") < PAYLOAD_SIZE) s += base;
  return s.slice(0, PAYLOAD_SIZE);
}

function buildBatchBlob(startIndex, count) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      id: startIndex + i,
      from: null,
      to: `recv_${(startIndex + i) % 1000}`,
      data: mkLogicalPayload(startIndex + i),
    });
  }
  return Buffer.from(JSON.stringify(arr), "utf8").toString("base64");
}

async function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function main(){
  console.log("Connecting SDK to", RPC);
  const sdk = await SDK.New(RPC);
  const account = Account.new(SEED);
  console.log("Using account", account.address);
  let nextIdx = 0;

  for (let b = 0; b < BLOB_COUNT; b++){
    const payloadB64 = buildBatchBlob(nextIdx, N_LOGICAL_TX_PER_BLOB);
    nextIdx += N_LOGICAL_TX_PER_BLOB;
    console.log(`Submitting blob #${b} containing ${N_LOGICAL_TX_PER_BLOB} logical txs (~${Buffer.byteLength(Buffer.from(payloadB64,'base64'))} bytes)`);
    try {
      const tx = sdk.tx.dataAvailability.submitData(payloadB64);
      const start = Date.now();
      const res = await tx.executeWaitForInclusion(account, { app_id: APP_ID });
      const lat = Date.now() - start;
      console.log(`Blob #${b} included: txHash=${res.txHash} block=${res.blockNumber} latency=${lat}ms`);
    } catch (err) {
      console.error(`Blob #${b} FAILED:`, err.toString ? err.toString() : err);
      // if rejected (weight, kzg, or validate), reduce N_LOGICAL_TX_PER_BLOB or PAYLOAD_SIZE
      break;
    }
    await sleep(WAIT_BETWEEN_MS);
  }

  try { if (sdk.api && sdk.api.disconnect) await sdk.api.disconnect(); } catch(e){}
  console.log("Done");
  process.exit(0);
}

main().catch(e=>{ console.error("fatal:", e); process.exit(1); });
