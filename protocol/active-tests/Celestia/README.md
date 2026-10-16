# Celestia Data Availability (DA) Testing

This directory contains scripts for interacting with the Celestia Data Availability layer.

## Methodology / Action Plan

As outlined in the [DA Comparative Study grant proposal](https://github.com/w3f/Grants-Program/blob/master/applications/da_comparative_study.md), our goal is to benchmark and compare different DA solutions. The scripts in this directory are part of the data collection phase (Milestone 2) of this study.

### Current Implementation

The `celestia_data.py` script provides a basic framework for submitting data blobs to the Celestia Mocha testnet. It uses the JSON-RPC API to interact with a Celestia node.

**Key features:**

*   **Data Submission:** The `submit_blob` function demonstrates how to send a data blob to a specified namespace on the Celestia testnet.

### Next Steps

1.  **Implement data retrieval:** The current script only supports data submission. We need to implement functionality to retrieve data blobs from the Celestia testnet. This will likely involve using the `blob.Get` or a similar RPC method.
2.  **Develop benchmarking scripts:** Once the basic data submission and retrieval functionality is working, we will develop scripts to measure key performance metrics, such as:
    *   **Data submission throughput:** How much data can be submitted to the Celestia DA layer per unit of time.
    *   **Data retrieval latency:** The time it takes to retrieve a data blob after it has been submitted.
    *   **Cost analysis:** The transaction fees associated with submitting data to the Celestia DA layer.
3.  **Integrate with the broader study:** The data collected from these scripts will be used to compare the Celestia DA solution with other DA layers, as described in the grant proposal.

## Running the Scripts

The JavaScript-based scripts (`celestia_tps.js` and `celestia_max_tps.js`) are used for performance testing.

### Prerequisites

*   [Node.js](https://nodejs.org/) (v16 or later)
*   [npm](https://www.npmjs.com/) (comes with Node.js)
*   A running Celestia Light Node.

#### Starting a Local Celestia Light Node

To start a local Celestia Light Node, run the following command:

```bash
celestia light start --core.ip rpc-mocha.pops.one --p2p.network mocha
```

This command connects your light node to the Mocha testnet.

### 1. Installation

Install the necessary Node.js dependencies:

```bash
npm install
```

### 2. Authentication

The scripts require an authentication token to communicate with your local Celestia node.

1.  **Generate the token:**
    ```bash
    celestia light auth admin --p2p.network mocha
    ```
2.  **Export the token as an environment variable:**
    Replace `<your-token>` with the output from the previous command.
    ```bash
    export AUTH_TOKEN="<your-token>"
    ```
    **Note:** This environment variable is only set for the current terminal session. You will need to set it again if you open a new terminal.

### 3. Execution

You can now run the test scripts.

*   **`celestia_tps.js`:** Submits blobs one by one in separate transactions to measure transactions per second (TPS).
    ```bash
    node celestia_tps.js
    ```
*   **`celestia_max_tps.js`:** Submits a batch of blobs in a single transaction to test the maximum data throughput in a single block.
    ```bash
    node celestia_max_tps.js
    ```

