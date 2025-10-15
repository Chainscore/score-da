### ⚠️ These are dummy results for now. Will be updated during M2-M3
# DA Protocol Benchmarking Results

This directory contains dummy datasets for DA protocol performance analysis and benchmarking visualization.

## Dataset Files

### 1. `performance-metrics.json`
Core performance metrics for all protocols:
- **Throughput** (MB/s): Data transmission rates
- **TPS**: Transactions per second
- **Cost per MB** (USD/MB): Cost efficiency
- **Latency** (seconds): Block finalization time
- **Max Block Size** (MB): Maximum block capacity
- **Data Retrieval** (seconds): Data retrieval latency

### 2. `worst-case-analysis.json`
Stress test scenarios:
- **Worst-case cost**: Peak pricing under congestion
- **Worst-case latency**: Maximum delays under stress
- **Worst-case retrieval**: Slowest data access times

### 3. `efficiency-metrics.json`
Efficiency analysis:
- **Storage efficiency**: Post-inclusion data overhead
- **Proof efficiency**: Proof size and computation time
- **Latency efficiency**: Normalized performance scores

### 4. `security-validator-data.json`
Security and operational data:
- **Security assumptions**: Honest majority requirements, validator counts
- **Validator costs**: Hardware requirements and operational expenses

### 5. `time-series-data.json`
30-day trend data:
- Throughput over time
- TPS over time
- Cost fluctuations
- Latency variations

## Protocols Covered

- **Polkadot** (ELVES)
- **Celestia**
- **Espresso** (Tiramisu)
- **NEAR**
- **Avail**

## Data Format

All datasets use JSON format with the following structure:
```json
{
  "metadata": { ... },
  "<metric-name>": {
    "unit": "...",
    "data": [ ... ]
  }
}
```

## Usage

These datasets are designed to be consumed by the dashboard frontend for:
- Interactive charts and visualizations
- Protocol comparisons
- Performance trending
- Cost analysis
- Security assessment

## Note

**This is dummy data** generated for development and demonstration purposes. Actual benchmarking results will be populated from real protocol testing.
