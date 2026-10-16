#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import os
from dotenv import load_dotenv

from substrateinterface import SubstrateInterface, Keypair
from substrateinterface.exceptions import SubstrateRequestException

# ----------------- setup -----------------
load_dotenv()
ENDPOINT = os.getenv("ENDPOINT", "wss://turing-rpc.avail.so/ws")
SEED = os.getenv("SEED")
APP_ID = int(os.getenv("APP_ID", "463"))
DATA = os.getenv("DATA", "DATA TO BE SUBMITTED")

if not SEED:
    raise SystemExit("SEED is missing in .env")

substrate = SubstrateInterface(
    url=ENDPOINT,
    ss58_format=42,
    # You can omit preset entirely; leaving it out tends to be safest on non-template chains
    # type_registry_preset="substrate-node-template",
)

# ---- Register ONLY the signed extension (do NOT feed back the whole registry) ----
substrate.runtime_config.update_type_registry({
    "signed_extensions": {
        "CheckAppId": {
            "extrinsic": {"app_id": "Compact<u32>"},
            "additionalSigned": {}
        }
    }
})

# ----------------- account -----------------
kp = Keypair.create_from_mnemonic(SEED)
print("Account:", kp.ss58_address)

# ----------------- compose call -----------------
# Try DataAvailability.submit_data, fall back to System.remark if pallet/call not found
try:
    call = substrate.compose_call(
        call_module="DataAvailability",
        call_function="submit_data",
        call_params={"data": DATA.encode()}
    )
    using_da = True
except Exception as e:
    print("[warn] DataAvailability.submit_data not found, falling back to System.remark:", e)
    call = substrate.compose_call(
        call_module="System",
        call_function="remark",
        call_params={"remark": "0x" + DATA.encode().hex()}
    )
    using_da = False

# ----------------- sign & submit -----------------
nonce = substrate.get_account_nonce(kp.ss58_address)

try:
    # Newer releases (keep this first; if it errors we fall back)
    xt = substrate.create_signed_extrinsic(
        call=call,
        keypair=kp,
        nonce=nonce,
        era={"period": 64},
        tip=0,
        tip_asset_id=APP_ID,
    )
except TypeError:
    # Your installed 1.7.11 wants the old kwarg name:
    xt = substrate.create_signed_extrinsic(
        call=call,
        keypair=kp,
        nonce=nonce,
        era={"period": 64},
        tip=0,
        tip_asset_id=APP_ID,
    )

try:
    receipt = substrate.submit_extrinsic(
        xt,
        wait_for_inclusion=True   # or wait_for_finalization=True
    )
except SubstrateRequestException as e:
    print("RPC error:", e)
    raise

print("Included in block:", receipt.block_hash)
print("Extrinsic hash   :", receipt.extrinsic_hash)
print("Success?         :", getattr(receipt, "is_success", None))

# ----------------- events (optional) -----------------
if receipt.triggered_events:
    for e in receipt.triggered_events:
        mod = e.event_module.name.lower()
        evn = e.event.name.lower()
        if mod == "dataavailability" and evn == "datasubmitted":
            print("DataSubmitted event:", e.params)
else:
    print("No events found (yet).")
