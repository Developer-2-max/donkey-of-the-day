/* Donkey of the Day — authoritative rules engine (rule version 0.1 defaults) */
(function (root) {
  const SUITS = ['C', 'D', 'H', 'S'];
  const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const RV = {}; RANKS.forEach((r, i) => RV[r] = i + 2);
  const SUIT_NAME = { C: 'Clubs', D: 'Diamonds', H: 'Hearts', S: 'Spades' };
  const T = { seatDraw: 4500, seatOrder: 45000, dealerDraw: 4500, batch: 15000, dealTotal: 120000,
              turn: 90000, handEnd: 5000, trickEnd: 3000, reveal: 20000, ready: 120000, pause: 120000, shuffle: 45000, deckCut: 30000 };
  const suitOf = c => c[0];
  const rankOf = c => RV[c.slice(2)];
  const fullDeck = () => { const d = []; for (const s of SUITS) for (const r of RANKS) d.push(s + '_' + r); return d; };
  function secureRand(n) {
    const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : require('crypto').webcrypto;
    const lim = Math.floor(0x100000000 / n) * n; const a = new Uint32Array(1);
    do { c.getRandomValues(a); } while (a[0] >= lim);
    return a[0] % n;
  }
  function shuffle(arr, rand) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function cardSort(a, b) { return SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || rankOf(a) - rankOf(b); }
  const lowestByOrder = cards => cards.slice().sort((a, b) => rankOf(a) - rankOf(b) || SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)))[0];

  function log(st, msg) { st.log.push(msg); if (st.log.length > 12) st.log.shift(); }
  function ev(st, e, now) { st.events = st.events || []; e.t = now; e.h = st.handNo; e.id = (st.evSeq = (st.evSeq || 0) + 1); st.events.push(e); if (st.events.length > 40) st.events.shift(); }
  const nm = (st, uid) => st.names[uid] || 'Player';
  const SN = s => '[[' + s + ']]';
  const seatUid = (st, i) => st.seats[i];
  const idxOf = (st, uid) => st.seats.indexOf(uid);

  function draw(contenders, rand, wantHigh) {
    const rounds = []; let c = contenders.slice();
    for (let guard = 0; guard < 20; guard++) {
      const deck = shuffle(fullDeck(), rand); const r = {};
      c.forEach((u, i) => r[u] = deck[i]);
      rounds.push(r);
      const vals = c.map(u => rankOf(r[u]));
      const best = wantHigh ? Math.max(...vals) : Math.min(...vals);
      const tied = c.filter(u => rankOf(r[u]) === best);
      if (tied.length === 1) return { rounds, winner: tied[0] };
      c = tied;
    }
    return { rounds, winner: c[0] };
  }

  function createMatch(o) {
    const rand = o.rand || secureRand; const now = o.now;
    const st = { rv: '0.1', v: 1, matchId: o.matchId || ('m' + now.toString(36)), mode: o.mode || 'single', tz: o.tz || 'UTC',
      n: o.players.length, lobby: o.players.map(p => p.uid), names: {}, bots: {}, losses: {}, seats: null,
      phase: 'SEATING_DRAW', deadline: now + T.seatDraw, log: [], history: [], autoCount: {}, handNo: 0,
      startedAt: now, award: null, lastResult: null, pauseFor: null, ready: {} };
    st.targets = Array.isArray(o.targets) ? o.targets.filter(u => o.players.some(p => p.uid === u)) : []; st.hintsOn = !!o.hints && st.targets.length > 0;
    st.levels = {}; st.titleOf = {}; st.target = [2, 3, 5].includes(o.target) ? o.target : 5;
    st.titles = Array.isArray(o.titles) && o.titles.length === 5 && o.titles.every(Array.isArray) ? o.titles.map(l => l.map(t => String(t || '').trim().slice(0, 40)).filter(Boolean)) : null;
    st.style = {};
    { const f = o.fun || {}; st.opts = { shuffle: !!f.shuffle, powers: !!f.powers, blitz: !!f.blitz, bets: !!f.bets }; st.turnMs = st.opts.blitz ? 10000 : T.turn; ensure25(st); }
    o.players.forEach(p => { st.names[p.uid] = p.name; st.bots[p.uid] = !!p.bot; st.losses[p.uid] = 0; if (p.bot) st.levels[p.uid] = p.level || 'medium'; });
    const d = draw(st.lobby, rand, true);
    st.draw = { kind: 'seat', rounds: d.rounds, winner: d.winner };
    log(st, nm(st, d.winner) + ' drew highest and arranges the seating.');
    st._rand = null; // rand is supplied per call
    return st;
  }

  function startHand(st, now, rand) {
    st.handNo++;
    if (st.handNo > 1) st.anchor = (st.anchor + 1) % st.n;
    const n = st.n, base = Math.floor(52 / n), rem = 52 - base * n;
    const q = Array(n).fill(base);
    if (st.mode === 'single') q[st.anchor] += rem; else for (let i = 0; i < rem; i++) q[(st.anchor + i) % n]++;
    st.quotas = q; st.dealt = Array(n).fill(0);
    const prevPile = st.hands ? [...(st.discard || []), ...(st.table || []).map(t => t.c), ...Object.values(st.hands).flat()] : [];
    const pile = prevPile.length === 52 && new Set(prevPile).size === 52 ? prevPile : fullDeck();
    ensure25(st); const shufOn = st.opts.shuffle;
    st.deck = shufOn ? pile : shuffle(fullDeck(), rand);
    st.hands = {}; st.seats.forEach(u => st.hands[u] = []);
    st.table = []; st.discard = []; st.transfer = null; st.led = null; st.trick = null;
    st.finished = {}; st.ready = {}; st.pauseFor = null; st.seen = {}; st.voids = {}; st.known = {}; st.ledBy = {}; st.cutWith = {}; st.shedSeen = {}; st.playedBy = {}; st.highBy = {}; st.trickNo = 0; st.finalView = null;
    st.dealTo = (st.dealer + 1) % n;
    st.phase = 'DEALING'; st.deadline = now + T.batch; st.dealTotal = now + T.dealTotal;
    st.bets = {}; st.firstOut = null; st.reverseNext = false; st.shuf = null;
    if (shufOn) { st.shuf = { by: st.seats[st.dealer], cutter: st.seats[(st.dealer + 1) % n], fresh: pile[0] === 'C_2' && pile[51] === 'S_A' }; st.phase = 'SHUFFLE'; st.deadline = now + T.shuffle; st.dealTotal = null; }
    log(st, nm(st, st.seats[st.dealer]) + ' is dealing hand ' + st.handNo + '.');
  }

  function nextRecipient(st, from) {
    for (let k = 0; k < st.n; k++) { const i = (from + k) % st.n; if (st.dealt[i] < st.quotas[i]) return i; }
    return -1;
  }
  function giveCards(st, count) {
    const r = st.dealTo; const u = st.seats[r];
    for (let k = 0; k < count; k++) st.hands[u].push(st.deck.shift());
    st.hands[u].sort(cardSort);
    st.dealt[r] += count;
    st.dealTo = nextRecipient(st, r + 1);
  }
  function finishDeal(st, now) {
    st.seats.forEach(u => st.hands[u].sort(cardSort));
    if (st.shuf) st.shuf.shape = st.seats.map(u => { const c = {}; st.hands[u].forEach(x => c[suitOf(x)] = (c[suitOf(x)] || 0) + 1); const s = Object.keys(c).sort((a, b) => c[b] - c[a])[0]; return { u, s, n: c[s] || 0, voids: SUITS.filter(x => !c[x]).length }; });
    const holder = st.seats.find(u => st.hands[u].includes('S_A'));
    st.firstTrick = true;
    newTrick(st, idxOf(st, holder), now);
    log(st, nm(st, holder) + ' holds the Ace of Spades and opens.');
  }
  function activeIdx(st) { return st.seats.map((u, i) => i).filter(i => st.hands[st.seats[i]].length > 0); }
  function newTrick(st, leader, now) {
    // D09 (proposed): a position repeating three times in one hand is a stalemate
    const key = leader + '|' + st.seats.map(u => st.hands[u].join(',')).join('/');
    st.seen = st.seen || {}; st.seen[key] = (st.seen[key] || 0) + 1;
    if (st.seen[key] >= 3) {
      const act = activeIdx(st); let d = leader;
      act.forEach(i => { if (st.hands[st.seats[i]].length > st.hands[st.seats[d]].length) d = i; });
      return endHand(st, d, 'The same position repeated three times, so the hand ended as a stalemate. ' + nm(st, st.seats[d]) + ' held the most cards' + (d === leader ? ' (or was due to lead on a tie)' : '') + '.', now);
    }
    const order = []; st.trickNo = (st.trickNo || 0) + 1;
    const dir = st.reverseNext ? -1 : 1; st.reverseNext = false;
    for (let k = 0; k < st.n; k++) { const i = (leader + dir * k + st.n) % st.n; if (st.hands[st.seats[i]].length > 0) order.push(i); }
    st.trick = { leader, order, pos: 0, rev: dir < 0 }; st.table = []; st.led = null;
    st.phase = 'TURN'; st.deadline = now + (st.turnMs || T.turn);
  }
  const actorUid = st => (st.phase === 'TURN' ? st.seats[st.trick.order[st.trick.pos]] : null);

  function highestLedOwner(st) {
    let best = null;
    for (const t of st.table) if (suitOf(t.c) === st.led && (!best || rankOf(t.c) > rankOf(best.c))) best = t;
    return best.s;
  }

  function resolve(st, preferred, finalHigh, now) {
    st.seats.forEach((u, i) => { if (st.hands[u].length === 0 && !st.finished[i]) { st.finished[i] = true; ev(st, { k: 'out', u }, now); onOut(st, u, now); } });
    const act = activeIdx(st);
    if (act.length <= 1) {
      const donkey = act.length === 1 ? act[0] : finalHigh;
      const reason = act.length === 1 ? nm(st, st.seats[donkey]) + ' was the last player holding cards.'
        : 'Everyone emptied their hand on the final trick, so ' + nm(st, st.seats[donkey]) + ', who played its highest card, takes the loss.';
      return endHand(st, donkey, reason, now);
    }
    let leader = preferred;
    if (st.hands[st.seats[leader]].length === 0) for (let k = 1; k <= st.n; k++) { const i = (preferred + k) % st.n; if (st.hands[st.seats[i]].length) { leader = i; break; } }
    if (st.pauseFor) { st.phase = 'PAUSED'; st.pausedLeader = leader; st.deadline = now + T.pause; st.table = []; st.led = null; st.trick = null;
      log(st, 'Paused: waiting for ' + nm(st, st.pauseFor) + ' to come back.'); return; }
    newTrick(st, leader, now);
  }

  function endHand(st, donkeyIdx, reason, now) {
    const u = st.seats[donkeyIdx];
    st.losses[u]++;
    st.lastResult = { handNo: st.handNo, uid: u, reason };
    st.history.push({ handNo: st.handNo, uid: u });
    ensure25(st); st.lastResult.bets = Object.assign({}, st.bets);
    Object.entries(st.bets).forEach(([b, pick]) => { if (pick === u) st.betPts[b] = (st.betPts[b] || 0) + 1; });
    st.seats.forEach(x => { const S = st.stats; if (x === u) S.streak[x] = 0; else { S.streak[x] = (S.streak[x] || 0) + 1; S.best[x] = Math.max(S.best[x] || 0, S.streak[x]); } });
    if (st.titles) { const lvl = st.losses[u] >= st.target ? 5 : Math.min(st.losses[u], 4); st.lastResult.level = lvl;
      const pool = shuffle((st.titles[lvl - 1] || []).filter(t => t !== st.titleOf[u]), secureRand);
      if (pool.length) { st.titleOf[u] = pool[0]; st.levelOf = st.levelOf || {}; st.levelOf[u] = lvl; st.lastResult.title = pool[0]; st.lastResult.titleOptions = pool.slice(1, 4); } }
    ev(st, { k: 'donkey', u, title: st.lastResult.title || null, losses: st.losses[u] }, now);
    st.trick = null; st.table = []; st.led = null; st.dealer = donkeyIdx;
    log(st, nm(st, u) + ' is the Donkey of hand ' + st.handNo + '.');
    st.phase = 'HAND_END'; st.deadline = now + T.handEnd; st.endNext = st.losses[u] >= st.target ? 'MATCH_RESULT' : 'HAND_RESULT';
    if (st.losses[u] >= st.target) {
      let date; try { date = new Intl.DateTimeFormat('en-IN', { timeZone: st.tz, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(now)); } catch (e) { date = new Date(now).toDateString(); }
      st.award = { uid: u, date, at: now, tz: st.tz };
      log(st, nm(st, u) + ' is Donkey of the Day.');
    }
  }

  function legalFor(st, uid) {
    if (st.phase !== 'TURN' || actorUid(st) !== uid) return { play: [], cut: false };
    const h = st.hands[uid];
    if (!st.table.length) return { play: st.firstTrick ? ['S_A'] : h.slice(), cut: false };
    const f = h.filter(c => suitOf(c) === st.led);
    return f.length ? { play: f, cut: false } : { play: [], cut: true };
  }

  function playCard(st, uid, card, now) {
    const h = st.hands[uid];
    if (!h.includes(card)) return 'CARD_NOT_OWNED';
    if (!st.table.length) {
      if (st.firstTrick && card !== 'S_A') return 'MUST_LEAD_ACE';
      st.led = suitOf(card);
      if (!st.firstTrick) { const L = st.ledBy[uid] = st.ledBy[uid] || {}; const sty = st.style[uid] = st.style[uid] || { led: 0, shed: 0 };
        if (!L[st.led]) sty.led++; L[st.led] = (L[st.led] || 0) + 1; }
    } else if (suitOf(card) !== st.led) {
      return h.some(c => suitOf(c) === st.led) ? 'MUST_FOLLOW_SUIT' : 'MUST_CUT';
    }
    { const lead = !st.table.length, prevHi = lead ? 0 : Math.max(...st.table.map(t => rankOf(t.c)));
      (st.playedBy[uid] = st.playedBy[uid] || []).push({ c: card, k: lead ? 'lead' : 'follow', t: st.trickNo });
      // a high card that it did not need to play: either they kept small cards, or they are about to run out of the suit
      if (!st.firstTrick && rankOf(card) >= 11 && (lead || rankOf(card) > prevHi)) { const hb = st.highBy[uid] = st.highBy[uid] || {}; const x = suitOf(card);
        if (!hb[x]) { const sty = st.style[uid] = st.style[uid] || { led: 0, shed: 0 }; sty.hi = (sty.hi || 0) + 1; } hb[x] = (hb[x] || 0) + 1; } }
    h.splice(h.indexOf(card), 1); forget(st, uid, [card]);
    st.table.push({ s: idxOf(st, uid), c: card });
    st.trick.pos++;
    if (st.trick.pos >= st.trick.order.length) {
      // keep the completed trick on the table for a moment so everyone sees the last card
      st.phase = 'TRICK_END'; st.deadline = now + T.trickEnd;
    } else st.deadline = now + (st.turnMs || T.turn);
    return null;
  }

  function finishTrick(st, now) {
    {
      const w = highestLedOwner(st);
      st.discard.push(...st.table.map(t => t.c));
      log(st, 'Everyone followed ' + SN(st.led) + '. ' + nm(st, st.seats[w]) + ' played highest.');
      st.firstTrick = false;
      st.lastTrick = st.table.slice(); st.finalView = { kind: 'clean', cards: st.table.slice(), led: st.led };
      ev(st, { k: 'clean', u: st.seats[w], c: st.table.find(t => t.s === w).c, suit: st.led }, now);
      resolve(st, w, w, now);
    }
  }

  function cutCards(st, uid, cards, now) {
    const h = st.hands[uid];
    if (!st.table.length) return 'CANNOT_CUT_WHEN_LEADING';
    if (h.some(c => suitOf(c) === st.led)) return 'MUST_FOLLOW_SUIT';
    if (!Array.isArray(cards) || !cards.length) return 'EMPTY_CUT';
    if (new Set(cards).size !== cards.length) return 'DUPLICATE_CARDS';
    if (!cards.every(c => h.includes(c))) return 'CARD_NOT_OWNED';
    if (new Set(cards.map(suitOf)).size !== 1) return 'MIXED_CUT_SUITS';
    const giver = idxOf(st, uid), rec = highestLedOwner(st);
    ensure25(st); const recU = st.seats[rec], shielded = st.shield[recU] === st.handNo; if (shielded) delete st.shield[recU];
    { const S = st.stats, tot = cards.length + st.table.length; S.cuts[uid] = (S.cuts[uid] || 0) + 1; S.cards[uid] = (S.cards[uid] || 0) + tot; S.big[uid] = Math.max(S.big[uid] || 0, tot); const rk = uid + '>' + recU; S.rival[rk] = (S.rival[rk] || 0) + 1; }
    st.voids[uid] = Object.assign({}, st.voids[uid], { [st.led]: true });
    { const sty = st.style[uid] = st.style[uid] || { led: 0, shed: 0 }; const k = uid + st.led;
      if (st.ledBy[uid] && st.ledBy[uid][st.led] && !st.shedSeen[k]) { sty.shed++; st.shedSeen[k] = 1; }
      if (st.highBy[uid] && st.highBy[uid][st.led] && !st.shedSeen['h' + k]) { sty.hiCut = (sty.hiCut || 0) + 1; st.shedSeen['h' + k] = 1; }
      const cw = st.cutWith[uid] = st.cutWith[uid] || {}; cw[suitOf(cards[0])] = (cw[suitOf(cards[0])] || 0) + 1; }
    cards.forEach(c => { h.splice(h.indexOf(c), 1); (st.playedBy[uid] = st.playedBy[uid] || []).push({ c, k: 'cut', t: st.trickNo }); }); forget(st, uid, cards);
    ev(st, { k: 'cut', u: uid, to: st.seats[rec], n: cards.length, total: cards.length + st.table.length, suit: suitOf(cards[0]), led: st.led, cards: cards.slice() }, now);
    st.transfer = { giver, recipient: rec, table: st.table.slice(), cut: cards.slice().sort(cardSort), endsAt: now + T.reveal, shield: shielded };
    if (shielded) ev(st, { k: 'shielded', u: recU, to: uid }, now);
    st.table = []; st.firstTrick = false;
    st.phase = 'CUT_REVEAL'; st.deadline = now + T.reveal;
    log(st, nm(st, uid) + ' cut ' + cards.length + ' ' + SN(suitOf(cards[0])) + '. ' + nm(st, st.seats[rec]) + ' picks up ' + (cards.length + st.transfer.table.length) + ' cards.');
    return null;
  }

  function forget(st, uid, cards) { if (st.known && st.known[uid]) st.known[uid] = st.known[uid].filter(c => !cards.includes(c)); }
  function commitTransfer(st, now) {
    const t = st.transfer; const ru = st.seats[t.recipient];
    st.finalView = { kind: 'cut', cards: t.table.slice(), cut: t.cut.slice(), giver: t.giver, recipient: t.recipient };
    const got = [...t.table.map(x => x.c), ...t.cut];
    if (t.shield) { st.discard.push(...got); st.finalView.shield = true; st.transfer = null; return resolve(st, t.giver, null, now); }
    st.hands[ru].push(...got);
    st.hands[ru].sort(cardSort);
    st.known[ru] = (st.known[ru] || []).concat(got);
    if (st.voids[ru]) got.forEach(c => { delete st.voids[ru][suitOf(c)]; });
    got.forEach(c => { if (st.highBy[ru]) delete st.highBy[ru][suitOf(c)]; if (st.ledBy[ru]) delete st.ledBy[ru][suitOf(c)]; if (st.cutWith[ru]) delete st.cutWith[ru][suitOf(c)]; });
    st.transfer = null;
    resolve(st, t.giver, null, now);
  }

  function autoAction(st, now) {
    const uid = actorUid(st), h = st.hands[uid];
    let res;
    if (!st.table.length) res = playCard(st, uid, st.firstTrick ? 'S_A' : lowestByOrder(h), now);
    else {
      const f = h.filter(c => suitOf(c) === st.led);
      res = f.length ? playCard(st, uid, lowestByOrder(f), now) : cutCards(st, uid, [lowestByOrder(h)], now);
    }
    return uid;
  }

  function startMatchPlay(st, now, rand) {
    const d = draw(st.seats, rand, false);
    st.draw = { kind: 'dealer', rounds: d.rounds, winner: d.winner };
    st.phase = 'DEALER_DRAW'; st.deadline = now + T.dealerDraw;
    st.dealer = idxOf(st, d.winner); st.anchor = (st.dealer + 1) % st.n;
    log(st, nm(st, d.winner) + ' drew lowest and deals first.');
  }

  /* apply a player action; returns null or a rejection code */
  function apply(st, uid, a, now, rand) {
    rand = rand || secureRand;
    if (!st.names[uid]) return 'NOT_IN_MATCH';
    const ph = st.phase;
    switch (a.type) {
      case 'SET_SEAT_ORDER': {
        if (ph !== 'SEATING_ORDER') return 'WRONG_PHASE';
        if (uid !== st.draw.winner) return 'NOT_YOUR_TURN';
        const o = a.payload && a.payload.order;
        if (!Array.isArray(o) || o.length !== st.n || new Set(o).size !== st.n || !o.every(u => st.names[u])) return 'INVALID_ORDER';
        st.seats = o.slice(); log(st, 'Seating confirmed.');
        startMatchPlay(st, now, rand); break;
      }
      case 'DEAL_BATCH': {
        if (ph !== 'DEALING') return 'WRONG_PHASE';
        if (uid !== st.seats[st.dealer]) return 'NOT_YOUR_TURN';
        const pc = planCount(st);
        if (pc && a.payload && a.payload.rest) { while (st.dealTo >= 0) giveCards(st, planCount(st)); finishDeal(st, now); break; }
        const c = pc && a.payload && a.payload.plan ? pc : a.payload && a.payload.count, r = st.dealTo;
        if (!Number.isInteger(c) || c < 1 || c > st.quotas[r] - st.dealt[r]) return 'INVALID_BATCH';
        if (pc && c !== pc) return 'WRONG_DEAL_STYLE';
        giveCards(st, c);
        if (st.dealTo < 0) finishDeal(st, now); else st.deadline = Math.min(now + T.batch, st.dealTotal);
        break;
      }
      case 'PLAY_CARD': case 'CUT_CARDS': {
        if (ph !== 'TURN') return 'WRONG_PHASE';
        if (actorUid(st) !== uid) return 'NOT_YOUR_TURN';
        const err = a.type === 'PLAY_CARD' ? playCard(st, uid, a.payload && a.payload.card, now) : cutCards(st, uid, a.payload && a.payload.cards, now);
        if (err) return err;
        st.autoCount[uid] = 0; break;
      }
      case 'READY_NEXT_HAND': {
        if (ph !== 'HAND_RESULT') return 'WRONG_PHASE';
        st.ready[uid] = true;
        if (st.seats.every(u => st.bots[u] || st.ready[u])) startHand(st, now, rand);
        break;
      }
      case 'CROWN': {
        const r = st.lastResult; const name = String((a.payload && a.payload.name) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!r || !st.titles || !['HAND_END', 'HAND_RESULT', 'MATCH_RESULT'].includes(ph)) return 'WRONG_PHASE';
        if (uid === r.uid) return 'NOT_YOUR_TURN';
        if (!name) return 'EMPTY_NAME';
        st.titleOf[r.uid] = name; r.title = name; r.crownedBy = uid; ev(st, { k: 'crown', u: uid, to: r.uid, title: name }, now); log(st, nm(st, uid) + ' crowned ' + nm(st, r.uid) + ' as ' + name + '.'); break;
      }
      case 'SHUFFLE_PICK': { const p = a.payload || {};
        if (ph !== 'SHUFFLE') return 'WRONG_PHASE'; if (uid !== st.shuf.by) return 'NOT_YOUR_TURN';
        if (!SHUF.includes(p.mode)) return 'BAD_MODE'; if (p.mode === st.lastShuf) return 'SAME_SHUFFLE';
        applyShuffle(st, p.mode, !!p.secret, now, rand); break; }
      case 'DECK_CUT': { if (ph !== 'DECK_CUT') return 'WRONG_PHASE'; if (uid !== st.shuf.cutter) return 'NOT_YOUR_TURN'; applyCut(st, a.payload, now, rand); break; }
      case 'USE_POWER': { ensure25(st); const p = a.payload || {}, list = st.powers[uid] || [], i = list.indexOf(p.k);
        if (!st.opts.powers || i < 0) return 'NO_POWER'; if (!['TURN', 'TRICK_END', 'CUT_REVEAL'].includes(ph)) return 'WRONG_PHASE';
        const r = usePower(st, uid, p, now, rand); if (r) return r; list.splice(i, 1); break; }
      case 'BET': { ensure25(st); const p = a.payload || {};
        if (!st.opts.bets || !['TURN', 'TRICK_END', 'CUT_REVEAL'].includes(ph)) return 'WRONG_PHASE';
        if (st.hands[uid].length) return 'NOT_OUT'; if (st.bets[uid]) return 'ALREADY_BET';
        const act = activeIdx(st).map(j => st.seats[j]); if (act.length < 2 || !act.includes(p.pick)) return 'BAD_TARGET';
        st.bets[uid] = p.pick; ev(st, { k: 'bet', u: uid, to: p.pick }, now); log(st, nm(st, uid) + ' bet that ' + nm(st, p.pick) + ' will be the Donkey.'); break; }
      case 'RESUME': {
        if (ph !== 'PAUSED') return 'WRONG_PHASE';
        if (uid !== st.pauseFor) return 'NOT_YOUR_TURN';
        st.autoCount[uid] = 0; st.pauseFor = null; log(st, nm(st, uid) + ' is back.');
        newTrick(st, st.pausedLeader, now); break;
      }
      default: return 'UNKNOWN_ACTION';
    }
    st.v++; return null;
  }

  /* advance deadlines; returns true if state changed */
  function tick(st, now, rand) {
    rand = rand || secureRand;
    if (st.deadline == null || now < st.deadline) {
      if (!(st.phase === 'DEALING' && now >= st.dealTotal)) return false;
    }
    switch (st.phase) {
      case 'SEATING_DRAW': st.phase = 'SEATING_ORDER'; st.deadline = now + T.seatOrder;
        if (st.bots[st.draw.winner]) { st.seats = st.lobby.slice(); startMatchPlay(st, now, rand); } break;
      case 'SEATING_ORDER': st.seats = st.lobby.slice(); log(st, 'Seating time ran out; join order kept.'); startMatchPlay(st, now, rand); break;
      case 'DEALER_DRAW': st.handNo = 0; startHand(st, now, rand); break;
      case 'SHUFFLE': applyShuffle(st, st.lastShuf === 'machine' ? 'riffle7' : 'machine', false, now, rand); log(st, 'Shuffle time ran out, so the machine shuffled.'); break;
      case 'DECK_CUT': applyCut(st, { kind: 'cut', at: 20 + rand(13) }, now, rand); break;
      case 'DEALING': while (st.dealTo >= 0) giveCards(st, planCount(st) || 1); log(st, 'Dealing time ran out; the rest was dealt one card at a time.'); finishDeal(st, now); break;
      case 'TURN': { const u = autoAction(st, now); ev(st, { k: 'auto', u }, now); if (!st.bots[u]) { st.autoCount[u] = (st.autoCount[u] || 0) + 1; log(st, nm(st, u) + "’s move was made automatically.");
          if (st.autoCount[u] >= 2 && !st.pauseFor) st.pauseFor = u; } break; }
      case 'CUT_REVEAL': commitTransfer(st, now); break;
      case 'TRICK_END': finishTrick(st, now); break;
      case 'HAND_END': st.phase = st.endNext; st.deadline = st.phase === 'HAND_RESULT' ? now + T.ready : null; st.ready = {}; break;
      case 'HAND_RESULT': startHand(st, now, rand); break;
      case 'PAUSED': st.phase = 'INCOMPLETE'; st.deadline = null; st.incompleteReason = nm(st, st.pauseFor) + ' did not return.'; break;
      default: return false;
    }
    st.v++; return true;
  }

  /* Probability that each opponent holds NO cards of each suit, from one player's point of view,
     using only public information plus a pattern adjustment: players tend to lead and cut the
     suits they hold few of, to run out of them and earn the right to cut. */
  let HIGH_W = 1.2;
  /* how much a player's high-card plays have actually come before a cut in that suit, learned over the match */
  function highWeight(pv, u) { const s = (pv.style || {})[u] || {}; return HIGH_W * ((s.hiCut || 0) + 0.3) / ((s.hi || 0) + 2); }
  function lambdaFor(pv, u) { const s = (pv.style || {})[u] || { led: 0, shed: 0 }; return 1.4 + 1.6 * (s.shed + 1) / (s.led + 2); }
  function estimate(pv, me, myHand) {
    const seen = new Set([...myHand, ...(pv.discard || []), ...(pv.table || []).map(t => t.c)]);
    if (pv.transfer) [...pv.transfer.table.map(x => x.c), ...pv.transfer.cut].forEach(c => seen.add(c));
    const known = pv.known || {}, voids = pv.voids || {};
    Object.entries(known).forEach(([u, cs]) => { if (u !== me) cs.forEach(c => seen.add(c)); });
    const unknown = fullDeck().filter(c => !seen.has(c));
    const rows = (pv.seats || []).filter(u => u !== me && pv.counts[u] > 0).map(u => {
      const kn = known[u] || [], slots = Math.max(0, pv.counts[u] - kn.length);
      const pool = unknown.filter(c => !(voids[u] && voids[u][suitOf(c)])), N = pool.length;
      const base = {}, adj = {}, why = {}, lam = lambdaFor(pv, u);
      SUITS.forEach(x => {
        if (voids[u] && voids[u][x]) { base[x] = adj[x] = 1; why[x] = 'shown'; return; }
        if (kn.some(c => suitOf(c) === x)) { base[x] = adj[x] = 0; why[x] = 'holds'; return; }
        const k = pool.filter(c => suitOf(c) === x).length; let p = 1;
        if (slots > N - k) p = 0; else for (let i = 0; i < slots; i++) p *= (N - k - i) / (N - i);
        base[x] = p;
        const ev = Math.min(3, ((pv.ledBy || {})[u] || {})[x] || 0) + Math.min(2, ((pv.cutWith || {})[u] || {})[x] || 0) + highWeight(pv, u) * Math.min(2, ((pv.highBy || {})[u] || {})[x] || 0);
        if (ev && p > 0 && p < 1) { const o = p / (1 - p) * Math.pow(lam, ev); adj[x] = Math.min(0.97, o / (1 + o)); why[x] = 'pattern'; } else adj[x] = p;
      });
      return { u, count: pv.counts[u], known: kn, base, pv: adj, why, lam, hw: highWeight(pv, u), shown: voids[u] || {} };
    });
    const otherCount = {}, top = {};
    SUITS.forEach(x => { const cs = [...unknown, ...rows.flatMap(r => r.known)].filter(c => suitOf(c) === x); otherCount[x] = cs.length; top[x] = cs.length ? Math.max(...cs.map(rankOf)) : 0; });
    return { rows, otherCount, top };
  }

  /* conspiracy: pro bots that are not targets work together against the targets.
     They share knowledge of the targets' hands (that is the conspiracy). */
  const isTarget = (st, u) => (st.targets || []).includes(u);
  function conspire(st, uid) {
    if (!st.targets || !st.targets.length || isTarget(st, uid)) return null;
    const h = st.hands[uid], led = st.led, me = idxOf(st, uid);
    const by = {}; h.forEach(c => (by[suitOf(c)] = by[suitOf(c)] || []).push(c));
    Object.values(by).forEach(a => a.sort((x, y) => rankOf(x) - rankOf(y)));
    const tg = st.targets.filter(u => st.hands[u].length > 0);
    if (!tg.length) return null;
    if (st.table.length) {
      const hiI = highestLedOwner(st), hiU = st.seats[hiI];
      const f = by[led] || [];
      if (!f.length) {
        // void: dump the heaviest suit on a target, spare everyone else with one low card
        const ks = Object.keys(by);
        if (isTarget(st, hiU)) { const w = s => by[s].reduce((t, c) => t + Math.pow(rankOf(c), 1.5), 0); const s = ks.sort((a, b) => w(b) - w(a))[0]; return { type: 'CUT_CARDS', payload: { cards: by[s] } }; }
        const low = ks.map(s => by[s][0]).sort((a, b) => rankOf(a) - rankOf(b))[0]; return { type: 'CUT_CARDS', payload: { cards: [low] } };
      }
      const hi = rankOf(st.table.find(t => t.s === hiI).c);
      const rest = st.trick.order.slice(st.trick.pos + 1).map(i => st.seats[i]);
      const under = f.filter(c => rankOf(c) < hi);
      const someoneCuts = rest.some(u => !isTarget(st, u) && !st.hands[u].some(c => suitOf(c) === led));
      // a target is highest and a conspirator after us can cut: stay under
      if (isTarget(st, hiU) && someoneCuts) return { type: 'PLAY_CARD', payload: { card: under.length ? under[under.length - 1] : f[0] } };
      // a target still to play holds a higher card than ours: play low so the target ends up highest
      const tAfter = rest.filter(u => isTarget(st, u));
      if (tAfter.some(u => st.hands[u].some(c => suitOf(c) === led && rankOf(c) > rankOf(f[0])))) return { type: 'PLAY_CARD', payload: { card: f[0] } };
      return null;
    }
    if (st.firstTrick) return null;
    // leading: choose a suit where a target holds the top card and a conspirator later in the order is void
    let best = null;
    for (const s of Object.keys(by)) {
      let sc = 0;
      for (const t of tg) {
        const ts = st.hands[t].filter(c => suitOf(c) === s); if (!ts.length) continue;
        const tTop = Math.max(...ts.map(rankOf));
        const othersTop = st.seats.filter(u => u !== t && st.hands[u].length).map(u => Math.max(0, ...st.hands[u].filter(c => suitOf(c) === s).map(rankOf)));
        if (tTop > Math.max(0, ...othersTop)) sc += 3;
        const order = []; for (let k = 1; k < st.n; k++) { const i = (me + k) % st.n; if (st.hands[st.seats[i]].length) order.push(st.seats[i]); }
        const ti = order.indexOf(t);
        if (order.slice(ti + 1).some(u => !isTarget(st, u) && !st.hands[u].some(c => suitOf(c) === s))) sc += 2;
      }
      if (sc && (!best || sc > best.sc)) best = { s, sc };
    }
    return best ? { type: 'PLAY_CARD', payload: { card: by[best.s][0] } } : null;
  }

  /* private whisper for human allies (non-targets) when hints are on */
  function conspiracyHint(st, uid) {
    if (!st.hintsOn || isTarget(st, uid) || st.bots[uid] || st.phase !== 'TURN' || !st.hands) return null;
    const tg = st.targets.filter(u => st.hands[u].length > 0); if (!tg.length) return null;
    const bots = st.seats.filter(u => st.bots[u] && !isTarget(st, u)); const who = bots.length ? st.names[bots[0]] : 'The bots';
    const h = st.hands[uid], T = tg.map(u => st.names[u]).join(' and ');
    if (actorUid(st) === uid && st.table.length) {
      const hiU = st.seats[highestLedOwner(st)], f = h.filter(c => suitOf(c) === st.led);
      if (!f.length && isTarget(st, hiU)) return who + ' whispers: ' + st.names[hiU] + ' is highest. Cut big, dump your heaviest suit on them.';
      if (!f.length) return who + ' whispers: the pickup goes to a friend. Cut one low card to go easy on them.';
      if (isTarget(st, hiU)) return who + ' whispers: ' + st.names[hiU] + ' is highest. Play under them and let someone cut.';
      const tAfter = st.trick.order.slice(st.trick.pos + 1).map(i => st.seats[i]).filter(u => isTarget(st, u));
      for (const t of tAfter) { const top = st.hands[t].filter(c => suitOf(c) === st.led).sort((a, b) => rankOf(b) - rankOf(a))[0];
        if (top) return who + ' whispers: ' + st.names[t] + ' still holds {{' + top + '}}. Play low and they end up highest.'; }
      return null;
    }
    if (actorUid(st) === uid && !st.table.length && !st.firstTrick) {
      for (const t of tg) { const by = {}; st.hands[t].forEach(c => (by[suitOf(c)] = by[suitOf(c)] || []).push(c));
        for (const s of Object.keys(by)) { if (!h.some(c => suitOf(c) === s)) continue;
          const tTop = Math.max(...by[s].map(rankOf)); const mine = Math.max(...h.filter(c => suitOf(c) === s).map(rankOf));
          if (tTop > mine) return who + ' whispers: ' + st.names[t] + ' holds the higher ' + SN(s) + '. Lead your lowest ' + SN(s) + '.'; } }
    }
    return null;
  }

  /* bot policy: easy | medium | hard | pro */
  function botAction(st, uid, rand, level) {
    rand = rand || secureRand; level = level || (st.levels && st.levels[uid]) || 'medium';
    const ph = st.phase;
    if (ph === 'SHUFFLE' && st.shuf && st.shuf.by === uid) { const ms = SHUF.filter(x => x !== st.lastShuf); return { type: 'SHUFFLE_PICK', payload: { mode: ms[rand(ms.length)], secret: rand(3) === 0 } }; }
    if (ph === 'DECK_CUT' && st.shuf && st.shuf.cutter === uid) { const r = rand(10); return { type: 'DECK_CUT', payload: { kind: r < 6 ? 'cut' : r < 8 ? 'double' : 'knock', at: 8 + rand(37), peek: rand(4) === 0 } }; }
    if (st.opts && st.opts.bets && st.hands && ['TURN', 'TRICK_END'].includes(ph) && !st.hands[uid].length && st.bets && !st.bets[uid]) { const act = activeIdx(st).map(j => st.seats[j]);
      if (act.length >= 2) { const pick = act.slice().sort((x, y) => st.hands[y].length - st.hands[x].length)[0]; return { type: 'BET', payload: { pick } }; } }
    if (ph === 'DEALING' && st.seats[st.dealer] === uid) { const pc = planCount(st); if (pc) return { type: 'DEAL_BATCH', payload: { count: pc } }; const r = st.dealTo; const left = st.quotas[r] - st.dealt[r]; return { type: 'DEAL_BATCH', payload: { count: 1 + rand(Math.min(left, 5)) } }; }
    if (ph !== 'TURN' || actorUid(st) !== uid) return null;
    if (level === 'pro') { const c = conspire(st, uid); if (c) return c; }
    const h = st.hands[uid], me = idxOf(st, uid);
    const by = {}; h.forEach(c => (by[suitOf(c)] = by[suitOf(c)] || []).push(c));
    Object.values(by).forEach(a => a.sort((x, y) => rankOf(x) - rankOf(y)));
    const pick = a => a[rand(a.length)];
    const play = c => ({ type: 'PLAY_CARD', payload: { card: c } });
    const others = st.seats.map((u, i) => i).filter(i => i !== me && st.hands[st.seats[i]].length > 0);
    let est = null; const E = () => est || (est = estimate(publicView(st), uid, h));
    const pVoid = (u, s) => { const r = E().rows.find(x => x.u === u); return r ? r.pv[s] : 0; };
    const voidCount = s => level === 'pro' ? others.reduce((t, i) => t + pVoid(st.seats[i], s), 0) : others.filter(i => st.voids[st.seats[i]] && st.voids[st.seats[i]][s]).length;
    const unseen = s => 13 - st.discard.filter(c => suitOf(c) === s).length - (by[s] || []).length;
    /* leading */
    if (!st.table.length) {
      if (st.firstTrick) return play('S_A');
      if (level === 'easy') return play(pick(h));
      const ks = Object.keys(by);
      if (level === 'medium') { const s = rand(3) ? ks.sort((a, b) => by[b].length - by[a].length)[0] : pick(ks); return play(by[s][0]); }
      // hard / pro: lead a suit no opponent has shown void in, where others still hold cards
      const score = s => voidCount(s) * 10 - (level === 'pro' ? Math.min(unseen(s), others.length) : 0) + (level === 'pro' ? rankOf(by[s][0]) / 20 : 0);
      const safe = ks.slice().sort((a, b) => score(a) - score(b) || rankOf(by[a][0]) - rankOf(by[b][0]));
      const s = rand(8) ? safe[0] : pick(ks);
      return play(by[s][0]);
    }
    const led = st.led, f = by[led] || [];
    /* following */
    if (f.length) {
      if (level === 'easy') return play(pick(f));
      const hi = Math.max(...st.table.filter(t => suitOf(t.c) === led).map(t => rankOf(t.c)));
      const under = f.filter(c => rankOf(c) < hi), over = f.filter(c => rankOf(c) > hi);
      if (level === 'medium') return play(under.length ? under[under.length - 1] : f[f.length - 1]);
      const rest = st.trick.order.slice(st.trick.pos + 1).map(i => st.seats[i]);
      const cutRisk = rest.some(u => st.voids[u] && st.voids[u][led]) || (level === 'pro' && rest.some(u => pVoid(u, led) >= 0.5));
      const last = rest.length === 0;
      if (last || !cutRisk) {
        // nobody can cut after us: winning the trick is safe, so shed the highest card
        if (level === 'pro' || last) return play(f[f.length - 1]);
        return play(under.length ? under[under.length - 1] : f[f.length - 1]);
      }
      // someone after us is void: stay under the current highest if we can
      if (under.length) return play(under[under.length - 1]);
      return play(over[0]);
    }
    /* cutting */
    const ks = Object.keys(by);
    if (level === 'easy') { const s = pick(ks); return { type: 'CUT_CARDS', payload: { cards: [pick(by[s])] } }; }
    if (level === 'medium') {
      const s = rand(4) ? ks.sort((a, b) => rankOf(by[b][by[b].length - 1]) - rankOf(by[a][by[a].length - 1]) || by[b].length - by[a].length)[0] : pick(ks);
      return { type: 'CUT_CARDS', payload: { cards: rand(3) ? by[s] : by[s].slice(-1 - rand(by[s].length)) } };
    }
    const weight = s => by[s].reduce((t, c) => t + (level === 'pro' ? Math.pow(rankOf(c), 1.5) : rankOf(c)), 0);
    const s = ks.sort((a, b) => weight(b) - weight(a))[0];
    return { type: 'CUT_CARDS', payload: { cards: by[s] } };
  }

  function publicView(st) {
    const p = { rv: st.rv, v: st.v, matchId: st.matchId, phase: st.phase, n: st.n, mode: st.mode, tz: st.tz,
      lobby: st.lobby, seats: st.seats, names: st.names, bots: st.bots, losses: st.losses, deadline: st.deadline,
      dealTotal: st.dealTotal || null,
      log: st.log, history: st.history, handNo: st.handNo, award: st.award, lastResult: st.lastResult, draw: st.draw,
      dealer: st.dealer ?? null, target: st.target || 5, levelOf: st.levelOf || {}, endNext: st.endNext || null, style: st.style || {}, levels: st.levels, titleOf: st.titleOf, titles: st.titles, events: st.events || [], targets: st.targets || [], hintsOn: !!st.hintsOn, anchor: st.anchor ?? null, pauseFor: st.pauseFor, ready: st.ready, incompleteReason: st.incompleteReason || null };
    if (st.hands) {
      p.counts = {}; st.seats.forEach((u, i) => p.counts[u] = st.phase === 'DEALING' ? st.dealt[i] : st.hands[u].length);
      p.quotas = st.quotas; p.dealt = st.dealt; p.dealTo = st.dealTo;
      p.table = st.table; p.led = st.led; p.trick = st.trick; p.firstTrick = !!st.firstTrick;
      p.transfer = st.transfer; p.finished = st.finished; p.discardCount = st.discard.length; p.deckCount = st.deck.length;
      p.trickNo = st.trickNo || 0; p.actor = actorUid(st); p.lastTrick = st.lastTrick || null; p.playedBy = st.playedBy || {}; p.highBy = st.highBy || {}; p.finalView = st.finalView || null; p.ledBy = st.ledBy || {}; p.cutWith = st.cutWith || {}; p.voids = st.voids || {}; p.known = st.known || {}; p.discard = st.discard.slice();
    }
    return view25(st, p);
  }
  function privateHand(st, uid) { return (st.hands && st.hands[uid]) ? st.hands[uid].slice() : []; }

  function checkConservation(st) {
    if (!st.hands) return true;
    const all = [...st.deck, ...st.discard, ...st.table.map(t => t.c), ...Object.values(st.hands).flat()];
    if (st.transfer) all.push(...st.transfer.table.map(t => t.c), ...st.transfer.cut);
    return all.length === 52 && new Set(all).size === 52;
  }


  /* ===== 2.5: Donkey's shuffle power, magic cards, bets, blitz, stats ===== */
  const SHUF = ['cut', 'shanti', 'ulta', 'over_lite', 'over_full', 'riffle1', 'riffle3', 'riffle7', 'wash', 'machine', 'marzi'];
  /* shuffle style = deal style: how many cards each player gets per pass */
  const DEAL_OF = { cut: 'all', shanti: 1, ulta: 5, over_lite: 4, over_full: 3, riffle1: 3, riffle3: 1, riffle7: 1, wash: 1, machine: 1 };
  const DEALS = [1, 3, 4, 5, 'all'];
  const SHUF_NAME = { shanti: 'Shanti Cut', cut: 'Sirf Cut', over_lite: 'Ghar Wala Shuffle (light)', over_full: 'Ghar Wala Shuffle (full)', riffle1: 'Riffle ×1', riffle3: 'Riffle ×3', riffle7: 'Riffle ×7', wash: 'Patta Ragdo', machine: 'Machine Shuffle', ulta: 'Ulta Pulta', marzi: 'Gadhe Ki Marzi' };
  const POWERS = ['peek', 'shield', 'swap', 'reverse'];
  const cutAt = (d, k) => d.slice(k).concat(d.slice(0, k));
  function overhand(d, rand) { let out = [], i = 0; while (i < d.length) { const k = 3 + rand(8); out = d.slice(i, i + k).concat(out); i += k; } return out; }
  function riffle(d, rand) { let c = 0; for (let i = 0; i < d.length; i++) c += rand(2); const a = d.slice(0, c), b = d.slice(c), out = [];
    while (a.length || b.length) { if (rand(a.length + b.length) < a.length) out.push(a.shift()); else out.push(b.shift()); } return out; }
  function doShuffle(mode, d, rand) {
    let x = d.slice();
    switch (mode) {
      case 'cut': case 'shanti': return cutAt(x, 16 + rand(21));
      case 'over_lite': for (let i = 3 + rand(2); i--;) x = overhand(x, rand); return x;
      case 'over_full': for (let i = 10 + rand(3); i--;) x = overhand(x, rand); return x;
      case 'riffle1': return riffle(x, rand);
      case 'riffle3': for (let i = 3; i--;) x = riffle(x, rand); return x;
      case 'riffle7': for (let i = 7; i--;) x = riffle(x, rand); return x;
      case 'ulta': return cutAt(x.reverse(), 26);
      default: return shuffle(x, rand);
    }
  }
  function ensure25(st) {
    st.opts = st.opts || { shuffle: false, powers: false, blitz: false, bets: false };
    st.powers = st.powers || {}; st.peeks = st.peeks || {}; st.shield = st.shield || {}; st.bets = st.bets || {}; st.betPts = st.betPts || {};
    st.stats = st.stats || { cuts: {}, cards: {}, big: {}, rival: {}, streak: {}, best: {}, first: {} };
    return st;
  }
  function applyShuffle(st, mode, secret, now, rand) {
    let actual = mode;
    if (mode === 'marzi') { const pool = SHUF.filter(x => x !== 'marzi'); actual = pool[rand(pool.length)]; secret = true; }
    st.deck = doShuffle(actual, st.deck, rand); st.lastShuf = mode;
    Object.assign(st.shuf, { mode, actual, secret: !!secret, deal: mode === 'marzi' ? DEALS[rand(DEALS.length)] : DEAL_OF[actual] });
    ev(st, { k: 'shuffle', u: st.shuf.by, mode: secret ? null : actual }, now);
    log(st, nm(st, st.shuf.by) + (secret ? ' shuffled in secret.' : ' used ' + SHUF_NAME[actual] + '.'));
    st.phase = 'DECK_CUT'; st.deadline = now + T.deckCut;
  }
  function applyCut(st, p, now, rand) {
    p = p || {}; const kind = ['cut', 'knock', 'double'].includes(p.kind) ? p.kind : 'cut';
    const at = Math.max(4, Math.min(48, Math.round(+p.at || 26)));
    if (kind === 'cut') st.deck = cutAt(st.deck, at);
    if (kind === 'double') { const a = 8 + rand(14), b = a + 10 + rand(14), d = st.deck; st.deck = d.slice(b).concat(d.slice(0, a), d.slice(a, b)); }
    st.shuf.cut = { kind, at: kind === 'cut' ? at : null };
    ev(st, { k: 'deckcut', u: st.shuf.cutter, kind, at: kind === 'cut' ? at : null }, now);
    log(st, nm(st, st.shuf.cutter) + (kind === 'knock' ? ' knocked: no cut.' : kind === 'double' ? ' did a Double Kaat.' : ' cut the deck at ' + at + '.'));
    if (p.peek) { st.shuf.bottom = st.deck[51]; ev(st, { k: 'bottom', u: st.shuf.cutter, c: st.deck[51] }, now); }
    st.phase = 'DEALING'; st.deadline = now + T.batch; st.dealTotal = now + T.dealTotal;
  }
  function planCount(st) { const r = st.dealTo, left = st.quotas[r] - st.dealt[r], d = st.shuf && st.shuf.deal; return !d ? null : d === 'all' ? left : Math.min(d, left); }
  function onOut(st, u, now, rand) {
    ensure25(st); if (st.firstOut) return; st.firstOut = u; st.stats.first[u] = (st.stats.first[u] || 0) + 1;
    if (st.opts.powers && !st.bots[u] && (st.powers[u] || []).length < 2) { const k = POWERS[(rand || secureRand)(POWERS.length)]; (st.powers[u] = st.powers[u] || []).push(k); ev(st, { k: 'earn', u, p: k }, now); }
  }
  function nextActive(st, i) { for (let k = 1; k < st.n; k++) { const j = (i + k) % st.n; if (st.hands[st.seats[j]].length) return j; } return -1; }
  function usePower(st, uid, p, now, rand) {
    const ph = st.phase, me = idxOf(st, uid);
    if (!st.hands[uid].length) return 'YOU_ARE_OUT';
    switch (p.k) {
      case 'peek': { const h = st.hands[p.to]; if (!h || p.to === uid || !h.length) return 'BAD_TARGET';
        st.peeks[uid] = { to: p.to, c: h[rand(h.length)], h: st.handNo }; ev(st, { k: 'power', u: uid, p: 'peek', to: p.to }, now); return null; }
      case 'shield': if (st.shield[uid] === st.handNo) return 'ALREADY_SHIELDED'; st.shield[uid] = st.handNo; ev(st, { k: 'power', u: uid, p: 'shield' }, now); return null;
      case 'reverse': if (st.reverseNext) return 'ALREADY_REVERSED'; st.reverseNext = true; ev(st, { k: 'power', u: uid, p: 'reverse' }, now); return null;
      case 'swap': { if (ph !== 'TURN' || actorUid(st) !== uid) return 'NOT_YOUR_TURN'; const j = nextActive(st, me); if (j < 0) return 'BAD_TARGET';
        const nu = st.seats[j], a = st.hands[uid], b = st.hands[nu], c1 = a[rand(a.length)], c2 = b[rand(b.length)];
        a.splice(a.indexOf(c1), 1, c2); b.splice(b.indexOf(c2), 1, c1); a.sort(cardSort); b.sort(cardSort); forget(st, uid, [c1]); forget(st, nu, [c2]);
        if (st.voids[uid]) delete st.voids[uid][suitOf(c2)]; if (st.voids[nu]) delete st.voids[nu][suitOf(c1)];
        ev(st, { k: 'power', u: uid, p: 'swap', to: nu }, now); return null; }
    }
    return 'NO_POWER';
  }
  function privateExtra(st, uid) {
    const pk = st.peeks && st.peeks[uid];
    return pk && pk.h === st.handNo ? { peek: { to: pk.to, c: pk.c } } : null;
  }
  function view25(st, p) {
    ensure25(st);
    const endPh = ['HAND_END', 'HAND_RESULT', 'MATCH_RESULT', 'INCOMPLETE'].includes(st.phase), hidden = ['SHUFFLE', 'DECK_CUT', 'DEALING'].includes(st.phase);
    const s = st.shuf;
    p.opts = st.opts; p.turnMs = st.turnMs || T.turn; p.powers = st.powers; p.shield = Object.keys(st.shield).filter(u => st.shield[u] === st.handNo);
    p.reverseNext = !!st.reverseNext; p.bets = st.bets; p.betPts = st.betPts; p.stats = st.stats; p.firstOut = st.firstOut || null; p.lastShuf = st.lastShuf || null;
    p.shuf = s ? { deal: s.secret && hidden ? null : (s.deal || null), by: s.by, cutter: s.cutter, fresh: !!s.fresh, secret: !!s.secret, picked: !!s.mode, mode: s.secret && hidden ? null : (s.mode || null), actual: s.secret && hidden ? null : (s.actual || null), cut: s.cut || null, bottom: s.bottom || null, shape: endPh ? s.shape || null : null } : null;
    return p;
  }

  const api = { privateExtra, SHUF, SHUF_NAME, DEAL_OF, POWERS, doShuffle, setHighWeight: w => { HIGH_W = w; }, estimate, conspiracyHint, SUITS, RANKS, SUIT_NAME, T, suitOf, rankOf, fullDeck, cardSort, createMatch, apply, tick, botAction, publicView, privateHand, legalFor, actorUid, checkConservation, secureRand };
  if (typeof module !== 'undefined') module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
module.exports = globalThis.Engine || module.exports;
