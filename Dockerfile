# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
# DA research pipeline image: collect, transform and plot for all six protocols.
# Active-test tools have their own images in protocol/active-tests/<Protocol>/Dockerfile.

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
    cd /app/protocol/Celestia && uv pip install --system -r pyproject.toml

# Install all Node.js dependencies
RUN cd /app/protocol/Avail && npm install && \
    cd /app/protocol/Near && npm install && \
    cd /app/protocol/Polkadot && npm install && \
    cd /app/protocol/Ethereum && npm install

# Copy entrypoint script
COPY collect.sh /app/collect.sh
RUN chmod +x /app/collect.sh

# Set environment variable for Python unbuffered output
ENV PYTHONUNBUFFERED=1

ENTRYPOINT ["/app/collect.sh"]
CMD []
