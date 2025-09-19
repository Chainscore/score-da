#!/usr/bin/env python3
"""
Submit 1 KB of data to Westend testnet. Tries a DA/ELVES extrinsic if present,
otherwise falls back to system.remark (testing). Uses a funded Westend test account.

Prereqs:
  pip install substrate-interface websocket-client requests

Set environment variable SENDER_SEED to your test account mnemonic/secret URI:
  export SENDER_SEED="bottom drive obey ..."

Run:
  python put_1kb_westend.py
"""
import os
import sys
import secrets
from decimal import Decimal
from time import sleep

try:
    from substrateinterface import SubstrateInterface, Keypair
except Exception as e:
    print("Please install substrate-interface and dependencies: pip install substrate-interface websocket-client requests", e, file=sys.stderr)
    sys.exit(1)

try:
    import requests
except Exception:
    requests = None

# --- CONFIG ---
WS_ENDPOINT = "wss://westend-rpc.polkadot.io"   # public Westend endpoint
PAYLOAD_SIZE = 1024                             # 1 KB
PLANCK_PER_DOT = Decimal(10) ** 10
COINGECKO_SIMPLE_PRICE = "https://api.coingecko.com/api/v3/simple/price"
COIN_ID = "polkadot"
VS_CURRENCY = "usd"
# ----------------

def make_payload(n):
    """Return n random bytes (you can replace with your data)."""
    return secrets.token_bytes(n)

def get_dot_price_usd():
    if not requests:
        return None
    try:
        r = requests.get(COINGECKO_SIMPLE_PRICE, params={"ids": COIN_ID, "vs_currencies": VS_CURRENCY}, timeout=8)
        r.raise_for_status()
        j = r.json()
        v = j.get(COIN_ID, {}).get(VS_CURRENCY)
        return Decimal(str(v)) if v is not None else None
    except Exception:
        return None

def fetch_registrar_constant(substrate):
    """Try to read registrar.dataDepositPerByte; may return None."""
    try:
        v = substrate.get_constant('Registrar', 'dataDepositPerByte')
        if v is None:
            return None
        return int(v)
    except Exception:
        return None

def choose_call_and_prepare(substrate, payload_hex, deposit_planck=None):
    """
    Inspect API for a DA/ELVES-style call; return composed call object.
    If not found, return a system.remark call as fallback.
    """
    # Preferred names to try (may vary across runtimes)
    # Try several plausible pallets and method names.
    candidates = [
        ('Elves', 'submitBlob'),
        ('DA', 'submit_data'),
        ('DataAvailability', 'submit'),
        ('dataAvailability', 'submit'),
        ('ElvesPallet', 'submit_blob'),
        ('ParachainSystem', 'note'),  # unlikely but harmless
    ]

    for module, fn in candidates:
        try:
            if substrate.has_module(module) and substrate.has_module_function(module, fn):
                # Compose call with likely parameter names. If signature differs, this may throw.
                print(f"Using extrinsic: {module}.{fn}")
                # Try common param names
                try:
                    return substrate.compose_call(
                        call_module=module,
                        call_function=fn,
                        call_params={'data': '0x' + payload_hex}
                    )
                except Exception:
                    # fallback try single-byte-array param
                    try:
                        return substrate.compose_call(
                            call_module=module,
                            call_function=fn,
                            call_params={'blob': '0x' + payload_hex}
                        )
                    except Exception:
                        # last attempt: positional param
                        try:
                            return substrate.compose_call(
                                call_module=module,
                                call_function=fn,
                                call_params={'0': '0x' + payload_hex}
                            )
                        except Exception:
                            print(f"Could not compose {module}.{fn} with guessed args; skipping.")
                            continue
        except Exception:
            continue

    # fallback to system.remark (safe, supported everywhere)
    print("No DA/ELVES extrinsic found — falling back to System.remark (test only).")
    return substrate.compose_call(
        call_module='System',
        call_function='remark',
        call_params={'remark': '0x' + payload_hex}
    )

def main():
    seed = os.environ.get('SENDER_SEED')
    if not seed:
        print("ERROR: set SENDER_SEED env var to your test account mnemonic/secret URI (Westend).", file=sys.stderr)
        sys.exit(1)

    print("Connecting to Westend node:", WS_ENDPOINT)
    try:
        substrate = SubstrateInterface(url=WS_ENDPOINT, type_registry_preset='westend')
    except Exception as e:
        print("Connection failed:", e, file=sys.stderr)
        sys.exit(1)

    # prepare payload
    payload = make_payload(PAYLOAD_SIZE)
    payload_hex = payload.hex()
    print(f"Prepared payload: {PAYLOAD_SIZE} bytes, hex length {len(payload_hex)} (showing first 64 chars):")
    print(payload_hex[:64] + "...")

    # fetch registrar constant (optional)
    planck_per_byte = fetch_registrar_constant(substrate)
    if planck_per_byte is not None:
        print("registrar.dataDepositPerByte (Planck/byte):", planck_per_byte)
        total_planck = planck_per_byte * PAYLOAD_SIZE
        per_byte_dot = Decimal(planck_per_byte) / PLANCK_PER_DOT
        total_dot = per_byte_dot * Decimal(PAYLOAD_SIZE)
        print(f"-> deposit needed for this payload (Planck): {total_planck}")
        print(f"-> which is {total_dot:.6f} DOT (may be refundable depending on pallet semantics).")
    else:
        print("registrar.dataDepositPerByte not readable from this node/runtime. We will proceed and rely on runtime to reject if deposit is mandatory.")

    # pick keypair
    try:
        kp = Keypair.create_from_uri(seed)
    except Exception as e:
        print("Failed to create keypair from SENDER_SEED. Make sure it is a valid secret URI or mnemonic:", e, file=sys.stderr)
        sys.exit(1)

    print("Using account (SS58):", kp.ss58_address)

    # Compose call (DA extrinsic if available, else system.remark)
    call = choose_call_and_prepare(substrate, payload_hex, deposit_planck=(total_planck if planck_per_byte is not None else None))

    # create and sign extrinsic
    try:
        extrinsic = substrate.create_signed_extrinsic(call=call, keypair=kp)
    except Exception as e:
        print("Error creating signed extrinsic:", e, file=sys.stderr)
        sys.exit(1)

    # Submit extrinsic and wait for inclusion/finalization
    try:
        print("Submitting extrinsic (waiting for inclusion)...")
        receipt = substrate.submit_extrinsic(extrinsic, wait_for_inclusion=True)
        print("Included in block:", receipt.block_hash)
        # optionally wait for finalization
        print("Waiting for finalization...")
        # some RPCs let you wait_for_finalization in submit_extrinsic, but do a short poll here:
        receipt2 = substrate.get_extrinsic_status(receipt.extrinsic_hash)
        # We will loop until finalized or timeout
        timeout = 60  # seconds
        waited = 0
        while not (receipt2 and receipt2.get('isFinalized')) and waited < timeout:
            sleep(2)
            waited += 2
            receipt2 = substrate.get_extrinsic_status(receipt.extrinsic_hash)
        print("Finalization status (may be None depending on node):", receipt2)
        print("Extrinsic hash:", receipt.extrinsic_hash)
    except Exception as e:
        print("Error submitting extrinsic:", e, file=sys.stderr)
        sys.exit(1)

    # print optional USD conversion
    dot_price = None
    try:
        dot_price = get_dot_price_usd()
    except Exception:
        dot_price = None
    if planck_per_byte is not None and dot_price is not None:
        total_dot = (Decimal(planck_per_byte) / PLANCK_PER_DOT) * Decimal(PAYLOAD_SIZE)
        print(f"Estimated cost (DOT): {total_dot:.6f}")
        print(f"Estimated cost (USD): ${ (total_dot * dot_price):,.2f } (DOT price from CoinGecko)")
    print("Done.")

def get_dot_price_usd():
    if not requests:
        return None
    try:
        r = requests.get(COINGECKO_SIMPLE_PRICE, params={"ids": COIN_ID, "vs_currencies": VS_CURRENCY}, timeout=8)
        r.raise_for_status()
        return Decimal(str(r.json()[COIN_ID][VS_CURRENCY]))
    except Exception:
        return None

if __name__ == "__main__":
    main()
