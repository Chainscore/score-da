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
