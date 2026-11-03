# Donkey of the Day — Web App Porting Plan

Nov 3, 2026 · @Smith Gonsalves

## Summary

Port Lab 2.6 to a standalone web app at your own domain in about 10–12 weeks. The game logic moves to a server so it no longer depends on the host's phone. The plan is built around four must-haves:

1. **Live commentary that works on every phone and browser.** Use pre-recorded audio clips instead of the browser's built-in voice, which caused the failures you saw.
2. **30 songs ready to play.** They are licensed and streamed from a content delivery network (CDN), with the same song in sync for everyone at the table.
3. **No song gate before Start.** Music becomes optional, so the Start button works as soon as the seats are full.
4. **At least 10 concurrent game rooms running smoothly.** That is about 50 players plus watchers. The design targets 100 rooms, so 10 has wide headroom, and it is proven with a load test before launch.

Success means 10 rooms of 5 players can play for an hour with move delays under 200 ms, commentary plays on Android and iPhone, and no game is ever lost when one phone drops.

## Scope

Everything in Lab 2.6 carries over. The main changes are where the game runs and how audio works.

| Area | Carried over from Lab 2.6 | What changes in the web app |
| --- | --- | --- |
| Core game | Rules engine, cuts, seating and dealer draws, 4 or 5 players, series to 2, 3 or 5 losses | Runs on the server instead of the host's phone |
| Donkey's Shuffle Power | 11 shuffle modes, each with its own deal style, Gaddi Kaat, secret shuffles | Same rules, enforced on the server |
| Magic cards, bets, Blitz | Peek, Shield, Swap, Reverse; Bet on the Donkey; 10-second turns | Same |
| Bots | Easy, Medium, Hard, Pro, conspiracy mode | Bots run on the server and fill empty seats |
| Social | Chat, bubbles, throws, nicknames, inside jokes, Donkey punishments, mute | Chat moderation and a report button added |
| Progress | Hall of Shame, stats, rivalries, daily challenge, XP, themes, card backs | XP and Hall of Shame stored per account, not per device |
| Commentary | Bablu Bhaiya and Chacha line banks, spice levels | Pre-recorded audio replaces the phone voice |
| Music | 4 built-in tracks, uploads | 30 licensed songs; uploads dropped for public rooms |
| Start flow | Every player must pick music before Ready | Music optional; Start works when seats are full |

Out of scope for the first release: Android and iOS store apps (later, as wrappers of the web app), team mode (2 vs 2, rules still open), AI-written roasts and payments.

## Architecture

The game moves from the host's phone to one authoritative server in India. Phones only show the table and send moves.

&#91;embedded content: web app architecture · 6 parts\]

Players connect through Cloudflare. Moves go to the game server, which saves each one to the database, while songs and commentary clips stream straight from audio storage.

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Vite + TypeScript, reusing Lab's screens, installable as a PWA | Fast to port; works on any phone browser |
| Real-time | Colyseus (or Socket.IO) on Node.js | Built for game rooms, reconnects and per-player private state |
| Rules engine | Lab's engine, moved to the server unchanged | Already pure JavaScript and tested over 60 bot matches |
| Database and login | Supabase (Postgres, phone OTP and Google login) | Free tier to start; India region available |
| Audio | Cloudflare R2 storage behind the CDN | Low cost and fast in India |
| Hosting | Small VM or Fly.io / Render in Mumbai | Under 50 ms to most Indian players |

The Lab's host-on-a-phone model and its encryption step go away. The server keeps each hand private and sends a player only their own cards.

## Concurrency: 10 rooms minimum

One small server handles 10 rooms easily, because a card game sends little data. The target is 100 rooms, so the 10-room minimum runs at about a tenth of capacity.

**Load at 10 rooms**

| Measure | At 10 rooms | Design target |
| --- | --- | --- |
| Players | 50 (5 per room) | 500 |
| Watchers | up to 50 | 500 |
| Live connections | about 100 | 1,000 |
| Game messages | about 20 per second | 200 per second |
| Memory for game state | under 10 MB | under 100 MB |

**How each room stays isolated**

- Each room is its own object on the server, with its own timers and bots.
- A crash or bug in one room cannot freeze the others.
- Rooms with no connected players for 30 minutes are saved to the database and closed.

**Reconnects**

- If a phone drops, the seat is held for 2 minutes and a bot plays timed-out moves, as in Lab.
- On reconnect, the server sends the full current state, so nothing is lost.
- Game state is saved after every move, so a server restart resumes every room.

**Proving it before launch**

- Run a load test with k6 or Artillery: 20 rooms of 5 scripted players, 1 hour, twice the minimum.
- Pass criteria: move round trip under 200 ms at the 95th percentile, zero dropped games, server CPU under 60%.
- Repeat at 100 rooms to find the real ceiling.

**Scaling past one server**

Add servers behind a load balancer with sticky sessions, so each room stays on one server, and use Redis to share room lookups. This is only needed well beyond 100 rooms.

## Live commentary

Commentary will play pre-recorded audio clips instead of using the phone's built-in voice. The built-in voice was the root cause of the failures you saw.

**Why it failed in Lab**

- **Browser speech is unreliable.** Chrome on Android often gets stuck after one sentence. Some browser views, like the Claude app on Android, have no voice at all.
- **Hindi voices are missing on many phones,** and no phone has a Bhojpuri voice.
- **Audio is blocked until a tap.** iPhones also mute web audio when the silent switch is on.
- **Audio was shared with the host's device logic,** so timing glitches on one phone affected sound.

**The web design**

1. **Line bank:** about 400 lines across the two commentators (Bablu Bhaiya, Chacha) and the Halka and Teekha levels, tagged by event (cut, big cut, out, final two, Donkey, award, throws, shuffle).
2. **Voices:** record each line once. Either hire 2 Bhojpuri and Hindi voice artists with a signed consent agreement, or generate them with a cloud text-to-speech service using a consented, cloned voice. Save each as a small MP3 of 20–40 KB.
3. **Names:** keep most lines name-free ("Kya cut hai!"). For named lines, record each player's nickname once when they set it, or show the name in text while the clip plays.
4. **Delivery:** clips are bundled into one audio file per commentator, downloaded once (about 2–3 MB) and cached.
5. **Playback:** one audio engine (the Web Audio API) is unlocked by the player's first tap on Join or Start. Music volume dips automatically while a line plays.
6. **Sync:** the server picks the line for each event and sends its ID to everyone. All phones play the same clip at the same moment.
7. **Fallback:** if audio is blocked, the line still shows as text in the commentary strip, and a speaker icon prompts "Tap to turn on sound."

**Done means:** commentary is heard on Chrome for Android, Safari on iPhone (silent switch on and off) and desktop Chrome, Edge and Firefox, with under 300 ms delay from event to sound.

## Music: 30 songs built in

The app ships with 30 licensed instrumental tracks, streamed from a CDN and synced so the whole table hears the same song.

**Licensing comes first.** Bollywood film songs need licences from the music labels and Indian collecting societies such as IPRS and PPL, which is costly for a small app. The safe options are:

- **Royalty-free libraries** that allow use in apps and games, such as Pixabay Music or tracks from paid libraries like Epidemic Sound or Artlist. Check each licence covers in-app use before adding a track.
- **Commissioned tracks:** hire a local composer for 10–15 desi-style instrumentals (dhol, shehnai, chai-stall lo-fi). You own them outright.
- A mix of both is the practical route: about 20 library tracks plus 10 commissioned ones.

**Suggested mix of 30**

| Mood | Tracks | Example feel |
| --- | --- | --- |
| Chill table | 8 | Chai-stall lo-fi, soft sitar |
| Masti | 8 | Dhol beats, wedding band |
| Tension | 6 | Drumroll, filmy suspense, for the final two |
| Retro | 4 | 70s Bollywood-style instrumentals |
| Devotional-light | 4 | Flute, morning raga |

**How playback works**

- Each track is about 2–3 minutes, MP3 at 128 kbps, roughly 3 MB, so all 30 are about 90 MB on the CDN.
- Phones stream only the current song, never the whole library.
- The server stores which track is playing and when it started. Each phone joins at the right second, so everyone hears the same moment.
- Any seated player can change the song at any time, with no 30-second lock. The rule that the player with the most losses can't change music stays, as a Donkey punishment.
- Each player can mute music on their own phone, or switch to their own music app.
- Uploading your own songs stays for private rooms only. It is turned off in public rooms to avoid copyright takedowns.

## Start flow: no song gate

The host can tap Start as soon as every seat is filled. Choosing music is no longer a condition.

**Today in Lab:** each player must choose music before Ready works, and the host's Start stays disabled until everyone is ready.

**In the web app:**

1. Players join with a room code or link. Their seat counts as ready automatically.
2. The host sees Start enabled when the seats are full (humans plus bots).
3. The room's default song starts playing on each phone after that player's first tap anywhere, which browsers require.
4. A small music chip shows the song. Players can change it, mute it or use their own app at any time.
5. The optional Ready toggle is dropped. If a player isn't ready, they say so in chat.

## Security, privacy and fair play

The server is the only source of truth, so cheating by editing the page stops working.

**Fair play**

- Each player's connection receives only their own cards. Other hands never leave the server.
- The server checks every move against the rules and rejects anything illegal.
- Shuffles use a cryptographic random number generator on the server.
- Peek results are sent only to the player who used Peek.

**Application security**

- HTTPS and secure WebSockets (WSS) everywhere, with Cloudflare in front for DDoS protection.
- Login tokens are short-lived and stored in secure cookies.
- Rate limits per player: moves, chat messages and throws.
- Chat, nicknames and jokes are escaped before display to block script injection (XSS), with a profanity filter in public rooms.
- Dependency scanning, an OWASP Top 10 review and a short penetration test before launch.

**Privacy (India's DPDP Act 2023)**

- Collect the minimum: a display name and a phone number or Google account.
- Publish a privacy policy and terms of use.
- Let players download and delete their data from their profile.
- Host data in an India region (Mumbai).

## Delivery roadmap

The web app can launch in about 12 weeks with one full-time developer. The server work comes first, because everything else depends on it.

&#91;embedded content: delivery roadmap · 6 phases, 2 gates\]

Web client and audio overlap with the server work. Neither gate is skipped: if one fails, the next phase waits until it passes. Android and iOS store apps can follow about 4 weeks after launch, as wrappers of the same web app.

## Costs, risks and open decisions

Running costs for 10–100 rooms are roughly ₹3,000–6,000 a month. The bigger one-time costs are music and voices. All figures are approximate and should be checked against current price lists.

**Monthly running costs (approximate)**

| Item | Approx. cost per month |
| --- | --- |
| Game server (2 vCPU, 4 GB, Mumbai region) | ₹1,500–3,000 |
| Database and login (Supabase or similar) | ₹0–2,000 |
| CDN and static hosting (Cloudflare, Vercel) | ₹0–500 |
| Domain (yearly cost spread monthly) | about ₹100 |
| Monitoring and error tracking | ₹0–500 |

**One-time costs (approximate)**

| Item | Approx. cost |
| --- | --- |
| Music library licences or subscription for 20 tracks | ₹0–25,000 |
| 10 commissioned tracks | ₹20,000–60,000 |
| Voice artists for about 400 lines, 2 voices | ₹15,000–50,000 |
| Penetration test | Done in-house by CyberSmithSECURE |

**Risks**

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Music licence doesn't cover in-app use | Takedown or legal notice | Check every track's licence; prefer commissioned tracks |
| Voice cloning without consent | Legal risk under personality-rights rulings | Signed consent from every voice artist |
| One server fails | All rooms pause | Save state after every move; auto-restart; add a second server later |
| Phones block audio | No commentary heard | Text fallback and a tap-to-enable prompt |

**Open decisions for you**

- [ ] Domain name for the game
- [ ] Login method: phone OTP, Google, or both
- [ ] Voice artists or cloned voices for commentary
- [ ] Library tracks, commissioned tracks, or a mix
- [ ] Public rooms at launch, or invite-only for friends first
