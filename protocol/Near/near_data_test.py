
import asyncio
import base64
import os

from py_near.account import Account
from py_near.exceptions import RpcException
from py_near.providers import JsonProvider
from py_near.signer import KeyPair

# TODO: Replace with the actual contract ID and method names.
NEAR_DA_CONTRACT_ID = os.getenv("NEAR_DA_CONTRACT_ID", "data_availability.testnet")
SUBMIT_METHOD_NAME = os.getenv("NEAR_DA_SUBMIT_METHOD", "submit_blob")
RETRIEVE_METHOD_NAME = os.getenv("NEAR_DA_RETRIEVE_METHOD", "get_blob")

async def submit_near_da_blob(
    account_id: str,
    private_key: str,
    blob_data: bytes,
    network_id: str = "testnet",
):
    """
    Submits a blob to the NEAR DA Blob Store Contract.

    Args:
        account_id: The NEAR account ID of the sender.
        private_key: The private key of the sender's account.
        blob_data: The raw bytes of the data blob to submit.
        network_id: The NEAR network to connect to ("mainnet", "testnet", etc.).
    """

    if network_id == "mainnet":
        rpc_url = "https://rpc.mainnet.near.org"
    elif network_id == "testnet":
        rpc_url = "https://rpc.testnet.near.org"
    else:
        raise ValueError(f"Unsupported network_id: {network_id}")

    provider = JsonProvider(rpc_url)
    signer = KeyPair(private_key)
    account = Account(provider, account_id, signer)

    encoded_blob_data = base64.b64encode(blob_data).decode('utf-8')

    args = {
        "data": encoded_blob_data,
    }

    print(f"Submitting blob to contract '{NEAR_DA_CONTRACT_ID}' method '{SUBMIT_METHOD_NAME}'...")

    try:
        result = await account.function_call(
            contract_id=NEAR_DA_CONTRACT_ID,
            method_name=SUBMIT_METHOD_NAME,
            args=args,
        )
        print("Blob submission successful!")
        print(f"Transaction Hash: {result.transaction.hash}")
        return result.transaction.hash
    except RpcException as e:
        print(f"Error submitting blob: {e}")
        return None

async def retrieve_near_da_blob(
    transaction_hash: str,
    network_id: str = "testnet",
):
    """
    Retrieves a blob from the NEAR DA Blob Store Contract.

    Args:
        transaction_hash: The transaction hash of the blob submission.
        network_id: The NEAR network to connect to ("mainnet", "testnet", etc.).
    """

    if network_id == "mainnet":
        rpc_url = "https://rpc.mainnet.near.org"
    elif network_id == "testnet":
        rpc_url = "https://rpc.testnet.near.org"
    else:
        raise ValueError(f"Unsupported network_id: {network_id}")

    provider = JsonProvider(rpc_url)

    print(f"Retrieving blob with transaction hash: {transaction_hash}...")

    try:
        # The logic to retrieve the blob will depend on how the contract stores and exposes the data.
        tx_result = await provider.get_tx_status(transaction_hash, "sender.testnet") # sender_id is required but not used for this
        
        # Assuming the blob data is returned in the transaction result
        if 'receipts_outcome' in tx_result:
            for outcome in tx_result['receipts_outcome']:
                if 'outcome' in outcome and 'logs' in outcome['outcome'] and outcome['outcome']['logs']:
                    for log in outcome['outcome']['logs']:
                        # Look for a log that contains the blob data
                        if log.startswith("blob_data:"):
                            encoded_blob_data = log.split(":")[1]
                            decoded_blob = base64.b64decode(encoded_blob_data)
                            print("Blob retrieval successful!")
                            return decoded_blob

        print("Could not find blob data in transaction result.")
        return None

    except RpcException as e:
        print(f"Error retrieving blob: {e}")
        return None


if __name__ == "__main__":
    # Use environment variables.
    SENDER_ACCOUNT_ID = os.getenv("NEAR_ACCOUNT_ID", "SENDER_ACCOUNT.testnet")
    SENDER_PRIVATE_KEY = os.getenv("NEAR_PRIVATE_KEY", "ed25519:PRIVATE_KEY_HERE")

    my_blob_data = b"This is a test blob for NEAR DA"

    async def main():
        tx_hash = await submit_near_da_blob(
            account_id=SENDER_ACCOUNT_ID,
            private_key=SENDER_PRIVATE_KEY,
            blob_data=my_blob_data,
        )

        if tx_hash:
            retrieved_blob = await retrieve_near_da_blob(tx_hash)
            if retrieved_blob:
                print(f"Retrieved blob: {retrieved_blob.decode()}")
                assert my_blob_data == retrieved_blob

    asyncio.run(main())
