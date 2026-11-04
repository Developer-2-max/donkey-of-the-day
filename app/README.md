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

* **Update:** `git pull && docker compose up -d --build`. Rooms are saved on shutdown and resume.
* **Logs / status / health:** `docker compose logs -f donkey`, `docker compose ps`, `curl http://127.0.0.1:3000/healthz`.
* **Data** (rooms, profiles, Hall of Shame, reports, uploads, audio) lives in the Docker volume `donkey-data`, so it survives rebuilds. **Back it up:**
  `docker run --rm -v donkey-of-the-day_donkey-data:/data -v "$PWD":/out alpine tar czf /out/donkey-backup-$(date +%F).tgz -C /data .`
* **Settings** are environment variables in `.env` (table below). After editing, `docker compose up -d` applies them.
* **Moderation reports:** `docker compose exec donkey tail -n 20 /data/reports.jsonl`.

The container runs as a non-root user, the port is bound to localhost only (nothing but nginx can reach it), and Docker restarts it after a crash or reboot. If you do not use Docker, `deploy/ecosystem.config.js` is a pm2 alternative.

## 3. Adding the 30 songs and the commentary voices

Files go in the audio folder (`$DATA_DIR/audio`, or set `AUDIO_DIR`). With Docker that folder is inside the `donkey-data` volume: copy files in with `docker compose cp ./my-audio/. donkey:/data/audio/` (for example a `music` and a `commentary` folder), no restart needed. The server lists what exists at `/audio/manifest.json`; a clip or track is used only when its file is present, and everything else falls back to text or synth. No restart is needed.

* **Music:** `audio/music/<id>.mp3` where `<id>` is a catalog id such as `chill-01`, `masti-03`, `tension-02`, `retro-04`, `devotional-01` (the full list is in `shared/catalog.js`). MP3 at 128 kbps, 2–3 minutes. The titles in the catalog are placeholders; rename them there when the real tracks are chosen.
* **Commentary:** `audio/commentary/<line id>.mp3`, for example `bablu.base.cut.2.mp3` or `chacha.spicy.donkey.0.mp3`. Run `node scripts/commentary-script.js > sheet.csv` for the full recording sheet (ID, speaker, on-screen text and a "say this" version). 20–40 KB each. Many Lab lines contain player names ({u}, {to}): a recording can't contain a name, so the sheet gives a neutral spoken stand-in and the screen shows the real names while the clip plays. Add new lines to the **end** of a list in `shared/commentary.js` so existing IDs never change.
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
