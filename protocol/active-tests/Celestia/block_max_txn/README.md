# celestia_max_txns.js

This script submits a configurable number of transactions to a Celestia Light Node to test the maximum number of transactions that can be included in a block.

## Prerequisites

*   [Node.js](https://nodejs.org/) (v16 or later)
*   [npm](https://www.npmjs.com/) (comes with Node.js)
*   A running Celestia Light Node.

Please refer to the main [README.md](../../README.md) for instructions on how to set up and run a Celestia Light Node.

## Installation

If you haven't already, install the necessary Node.js dependencies from the root of the project:

```bash
npm install
```

## Authentication

The script requires an authentication token to communicate with your local Celestia node.

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

## Usage

You can now run the test script.

*   **Default:** Submits 10 transactions.
    ```bash
    node block_max_txn/celestia_max_txns.js
    ```
*   **Custom Number of Transactions:** Use the `--num-txns` flag to specify the number of transactions to submit.
    ```bash
    node block_max_txn/celestia_max_txns.js --num-txns 500
    ```
