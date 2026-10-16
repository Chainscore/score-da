# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import requests
import json
from datetime import datetime

def fetch_block_info(page=0, row=100):
    """
    Fetches block information from Avail using Subscan API.
    
    :param page: Page number for pagination (default: 0)
    :param row: Number of blocks per request (default: 100)
    :return: Block information or error message
    """
    # API Endpoint for block information
    API_URL = "https://polkadot.api.subscan.io/api/v2/scan/blocks"

    # Request Headers
    headers = {
        'Content-Type': 'application/json',
    }

    # Request Body
    payload = {
        "page": page,
        "row": row,
        "order": "desc"  # Latest blocks first
    }

    try:
        response = requests.post(API_URL, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

        if data.get('code') == 0:
            blocks = data.get('data', {}).get('blocks', [])
            total = data.get('data', {}).get('count', 0)
            
            print(f"\nFetched {len(blocks)} blocks out of {total} total blocks")
            
            total_data_size = 0
            total_data_count = 0
            total_extrinsics_count = 0  
            total_events_count = 0      
            
            
            # Process each block
            for block in blocks:
                block_num = block.get('block_num')
                timestamp = datetime.fromtimestamp(block.get('block_timestamp'))
                extrinsics = block.get('extrinsics_count', 0)
                additional_meta = block.get('additional_meta', {})
                
                # Extract data submission metrics
                extrinsics_data_count = block.get('extrinsics_count', 0)
                events_data_count = block.get('event_count', 0)

                # Update totals
                total_extrinsics_count += extrinsics_data_count
                total_events_count += events_data_count

                # Additional block details if needed

                # print(f"\nBlock #{block_num}")
                # print(f"Timestamp: {timestamp}")
                # print(f"Extrinsics count: {extrinsics}")
                # print(f"Block hash: {block.get('hash')}")
                # print(f"additional_meta: {additional_meta}")
                # print("-" * 50)

            # Calculate averages
            avg_data_size = total_data_size / len(blocks) if blocks else 0
            avg_data_count = total_data_count / len(blocks) if blocks else 0
            
            print("\nSummary Statistics:")
            print(f"Total extrinsics submissions: {total_extrinsics_count}")
            print(f"Total events submissions: {total_events_count}")

            return blocks
        
        else:
            return f"API Error: {data.get('message', 'Unknown error')}"

    except requests.exceptions.RequestException as e:
        return f"Request failed: {str(e)}"
    
def calculate_tps(blocks):
                """
                Calculate TPS from block data
                """
                if not blocks:
                    return 0
                
                # Get first and last block timestamps
                first_block = blocks[-1]  # Since blocks are in desc order
                last_block = blocks[0]
                
                start_time = first_block.get('block_timestamp')
                end_time = last_block.get('block_timestamp')
                
                # Calculate time difference
                time_diff = end_time - start_time
                if time_diff <= 0:
                    return 0
                
                # Sum all extrinsics
                total_extrinsics = sum(block.get('extrinsics_count', 0) for block in blocks)
                
                # Calculate TPS
                tps = total_extrinsics / time_diff
                return tps

import requests
from datetime import datetime

def fetch_tps_data():
    """
    Fetch TPS data from Avail using Subscan API
    """
    blocks = fetch_block_info(page=0, row=100)
    tps = 0
    if isinstance(blocks, list):
        # Calculate TPS
        tps = calculate_tps(blocks)
        
        print("\nTPS Analysis:")
        print(f"Transactions Per Second: {tps:.2f}")
        print(f"Sample Period: {len(blocks)} blocks")
        
        # Calculate data submission rate
        first_time = blocks[-1].get('block_timestamp')
        last_time = blocks[0].get('block_timestamp')
        time_period = last_time - first_time
        
        if time_period > 0:
            data_rate = sum(
                block.get('additional_meta', {}).get('submit_data_size', 0) 
                for block in blocks
            ) / time_period / 1024  # KB/s
            
            print(f"Data Submission Rate: {data_rate:.2f} KB/s")
        
        return tps

    else:
        print(f"Error: {blocks}")
        return 0.0



if __name__ == "__main__":
    blocks = fetch_block_info(page=0, row=100)
    
    if isinstance(blocks, list):
        # Calculate TPS
        tps = calculate_tps(blocks)
        
        print("\nTPS Analysis:")
        print(f"Transactions Per Second: {tps:.2f}")
        print(f"Sample Period: {len(blocks)} blocks")
        
        # Calculate data submission rate
        first_time = blocks[-1].get('block_timestamp')
        last_time = blocks[0].get('block_timestamp')
        time_period = last_time - first_time
        
    else:
        print(f"Error: {blocks}")