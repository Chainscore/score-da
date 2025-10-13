# Comparative Study of Data Availability Schemes in Various Blockchains

This repository contains the research and implementation for the paper "Comparative Study of Data Availability Schemes in Various Blockchains".

## Authors

*   Pranjal Sarode (pranjal@chainscore.finance)
*   Prasad Kumkar (prasad@chainscore.finance)

## Abstract

We make a comparative benchmarking study of currently polkadot's ELVES data availability protocol with emerging data availability solutions which includes Avail, Celestia, Espresso's-Tiramisu and NEAR's sharded DA.

This work compares various system parameters—including bandwidth, time, latency, block time, block size, robustness, and cost per megabyte of data availability—and extends the analysis to other emerging factors affecting performance and scalability.

## Project Structure

The repository is organized as follows:

*   `paper-latex/`: Contains the LaTeX source for the research paper.
*   `protocol/`: Contains the code for interacting with and testing the different blockchain protocols.
*   `common/`: Common code and libraries used across the different protocols.
*   `outputs/`: Output data from the experiments.
*   `figures/`: Figures and plots used in the paper.

## Protocols Investigated

*   Polkadot (ELVES)
*   Avail
*   Celestia
*   Espresso (Tiramisu)
*   NEAR (Sharded DA)

## Getting Started

### Avail

The `protocol/Avail` directory contains scripts for interacting with the Avail network.

**Dependencies:**

*   Node.js
*   `avail-js-sdk`
*   `dotenv`
*   `substrate-interface` (for Python scripts)

**Installation:**

```bash
cd protocol/Avail
npm install
pip install substrate-interface
```

**Scripts:**

*   `avail_test_data.js`: Submits data to the Avail testnet.
    *   **Usage:** `node avail_test_data.js`
    *   **Note:** Requires a `SEED` environment variable.
*   `avail_telemetry_probe.py`: Fetches telemetry from a local Avail/Substrate node.
    *   **Usage:** `python3 avail_telemetry_probe.py`
*   `block_bloat_test.py`: Bloats a block with remark extrinsics and shows before/after telemetry.
    *   **Usage:** `python3 block_bloat_test.py`

### Celestia

The `protocol/Celestia` directory is currently empty.

### Espresso

The `protocol/Espresso` directory contains scripts for interacting with the Espresso Data Availability network.

**Dependencies:**

*   Python 3
*   `requests`

**Installation:**

```bash
pip install requests
```

**Scripts:**

*   `espresso-da.py`: A client for the Espresso DA to submit and retrieve data.
    *   **Usage:** `python3 espresso-da.py`
*   `espresso_analyzer.py`: Fetches block data from the Espresso Network API and calculates statistics.
    *   **Usage:** `python3 espresso_analyzer.py`

### NEAR

The `protocol/NEAR` directory is currently empty.

### Polkadot

The `protocol/Polkadot` directory contains a script for submitting data to the Polkadot network.

**Dependencies:**

*   Node.js
*   `@polkadot/api`
*   `@polkadot/util`
*   `@polkadot/util-crypto`

**Installation:**

```bash
cd protocol/Polkadot
npm install
```

**Scripts:**

*   `polkadot_add_data.js`: Submits data to the Polkadot network using a `remark` or `preimage` extrinsic.
    *   **Usage:** `node polkadot_add_data.js`
    *   **Note:** Requires a `SEED_PHRASE` environment variable. Use `--send` and `--fees` flags to control behavior.
