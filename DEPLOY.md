# OD Pulse — Deployment Guide
## odpulse.dhanamfinance.com → EC2 (3.110.0.79)

---

## STEP 1: Create GitHub Repo & Push Code

On your local machine (or wherever you have the odpulse folder):

```bash
cd odpulse
git init
git add .
git commit -m "Initial commit - OD Pulse MFI Dashboard"
```

Go to GitHub → New Repository → name it `odpulse` → Create (don't add README).

```bash
git remote add origin https://github.com/YOUR_USERNAME/odpulse.git
git branch -M main
git push -u origin main
```

---

## STEP 2: SSH into EC2

```bash
ssh -i your-key.pem ubuntu@3.110.0.79
```

---

## STEP 3: Clone Repo & Build

```bash
cd /home/ubuntu
git clone https://github.com/YOUR_USERNAME/odpulse.git
cd odpulse
```

Install Node dependencies and build:

```bash
npm install
npm run build
```

This creates a `dist/` folder with the static site. That's what Nginx will serve.

---

## STEP 4: Set Up Nginx

Copy the nginx config:

```bash
sudo cp nginx-odpulse.conf /etc/nginx/sites-available/odpulse
sudo ln -s /etc/nginx/sites-available/odpulse /etc/nginx/sites-enabled/odpulse
```

Test the config:

```bash
sudo nginx -t
```

If it says "ok" and "successful", reload:

```bash
sudo systemctl reload nginx
```

At this point, http://odpulse.dhanamfinance.com should work (no HTTPS yet).

---

## STEP 5: Set Up SSL with Certbot

Since you already have Certbot installed (from your other sites):

```bash
sudo certbot --nginx -d odpulse.dhanamfinance.com
```

Follow the prompts. Choose "Redirect HTTP to HTTPS" when asked.

After this, https://odpulse.dhanamfinance.com is live with SSL.

---

## STEP 6: Verify

Open in browser: https://odpulse.dhanamfinance.com

You should see the login screen. Default credentials:
- **Admin:** `admin` / `admin123`
- **Staff:** `staff1` / `staff123`

---

## ALWAYS-ON BACKEND (do this ONCE on EC2)

The frontend is static and served by Nginx — it's always up. The backend Express
API on `:3001` must ALSO be always up, otherwise `/api/od/*/upload` returns
"Backend API unreachable" and staff cannot upload. This section sets that up so
the API auto-restarts on crash AND on reboot.

Pick ONE supervisor. The recommended path is PM2 because pm2 commands are
already referenced below. The alternative is a standalone systemd unit.

### Option A: PM2 (recommended)

```bash
# First-time setup on the EC2 box:
cd /home/ubuntu/odpulse
npm install -g pm2                                   # one-time, global
pm2 start ecosystem.config.js                        # starts odpulse-api on :3001
pm2 save                                             # persist process list
pm2 startup systemd                                   # prints a sudo command — RUN IT
# Copy-paste the `sudo env PATH=$PATH:... pm2 startup systemd -u ubuntu --hp /home/ubuntu`
# command that pm2 emits. That installs a systemd hook so PM2 itself is resurrected
# on reboot, which then resurrects odpulse-api.

# Verify the API is up now AND survives a reboot:
pm2 status
curl -s http://127.0.0.1:3001/api/health | head -c 200
sudo reboot                                           # optional — come back in 30s
pm2 status                                            # should show odpulse-api online
```

Day-to-day commands:

```bash
pm2 logs odpulse-api          # tail live logs
pm2 restart odpulse-api       # after git pull + npm install
pm2 stop odpulse-api          # planned downtime
pm2 monit                     # interactive dashboard
```

### Option B: systemd directly

If you prefer not to use PM2:

```bash
sudo cp /home/ubuntu/odpulse/odpulse-api.service /etc/systemd/system/odpulse-api.service
sudo systemctl daemon-reload
sudo systemctl enable odpulse-api        # starts on every boot, forever
sudo systemctl start odpulse-api
sudo systemctl status odpulse-api        # should say "active (running)"

# Tail logs:
journalctl -u odpulse-api -f
```

DO NOT enable both PM2 and the systemd unit — they will race for port 3001.

### Health check

`/api/health` returns 200 + JSON when the backend is live. Point your uptime
monitor (UptimeRobot / Pingdom / CloudWatch) at:

```
https://odpulse.dhanamfinance.com/api/health
```

If that stops responding, one of PM2 / systemd should restart it within seconds.
If not, SSH in and check `pm2 logs` or `journalctl -u odpulse-api -n 200`.

---

## UPDATING THE APP (Future Deployments)

When you make changes and push to GitHub:

```bash
# SSH into EC2
ssh -i your-key.pem ubuntu@3.110.0.79

# Pull latest code
cd /home/ubuntu/odpulse
git pull origin main

# Frontend: install + build
npm install
npm run build

# Backend: install + rebuild native modules, then restart
cd server
npm install
# better-sqlite3 is a native module — rebuild it to match the server's Node ABI,
# otherwise startup crashes with a NODE_MODULE_VERSION mismatch.
npm rebuild better-sqlite3
cd ..

# Restart the API service (PM2 is used for the Express server).
pm2 restart odpulse-api
```

---

## IF THE NGINX CONFIG CHANGED

After pulling a commit that modifies `nginx-odpulse.conf` (upload size limits,
proxy timeouts, new locations, etc.) the changes don't take effect until you
copy the file and reload nginx:

```bash
sudo cp /home/ubuntu/odpulse/nginx-odpulse.conf /etc/nginx/sites-available/odpulse
sudo nginx -t                       # validate
sudo systemctl reload nginx         # zero-downtime reload
```

Symptom that usually means you forgot this step:
`413 Request Entity Too Large` on big uploads (pool / accrued reports).

---

## RUNTIME DATA FILES — DO NOT COMMIT

`server/data/*.sqlite*`, `users.json`, `entries.json`, `notifications.json`,
and `config.json` are runtime state and are **not tracked in git**. Each
production server owns its own copy. First-time setup:

```bash
mkdir -p /home/ubuntu/odpulse/server/data
# If restoring from backup:
cp /path/to/backup/odpulse.sqlite /home/ubuntu/odpulse/server/data/
# If starting fresh: the server auto-creates the DB on first boot.
```

Taking a backup (recommended: daily cron):

```bash
sqlite3 /home/ubuntu/odpulse/server/data/odpulse.sqlite \
  ".backup /home/ubuntu/backups/odpulse-$(date +%F).sqlite"
```

---

## TROUBLESHOOTING

**"502 Bad Gateway"**
→ Not applicable here (static site, no backend). Check `sudo nginx -t`.

**"Page not found" on refresh**
→ The `try_files` rule in nginx config handles this. If missing, re-check `/etc/nginx/sites-available/odpulse`.

**Certbot fails**
→ Make sure DNS has propagated: `dig odpulse.dhanamfinance.com` should show `3.110.0.79`.
→ Make sure port 80 is open in your EC2 security group.

**Build fails on EC2**
→ Check Node version: `node -v` (should be 18+). If old:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## PROJECT STRUCTURE

```
odpulse/
├── index.html          ← Vite entry point
├── package.json        ← Dependencies
├── vite.config.js      ← Build config
├── tailwind.config.js  ← Tailwind CSS config
├── postcss.config.js   ← PostCSS config
├── nginx-odpulse.conf  ← Nginx server block (copy to /etc/nginx/)
├── .gitignore
├── favicon.svg
├── src/
│   ├── main.jsx        ← React entry
│   ├── App.jsx         ← Full dashboard app
│   └── index.css       ← Tailwind imports
└── dist/               ← Built output (generated by `npm run build`)
```
