# Donkey of the Day — self-hosted web version (2.0)

Your friends open a normal web address, type a name and play. No Claude account needed.
The server is the referee: it shuffles, deals, checks every move, runs the bots and timers,
and sends each player **only their own cards**. Nobody's phone has to stay open as "host".

## What's in this folder

| Path | What it is |
|---|---|
| `server.js` | The game server (Node.js + Socket.IO) |
| `shared/` | Rules engine, bots, music tracks and room logic, the same code the browser uses |
| `public/index.html` | The game page players open |
| `data/` | Created at runtime: saved rooms, uploaded songs, player identities. **Back this up.** |
| `Dockerfile` | Optional, for hosts that run containers |

## 1. Try it on your own computer (5 minutes)

1. Install **Node.js 20 or newer** from nodejs.org.
2. Open a terminal in this folder and run:
   ```
   npm install
   npm start
   ```
3. Open **http://localhost:3000** in your browser.
4. Friends on the **same Wi-Fi** can join at `http://YOUR-COMPUTER-IP:3000`.
   (Find the IP in your network settings, for example 192.168.1.20.)

## 2. Put it online so anyone can play

Pick **one** option.

### Option A: Render (easiest, no server admin)
1. Create a free GitHub account and upload this folder as a new repository
   (without `node_modules` and `data`; the included `.gitignore` handles that).
2. On render.com: **New → Web Service → connect the repository**.
3. Settings: Build command `npm install`, Start command `npm start`.
4. To keep rooms and uploaded songs across redeploys, add a **persistent disk** mounted at
   `/data` and set the environment variable `DATA_DIR=/data`.
   Without a disk, everything resets when the service restarts.
5. Render gives you an `https://….onrender.com` address. Share it.
   Free instances go to sleep when idle, so the first visit after a quiet spell can take a while
   to load. Check Render's current plans for always-on and disk options.

### Option B: Railway
Same idea: **New Project → Deploy from GitHub repo**. Add a **Volume** mounted at `/data`
and set `DATA_DIR=/data`. Railway gives you a public `https://` address.

### Option C: Your own Linux server (VPS)
```
# on Ubuntu, as a normal user with sudo
sudo apt install -y nodejs npm nginx
sudo npm install -g pm2
cd donkey-of-the-day && npm install
DATA_DIR=/var/lib/donkey pm2 start server.js --name donkey && pm2 save && pm2 startup
```
Nginx in front (WebSockets need the two `Upgrade` lines):
```
server {
  server_name play.yourdomain.com;
  client_max_body_size 21m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```
Then get free HTTPS with `sudo certbot --nginx -d play.yourdomain.com`.

### Option D: Docker (any container host)
```
docker build -t donkey .
docker run -d -p 3000:3000 -v donkey-data:/data --name donkey donkey
```

### Option E: Fly.io
The repository includes a `fly.toml` for a single-region deployment with a persistent
1 GB volume mounted at `/data`:
```
fly auth login
fly deploy
```
The app is configured for the `bom` region and will be available at
`https://donkey-of-the-day.fly.dev` after deployment.

## 3. Inviting friends
Create a room, then tap **Copy invite**. It copies a link like
`https://your-address/?room=ABCDE`. Anyone who opens it lands on the join screen with the
code filled in. Reloading the page puts a player straight back in their seat.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the server listens on (most hosts set this for you) |
| `DATA_DIR` | `./data` | Where rooms, songs and identities are saved |
| `MAX_ROOMS` | `500` | Upper limit on open rooms |

## Good to know
- **Use HTTPS** when it's on the internet. Each browser keeps a private key that proves who it
  is. HTTPS stops anyone on the network from reading it.
- Built-in limits: 20 MB per song, 30 songs per room, 240-character chat messages,
  rate limiting on moves and chat, and rooms idle for 6 hours are cleaned up.
- **Songs:** players upload their own files. Only share music you're allowed to share.
- **Updating:** replace the files and restart. Saved rooms resume where they left off.
- **Health check:** `GET /healthz` returns `{"ok":true,"rooms":N}`, useful for uptime monitors.
