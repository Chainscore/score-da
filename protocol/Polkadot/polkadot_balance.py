#!/usr/bin/env python3
"""
Check Westend account balance and print human-readable amounts.

Usage:
  export SENDER_SEED="your mnemonic or secret URI"
  python check_westend_balance.py
"""
import os, sys
from decimal import Decimal

try:
    from substrateinterface import SubstrateInterface, Keypair
except Exception as e:
    print("Install substrate-interface: pip install substrate-interface websocket-client", e, file=sys.stderr)
    sys.exit(1)

WS = "wss://westend-rpc.polkadot.io"
PLANCK_PER_WND = Decimal(10) ** 12  # Westend base unit (12 decimals)

def main():
    seed = os.environ.get("SENDER_SEED")
    if not seed:
        print("Set SENDER_SEED env var (mnemonic or secret URI). Example:")
        print("  export SENDER_SEED='your seed phrase here'"); sys.exit(1)

    try:
        kp = Keypair.create_from_uri(seed)
    except Exception as e:
        print("Invalid seed/URI:", e); sys.exit(1)

    addr = kp.ss58_address
    print("Using account:", addr)

    substrate = SubstrateInterface(url=WS, type_registry_preset='westend')

    # Query System Account
    acc = substrate.query('System', 'Account', [addr]).value
    if acc is None:
        print("No account info found (maybe zero balance).")
        return

    data = acc.get('data', {})
    free = int(data.get('free', 0))
    reserved = int(data.get('reserved', 0))
    misc_frozen = int(data.get('misc_frozen', 0))
    fee_frozen = int(data.get('fee_frozen', 0))

    def fmt(planck):
        return f"{Decimal(planck) / PLANCK_PER_WND:.12f}"

    print(f"Free balance : {free} Planck  => {fmt(free)} WND")
    print(f"Reserved     : {reserved} Planck  => {fmt(reserved)} WND")
    print(f"Misc frozen  : {misc_frozen} Planck => {fmt(misc_frozen)} WND")
    print(f"Fee frozen   : {fee_frozen} Planck => {fmt(fee_frozen)} WND")
    total = free + reserved
    print(f"Total (free+reserved): {total} Planck => {fmt(total)} WND")

if __name__ == '__main__':
    main()
