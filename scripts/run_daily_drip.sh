#!/bin/bash
# run_daily_drip.sh - Cloud-ready entry point for cron

# 1. Navigate to project root (resolving script location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT" || exit 1

# 2. Load Environment (Optional, as npm start also loads dotenv, 
# but useful if we want to use env vars in shell)
if [ -f .env ]; then
  set -a
  source .env
  set +a
else
  echo "[ERROR] .env file not found at $PROJECT_ROOT"
  exit 1
fi

# 3. Ensure directories
mkdir -p logs
mkdir -p data

# 4. Define log file
LOG_FILE="logs/drip_$(date +%Y-%m-%d_%H%M%S).log"

# 5. Execution with Flock (Singleton)
LOCK_FILE="/tmp/sol-jupiter-drip.lock"

echo "[START] Running DRIP at $(date)" >> "$LOG_FILE"
echo "Node: $(node -v)" >> "$LOG_FILE"

# Use flock to ensure only one instance runs
(
  flock -n 200 || {
    echo "[SKIP] Another instance is already running."
    exit 1
  }
  
  # Run the application
  npm run start -- drip

) 200>"$LOCK_FILE" >> "$LOG_FILE" 2>&1

echo "[END] Finished at $(date)" >> "$LOG_FILE"
