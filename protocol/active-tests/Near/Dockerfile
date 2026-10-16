# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
# Active DA tests for Near. Keys come from environment variables (see ../README.md).
#   docker build -t da-active-near protocol/active-tests/Near
#   docker run --rm -e SEED=... da-active-near node <script>.js
FROM node:20-slim
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages requests substrate-interface py-near aiohttp python-dotenv
WORKDIR /app
COPY . .
RUN npm install --prefix block_max_txn && npm install --no-save near-api-js@4 dotenv
CMD ["bash"]
