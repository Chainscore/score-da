# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
# https://api-docs.celenium.io/
# https://api-mainnet.celenium.io/v1/stats/tps

import requests
import json

def fetch_tps_data():

    API_URL = "https://api-mainnet.celenium.io/v1/block"
    params = {
        'limit': 100,
    }


    headers = {
        'Accept': 'application/json',
    }


    print('Fetching Celenium TPS data...')
    try:

        response = requests.get(API_URL, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()

        # Extract blocks from response structure
        if isinstance(data, dict) and 'data' in data:
            return data['data']  # API returns {"data": [blocks]}
        elif isinstance(data, list):
            return data  # Direct block list


        print(f"Response structure: {json.dumps(data)[:200]}...")  # Debug print
        return []

    except requests.exceptions.RequestException as e:
        print(f"API Error: {str(e)}")
        return []





def calculate_tps(blocks):

    """
    Calculate TPS from Celestia block data
    """
    if not blocks:
        print("No blocks received to analyze")
        return 0

    print(f"Analyzing {len(blocks)} blocks...")

    from datetime import datetime

    try:


        # Sort blocks by height in ascending order
        sorted_blocks = sorted(blocks, key=lambda x: x['height'])
        first_block = sorted_blocks[0]   # Lowest height block
        last_block = sorted_blocks[-1]   # Highest height block

        print(f"Block height range: {first_block['height']} to {last_block['height']}")

        start_time = datetime.fromisoformat(first_block['time'].replace('Z', '+00:00'))
        end_time = datetime.fromisoformat(last_block['time'].replace('Z', '+00:00'))
        time_diff = (end_time - start_time).total_seconds()


        if time_diff <= 0:
            print("Invalid time difference between blocks")
            return 0
        # Count transactions per block

        block_txs = []
        total_txs = 0

        for block in sorted_blocks:
            tx_count = len(block.get('message_types', []))
            block_txs.append(tx_count)
            total_txs += tx_count

        tps = total_txs / time_diff
        block_time = time_diff / len(blocks)


        print("\nDetailed Block Analysis:")
        print(f"Time period: {time_diff:.2f} seconds")
        print(f"Number of blocks: {len(blocks)}")
        print(f"Total transactions: {total_txs}")
        print(f"Average transactions per block: {total_txs/len(blocks):.2f}")
        print(f"Transactions per second (TPS): {tps:.2f}")

        return tps
    
    except KeyError as e:

        print(f"Error processing block data: {str(e)}")


        return 0

if __name__ == "__main__":
    blocks_data = fetch_tps_data()
    tps = calculate_tps(blocks_data)
    print(f"\nFinal TPS: {tps:.2f}")