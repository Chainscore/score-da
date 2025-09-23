# submit_preimage_py.py
import os, time, hashlib
from substrateinterface import SubstrateInterface, Keypair, SubstrateRequestException

WS = os.environ.get('WS', 'wss://westend-rpc.polkadot.io')
MNEMONIC = os.environ.get('MNEMONIC') or '//Alice'
SIZE = 1024

payload = bytes([0x42]) * SIZE
# blake2b 256-bit
h = hashlib.blake2b(payload, digest_size=32).digest()
h_hex = '0x' + h.hex()

substrate = SubstrateInterface(url=WS, type_registry_preset='polkadot')
kp = Keypair.create_from_mnemonic(MNEMONIC)

# Try to find call name
call_module = None
call_fn = None
for name in ('Preimage','preimage'):
    try:
        m = substrate.metadata.get_module(name)
        if m and ('note_preimage' in m.calls or 'notePreimage' in m.calls):
            call_module = name
            call_fn = 'note_preimage' if 'note_preimage' in m.calls else 'notePreimage'
            break
    except Exception:
        continue

if not call_module:
    call_module, call_fn = 'Preimage', 'note_preimage'  # fallback; may need inspection

call = substrate.compose_call(call_module=call_module, call_function=call_fn, call_params={'bytes': payload})
extrinsic = substrate.create_signed_extrinsic(call=call, keypair=kp)
try:
    receipt = substrate.submit_extrinsic(extrinsic, wait_for_inclusion=True)
    print('Included in', receipt.block_hash)
except SubstrateRequestException as e:
    print('Submit failed:', e)
    raise

time.sleep(6)
# query storage
try:
    res = substrate.query(module='Preimage', storage_function='preimageFor', params=[h])
    print('Storage:', res.value)
except Exception as e:
    print('Query error:', e)
