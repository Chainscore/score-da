# Multi-protocol DA Benchmarking Environment
# This Dockerfile sets up all DA protocol testing tools

FROM python:3.11-slim as python-base

# Install uv for Python package management
RUN pip install uv

# Set working directory
WORKDIR /app

# ============================================
# Avail Protocol Setup
# ============================================
FROM python-base as avail-python

WORKDIR /app/protocol/avail

# Copy Python dependencies
COPY protocol/avail/pyproject.toml .

# Install Python dependencies using uv
RUN uv pip install --system -r pyproject.toml

# Copy Python scripts
COPY protocol/avail/*.py .

# ============================================
# Espresso Protocol Setup
# ============================================
FROM python-base as espresso-python

WORKDIR /app/protocol/espresso

# Copy Python dependencies
COPY protocol/espresso/pyproject.toml .

# Install Python dependencies using uv
RUN uv pip install --system -r pyproject.toml

# Copy Python scripts
COPY protocol/espresso/*.py .

# ============================================
# Near Protocol Setup
# ============================================
FROM python-base as near-python

WORKDIR /app/protocol/near

# Copy Python dependencies
COPY protocol/near/pyproject.toml .

# Install Python dependencies using uv
RUN uv pip install --system -r pyproject.toml

# Copy Python scripts
COPY protocol/near/*.py .

# ============================================
# Celestia Protocol Setup
# ============================================
FROM python-base as celestia-python

WORKDIR /app/protocol/celestia

# Copy Python dependencies
COPY protocol/celestia/pyproject.toml .

# Install Python dependencies using uv
RUN uv pip install --system -r pyproject.toml

# Copy any Python scripts (if they exist)
COPY protocol/celestia/*.py . 2>/dev/null || true

# ============================================
# Node.js Base Setup
# ============================================
FROM node:20-slim as node-base

WORKDIR /app

# ============================================
# Avail Node.js Setup
# ============================================
FROM node-base as avail-node

WORKDIR /app/protocol/avail

# Copy package files
COPY protocol/avail/package*.json .

# Install dependencies
RUN npm install

# Copy JavaScript files
COPY protocol/avail/*.js .

# ============================================
# Polkadot Node.js Setup
# ============================================
FROM node-base as polkadot-node

WORKDIR /app/protocol/polkadot

# Copy package files
COPY protocol/polkadot/package*.json .

# Install dependencies
RUN npm install

# Copy JavaScript files
COPY protocol/polkadot/*.js .

# ============================================
# Final Multi-Protocol Image
# ============================================
FROM python:3.11-slim

# Install Node.js and uv
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && pip install uv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy all protocol files
COPY protocol /app/protocol

# Install all Python dependencies
RUN cd /app/protocol/avail && uv pip install --system -r pyproject.toml && \
    cd /app/protocol/espresso && uv pip install --system -r pyproject.toml && \
    cd /app/protocol/near && uv pip install --system -r pyproject.toml && \
    cd /app/protocol/celestia && uv pip install --system -r pyproject.toml

# Install all Node.js dependencies
RUN cd /app/protocol/avail && npm install && \
    cd /app/protocol/near && npm install && \
    cd /app/protocol/polkadot && npm install && \
    cd /app/protocol/ethereum && npm install

# Copy entrypoint script
COPY collect.sh /app/collect.sh
RUN chmod +x /app/collect.sh

# Set environment variable for Python unbuffered output
ENV PYTHONUNBUFFERED=1

ENTRYPOINT ["/app/collect.sh"]
CMD []
