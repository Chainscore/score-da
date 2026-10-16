# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
# Active DA tests for Avail. Keys come from environment variables (see ../README.md).
#   docker build -t da-active-avail protocol/active-tests/Avail
#   docker run --rm -e SEED=... da-active-avail node <script>.js
FROM node:20-slim
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages requests substrate-interface py-near aiohttp python-dotenv
WORKDIR /app
COPY . .
RUN if [ -f package.json ]; then npm install; fi
CMD ["bash"]
