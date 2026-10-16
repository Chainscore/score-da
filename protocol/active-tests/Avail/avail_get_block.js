// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
import { SDK, Block } from "avail-js-sdk";
 
export async function chainGetBlockHeader() {
 
    // Initialize SDK with Turing endpoint
    const sdk = await SDK.New('wss://turing-rpc.avail.so/ws');
 
    // 1. Gets the block header for the latest block if no argument is provided
    // 2. Gets the block header for a specific block if a block hash is provided
    const header = await sdk.client.api.rpc.chain.getHeader("0x75a6c54bb5ea904e47fa151956992d7cf543bc7c936d78488e311db8e10397c1")
    console.log("getBlockHeader")
    console.log(header.toJSON())

     // 2. Gets block header and body for a specific block if a block hash is provided
    const block = await sdk.client.api.rpc.chain.getBlock("0x33fc2a7ae796ee5e1ee0d70ea05adbf96596d84de02e03e6b2049c8918e53f69")
    console.log("getBlock")
    // console.log(block.toJSON())
    
    const txHash = "0xcee6b7f84254dc08b491e446e84d003df88859e9b8931192c519b4a420a50494";
    const blockHash = "0x33fc2a7ae796ee5e1ee0d70ea05adbf96596d84de02e03e6b2049c8918e53f69";
    
    console.log(`Looking up transaction: ${txHash}`);
    console.log(`In block: ${blockHash}`);
 
    
    // Get data submissions for the specified transaction hash
    const block2 = await Block.New(sdk.client, blockHash);
    const blobs = block2.dataSubmissions({ txHash });
 
    console.log(`Found ${blobs.length} data submission(s)`);
    
    // Display information for each data blob
    if (blobs.length === 0) {
        console.log("No data submissions found for this transaction");
    } else {
        console.log("\nData Submission Details:");
        for (const blob of blobs) {
            console.log(`Tx Hash: ${blob.txHash}`);
            console.log(`Tx Index: ${blob.txIndex}`);
            console.log(`Data (ASCII): ${blob.toAscii()}`);
            console.log(`App Id: ${blob.appId}`);
            console.log(`Signer: ${blob.txSigner}`);
            console.log("---");
        }
    }
    
    console.log("Data retrieval completed successfully");
    
    process.exit(0);
}
 
// Execute the function
chainGetBlockHeader()