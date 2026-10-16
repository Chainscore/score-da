# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import asyncio
from py_near.account import Account
from dotenv import load_dotenv
import os
import time
from typing import List, Any, Union

# Load environment variables from a .env file
# Ensure your .env file contains:
# NEAR_ACCOUNT_ID="your_account.testnet"
# NEAR_PRIVATE_KEY="ed25519:..."
# NEAR_CONTRACT_ID="your_contract_id.testnet"
load_dotenv()

# --- Configuration ---
ACCOUNT_ID = os.getenv("NEAR_ACCOUNT_ID")
PRIVATE_KEY = os.getenv("NEAR_PRIVATE_KEY")
CONTRACT_ID = os.getenv("NEAR_CONTRACT_ID")

# Note: Using a public RPC might introduce latency that affects the result.
# For high-throughput testing, a self-hosted RPC is recommended.
NETWORK_URL = "https://rpc.testnet.fastnear.com" 

# Number of transactions to attempt
NUM_TRANSACTIONS = 500 

# Maximum number of concurrent network requests to prevent RPC rate-limiting
# Adjust this number (e.g., 20, 50, 100) based on the RPC provider's limits.
MAX_CONCURRENT_TASKS = 50 

# Define the type hint for the result of a single transaction attempt
TxResult = Union[str, Exception]

async def create_transaction_task(account: Account, i: int, semaphore: asyncio.Semaphore) -> TxResult:
    """
    Acquires the semaphore, executes the function call, and releases the semaphore.
    Returns the transaction hash (str) on success, or the Exception object on failure.
    The semaphore controls the flow to prevent overwhelming the RPC.
    """
    # Wait until a slot in the semaphore is available
    async with semaphore:
        sample_data = f"Hello! (tx {i+1})"
        try:
            # Send transaction and don't wait for the final result (nowait=True)
            tx_hash = await account.function_call(
                CONTRACT_ID,
                "submit_data",
                {"data": sample_data},
                nowait=True
            )
            # A successful submission should return a 44-character hash string
            return tx_hash 
        except Exception as e:
            # Print failure for debugging and return the exception object
            # This prevents the 'str' object error from previous attempts
            print(f"Transaction {i+1} failed: {type(e).__name__}: {e}")
            return e


async def send_and_calculate_tps():
    """
    Connects to NEAR network, sends multiple transactions concurrently using a semaphore, 
    and calculates the Transactions Per Second (TPS).
    """
    print(f"Connecting to NEAR network: {NETWORK_URL}")

    # Initialize the Account object
    account = Account(ACCOUNT_ID, PRIVATE_KEY, rpc_addr=NETWORK_URL)
    await account.startup()

    print(f"Account '{ACCOUNT_ID}' loaded.")
    print(f"Preparing to send {NUM_TRANSACTIONS} transactions to '{CONTRACT_ID}'...")

    # Create the semaphore instance to limit concurrency
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_TASKS)
    print(f"Limiting concurrency to {MAX_CONCURRENT_TASKS} simultaneous requests.")
    
    # --- Timing Start ---
    start_time = time.monotonic()

    tasks: List[asyncio.Future] = []
    for i in range(NUM_TRANSACTIONS):
        # Create a task for each transaction
        task = create_transaction_task(account, i, semaphore)
        tasks.append(task)

    try:
        # Run all tasks. Exceptions are handled and returned within create_transaction_task.
        results: List[TxResult] = await asyncio.gather(*tasks)
        
        # --- Timing End ---
        end_time = time.monotonic()
        
        # Calculate Duration and TPS
        duration = end_time - start_time
        
        # Count successful transactions (which are the hash strings)
        # NEAR transaction hashes are 44 characters long and are returned as strings
        successful_tx_count = len([res for res in results if isinstance(res, str) and len(res) == 44])
        failed_tx_count = NUM_TRANSACTIONS - successful_tx_count
        
        if duration > 0:
            tps = successful_tx_count / duration
        else:
            tps = 0.0

        print("\n" + "="*50)
        print("📊 NEAR TPS Calculation Results")
        print(f"Total Transactions Attempted: {NUM_TRANSACTIONS}")
        print(f"✅ Successful Transactions Sent: {successful_tx_count}")
        print(f"❌ Failed Transactions: {failed_tx_count}")
        print(f"⏱️ Total Duration (seconds): {duration:.4f}s")
        print(f"⚡ Calculated TPS (Transactions/Second): **{tps:.2f}**")
        print("="*50)

    except Exception as e:
        print(f"\n❌ A critical error occurred during setup or gathering: {e}")
        
    finally:
        # Clean up the account connection
        await account.shutdown()

if __name__ == "__main__":
    # Ensure you have an event loop running for async operations
    asyncio.run(send_and_calculate_tps())