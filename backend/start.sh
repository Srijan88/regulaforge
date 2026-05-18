#!/bin/bash
# Start Lobster Trap in background
if [ -f "./lobstertrap-linux" ]; then
  chmod +x ./lobstertrap-linux
  ./lobstertrap-linux serve --port 8080 --policy ./policies/finance_combined_policy.yaml &
  echo "Lobster Trap started on port 8080"
else
  echo "WARNING: lobstertrap-linux binary not found, skipping LT"
fi

# Start FastAPI
uvicorn app.main:app --host 0.0.0.0 --port $PORT
