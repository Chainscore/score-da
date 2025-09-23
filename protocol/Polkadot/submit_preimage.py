#!/usr/bin/env python3
"""
submit_preimage_simple.py

Simple version based on working JS reference.
Usage: MNEMONIC='//Alice' python submit_preimage_simple.py
"""
import os
import time
import hashlib
from substrateinterface import SubstrateInterface, Keypair

WS = os.environ.get('WS', 'wss://westend-rpc.polkadot.io')
MNEMONIC = os.environ.get('SENDER_SEED', '//Alice')
SIZE = int(os.environ.get('SIZE', '1024'))

def main():
    # Connect
    substrate = SubstrateInterface(url=WS, type_registry_preset='polkadot')
    print(f'Connected to {WS}')
    
    # Create keypair
    if MNEMONIC.startswith('//') or '/' in MNEMONIC or MNEMONIC.count(' ') < 2:
        kp = Keypair.create_from_uri(MNEMONIC)
    else:
        kp = Keypair.create_from_mnemonic(MNEMONIC)
    
    print(f'Using account: {kp.ss58_address}')
    
    # Create payload
    payload = bytes([0x42]) * SIZE  # bytes object
    payload_hex = '0x' + payload.hex()  # Convert to HEX STRING like JS
    hash_bytes = hashlib.blake2b(payload, digest_size=32).digest()
    hash_hex = '0x' + hash_bytes.hex()
    
    print(f'Payload size: {len(payload)} bytes')
    print(f'blake2_256 hash: {hash_hex}')
    print(f'Payload hex: {payload_hex[:50]}{"..." if len(payload_hex) > 50 else ""}')
    
    # Find preimage call - try different combinations like JS code
    call = None
    call_name = None
    
    # Try different pallet/call combinations
    for pallet in ['preimage', 'Preimage']:
        for method in ['notePreimage', 'note_preimage']:
            try:
                # Try both hex string (like JS) and raw bytes
                call = substrate.compose_call(
                    call_module=pallet,
                    call_function=method,
                    call_params={'bytes': payload_hex}  # Send as HEX STRING like JS
                )
                call_name = f'{pallet}.{method}'
                break
            except Exception:
                try:
                    # Fallback to raw bytes
                    call = substrate.compose_call(
                        call_module=pallet,
                        call_function=method,
                        call_params={'bytes': payload}  # Raw bytes fallback
                    )
                    call_name = f'{pallet}.{method} (raw bytes)'
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
        
        # Print events to see if it succeeded
        if hasattr(receipt, 'triggered_events'):
            for event in receipt.triggered_events:
                event_data = event.value
                print(f'Event: {event_data}')
                
                # Check for failure
                if (isinstance(event_data, dict) and 
                    event_data.get('event_id') == 'ExtrinsicFailed'):
                    print('❌ Extrinsic failed!')
                    return
        
        print('✅ Extrinsic appears successful')
        
    except Exception as e:
        print(f'Submission failed: {e}')
        return
    
    # Wait then query storage like JS code
    print('Waiting 10 seconds then querying...')
    time.sleep(10)
    
    try:
        stored = None
        
        # Try different query combinations like JS (use raw bytes for hash like JS)
        for pallet in ['preimage', 'Preimage']:
            for storage in ['preimageFor', 'preimage_for']:
                try:
                    # Try with raw hash bytes (like JS uses hashU8)
                    stored = substrate.query(pallet, storage, params=[hash_bytes])
                    if stored is not None:
                        print(f'Found via {pallet}.{storage} (raw bytes)')
                        break
                except Exception:
                    try:
                        # Fallback to hex string
                        stored = substrate.query(pallet, storage, params=[hash_hex])
                        if stored is not None:
                            print(f'Found via {pallet}.{storage} (hex string)')
                            break
                    except Exception:
                        continue
            if stored is not None:
                break
        
        if stored is None:
            print('❌ Preimage not found in storage')
        else:
            print(f'✅ Query result: {stored}')
            
            # Print hex sample if possible
            try:
                if hasattr(stored, 'to_hex'):
                    hex_data = stored.to_hex()
                    print(f'Hex sample: {hex_data[:200]}{"..." if len(hex_data) > 200 else ""}')
                elif hasattr(stored, 'value') and isinstance(stored.value, (bytes, bytearray)):
                    hex_data = '0x' + stored.value.hex()
                    print(f'Hex sample: {hex_data[:200]}{"..." if len(hex_data) > 200 else ""}')
            except Exception as e:
                print(f'Could not display hex: {e}')
                
    except Exception as e:
        print(f'Error querying preimage: {e}')

if __name__ == '__main__':
    main()