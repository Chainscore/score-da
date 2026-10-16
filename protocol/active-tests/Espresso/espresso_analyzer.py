# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import requests
import json
from datetime import datetime

def fetch_block_data(num_blocks=100):
    """
    Fetch block data from Espresso Network API
    """
    url = f"https://cache.main.net.espresso.network/v0/explorer/blocks/latest/{num_blocks}"
    
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        return data.get('block_summaries', [])
    except requests.exceptions.RequestException as e: 
        print(f"Error fetching data: {e}")
        return None

def calculate_statistics(blocks):
    """
    Calculate average TPS, block size, and transactions per block
    """
    if not blocks or len(blocks) == 0:
        print("No blocks to analyze")
        return None
    
    total_transactions = 0
    total_size = 0
    total_time_diff = 0
    
    # Sort blocks by height to ensure chronological order
    sorted_blocks = sorted(blocks, key=lambda x: x['height'])
    
    for block in sorted_blocks:
        total_transactions += block['num_transactions']
        total_size += block['size']
    
    # Calculate time difference between first and last block
    if len(sorted_blocks) > 1:
        first_time = datetime.fromisoformat(sorted_blocks[0]['time'].replace('Z', '+00:00'))
        last_time = datetime.fromisoformat(sorted_blocks[-1]['time'].replace('Z', '+00:00'))
        total_time_diff = (last_time - first_time).total_seconds()
    
    # Calculate averages
    num_blocks = len(blocks)
    avg_block_size = total_size / num_blocks
    avg_transactions_per_block = total_transactions / num_blocks
    
    # Calculate TPS (transactions per second)
    if total_time_diff > 0:
        avg_tps = total_transactions / total_time_diff
    else:
        avg_tps = 0
    
    return {
        'total_blocks_analyzed': num_blocks,
        'total_transactions': total_transactions,
        'time_period_seconds': total_time_diff,
        'average_tps': round(avg_tps, 4),
        'average_block_size_bytes': round(avg_block_size, 2),
        'average_transactions_per_block': round(avg_transactions_per_block, 2)
    }

def main():
    print("Fetching 100 blocks from Espresso Network...")
    print("-" * 60)
    
    # Fetch block data
    blocks = fetch_block_data(100)
    
    if blocks is None:
        return
    
    print(f"Successfully fetched {len(blocks)} blocks\n")
    
    # Calculate statistics
    stats = calculate_statistics(blocks)
    
    if stats:
        print("=" * 60)
        print("ESPRESSO NETWORK BLOCK STATISTICS")
        print("=" * 60)
        print(f"Total Blocks Analyzed: {stats['total_blocks_analyzed']}")
        print(f"Total Transactions: {stats['total_transactions']}")
        print(f"Time Period: {stats['time_period_seconds']:.2f} seconds")
        print("-" * 60)
        print(f"Average TPS: {stats['average_tps']} transactions/second")
        print(f"Average Block Size: {stats['average_block_size_bytes']} bytes")
        print(f"Average Transactions per Block: {stats['average_transactions_per_block']}")
        print("=" * 60)
        
        # Also print as JSON for easy parsing
        print("\nJSON Output:")
        print(json.dumps(stats, indent=2))

if __name__ == "__main__":
    main()