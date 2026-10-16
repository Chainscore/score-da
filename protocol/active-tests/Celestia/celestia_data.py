# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import requests
import json
from pathlib import Path
import sys
import binascii

# === CONFIG ===
# PublicNode Mocha RPC (community free endpoint). If your provider uses a different path remove /v1/jsonrpc.
RPC_JSONRPC_URL = "https://celestia-mocha-rpc.publicnode.com:443/v1/jsonrpc"

AUTH_TOKEN = None

# Namespace must be 32 hex chars (16 bytes) prefixed by 0x.
#TODO; Replace with your Correct namespace.
NAMESPACE = ""

# Maximum recommended: keep test blobs small (e.g., < 1.8 MiB)
DEFAULT_PAYLOAD_PATH = "small_payload.bin"

# === HELPERS ===
def file_to_hex(path: str) -> str:
    data = Path(path).read_bytes()
    return "0x" + data.hex()

def build_blob_object(namespace_hex: str, data_hex: str) -> dict:
    # Basic blob object: namespace + data.
    # More fields (share_version, commitments) may exist in other APIs.
    return {
        "namespace": namespace_hex,
        "data": data_hex
    }

def rpc_request(method: str, params: list):
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params
    }
    headers = {"Content-Type": "application/json"}
    if AUTH_TOKEN:
        headers["Authorization"] = AUTH_TOKEN
    resp = requests.post(RPC_JSONRPC_URL, json=body, headers=headers, timeout=30)
    # Raise for HTTP errors, but keep JSON body if present for debug
    resp.raise_for_status()
    return resp.json()

# === MAIN ===
def submit_blob(namespace_hex: str, file_path: str):
    if not Path(file_path).exists():
        print("Payload file not found:", file_path)
        return

    data_hex = file_to_hex(file_path)
    blob_obj = build_blob_object(namespace_hex, data_hex)

    # blob.Submit expects an array of blob objects inside params: params = [[blobObj, ...]]
    try:
        print("Submitting blob to RPC:", RPC_JSONRPC_URL)
        result = rpc_request("blob.Submit", [[blob_obj]])
    except requests.HTTPError as e:
        # print HTTP error + response body if available
        print("HTTP error:", e)
        try:
            print("Response body:", e.response.text)
        except Exception:
            pass
        return
    except requests.RequestException as e:
        print("Request failed:", e)
        return

    # Print full RPC response for debugging
    print("RPC response:")
    print(json.dumps(result, indent=2))

    # Typical expect: result or error object; check and print useful parts
    if "error" in result:
        print("RPC returned error:", result["error"])
        print("If you see 'method not found' or 'permission denied' the provider may not allow blob submissions.")
    else:
        print("Submission result:", result.get("result"))

if __name__ == "__main__":
    payload = DEFAULT_PAYLOAD_PATH
    if len(sys.argv) > 1:
        payload = sys.argv[1]
    submit_blob(NAMESPACE, payload)
