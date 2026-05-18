#!/bin/bash
echo "=== RegulaForge Startup ==="
echo "Working dir: $(pwd)"
echo "Files: $(ls -la)"

# Start Lobster Trap in background
if [ -f "./lobstertrap-linux" ]; then
  chmod +x ./lobstertrap-linux
  mkdir -p configs
  cp ../policies/finance_combined_policy.yaml configs/default_policy.yaml 2>/dev/null && echo "Policy copied OK" || echo "Policy copy failed, using default"
  ./lobstertrap-linux serve --listen :8081 &
  sleep 1
  echo "Lobster Trap started on port 8081"
else
  echo "WARNING: lobstertrap-linux not found in $(pwd)"
fi

# Start FastAPI
exec uvicorn app.main:app --host 0.0.0.0 --port $PORT
