# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
# Active DA tests for Espresso (mainnet query service; no keys needed).
#   docker build -t da-active-espresso protocol/active-tests/Espresso
#   docker run --rm da-active-espresso python3 espresso-da.py
FROM python:3.11-slim
RUN pip install requests aiohttp
WORKDIR /app
COPY . .
CMD ["bash"]
