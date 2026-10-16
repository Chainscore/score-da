# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs

import requests
import json

def fetch_tps_data():
    """
    Fetch TPS data from NEAR Blocks API
    """
    API_URL = "https://api.nearblocks.io/v1/stats"
    
    try:
        response = requests.get(API_URL)
        data = response.json()
        
        if 'stats' in data and len(data['stats']) > 0:
            tps = float(data['stats'][0].get('tps', 0))
            return tps
            
        return 0.0
        
    except Exception as e:
        print(f"NEAR TPS Error: {str(e)}")
        return 0.0
    
if __name__ == "__main__":
    data = fetch_tps_data()
