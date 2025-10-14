# DA Research - Protocol Setup

This directory contains testing and analysis tools for multiple Data Availability (DA) protocols.

## Protocols Included

- **Avail**: Substrate-based DA protocol with Python and Node.js tools
- **Espresso**: DA protocol with Python analysis tools
- **Near**: DA protocol with Python tools
- **Polkadot**: Substrate-based protocol with Node.js tools
- **Celestia**: DA protocol (placeholder)

## Setup

### Using Docker (Recommended)

#### Build and run all protocols:
```bash
docker-compose up -d da-research
docker-compose exec da-research bash
```

#### Run individual protocol containers:
```bash
# Avail
docker-compose up -d avail
docker-compose exec avail bash

# Espresso
docker-compose up -d espresso
docker-compose exec espresso bash

# Near
docker-compose up -d near
docker-compose exec near bash

# Polkadot
docker-compose up -d polkadot
docker-compose exec polkadot bash
```

### Local Setup

#### Prerequisites
- Python 3.8+
- Node.js 18+
- [uv](https://github.com/astral-sh/uv) (Python package manager)
- npm (comes with Node.js)

#### Python Dependencies (using uv)

```bash
# Avail
cd protocol/Avail
uv pip install -r pyproject.toml

# Espresso
cd protocol/Espresso
uv pip install -r pyproject.toml

# Near
cd protocol/Near
uv pip install -r pyproject.toml

# Celestia
cd protocol/Celestia
uv pip install -r pyproject.toml
```

#### Node.js Dependencies

```bash
# Avail
cd protocol/Avail
npm install

# Polkadot
cd protocol/Polkadot
npm install
```

## Protocol-Specific Information

### Avail
- **Python Scripts**: Telemetry probing, block bloat testing, more to be added
- **Node.js Scripts**: Data submission, block retrieval
- **Dependencies**: 
  - Python: `substrate-interface`
  - Node.js: `avail-js-sdk`, `dotenv`

### Espresso
- **Python Scripts**: Network analysis, data fetching, more to be added
- **Dependencies**: 
  - Python: `requests`

### Near
- **Python Scripts**: TBA
- **Dependencies**: 
  - Python: `requests`, `py-near`

### Polkadot
- **Node.js Scripts**: Data submission and fee estimation, more to be added
- **Dependencies**: 
  - Node.js: `@polkadot/api`, `@polkadot/util`, `@polkadot/util-crypto`, `bn.js`

### Celestia
- **Status**: TBA
- **Dependencies**: 
  - Python: `requests`

## Environment Variables

Each protocol may require environment variables. Create `.env` files in the respective protocol directories:

```bash
# Avail
echo "SEED=your_seed_phrase" > protocol/Avail/.env

# Polkadot
echo "SEED_PHRASE=your_seed_phrase" > protocol/Polkadot/.env
```

## Running Scripts

### Avail
```bash
# Python
python protocol/Avail/avail_telemetry_probe.py
python protocol/Avail/block_bloat_test.py

# Node.js
cd protocol/Avail
npm start  # or npm run get-block
```

### Espresso
```bash
python protocol/Espresso/espresso_analyzer.py
python protocol/Espresso/espresso-da.py
```

### Polkadot
```bash
cd protocol/Polkadot
npm start
```

## Development

Each protocol has its own dependency file:
- Python protocols: `pyproject.toml` (uv-compatible)
- Node.js protocols: `package.json`

To add dependencies:

```bash
# Python (using uv)
cd protocol/<protocol-name>
uv pip install <package-name>
# Update pyproject.toml manually

# Node.js
cd protocol/<protocol-name>
npm install <package-name>
```

## Docker Commands

```bash
# Build the image
docker-compose build

# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# View logs
docker-compose logs -f da-research

# Remove all containers and volumes
docker-compose down -v
```

## Notes

- All Python dependencies are managed using `uv` for faster installation
- Node.js version 18+ is required for all JavaScript protocols
- Python version 3.8+ is required for all Python scripts
