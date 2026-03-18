module.exports = {
  apps: [{
    name: 'messenger-backend',
    script: 'dist/app.js',
    cwd: '/root/H2V test/messenger-backend',
    env: {
      NODE_ENV: 'production',
      FRONTEND_DIST: '/root/H2V test/frontend/dist'
    }
  }]
};
