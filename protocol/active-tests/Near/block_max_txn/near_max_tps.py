# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import asyncio
from py_near.account import Account
from dotenv import load_dotenv
import os

load_dotenv()

# --- Configuration ---
# Replace with your NEAR account ID that has access to the private key
ACCOUNT_ID = os.getenv("NEAR_ACCOUNT_ID")
# Replace with your private key for the above account ID
# WARNING: Do not hardcode private keys in production applications.
# Use environment variables or a secure key management system.
PRIVATE_KEY = os.getenv("NEAR_PRIVATE_KEY")
# The contract ID you want to interact with
CONTRACT_ID = os.getenv("NEAR_CONTRACT_ID")# The network to connect to (testnet or mainnet)
NETWORK_URL = "https://near-testnet.gateway.tatum.io/"
# Number of transactions to send
NUM_TRANSACTIONS = 1000

async def send_multiple_transactions():
    """
    Connects to NEAR testnet and sends multiple transactions to the contract concurrently.
    """
    print(f"Connecting to NEAR network: {NETWORK_URL}")

    # Create an Account object
    account = Account(ACCOUNT_ID, PRIVATE_KEY, rpc_addr=NETWORK_URL)
    await account.startup()

    print(f"Account '{ACCOUNT_ID}' loaded.")
    print(f"Sending {NUM_TRANSACTIONS} transactions to '{CONTRACT_ID}'...")

    # Create a list of tasks to run concurrently
    tasks = []
    for i in range(NUM_TRANSACTIONS):
        sample_data = f"Hello from Gemini CLI! (tx {i+1})"
        task = account.function_call(
            CONTRACT_ID,
            "submit_data",
            {"data": sample_data},
            nowait=True  # Send transaction and don't wait for the result
        )
        tasks.append(task)

    try:
        # Run all transactions concurrently
        results = await asyncio.gather(*tasks)

        print(f"{NUM_TRANSACTIONS} transactions sent successfully!")
        for i, tx_hash in enumerate(results):
            print(f"  Transaction {i+1}: {tx_hash}")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        await account.shutdown()

if __name__ == "__main__":
    # Ensure you have an event loop running for async operations
    asyncio.run(send_multiple_transactions())
