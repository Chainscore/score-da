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

WORKDIR /app/protocol/Avail

# Copy Python dependencies
COPY protocol/Avail/pyproject.toml .

# Install Python dependencies using uv
RUN uv pip install --system -r pyproject.toml

# Copy Python scripts
COPY protocol/Avail/*.py .

# ============================================
# Espresso Protocol Setup
# ============================================
FROM python-base as espresso-python

WORKDIR /app/protocol/Espresso

# Copy Python dependencies
COPY protocol/Espresso/pyproject.toml .

# Install Python dependencies using uv
RUN uv pip install --system -r pyproject.toml

# Copy Python scripts
COPY protocol/Espresso/*.py .

# ============================================
# Near Protocol Setup
# ============================================
FROM python-base as near-python

WORKDIR /app/protocol/Near

# Copy Python dependencies
COPY protocol/Near/pyproject.toml .

# Install Python dependencies using uv
RUN uv pip install --system -r pyproject.toml

# Copy Python scripts
COPY protocol/Near/*.py .

# ============================================
# Celestia Protocol Setup
# ============================================
FROM python-base as celestia-python

WORKDIR /app/protocol/Celestia

# Copy Python dependencies
COPY protocol/Celestia/pyproject.toml .

# Install Python dependencies using uv
RUN uv pip install --system -r pyproject.toml

# Copy any Python scripts (if they exist)
COPY protocol/Celestia/*.py . 2>/dev/null || true

# ============================================
# Node.js Base Setup
# ============================================
FROM node:20-slim as node-base

WORKDIR /app

# ============================================
# Avail Node.js Setup
# ============================================
FROM node-base as avail-node

WORKDIR /app/protocol/Avail

# Copy package files
COPY protocol/Avail/package*.json .

# Install dependencies
RUN npm install

# Copy JavaScript files
COPY protocol/Avail/*.js .

# ============================================
# Polkadot Node.js Setup
# ============================================
FROM node-base as polkadot-node

WORKDIR /app/protocol/Polkadot

# Copy package files
COPY protocol/Polkadot/package*.json .

# Install dependencies
RUN npm install

# Copy JavaScript files
COPY protocol/Polkadot/*.js .

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
RUN cd /app/protocol/Avail && uv pip install --system -r pyproject.toml && \
    cd /app/protocol/Espresso && uv pip install --system -r pyproject.toml && \
    cd /app/protocol/Near && uv pip install --system -r pyproject.toml && \
    cd /app/protocol/Celestia && uv pip install --system -r pyproject.toml

# Install all Node.js dependencies
RUN cd /app/protocol/Avail && npm install && \
    cd /app/protocol/Polkadot && npm install

# Copy README files
COPY protocol/*/README.md /app/protocol/

# Set environment variable for Python unbuffered output
ENV PYTHONUNBUFFERED=1

# Default command
CMD ["/bin/bash"]
