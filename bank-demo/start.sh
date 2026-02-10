#!/bin/bash
# Security Note: In production, do not hardcode secrets in this file. Load them from a secure vault or .env file.
# These are DEMO secrets for local development.

export BANK_API_KEY="demo-bank-secret"
export FABRIC_JWT_SECRET="fabric-jwt-secret"
export PORT=4000

echo "Starting Bank Demo Server on Port $PORT..."
node server.js
