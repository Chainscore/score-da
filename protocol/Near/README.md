# NEAR Data Availability (DA) Testing

This directory contains scripts for interacting with the NEAR Data Availability layer.

## Methodology / Action Plan

As outlined in the [DA Comparative Study grant proposal](https://github.com/w3f/Grants-Program/blob/master/applications/da_comparative_study.md), our goal is to benchmark and compare different DA solutions. The scripts in this directory are part of the data collection phase (Milestone 2) of this study.

### Current Implementation

The `near_data_test.py` script provides a basic framework for submitting data blobs to and retrieving them from the NEAR DA testnet. It uses the `py-near` library to interact with the NEAR blockchain.

**Key features:**

*   **Data Submission:** The `submit_near_da_blob` function demonstrates how to send a data blob to a specified NEAR contract.
*   **Data Retrieval (Placeholder):** The `retrieve_near_da_blob` function includes placeholder logic for retrieving the data. The exact implementation will depend on the final NEAR DA contract interface.

### Next Steps

1.  **Identify the official NEAR DA contract:** The current script uses a placeholder contract ID (`data_availability.testnet`). We need to identify the correct contract address and method names by consulting the official NEAR documentation or by finding the contract on a testnet explorer.
2.  **Implement data retrieval:** The data retrieval logic in the script is a placeholder. We need to implement the correct logic based on how the NEAR DA contract exposes data for retrieval.
3.  **Develop benchmarking scripts:** Once the basic data submission and retrieval functionality is working, we will develop scripts to measure key performance metrics, such as:
    *   **Data submission throughput:** How much data can be submitted to the NEAR DA layer per unit of time.
    *   **Data retrieval latency:** The time it takes to retrieve a data blob after it has been submitted.
    *   **Cost analysis:** The transaction fees associated with submitting data to the NEAR DA layer.
4.  **Integrate with the broader study:** The data collected from these scripts will be used to compare the NEAR DA solution with other DA layers, as described in the grant proposal.
