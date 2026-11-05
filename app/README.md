# Donkey of the Day — self-hosted web version (2.6)

Your friends open a normal web address, type a name and play. No account needed.
The server is the referee: it shuffles, deals, checks every move, runs the bots and timers,
and sends each player **only their own cards**. Nobody's phone has to stay open as "host".

## What's in 2.6: the Lab 2.6 game, ported to the server

Everything from the Lab 2.6 source (`../donkey-of-the-day-v2.6-lab`) now runs here, with the server as referee.

| Lab 2.6 feature | In the web app |
|---|---|
| **Donkey's Shuffle Power** | 11 shuffle modes, each locked to its own deal style (Shuffle = Deal), secret shuffles, "Gadhe Ki Marzi". The Donkey picks the shuffle, the player on their left cuts the deck (Gaddi Kaat: cut, Double Kaat, Thak-Thak). The engine is the Lab engine, unchanged. |
| **Magic cards** | Peek, Shield, Swap, Reverse. The first player out each hand earns one. A Peek result is sent only to the player who used it. |
| **Bet on the Donkey, Mute the Donkey** | Host switches in the lobby ("Fun rules"). Mute the Donkey is enforced by the server as well as hidden in the page. Turns are 90 seconds. |
| **Commentary** | Bablu Bhaiya (Bhojpuri) and Commentator Chacha (cricket), Halka and Teekha tiers, the Lab's 87 lines with names, nicknames and inside jokes filled in. Final-two drumroll, hee-haw and fanfare sound effects. The phone's built-in voice is **gone**; a line plays a recording when one exists on the server (see "Adding the commentary voices"), otherwise it is text in the strip. |
| **Nicknames and inside jokes** | Shared by the room, used in commentary. Filtered in public rooms. |
| **Throws** | Tomato, chappal, egg, rose, hee-haw, thrown at a player. The server checks and rate-limits them, and bots answer back. |
| **Final showdown, stats, rivalries, comeback badge, donkey ears / chappal garland** | As in the Lab. |
| **Hall of Shame** | One shared leaderboard for every online room, kept by the server (`data/hall.json`), with titles, monthly counts and every Donkey of the Day. It shows **display names only**; a player who deletes their data has their name removed from past entries. |
| **XP, levels, daily challenge, themes, card backs** | The Lab kept these on one device. They are now stored on the server per player (under the Google account when signed in), so they follow the player to any device. The server decides XP and challenges from what happens at the table. 100 XP per level; five table colours and five card backs unlock at levels 1 to 5. The daily challenge rolls over at midnight IST (`GAME_TZ_OFFSET_MIN` changes it). |

The Lab's own simulation scripts live in `sim/` and run as part of `npm test`.

## What's new in 2.1 (from the Web App Porting Plan)

| Plan item | What it does now |
|---|---|
| **No song gate** | Start works as soon as every seat is filled (people plus bots). There is no Ready button and no "choose music" step. **Fill with bots** completes the table. |
| **30-song catalog** | 30 slots in five moods (8 chill, 8 masti, 6 tension, 4 retro, 4 devotional). The server stores which track plays and when it started, and every phone seeks to the same second. Any seated player can change the song at any time (no 30-second lock). The player with the most losses can't. Until you add recorded files, each slot plays a built-in synthesized track, so the room always has sound. |
| **Live commentary** | See 2.6 above: the Lab's commentators and lines, played from recordings instead of the phone's voice. Every phone picks the same line for the same event, because the choice is seeded by the match and event number in the server's state. Audio is unlocked by the first tap (iPhone silent-switch workaround included) and the music dips while a recording plays. |
| **First-tap audio** | The first tap or key press anywhere starts the room music and unlocks commentary. |
| **Reconnects** | A dropped phone keeps its seat. Reconnecting replays the full state. If it is the dropped player's turn the table waits 15 seconds, not 90, then a move is made for them. After two automatic moves the game pauses up to 2 minutes for them. |
| **Rooms** | A room with nobody connected for 30 minutes is saved and closed, and reloads when someone joins its code. Every move is saved. A server restart resumes every room. Saved rooms expire after 72 hours. |
| **Public vs private rooms** | Creating a room is private by default. A public room filters chat and nicknames and **turns song uploads off** (avoids copyright takedowns). Private rooms can still upload songs. |
| **Moderation** | Report button on each chat message (written to `data/reports.jsonl`), per-device Mute, rate limits on moves, chat, reactions, reports, uploads and room creation, all text escaped before display. |
| **Progress + Google sign-in** | XP, levels, stats and a Hall of Shame, stored on the server. Players can **Sign in with Google** (My profile) so progress follows them to any device; without signing in, progress belongs to the browser. Only the Google account ID and name are stored. **Download my data / Delete my data** covers access and erasure. |
| **PWA** | Installable (manifest, icons, service worker). |
| **Security** | Content-Security-Policy with no inline scripts, HSTS behind HTTPS, nosniff, frame protection, `trust proxy`, one room's error can't take the others down, dependency audit clean. |
| **Legal drafts** | `/privacy.html` and `/terms.html` describe what the software actually does. They contain `[bracketed]` placeholders and **must be completed and reviewed by a lawyer** before a public launch. |

### Not in this version
* **Phone OTP login and Supabase** (Google login is built), **Cloudflare/CDN**, **Vite + TypeScript rewrite** (the existing page already runs as shipped; a rewrite would add risk for no player-visible change).
* **Recorded songs and commentary voices.** The catalog and the line bank are ready; the audio files are yours to add (below). The Lab bank has 87 lines, fewer than the plan's ~400, so more lines need writing.
* Android/iOS store wrappers.

## What's in this folder

| Path | What it is |
|---|---|
| `server.js` | The game server (Node.js + Socket.IO + Express) |
| `lib/` | Word filter, rate limiter, player profiles, Hall of Shame, Google sign-in, shared-rules loader |
| `shared/` | Rules engine + bots (`engine.js`, from the Lab), the 30-song catalog (`catalog.js`), music (`music.js`), the Lab commentary bank and throws (`commentary.js`), XP/challenge/theme tables (`progress.js`), room logic (`host.js`). The server and the browser load these same files |
| `public/` | The page (`index.html`, `app.js`), PWA files, privacy and terms |
| `deploy/` | nginx config and pm2 process file for a VPS |
| `scripts/` | `loadtest.js`, `commentary-script.js` (recording sheet), `make-icons.js`, `testkit.js` |
| `sim/` | The Lab 2.6 simulation scripts (60 bot matches, magic cards, shuffle shapes) |
| `test/` | `npm test` (rules, Lab simulations, rooms, privacy of hands, shuffle flow, moderation, restart, Google sign-in) |
| `data/` | Created at runtime. **Back this up.** (rooms, profiles, identities, reports, uploads, `audio/`) |

## 1. Try it on your own computer
```
npm install
npm start
```
Open **http://localhost:3000**. Friends on the same Wi-Fi join at `http://YOUR-COMPUTER-IP:3000`.
Run `npm test` to check everything, and `npm run loadtest -- --rooms 20 --minutes 2` for a load test.

## 2. Deploy on the VPS (Docker + nginx)
The repository root has a `docker-compose.yml`. On the server:
```
git clone <your repo> donkey-of-the-day && cd donkey-of-the-day
cp .env.example .env && nano .env          # paste GOOGLE_CLIENT_ID (optional, see "Switching on Google sign-in")
docker compose up -d --build               # builds and starts the game on 127.0.0.1:3000
```
nginx is already in front with HTTPS (certbot); use the config in `deploy/nginx.conf` (it adds `X-Forwarded-Proto` and the upload size limit to your existing one), then `sudo nginx -t && sudo systemctl reload nginx`.

### Adding music on the VPS

The VPS does not play audio itself. It serves the files over HTTPS, and every player's browser plays
the selected track locally. The repository-level `music/` folder is mounted into the container. The
files can keep their human-readable names:

```
music/Aankh Marey.mp3
music/Kala Chashma.mp3
music/Zingaat.mp3
```

The ID-to-title mapping is in `app/data/audio/titles.json`; it makes `Aankh Marey.mp3` play for
catalog slot `chill-01`, for example. The complete list of IDs is in `shared/catalog.js`. The server
publishes the mapped files through `/audio/music/`. The Docker image includes the title mapping and
the compose file mounts only the music directory; this avoids nested read-only Docker mounts. After
copying or replacing files on the VPS, restart the container:

```
docker compose restart donkey
```

Players must tap the game once before audio can start because browsers block autoplay. Use only music
you have permission to stream; public-room uploads are intentionally disabled.

* **Update:** `git pull && docker compose up -d --build`. Rooms are saved on shutdown and resume.
* **Logs / status / health:** `docker compose logs -f donkey`, `docker compose ps`, `curl http://127.0.0.1:3000/healthz`.
* **Data** (rooms, profiles, Hall of Shame, reports and uploads) lives in the Docker volume `donkey-data`, so it survives rebuilds. Recorded audio is kept in `app/data/audio` on the VPS. Back up both locations.
  `docker run --rm -v donkey-of-the-day_donkey-data:/data -v "$PWD":/out alpine tar czf /out/donkey-backup-$(date +%F).tgz -C /data .`
* **Settings** are environment variables in `.env` (table below). After editing, `docker compose up -d` applies them.
* **Moderation reports:** `docker compose exec donkey tail -n 20 /data/reports.jsonl`.

The container runs as a non-root user, the port is bound to localhost only (nothing but nginx can reach it), and Docker restarts it after a crash or reboot. If you do not use Docker, `deploy/ecosystem.config.js` is a pm2 alternative.

## 3. Adding the 30 songs and the commentary voices

Files go in the audio folder (`$DATA_DIR/audio`, or set `AUDIO_DIR`). With the repository's Docker
compose setup, music goes in the repository-level `music/` folder and commentary goes in
`app/data/audio/commentary/`. The server lists what exists at
`/audio/manifest.json`; a clip or track is used only when its file is present, and everything else
falls back to text or synth. No restart is needed.

* **Music:** human-readable files such as `music/Aankh Marey.mp3` are mapped through `audio/titles.json` to catalog IDs such as `chill-01`. MP3 at 128 kbps, 2–3 minutes. Keep the title mapping updated when tracks are replaced.
* **Commentary:** `audio/commentary/<line id>.mp3`, for example `bablu.base.cut.2.mp3` or `chacha.spicy.donkey.0.mp3`. Generate the recording sheet with `node scripts/commentary-script.js > commentary-recording-sheet.csv`. Record each "say this" line, export short MP3 clips, and preserve the exact `id` as the filename. Many lines contain player names (`{u}`, `{to}`): record the neutral wording from the sheet; the screen still shows the real names. Add new lines only to the **end** of a list in `shared/commentary.js` so existing IDs never change.

On the VPS, create the folder and copy the clips:

```
mkdir -p app/data/audio/commentary
# Copy files such as bablu.base.cut.2.mp3 into that folder
docker compose up -d --build --force-recreate
curl http://127.0.0.1:3000/audio/manifest.json
```

The manifest's `commentary` object should list the uploaded clip IDs. Players must tap the game once
to unlock browser audio. Clips are downloaded and played by each player's browser; the VPS only serves
them. Missing clips safely fall back to on-screen commentary.
* **Licensing and consent come first.** Use tracks whose licence covers in-app use, or commission them. Get **signed consent** from every voice artist (or from the person whose voice is cloned) before recording.

`.wav`, `.m4a` and `.ogg` are also accepted by the server.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `DATA_DIR` | `./data` | Where rooms, profiles, identities, reports and uploads are saved |
| `AUDIO_DIR` | `$DATA_DIR/audio` | Recorded music and commentary |
| `MAX_ROOMS` | `500` | Upper limit on open rooms |
| `PUBLIC_ROOMS` | `1` | `0` disables public rooms (everything is invite-only) |
| `IDLE_CLOSE_MIN` | `30` | Minutes with nobody connected before a room is saved and closed |
| `ROOM_TTL_HOURS` | `72` | Saved rooms older than this are deleted |
| `GAME_TZ_OFFSET_MIN` | `330` | Minutes from UTC where the daily challenge rolls over (330 = IST) |
| `GOOGLE_CLIENT_ID` | none | Google OAuth client id. Setting it switches on Sign in with Google |
| `BANNED_WORDS` | none | Extra comma-separated words for the public-room filter |

## Switching on Google sign-in
1. In [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
2. Add **Authorized JavaScript origins**: `https://aajkagadha.tech` (and `https://www.aajkagadha.tech`). No redirect URI is needed.
3. Configure the **OAuth consent screen** (app name, support email, privacy policy link `https://aajkagadha.tech/privacy.html`, terms link) and publish it, so players outside your test list can sign in.
4. Put the client ID in `.env` as `GOOGLE_CLIENT_ID=...` on the server and run `docker compose up -d`.

The server verifies every Google token itself (signature, audience, expiry and a one-time nonce), so a stolen token cannot be replayed from another browser.

## Moderating
Reports are appended to `data/reports.jsonl`, one JSON object per line (time, room, reporter, reported player id, the message). Review with `tail -n 20 data/reports.jsonl`. Extend the filter with `BANNED_WORDS`.

## Good to know
* **Limits:** 20 MB per song, 30 songs per room, 240-character chat messages, rate limits per player.
* **Scale:** one process holds every room in memory. The load test (20 rooms, 100 connections, localhost) showed 2 ms p95 round trips and about 0.04 of a core. Real-network latency and an hour-long run are still yours to measure on the VPS: run `npm run loadtest -- --url https://your-domain --rooms 20 --minutes 60`. Past a few hundred rooms you would need sticky sessions and shared state.
* **Tests:** `npm test` runs the Lab simulations (60 full bot matches with every rule on, magic cards, shuffle shapes) and the web app's own tests, including the shuffle/cut/deal flow over the real server and the Google sign-in flow against a local fake key server.
* **Songs uploaded to private rooms:** players upload their own files. Only share music you're allowed to share.
