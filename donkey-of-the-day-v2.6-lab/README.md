# Donkey of the Day — v2.6 Lab (source)

Online multiplayer version of the house card game, as published on claude.ai on 3 Nov 2026.

## What's in this zip

| Path | What it is |
| --- | --- |
| `index.html` | The whole game: rules engine, bots, screens, styles, commentary, shuffle power, magic cards, stats. One self-contained file. |
| `tools/engine.js` | The rules engine copied out of `index.html` so it can run in Node.js (same code). |
| `tests/sim-60-matches.js` | Plays 60 full bot matches with every rule on and checks no card is lost or duplicated. |
| `tests/magic-cards.js` | Stress-tests Peek, Shield, Swap and Reverse. |
| `tests/shuffle-deal-shapes.js` | Measures how each shuffle + deal style shapes the hands. |

Run the tests with Node.js 18 or newer:

```
node tests/sim-60-matches.js
node tests/magic-cards.js
node tests/shuffle-deal-shapes.js
```

## Running the game

- **Practice vs bots:** open `index.html` in any modern browser. Practice mode works offline.
- **Online rooms, chat, music sync, Hall of Shame:** these use claude.ai's artifact runtime
  (`window.claude.use('room' | 'db' | 'user' | 'assets')`), so they only work when the page is
  published as a claude.ai artifact. For your own website, replace these four services with your
  own backend, as described in the Web App Porting Plan doc.

## Version notes (2.6 Lab)

- Each shuffle mode is locked to its own deal style (Shuffle = Deal).
- Donkey's Shuffle Power, Gaddi Kaat, magic cards, Blitz, Bet on the Donkey, daily challenge,
  stats and rivalries, XP themes and card backs, nicknames and inside jokes.
- Known issues: phone-voice commentary and music are unreliable on some devices; parked for the web app.
