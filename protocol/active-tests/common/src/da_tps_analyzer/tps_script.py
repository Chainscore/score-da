# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import os
import json
import importlib.util
import sys
from datetime import datetime
import traceback

def import_tps_module(protocol_path, module_name):
    """
    Dynamically import TPS modules from protocol directories
    """
    try:
        full_path = os.path.join(protocol_path, module_name)
        print(f"Loading module from: {full_path}")
        
        spec = importlib.util.spec_from_file_location(module_name, full_path)
        if spec is None:
            print(f"Could not load spec for {module_name}")
            return None
            
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module
    except Exception as e:
        print(f"Error importing {module_name}: {str(e)}")
        print(traceback.format_exc())
        return None

def collect_tps_data():
    """
    Collect TPS data from all protocol implementations
    """
    # Base protocol directory - using absolute path
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    protocol_dir = os.path.join(base_dir, "protocol")
    
    print(f"Protocol directory: {protocol_dir}")
    
    results = {
        "timestamp": datetime.now().isoformat(),
        "protocols": {}
    }
    
    protocols = ["Avail", "Celestia", "Espresso", "Near", "Polkadot"]
    
    for protocol in protocols:
        protocol_path = os.path.join(protocol_dir, protocol)
        tps_file = f"{protocol.lower()}_tps.py"
        
        print(f"\nChecking {protocol}...")
        if not os.path.exists(os.path.join(protocol_path, tps_file)):
            print(f"File not found: {tps_file}")
            results["protocols"][protocol] = {
                "tps": 0,
                "status": "error",
                "error": "TPS file not found"
            }
            continue
            
        try:
            module = import_tps_module(protocol_path, tps_file)
            if module and hasattr(module, 'fetch_tps_data'):
                tps_data = module.fetch_tps_data()
                
                # Ensure numeric TPS value
                if isinstance(tps_data, (dict, list)):
                    print(f"Warning: {protocol} returned complex data structure")
                    tps_value = 0
                else:
                    try:
                        tps_value = float(tps_data)
                    except (TypeError, ValueError):
                        tps_value = 0
                        
                results["protocols"][protocol] = {
                    "tps": tps_value,
                    "status": "success" if tps_value > 0 else "error",
                    "timestamp": datetime.now().isoformat()
                }
            else:
                results["protocols"][protocol] = {
                    "tps": 0,
                    "status": "error",
                    "error": "Invalid module structure"
                }
        except Exception as e:
            print(f"Error processing {protocol}: {str(e)}")
            print(traceback.format_exc())
            results["protocols"][protocol] = {
                "tps": 0,
                "status": "error",
                "error": str(e)
            }
    
    return results

def save_results(results):
    """
    Save results to JSON file
    """
    # Use correct path for data directory
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    output_dir = os.path.join(base_dir, "data")
    os.makedirs(output_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = os.path.join(output_dir, f"tps_results_{timestamp}.json")
    
    with open(filename, 'w') as f:
        json.dump(results, f, indent=4)
    
    print(f"\nResults saved to: {filename}")
    return filename

if __name__ == "__main__":
    try:
        print("Starting TPS data collection...")
        results = collect_tps_data()
        filename = save_results(results)
        
        print("\nTPS Summary:")
        for protocol, data in results["protocols"].items():
            status = "✓" if data["status"] == "success" else "✗"
            print(f"{protocol}: {data['tps']:.2f} TPS {status}")
            if data["status"] == "error" and "error" in data:
                print(f"  Error: {data['error']}")
                
    except Exception as e:
        print(f"Fatal error: {str(e)}")
        print(traceback.format_exc())
        sys.exit(1)