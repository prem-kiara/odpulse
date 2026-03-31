#!/bin/bash
# ─── OD Pulse Deployment Script ─────────────────────────────────────────────
# Run this on EC2: bash deploy.sh
# SAFE: Only touches the 'odpulse-api' PM2 process. Does NOT affect other
#       PM2 services running on this machine.
# ─────────────────────────────────────────────────────────────────────────────

set -e
APP_DIR="/home/ubuntu/odpulse"
API_NAME="odpulse-api"
API_PORT=3001
cd "$APP_DIR"

echo "=== OD Pulse Deployment ==="
echo ""

# 0. Show existing PM2 processes (safety check)
echo "[0/7] Current PM2 processes (will NOT be touched):"
pm2 list 2>/dev/null || echo "  (PM2 not yet installed)"
echo ""

# Check port 3001 is not in use by another process
if lsof -i :$API_PORT -sTCP:LISTEN -t 2>/dev/null | head -1 | grep -q .; then
  EXISTING_PID=$(lsof -i :$API_PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
  EXISTING_NAME=$(ps -p "$EXISTING_PID" -o comm= 2>/dev/null || echo "unknown")
  # Check if it's our own process
  if pm2 pid $API_NAME 2>/dev/null | grep -q "$EXISTING_PID"; then
    echo "  Port $API_PORT is used by our own $API_NAME process — will restart it."
  else
    echo "  ERROR: Port $API_PORT is already in use by '$EXISTING_NAME' (PID $EXISTING_PID)."
    echo "  Please free up port $API_PORT or change API_PORT in this script and server/index.js."
    exit 1
  fi
fi

# 1. Pull latest code
echo "[1/7] Pulling latest code..."
git pull origin main

# 2. Install frontend dependencies & build
echo "[2/7] Installing frontend dependencies..."
npm install

echo "[3/7] Building frontend..."
npm run build

# 3. Install server dependencies
echo "[4/7] Installing server dependencies..."
cd server
npm install
cd ..

# 4. Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
  echo "[5/7] Installing PM2..."
  sudo npm install -g pm2
else
  echo "[5/7] PM2 already installed."
fi

# 5. Start/restart ONLY the odpulse-api process (leaves other PM2 apps untouched)
echo "[6/7] Starting $API_NAME with PM2 (other processes untouched)..."
if pm2 describe $API_NAME > /dev/null 2>&1; then
  # Process exists — just restart it
  pm2 restart $API_NAME
else
  # First time — create it
  pm2 start server/index.js --name $API_NAME
fi
# Save all processes (preserves existing ones)
pm2 save

# Set PM2 to auto-start on reboot (safe to run multiple times)
pm2 startup 2>/dev/null || true

# 6. Update Nginx config & reload
echo "[7/7] Updating Nginx..."
sudo cp nginx-odpulse.conf /etc/nginx/sites-available/odpulse
sudo ln -sf /etc/nginx/sites-available/odpulse /etc/nginx/sites-enabled/odpulse
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "  Frontend: https://odpulse.dhanamfinance.com"
echo "  API:      https://odpulse.dhanamfinance.com/api/health"
echo "  Data dir: $APP_DIR/server/data/"
echo ""
echo "All PM2 processes after deploy:"
pm2 list
echo ""
echo "To view API logs:  pm2 logs $API_NAME"
echo "To set up email reminders, configure SMTP:"
echo "  pm2 delete $API_NAME"
echo "  SMTP_USER=your@gmail.com SMTP_PASS=your_app_password pm2 start server/index.js --name $API_NAME"
echo "  pm2 save"
