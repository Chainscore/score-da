# On-chain evidence of our active DA tests (Aug–Nov 2025)

These transactions were sent by the scripts in this folder (`protocol/active-tests/`), originally committed in `58ec122` through `6b3c62d`. The full per-transaction data is in this folder.

## Avail: Turing testnet

**Account:** [5CwGWiEvMerYDZLVc78jLFD7YtEiHuMDWj4s9jShzjG3vzEJ](https://avail-turing.subscan.io/account/5CwGWiEvMerYDZLVc78jLFD7YtEiHuMDWj4s9jShzjG3vzEJ). It sent 25 extrinsics, all successful, between 20 Aug and 27 Nov 2025: one app-key registration and 24 `submit_data` calls. Full list: `avail_westend_txs.csv`.

| Date (UTC) | Test | Tx |
|---|---|---|
| 2025-08-20 | App key "avail-test-da" registered (id 463) | [0x9ddd6b58…f1cc](https://avail-turing.subscan.io/extrinsic/0x9ddd6b588853da0c72f92635b99d65cd0599ec4c8f0bc447d5252257e0cff1cc) |
| 2025-08-20 | First data submission (20 B) | [0x3ead3fa2…1efc](https://avail-turing.subscan.io/extrinsic/0x3ead3fa2fe6a9dddd737f0714b56af0e9fd55f61ca7984e91f1a9f8fb2ca1efc) |
| 2025-08-20 | Submission later read back by our retrieval script | [0xcee6b7f8…0494](https://avail-turing.subscan.io/extrinsic/0xcee6b7f84254dc08b491e446e84d003df88859e9b8931192c519b4a420a50494) |
| 2025-10-29 | Batch-payload prototype (236 B) | [0x47ed50be…dd0f](https://avail-turing.subscan.io/extrinsic/0x47ed50bec055fa024b78481441ca6d845167dd32e055b41e18894d89d38edd0f) |
| 2025-10-30 | Large blob, 203,044 B (1 of 3 in consecutive blocks) | [0x3a39f871…f334](https://avail-turing.subscan.io/extrinsic/0x3a39f871fde9e15029dc2575a451d8e3bb9bdfa9e1e04cfcd2058c718255f334) |
| 2025-10-30 | Large blob, 203,336 B (2 of 3) | [0x2c735ebe…4479](https://avail-turing.subscan.io/extrinsic/0x2c735ebe4b9da01d5bf0407a429f16be8cd2f756136adbd4aaa4613695f84479) |
| 2025-10-30 | Large blob, 203,856 B (3 of 3) | [0x13360540…a96e](https://avail-turing.subscan.io/extrinsic/0x13360540ffb9dfe9aefdda56376083edc2bcb1313f67ea7f6b3d424083cca96e) |
| 2025-11-14 | Repeat submission run (first of 6) | [0xf9124327…2c5d](https://avail-turing.subscan.io/extrinsic/0xf9124327fa46389dc5d929324ab0617ad8a39cceac87698ba1ceaade71852c5d) |
| 2025-11-24 | JSON-record submission | [0x3d8ccd33…ecc7](https://avail-turing.subscan.io/extrinsic/0x3d8ccd33cb16c0209fb14d983049d7ae79a2c37d503c01f25710f9dfff9aecc7) |
| 2025-11-27 | Large-blob re-run, 203,044 B | [0x017c562c…75b5](https://avail-turing.subscan.io/extrinsic/0x017c562cd523847331bbdf9a912bffae89860e17930aaf38b566dd83418e75b5) |
| 2025-11-27 | Large-blob re-run, 203,336 B | [0xa5492a27…30ee](https://avail-turing.subscan.io/extrinsic/0xa5492a27e5ac4326227fe47a50179a9a77e064408762476d77233189ea6f30ee) |

## Polkadot: Westend testnet

The same key was used on Westend: [account](https://westend.subscan.io/account/5CwGWiEvMerYDZLVc78jLFD7YtEiHuMDWj4s9jShzjG3vzEJ).

| Date (UTC) | Test | Tx |
|---|---|---|
| 2025-09-23 | 1 KiB `system.remark` (1 of 5) | [0xa6f09f34…49e3](https://westend.subscan.io/extrinsic/0xa6f09f34808007d6f729e6d4f5f709312e64fa13cb4b720d8bf95f885d1f49e3) |
| 2025-09-23 | 1 KiB remark | [0xe8893256…fbc0](https://westend.subscan.io/extrinsic/0xe8893256a6a133a9f1cefe3a0f019a6cccedce59f83bace4d212799f5513fbc0) |
| 2025-09-23 | 1 KiB remark | [0xdbe79604…6da4](https://westend.subscan.io/extrinsic/0xdbe796047bdf823d9f363a5116ae166673f730eb8cf70f5982d03cb67fe86da4) |
| 2025-09-23 | 1 KiB remark | [0x9662e20f…cda5](https://westend.subscan.io/extrinsic/0x9662e20fdda260ab2e0e8e85e6e2f2d3ebc6af731688fae5112dba76ae8bcda5) |
| 2025-09-23 | 1 KiB remark | [0x8634f1b8…2815](https://westend.subscan.io/extrinsic/0x8634f1b898b8daa03aeee1009793dc7f1715f41dfe9f271366141a7186c22815) |
| 2025-09-24 | Preimage, 64 B | [0x20d9bcef…6ed5](https://westend.subscan.io/extrinsic/0x20d9bcef7c068eec5c06d5bf9cbd1936afdcf39bcff13db365ee7b95f97a6ed5) |
| 2025-09-24 | Preimage, 5,024 B | [0xb43a0545…5a93](https://westend.subscan.io/extrinsic/0xb43a0545fa98fb2b511455372a397feea3304a8ce3db4f770a7a9fd0ef165a93) |
| 2025-09-24 | Preimage, 10,240 B | [0xee7a9ecd…8fc1](https://westend.subscan.io/extrinsic/0xee7a9ecd565925721e2e166651bd536018d9db12ec867ce9cdca5381a4348fc1) |
| 2025-09-26 | Preimage, 50,240 B | [0xa6f79375…c18b](https://westend.subscan.io/extrinsic/0xa6f79375330aa4150190e59dd24b95db0c7e424d8c23531a01f5d0a7e39bc18b) |

We also ran remark and batch tests on Paseo. Paseo was restarted from a new genesis in July 2026, so that history is no longer publicly served.

## NEAR: testnet

**Account and contract:** [6811aa3a…efbe](https://testnet.nearblocks.io/address/6811aa3a90ee67fb710f23e240639ebd10423f45793dba39f1930195ce10efbe). It made 2,287 `submit_data` calls, 2,285 of them successful, on 12, 13 and 27 Nov 2025. The 13 Nov run peaked at 63 calls in one block and the 27 Nov run at 88. Full list: `near_submit_data.json`.

| Date (UTC) | Test | Tx |
|---|---|---|
| 2025-10-31 | Account created | [4UtKP3Hv…zdtt](https://testnet.nearblocks.io/txns/4UtKP3HveEEgeY9ds4uJU4aFsfbUNYcsZBy1rHDrzdtt) |
| 2025-11-12 | Contract deployed | [HyCSCPMs…GFk6](https://testnet.nearblocks.io/txns/HyCSCPMsW2aACvy4cZtLMxcBuGGvjRz82yMXqvUDGFk6) |
| 2025-11 | `submit_data` sample | [FyW1KEXq…CNJ](https://testnet.nearblocks.io/txns/FyW1KEXqEMzerurE5XGwbxhGWAbfMFZrMUsm7hLZCPNJ) |
| 2025-11 | `submit_data` sample | [EBoevRwv…JDw](https://testnet.nearblocks.io/txns/EBoevRwvVZdRujzsqsgMdhkepbukrEuwKgjbLa982JDw) |
| 2025-11 | `submit_data` sample | [4rR9ktFo…Xmk](https://testnet.nearblocks.io/txns/4rR9ktFo82Xg7fgN8k8jntB9DNfSyEh2ZKgjj3pFpXmk) |
| 2025-11 | `submit_data` sample | [AV1thAdp…haZ2](https://testnet.nearblocks.io/txns/AV1thAdpABGtgkgnEWx1Bib87VrgK55nBKaNRyYyhaZ2) |

## Espresso: mainnet

All of these transactions are in **namespace 1000000**: 56,645 between 29 Aug and 21 Nov 2025, in 106 blocks. Every payload matches our scripts' formats. Inclusion latency on 3 Nov was 1.1–2.6 s. Full list: `espresso_ns1000000.json`.

| Date (UTC) | Test | Link |
|---|---|---|
| 2025-08-29 | First submit and retrieve (56 B) | [block 5453080](https://explorer.espresso.network/block/5453080) · [tx](https://query.main.net.espresso.network/v1/availability/transaction/hash/TX~51IKaapjCQER4hiGES-x5Q9aawdvOZ2qLHBm0RP9ad6u) |
| 2025-11-03 | Async stress test, 99 txs, 128 B | [block 7135888](https://explorer.espresso.network/block/7135888) · [tx](https://query.main.net.espresso.network/v1/availability/transaction/hash/TX~HnWyfYPmg6y2wUlmPKnqxwoTo1GiiqyKXGveK5lAStDN) |
| 2025-11-13 | Stress run, 13,009 txs over 28 blocks | [block 7360977](https://explorer.espresso.network/block/7360977) · [tx](https://query.main.net.espresso.network/v1/availability/transaction/hash/TX~2bzzxYZDZOs-tBPdq7WFPkXiKGb58P692NFi7psTqvuZ) |
| 2025-11-20 | Throughput run, 17,054 txs; peak 3,967 in one block | [block 7556855](https://explorer.espresso.network/block/7556855) · [tx](https://query.main.net.espresso.network/v1/availability/transaction/hash/TX~suYyYYbn0KbtMpeY2MtAs07LeQn3_VVQMB1Z4ONGSl2i) |
| 2025-11-21 | Throughput run, 26,480 txs over 38 blocks | [block 7573046](https://explorer.espresso.network/block/7573046) · [tx](https://query.main.net.espresso.network/v1/availability/transaction/hash/TX~l-oo-sXnmQf1CvAltCYNj6sfomYZyVL8ckkoPV2QyFND) |

## Celestia: Mocha testnet

We submitted and retrieved blobs through our own light node on the Mocha testnet (scripts in commits `6f7dcc8` and `6b3c62d`). Celestia has since shut down that testnet and relaunched it as mocha-5 (August 2026), and the old history is no longer publicly served. We can trace the transactions through an archive provider if needed.
