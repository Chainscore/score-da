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
CONTRACT_ID = os.getenv("NEAR_CONTRACT_ID")
# The network to connect to (testnet or mainnet)
NETWORK_URL = "https://rpc.testnet.near.org"

async def send_single_transaction():
    """
    Connects to NEAR testnet and sends a single transaction to the contract.
    """
    print(f"Connecting to NEAR network: {NETWORK_URL}")

    # Create an Account object
    account = Account(ACCOUNT_ID, PRIVATE_KEY, rpc_addr=NETWORK_URL)
    await account.startup()

    print(f"Account '{ACCOUNT_ID}' loaded.")
    print(f"Calling 'submit_data' on contract '{CONTRACT_ID}'...")

    # Data to submit to the contract
    sample_data = "Hello Web3 Near"

    try:
        # Call the 'submit_data' method on the contract
        # The arguments are passed as a dictionary
        result = await account.function_call(
            CONTRACT_ID,
            "submit_data",
            {"data": sample_data}
        )

        print("Transaction successful!")
        print(f"Transaction Hash: {result.transaction.hash}")
        print(f"Data submitted: '{sample_data}'")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        await account.shutdown()

if __name__ == "__main__":
    # Ensure you have an event loop running for async operations
    asyncio.run(send_single_transaction())
