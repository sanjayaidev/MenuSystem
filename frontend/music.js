/* Background music for the public pages (index.html and menu-page.html).
 *
 * Usage:  <script src="music.js" data-page="index|menu" data-host="CSS selector" data-class="button classes" defer></script>
 *
 * The track for each page is uploaded in Admin -> Music and served by GET /api/music.
 * - No track, or the admin switched it off: nothing happens and no button is shown.
 * - Otherwise a small music button is added to the host element. Browsers only allow sound after
 *   a tap, so playback starts immediately when the browser permits it, or on the visitor's first tap.
 * - The visitor's on/off choice is remembered (localStorage "redhouse_music") and shared by both pages.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;
  var page = script.getAttribute('data-page') || 'index';
  var hostSelector = script.getAttribute('data-host') || '';
  var btnClass = script.getAttribute('data-class') || 'rh-music';

  var PREF_KEY = 'redhouse_music';
  var TARGET_VOLUME = 0.5;
  var FADE_MS = 700;

  var LABELS = {
    en: { on: 'Music on - tap to turn off', off: 'Music off - tap to turn on' },
    ar: { on: 'الموسيقى تعمل - اضغط للإيقاف', off: 'الموسيقى متوقفة - اضغط للتشغيل' },
    ur: { on: 'موسیقی چل رہی ہے - بند کرنے کے لیے ٹیپ کریں', off: 'موسیقی بند ہے - چلانے کے لیے ٹیپ کریں' },
    zh: { on: '音乐已开启 - 点击关闭', off: '音乐已关闭 - 点击开启' }
  };

  var ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  var ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor"/><path d="m16 9 5 6M21 9l-5 6"/></svg>';

  function readPref() {
    try { return localStorage.getItem(PREF_KEY) !== 'off'; } catch (e) { return true; }
  }
  function writePref(on) {
    try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch (e) { /* storage unavailable */ }
  }
  function currentLang() {
    var l = '';
    try { l = localStorage.getItem('redhouse_lang') || ''; } catch (e) { /* ignore */ }
    if (!LABELS[l]) l = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return LABELS[l] ? l : 'en';
  }

  function fetchTrack() {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 4000) : null;
    return fetch('/api/music', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (timer) clearTimeout(timer); return r.ok ? r.json() : null; })
      .then(function (m) { return m && m[page] && m[page].enabled && m[page].url ? m[page] : null; })
      .catch(function () { return null; });
  }

  function start(track) {
    var audio = new Audio();
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    audio.src = track.url;

    var wanted = readPref();      // the visitor's choice (default on)
    var fadeTimer = null;
    var unlocked = false;         // true once the browser let us play
    var removed = false;

    var host = hostSelector ? document.querySelector(hostSelector) : null;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = btnClass;
    btn.setAttribute('data-rh-music', '');
    (host || document.body).appendChild(btn);

    function render() {
      var playing = !audio.paused;
      btn.innerHTML = playing ? ICON_ON : ICON_OFF;
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      var label = LABELS[currentLang()][playing ? 'on' : 'off'];
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }

    function fadeTo(volume, done) {
      clearInterval(fadeTimer);
      var from = audio.volume, steps = 14, i = 0;
      fadeTimer = setInterval(function () {
        i++;
        audio.volume = Math.max(0, Math.min(1, from + (volume - from) * (i / steps)));
        if (i >= steps) { clearInterval(fadeTimer); if (done) done(); }
      }, FADE_MS / steps);
    }

    // Returns a promise-like; resolves to true when playback started.
    function play() {
      if (removed || !wanted || document.hidden || window.rhHeroSoundOn) return Promise.resolve(false);   // the hero video's own sound takes priority
      var p;
      try { p = audio.play(); } catch (e) { return Promise.resolve(false); }
      if (!p || typeof p.then !== 'function') { unlocked = true; fadeTo(TARGET_VOLUME); return Promise.resolve(true); }
      return p.then(function () {
        unlocked = true;
        fadeTo(TARGET_VOLUME);
        return true;
      }, function () { return false; });   // blocked until the visitor taps
    }

    function stop() {
      fadeTo(0, function () { audio.pause(); });
    }

    // Autoplay is blocked until the visitor interacts: retry on the first real tap / key press.
    var unlockEvents = ['pointerup', 'touchend', 'click', 'keydown'];
    function onGesture(e) {
      if (e.target && e.target.closest && e.target.closest('[data-rh-music]')) return;   // the button handles itself
      play().then(function (ok) { if (ok) removeGestureListeners(); });
    }
    function removeGestureListeners() {
      unlockEvents.forEach(function (n) { document.removeEventListener(n, onGesture, true); });
    }
    function addGestureListeners() {
      unlockEvents.forEach(function (n) { document.addEventListener(n, onGesture, true); });
    }

    btn.addEventListener('click', function () {
      if (audio.paused) {
        wanted = true;
        writePref(true);
        try { window.dispatchEvent(new Event('rh-music-start')); } catch (e) { /* ignore */ }   // lets the hero video go quiet
        play().then(function (ok) { if (ok) removeGestureListeners(); render(); });
      } else {
        wanted = false;
        writePref(false);
        stop();
      }
    });

    ['play', 'pause', 'playing'].forEach(function (n) { audio.addEventListener(n, render); });
    audio.addEventListener('error', function () {
      // the file is missing or unreadable: remove the button rather than leave a dead control
      removed = true;
      removeGestureListeners();
      if (btn.parentNode) btn.parentNode.removeChild(btn);
    });

    // the landing page's hero video has its own sound: music yields while it is on and resumes when it is muted again
    window.addEventListener('rh-hero-sound', function (e) {
      if (e.detail && e.detail.on) { if (!audio.paused) stop(); }
      else if (wanted) { play().then(function (ok) { if (ok) removeGestureListeners(); render(); }); }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { audio.pause(); }
      else if (unlocked) { play(); }
    });
    window.addEventListener('pagehide', function () { audio.pause(); });

    render();
    if (wanted) {
      play().then(function (ok) { if (!ok && wanted) addGestureListeners(); });
    }
  }

  fetchTrack().then(function (track) { if (track) start(track); });
})();
