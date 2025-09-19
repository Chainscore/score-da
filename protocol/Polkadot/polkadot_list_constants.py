#!/usr/bin/env python3
"""
Compute cost to store 1 MB using registrar.dataDepositPerByte on Polkadot.

Requirements:
  pip install substrate-interface websocket-client requests

Usage:
  python polkadot_deposit_cost.py
"""
from decimal import Decimal
import sys

try:
    from substrateinterface import SubstrateInterface
except Exception as e:
    print("Install substrate-interface (pip install substrate-interface websocket-client requests):", e, file=sys.stderr)
    sys.exit(1)

try:
    import requests
except Exception:
    requests = None

# Config
WS_ENDPOINT = "wss://rpc.polkadot.io"
BYTES_TO_STORE = 1_000_000            # 1 MB (decimal)
PLANCK_PER_DOT = Decimal(10) ** 10    # 1 DOT = 10^10 Planck
COINGECKO_SIMPLE_PRICE = "https://api.coingecko.com/api/v3/simple/price"
COIN_ID = "polkadot"
VS_CURRENCY = "usd"

def get_dot_price_usd():
    """Return Decimal USD price of DOT or None if requests not available/failed."""
    if not requests:
        return None
    try:
        resp = requests.get(COINGECKO_SIMPLE_PRICE, params={"ids": COIN_ID, "vs_currencies": VS_CURRENCY}, timeout=10)
        resp.raise_for_status()
        j = resp.json()
        price = j.get(COIN_ID, {}).get(VS_CURRENCY)
        if price is None:
            return None
        return Decimal(str(price))
    except Exception as e:
        print("CoinGecko fetch failed:", e)
        return None

def main():
    print("Connecting to Polkadot node:", WS_ENDPOINT)
    try:
        substrate = SubstrateInterface(url=WS_ENDPOINT, type_registry_preset='polkadot')
    except Exception as e:
        print("Failed to connect to node:", e, file=sys.stderr)
        sys.exit(1)

    # read the known constant
    try:
        planck_per_byte = substrate.get_constant('Registrar', 'dataDepositPerByte')
        if planck_per_byte is None:
            raise ValueError("constant returned None")
        # substrate-interface returns a value that can be turned into int
        planck_per_byte_int = int(planck_per_byte)
    except Exception as e:
        print("Error fetching Registrar.dataDepositPerByte:", e, file=sys.stderr)
        sys.exit(1)

    # math
    planck_per_byte_dec = Decimal(planck_per_byte_int)
    dot_per_byte = planck_per_byte_dec / PLANCK_PER_DOT
    total_dot = dot_per_byte * Decimal(BYTES_TO_STORE)

    # get USD price (optional)
    dot_usd = get_dot_price_usd()
    total_usd = (total_dot * dot_usd) if dot_usd is not None else None

    # Print nicely
    print()
    print("On-chain constant: registrar.dataDepositPerByte =", planck_per_byte_int, "Planck per byte")
    print(f"Per-byte = {dot_per_byte:.12f} DOT/byte")
    print(f"Total for {BYTES_TO_STORE:,} bytes = {total_dot:.6f} DOT")
    if total_usd is not None:
        print(f"DOT price (USD): ${dot_usd:.4f}")
        print(f"Estimated cost (USD): ${total_usd:,.2f}")
    else:
        print("DOT USD price unavailable (CoinGecko fetch failed or requests not installed).")
        print("You can still see the DOT total above and multiply by current market DOT price.")
    print()
    print("Notes:")
    print(" - registrar.dataDepositPerByte is the deposit 'to be paid per byte stored on chain' (u128).")
    print(" - Meaning/semantics depend on the pallet/context (may be part of parachain registration or other registrar flows). See Polkadot docs for details.")
    print()

if __name__ == '__main__':
    main()
