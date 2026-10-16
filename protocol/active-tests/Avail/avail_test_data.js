// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Chainscore Labs
import * as dotenv from 'dotenv';
import { Account, SDK, Pallets } from 'avail-js-sdk';
 
dotenv.config();
 
export async function submitData() {
 
    // Initialize the SDK with a public Turing testnet endpoint
    const sdk = await SDK.New('wss://turing-rpc.avail.so/ws');
    
    const seed = process.env.SEED;
    if (!seed) {
      throw new Error("SEED environment variable is not set");
    }
    
    // Create account from seed
    const account = Account.new(seed);
    console.log("Account Address: ", account.address);
 
    // AppID
    const appId = 463;
    console.log(`Submitting data to App Id: ${appId}`);
 
    // Create data submission transaction
    const data = "DATA TO BE SUBMITTED";
    const tx = sdk.tx.dataAvailability.submitData(data);
    console.log("Submitting transaction with data...");
    
    // Execute and wait for inclusion with app_id
    const res = await tx.executeWaitForInclusion(account, { app_id: appId });
    
    // Check if transaction was successful
    const isOk = res.isSuccessful();
    if (isOk === undefined) {
      throw new Error("Cannot check if transaction was successful");
    }
    else if (!isOk) {
        throw new Error("Transaction failed");
    }
 
    // Extract event data
    if (res.events === undefined) throw new Error("No events found");
 
    // Transaction Details
    console.log(
      `Block Hash: ${res.blockHash}, Block Number: ${res.blockNumber}, Tx Hash: ${res.txHash}, Tx Index: ${res.txIndex}`
    );
 
    // Find DataSubmitted event
    const event = res.events.findFirst(Pallets.DataAvailabilityEvents.DataSubmitted);
    if (event === undefined) throw new Error("DataSubmitted event not found");
    
    console.log(`Data submitted successfully:`);
    console.log(`Who: ${event.who}`);
    console.log(`DataHash: ${event.dataHash}`);
    
    console.log("Data submission completed successfully");
    process.exit(0);
 
}
submitData()