# Donkey of the Day

The card game for friends, live at **https://aajkagadha.tech**.

## Repository layout (monorepo)

| Path | What it is |
|---|---|
| [`app/`](app/) | **The game.** Server (Node.js, Express, Socket.IO), web client, shared rules engine, tests, deployment files. Everything you run or deploy lives here. Start with [`app/README.md`](app/README.md). |
| [`donkey-of-the-day-v2.6-lab/`](donkey-of-the-day-v2.6-lab/) | **Reference only.** The Lab 2.6 source (single-file game, rules engine, bot simulations). Its game is now ported into `app/` (rules engine, fun rules, commentary, Hall of Shame, progress); the Lab's own simulations run in `app/sim/`. Not deployed. |
| `Donkey of the Day — Web App Porting Plan.md` | The porting plan: scope, architecture, costs, risks, open decisions. |

## Website pages

| URL | Page |
|---|---|
| `/` | Landing page (what the game is, how to start). Old invite links `/?room=ABCDE` redirect to `/play?room=ABCDE`. |
| `/play` | The game itself. |
| `/rules` | The full rules guide (setup, tricks, cutting, shuffles, magic cards, bets, timers, FAQ). |
| `/account` | **My games**: optional Google sign-in, rooms you can resume (any device once signed in), match history, signed-in devices (sign out one or all; sessions expire after 90 days idle). |

Guests can always play. The website pages share `app/public/site.css`; the game keeps its own styles in `play.html`.

## Common commands (from this folder)

```
npm run install:app   # install the app's dependencies
npm start             # run the game on http://localhost:3000
npm test              # run the app's tests
npm run loadtest      # load test (see app/README.md)
docker compose up -d --build   # run the whole thing in Docker (what the VPS uses)
```

Or `cd app` and use `npm start`, `npm test` directly. `app/` is self-contained, so it also builds on its own
(`docker build app`) and deploys from there.
