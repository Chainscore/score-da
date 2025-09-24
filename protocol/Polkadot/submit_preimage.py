#!/usr/bin/env python3

"""
submit_preimage_working.py
Python version that submits a valid-sized preimage.
"""

import os
import time
import hashlib
from substrateinterface import SubstrateInterface, Keypair

WS = os.environ.get('WS', 'wss://westend-rpc.polkadot.io')
MNEMONIC = os.environ.get('SENDER_SEED', '//Alice')
# Corrected size: Reduce the payload to a size that Westend will accept.
# 64 bytes is a safe, small value.
SIZE = int(os.environ.get('SIZE', '64')) 

def main():
    # Connect
    try:
        substrate = SubstrateInterface(url=WS, type_registry_preset='polkadot')
        print(f'Connected to {WS}')
    except Exception as e:
        print(f'Failed to connect: {e}')
        return

    # Create keypair
    if MNEMONIC.startswith('//') or '/' in MNEMONIC or MNEMONIC.count(' ') < 2:
        kp = Keypair.create_from_uri(MNEMONIC)
    else:
        kp = Keypair.create_from_mnemonic(MNEMONIC)
    print(f'Using account: {kp.ss58_address}')

    # Create payload
    payload = bytes([0x42]) * SIZE
    payload_hex = '0x' + payload.hex()
    hash_bytes = hashlib.blake2b(payload, digest_size=32).digest()
    hash_hex = '0x' + hash_bytes.hex()

    print(f'Payload size: {len(payload)} bytes')
    print(f'blake2_256 hash: {hash_hex}')
    print(f'Payload hex: {payload_hex[:50]}{"..." if len(payload_hex) > 50 else ""}')

    # Find preimage call
    call = None
    call_name = None
    for pallet in ['preimage', 'Preimage']:
        for method in ['notePreimage', 'note_preimage']:
            try:
                call = substrate.compose_call(
                    call_module=pallet,
                    call_function=method,
                    call_params={'bytes': payload_hex}
                )
                call_name = f'{pallet}.{method}'
                break
            except Exception:
                continue
        if call:
            break

    if not call:
        print('ERROR: preimage.notePreimage not found in metadata')
        return

    print(f'Using call: {call_name}')
    print('Submitting extrinsic...')

    # Submit
    try:
        extrinsic = substrate.create_signed_extrinsic(call=call, keypair=kp)
        receipt = substrate.submit_extrinsic(extrinsic, wait_for_inclusion=True)

        print(f'Status: InBlock')
        print(f'Included in: {receipt.block_hash}')

        # Check for ExtrinsicFailed event
        extrinsic_succeeded = True
        if hasattr(receipt, 'triggered_events'):
            for event in receipt.triggered_events:
                if event.value.get('event_id') == 'ExtrinsicFailed':
                    print('❌ Extrinsic failed!')
                    extrinsic_succeeded = False
                    print(f'Event: {event.value}')
                    break

        if extrinsic_succeeded:
            print('✅ Extrinsic appears successful')
        else:
            return

    except Exception as e:
        print(f'Submission failed: {e}')
        return

    # Wait then query storage
    print('Waiting 10 seconds then querying...')
    time.sleep(10)

    try:
        stored = None
        for pallet in ['preimage', 'Preimage']:
            for storage in ['preimageFor', 'preimage_for']:
                try:
                    stored = substrate.query(pallet, storage, params=[hash_bytes])
                    if stored.value is not None:
                        print(f'Found via {pallet}.{storage}')
                        break
                except Exception:
                    continue
            if stored and stored.value is not None:
                break
        
        if stored and stored.value is not None:
            print(f'✅ Query result: {stored.value}')
        else:
            print('❌ Preimage not found in storage')

    except Exception as e:
        print(f'Error querying preimage: {e}')

if __name__ == '__main__':
    main()