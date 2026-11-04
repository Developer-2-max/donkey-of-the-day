/* "My games" page: sign in (optional), resume a room, match history, signed-in devices. Same browser identity as the game page. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var LS = { get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var LOGIN_ERR = { LOGIN_OFF: 'Google sign-in is not switched on for this server.', BAD_NONCE: 'That sign-in expired. Try the Google button again.', EXPIRED: 'That sign-in expired. Try again.', BAD_TOKEN: 'Google sign-in could not be verified. Try again.', LIMIT: 'Slow down a little, then try again.' };

  function identity() {
    var id = LS.get('dotd-web-id');
    if (!id || !id.uid || !id.secret) {
      var r = function (n) { return Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(n)), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); };
      id = { uid: 'u-' + r(8), secret: r(24) }; LS.set('dotd-web-id', id);
    }
    return id;
  }
  var ident = identity(), retried = false, socket;
  function call(ev, data) { return new Promise(function (res) { var done = false, t = setTimeout(function () { if (!done) { done = true; res({ error: 'TIMEOUT' }); } }, 8000); socket.emit(ev, data || {}, function (r) { if (done) return; done = true; clearTimeout(t); res(r || {}); }); }); }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.add('hidden'); }, 3200); }
  function ago(ms) { var s = Math.max(0, (Date.now() - ms) / 1000); if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; if (s < 86400 * 45) return Math.round(s / 86400) + ' d ago'; return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  var S = { profile: null, rooms: [], hist: [], devs: [], cfg: null, gsi: null };

  /* ---------- views ---------- */
  function viewSignIn() {
    var p = S.profile; if (!p || p.account) return show('#p-in', false);
    show('#p-in', true);
    $('#p-in').className = 'panel signin';
    $('#p-in').innerHTML = '<h2>Keep your games with you</h2>' + (p.loginAvailable
      ? '<p>Sign in with Google to see your match history on any device, resume a room from another phone or laptop, and manage where you are signed in. You can still play as a guest without it.</p><div id="gbtn" style="min-height:44px"></div><div id="gerr" class="note"></div>'
      : '<p>Google sign-in is not switched on for this server yet. You can still play as a guest. Your games on this browser are kept here.</p>');
    if (p.loginAvailable) setupGoogle();
  }
  function viewMe() {
    var p = S.profile; if (!p) return show('#p-me', false); show('#p-me', true);
    var pct = Math.max(0, Math.min(100, Math.round(((p.xp - p.prevLevelXp) / Math.max(1, p.nextLevelXp - p.prevLevelXp)) * 100)));
    var name = p.account ? p.account.name : (p.name && p.name !== 'Player' ? p.name : 'Guest player');
    $('#p-me').innerHTML = '<div class="me"><div class="ring" style="--p:' + pct + '"><span>' + p.level + '</span></div><div class="who"><h2>' + esc(name) + '</h2><div class="meta">' +
      (p.account ? 'Signed in with Google' : 'Playing as a guest') + ' · ' + p.xp + ' XP · ' + p.matches + ' matches · ' + p.series.lost + ' Donkey ' + (p.series.lost === 1 ? 'title' : 'titles') + '</div></div>' +
      (p.account ? '<button class="btn alt small" id="so">Sign out</button>' : '') + '</div>';
    var so = $('#so'); if (so) so.onclick = function () { call('logout').then(function () { toast('Signed out.'); refresh(); }); };
  }
  function viewRooms() {
    var rows = S.rooms.filter(function (r) { return r.phase === 'lobby' || r.phase === 'playing'; });
    show('#p-rooms', true);
    var h = '<h2>Pick up where you left off <small>rooms you are in</small></h2>';
    if (!rows.length) h += '<div class="empty"><b>No open rooms</b>When you are in a room that has not finished, it shows up here so you can jump back in.</div>';
    else h += '<ul class="rooms">' + rows.map(function (r) {
      return '<li class="room"><div class="code">' + esc(r.code) + '</div><div class="info"><b>' + (r.phase === 'playing' ? 'Match in progress' : 'In the lobby') + '</b>' + (r.phase === 'playing' ? '<span class="badge play">Hand ' + esc(r.hand) + '</span>' : '') +
        '<span>' + (r.others && r.others.length ? 'With ' + r.others.map(esc).join(', ') : 'No one else yet') + ' · ' + esc(ago(r.at)) + '</span></div><button class="btn gold small" data-resume="' + esc(r.code) + '" data-name="' + esc(r.me) + '">Resume</button></li>';
    }).join('') + '</ul>';
    if (!S.profile || !S.profile.account) h += '<p class="note">Guests can resume rooms on this browser. Sign in to resume from any device.</p>';
    $('#p-rooms').innerHTML = h;
    Array.prototype.forEach.call(document.querySelectorAll('[data-resume]'), function (b) {
      b.onclick = function () { var c = b.getAttribute('data-resume'), n = b.getAttribute('data-name') || ''; if (n) LS.set('dotd-name', n); LS.set('dotd-last', { code: c, name: n, watch: false }); location.href = '/play?room=' + encodeURIComponent(c); };
    });
  }
  function viewHist() {
    show('#p-hist', true);
    var h = '<h2>Match history <small>your last ' + Math.min(S.hist.length, 100) + '</small></h2>';
    if (!S.hist.length) h += '<div class="empty"><b>No finished matches yet</b>Finish a match and it will be listed here, with who was the Donkey.</div>';
    else h += '<ul class="hist">' + S.hist.map(function (m) {
      var don = m.result === 'donkey';
      return '<li class="hrow ' + (don ? 'donkey' : '') + '"><div class="res" aria-hidden="true">' + (don ? '🫏' : '✅') + '</div><div class="main"><b>' + (don ? 'You were the Donkey of the Day' : 'You stayed safe') + '</b><span class="m">Room ' + esc(m.room) + ' · ' + esc(m.date || '') + ' · first to ' + esc(m.target) + ' · ' + esc(m.hands) + ' hands · ' + esc(ago(m.at)) + (m.title ? ' · ' + esc(m.title) : '') + '</span>' +
        '<div class="chips">' + (m.players || []).map(function (p) { return '<span class="chip ' + (p.donkey ? 'd' : '') + '">' + (p.donkey ? '🫏 ' : '') + esc(p.name) + (p.bot ? ' (bot)' : '') + ' · ' + esc(p.losses) + '</span>'; }).join('') + '</div></div></li>';
    }).join('') + '</ul>';
    if (!S.profile || !S.profile.account) h += '<p class="note">This list is kept for this browser. Sign in to keep it across devices.</p>';
    $('#p-hist').innerHTML = h;
  }
  function viewDevs() {
    if (!S.profile || !S.profile.account) return show('#p-devs', false);
    show('#p-devs', true);
    var icon = function (l) { return /iPhone|iPad|Android/.test(l) ? '📱' : '💻'; };
    var h = '<h2>Signed-in devices</h2>';
    if (!S.devs.length) h += '<div class="empty">No devices.</div>';
    else h += '<ul class="devs">' + S.devs.map(function (d) {
      return '<li class="dev"><span class="ico" aria-hidden="true">' + icon(d.label) + '</span><div class="info"><b>' + esc(d.label) + (d.current ? '<span class="badge">This device</span>' : '') + '</b><span>Last used ' + esc(ago(d.last)) + '</span></div>' + (d.current ? '' : '<button class="btn alt small" data-out="' + esc(d.id) + '">Sign out</button>') + '</li>';
    }).join('') + '</ul>';
    h += '<div class="row" style="margin-top:12px"><button class="btn alt small" id="outall">Sign out everywhere</button></div><p class="note">You are signed out automatically after 90 days without using a device.</p>';
    $('#p-devs').innerHTML = h;
    Array.prototype.forEach.call(document.querySelectorAll('[data-out]'), function (b) {
      b.onclick = function () { b.disabled = true; call('logout-device', { id: b.getAttribute('data-out') }).then(function (r) { if (r.ok) { S.devs = r.rows; toast('Device signed out.'); viewDevs(); } else { toast('Could not sign that device out.'); refresh(); } }); };
    });
    $('#outall').onclick = function () { if (!confirm('Sign out of every device, including this one?')) return; call('logout-all').then(function () { toast('Signed out everywhere.'); refresh(); }); };
  }

  /* ---------- Google sign-in (same flow as the game page) ---------- */
  function loadGsi() {
    return S.gsi || (S.gsi = new Promise(function (res, rej) { var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = res; s.onerror = function () { S.gsi = null; rej(new Error('gsi')); }; document.head.appendChild(s); }));
  }
  function setupGoogle() {
    var fail = function (m) { var e = $('#gerr'); if (e) e.innerHTML = '<span class="err">' + esc(m) + '</span>'; };
    (S.cfg || (S.cfg = fetch('/api/config').then(function (r) { return r.json(); }).catch(function () { return {}; }))).then(function (cfg) {
      if (!cfg.googleClientId) return fail('Google sign-in is not set up.');
      return call('login-nonce').then(function (n) {
        if (!n.nonce) return fail('Could not start sign-in. Reload and try again.');
        return loadGsi().then(function () {
          google.accounts.id.initialize({ client_id: cfg.googleClientId, nonce: n.nonce, ux_mode: 'popup', auto_select: false, callback: function (r) {
            call('login', { credential: r.credential }).then(function (x) { if (x.ok) { toast('Signed in as ' + x.name + '.'); refresh(); } else { fail(LOGIN_ERR[x.error] || 'Sign-in failed. Try again.'); setupGoogle(); } });
          } });
          var el = $('#gbtn'); if (el) google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
        });
      });
    }).catch(function () { fail('Could not load Google sign-in. Check your connection and try again.'); });
  }

  /* ---------- data ---------- */
  function refresh() {
    return Promise.all([call('profile'), call('my-rooms'), call('history'), call('devices')]).then(function (a) {
      if (a[0].error === 'TIMEOUT') { $('#status').textContent = 'The server is not answering. Check your connection.'; return; }
      S.profile = a[0].error ? null : a[0]; S.rooms = a[1].rows || []; S.hist = a[2].rows || []; S.devs = a[3].rows || [];
      $('#status').classList.add('hidden');
      viewSignIn(); viewMe(); viewRooms(); viewHist(); viewDevs();
    });
  }

  function connect() {
    socket = io({ auth: { uid: ident.uid, secret: ident.secret }, transports: ['websocket', 'polling'] });
    socket.on('connect', function () { refresh(); });
    socket.on('signed-out', function () { toast('You were signed out on this device.'); refresh(); });
    socket.on('connect_error', function (e) {
      if (e && e.message === 'BAD_IDENTITY' && !retried) { retried = true; try { localStorage.removeItem('dotd-web-id'); } catch (x) {} ident = identity(); socket.auth = { uid: ident.uid, secret: ident.secret }; socket.connect(); }
      else { $('#status').classList.remove('hidden'); $('#status').textContent = 'Cannot reach the server. Retrying…'; }
    });
  }
  connect();
})();
