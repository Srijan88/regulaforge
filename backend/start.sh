#!/bin/bash
echo "=== RegulaForge Startup ==="
echo "Working dir: $(pwd)"
echo "Files: $(ls -la)"

# Copy policy so LT can find it when Python manager starts it
mkdir -p configs
cp policies/finance_combined_policy.yaml configs/default_policy.yaml 2>/dev/null && echo "Policy copied OK" || echo "Policy copy failed"

# Start FastAPI — Python manager will start LT automatically
exec uvicorn app.main:app --host 0.0.0.0 --port $PORT
