#!/bin/bash
# Start Lobster Trap in background
if [ -f "./lobstertrap-linux" ]; then
  chmod +x ./lobstertrap-linux
  # Copy policy to current dir so LT can find it
  mkdir -p configs
  cp ../policies/finance_combined_policy.yaml configs/default_policy.yaml 2>/dev/null || true
  ./lobstertrap-linux serve --listen :8081 &
  echo "Lobster Trap started on port 8081"
else
  echo "WARNING: lobstertrap-linux binary not found, skipping LT"
fi

# Start FastAPI
uvicorn app.main:app --host 0.0.0.0 --port $PORT
