// pm2 process file:  pm2 start deploy/ecosystem.config.js && pm2 save && pm2 startup
module.exports = {
  apps: [{
    name: 'donkey',
    script: 'server.js',
    instances: 1,                       // one process: each room lives in memory on one server
    max_memory_restart: '600M',
    kill_timeout: 8000,                 // lets the server save every room on SIGTERM
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DATA_DIR: '/var/lib/donkey',      // rooms, profiles, identities, reports, uploaded songs and the audio folder
      GOOGLE_CLIENT_ID: '',             // paste the OAuth client id from Google Cloud Console to switch on Sign in with Google
      PUBLIC_ROOMS: '1',                // set to 0 for invite-only
      MAX_ROOMS: 500,
      IDLE_CLOSE_MIN: 30,               // no connected players for this long: room is saved and closed
      ROOM_TTL_HOURS: 72                // saved rooms older than this are deleted
    }
  }]
};
