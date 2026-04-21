// PM2 process manager config for the OD Pulse API.
// Usage on EC2:
//   pm2 start ecosystem.config.js       # first time
//   pm2 save                            # persist so pm2 resurrect restores on reboot
//   pm2 startup systemd                 # install the systemd hook (prints one sudo command)
//   pm2 restart odpulse-api             # after a deploy
//   pm2 logs odpulse-api                # tail logs
//
// Restart policy: PM2 will restart on crash, on memory > 500MB, and on OOM.
// exp_backoff_restart_delay prevents a hot crash loop from hammering the CPU.

module.exports = {
  apps: [
    {
      name: "odpulse-api",
      cwd: "./server",
      script: "index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      min_uptime: "10s",
      max_restarts: 10,
      exp_backoff_restart_delay: 2000,
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
      env_development: {
        NODE_ENV: "development",
        PORT: 3001,
      },
      // Log paths — pm2 rotates these when pm2-logrotate is installed.
      out_file: "./logs/odpulse-api.out.log",
      error_file: "./logs/odpulse-api.err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
