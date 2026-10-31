/* 한걸음 — 应用逻辑 */
(function () {
  'use strict';

  var WORDS = window.KV_WORDS || [];
  var GRAM = window.KV_GRAMMAR || [];
  var MAP = {}, GMAP = {};
  WORDS.forEach(function (w) { MAP[w.ko] = w; });
  GRAM.forEach(function (g) { GMAP[g.key] = g; });

  var STORE = 'hangul_step_v1';
  var STEPS = [1, 3, 7, 15, 30, 60, 120];   // 遗忘曲线：1/3/7/15/30/60/120 天
  var app = document.getElementById('app');
  var toastEl = document.getElementById('toast');
  var toastTimer = null;

  /* 例句里出现某个语法点时，自动把它挂到单词卡上（只匹配明确的结构） */
  (function linkGrammar() {
    var RULES = [
      [/고 싶/, '고 싶다'], [/고 있/, '고 있다'], [/수 있/, 'ㄹ 수 있다'],
      [/지 마/, '지 말다'], [/야 하/, '어야 하다'], [/러 가/, '러 가다'], [/러 갔/, '러 가다'],
      [/기 전에/, '기 전에'], [/후에/, '후에'], [/지만/, '지만'], [/는데/, '는데'],
      [/네요/, '네요'], [/군요/, '군요'], [/게 되/, '게 되다'],
      [/뿐만 아니라/, '뿐만 아니라'], [/반면/, '반면'], [/에 따라/, '에 따라'],
      [/더라도/, '더라도'], [/바람에/, '바람에'], [/수밖에/, '수밖에 없다'],
      [/도록/, '도록'], [/기 마련/, '기 마련이다'], [/셈이다/, '셈이다'],
      [/기는커녕/, '기는커녕'], [/기 때문에/, '기 때문에']
    ];
    WORDS.forEach(function (w) {
      if (w.gramKey || !w.ex) return;
      for (var i = 0; i < RULES.length; i++) {
        if (RULES[i][0].test(w.ex)) {
          var g = GMAP[RULES[i][1]];
          if (g) { w.gramKey = g.key; w.gram = g.desc; }
          return;
        }
      }
    });
  })();

  /* ---------------- 状态 ---------------- */
  function defaults() {
    return {
      v: 1,
      settings: { goal: 20, levels: [1, 2, 3, 4, 5, 6], autoSpeak: false },
      words: {},            // ko -> {s:阶段, d:下次复习, f:首次学习, n:次数, c:对, w:错, t:时间}
      log: {},              // 日期 -> {n:新词, r:复习, c:对, w:错}
      streak: { last: '', n: 0, best: 0 },
      createdAt: Date.now()
    };
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return defaults();
      var s = JSON.parse(raw), d = defaults();
      s.settings = Object.assign(d.settings, s.settings || {});
      s.words = s.words || {}; s.log = s.log || {};
      s.streak = Object.assign(d.streak, s.streak || {});
      return s;
    } catch (e) { return defaults(); }
  }
  var S = load();
  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }

  /* ---------------- 工具 ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function key(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(k, n) { var p = k.split('-').map(Number); return key(new Date(p[0], p[1] - 1, p[2] + n)); }
  function diffDays(a, b) { var pa = a.split('-').map(Number), pb = b.split('-').map(Number); return Math.round((new Date(pb[0], pb[1] - 1, pb[2]) - new Date(pa[0], pa[1] - 1, pa[2])) / 86400000); }
  function today() { return key(); }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function fmtDate(k) { var p = k.split('-').map(Number); var w = '일월화수목금토'.split('')[new Date(p[0], p[1] - 1, p[2]).getDay()]; return (p[1]) + '月' + p[2] + '日 (周' + '日一二三四五六'.split('')[new Date(p[0], p[1] - 1, p[2]).getDay()] + ')'; }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2000);
  }
  function haptic() { if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} } }

  /* ---------------- 发音 ---------------- */
  var voices = [];
  function loadVoices() { try { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch (e) { voices = []; } }
  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

  var audioEl = null, audioTimer = null;
  var audioCache = {}, audioOrder = [];

  /* 单词用有道（音质好），整句用百度（有道对带空格/标点的句子会 500） */
  function audioUrls(text) {
    var baidu = 'https://fanyi.baidu.com/gettts?lan=kor&spd=3&source=web&text=' + encodeURIComponent(text);
    var youdao = 'https://dict.youdao.com/dictvoice?le=ko&audio=' + encodeURIComponent(text);
    return text.indexOf(' ') > -1 ? [baidu, youdao] : [youdao, baidu];
  }

  function getAudio(text) {
    var a = audioCache[text];
    if (a) return a;
    try {
      var urls = audioUrls(text);
      a = new Audio(urls[0]);
      a.preload = 'auto';
      a._urls = urls; a._i = 0;
      a.load();
      audioCache[text] = a;
      audioOrder.push(text);
      if (audioOrder.length > 8) {
        var old = audioOrder.shift();
        if (old !== text) delete audioCache[old];
      }
      return a;
    } catch (e) { return null; }
  }

  /* 卡片出现时先把音频静默下好，点喇叭就能立刻出声 */
  function preloadAudio(text) { if (text) getAudio(text); }

  function setLoading(btn, on) { if (btn) btn.classList.toggle('loading', !!on); }

  /* 例句音频：644 句打包成一个文件，点的时候按字节切出来，秒播、可离线 */
  var SENT = { buf: null, req: null, failed: false, base: '' };

  function sentBinUrl() {
    if (SENT.base) return SENT.base + 'audio/sentences.bin';
    var s = document.querySelector('script[src$="sentences-index.js"]');
    if (s && s.src) {
      var m = s.src.match(/^(.*?)js\/sentences-index\.js/);
      if (m) { SENT.base = m[1]; return SENT.base + 'audio/sentences.bin'; }
    }
    return 'audio/sentences.bin';
  }

  function ensureSentences(cb) {
    if (SENT.buf) return cb(true);
    if (SENT.failed) return cb(false);
    if (SENT.req) { SENT.req.push(cb); return; }
    SENT.req = [cb];
    fetch(sentBinUrl()).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.arrayBuffer();
    }).then(function (b) {
      SENT.buf = b;
      var q = SENT.req; SENT.req = null;
      q.forEach(function (f) { f(true); });
    }).catch(function () {
      SENT.failed = true;
      var q = SENT.req; SENT.req = null;
      q.forEach(function (f) { f(false); });
    });
  }

  function playSentence(ko, btn) {
    var w = MAP[ko];
    var idx = window.KV_SENT || {};
    var e = w && w.ex && idx[ko];
    if (!e) { if (w && w.ex) speakLocal(w.ex, btn); return; }
    if (btn) { btn.classList.add('playing'); setLoading(btn, !SENT.buf); }
    ensureSentences(function (ok) {
      if (btn) setLoading(btn, false);
      if (!ok) { if (btn) btn.classList.remove('playing'); speakLocal(w.ex, btn); return; }
      try {
        var blob = new Blob([SENT.buf.slice(e[0], e[0] + e[1])], { type: 'audio/mpeg' });
        var url = URL.createObjectURL(blob);
        var a = new Audio(url);
        a.onended = a.onerror = function () {
          URL.revokeObjectURL(url);
          if (btn) btn.classList.remove('playing');
        };
        a.play();
      } catch (err) { if (btn) btn.classList.remove('playing'); speakLocal(w.ex, btn); }
    });
  }

  function speakLocal(text, btn) {
    if (!('speechSynthesis' in window)) { toast('发音加载失败，请检查网络'); return; }
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; u.rate = 0.88; u.pitch = 1;
      var v = voices.filter(function (v) { return /^ko/i.test(v.lang); })[0];
      if (v) u.voice = v;
      if (btn) { btn.classList.add('playing'); u.onend = u.onerror = function () { btn.classList.remove('playing'); }; }
      u.onerror = function () { if (btn) btn.classList.remove('playing'); toast('发音加载失败，请检查网络'); };
      speechSynthesis.speak(u);
    } catch (e) { if (btn) btn.classList.remove('playing'); toast('发音加载失败，请检查网络'); }
  }

  /* 播放：当前音源失败就换下一个，最终退回系统朗读 */
  function playAudio(text, btn) {
    var a = getAudio(text);
    if (!a) { speakLocal(text, btn); return; }
    if (btn) { btn.classList.add('playing'); setLoading(btn, a.readyState < 3); }
    var done = function () { if (btn) { btn.classList.remove('playing'); setLoading(btn, false); } };
    var fell = false;
    var fallback = function () {
      if (fell) return;
      fell = true;
      clearTimeout(audioTimer);
      done();
      speakLocal(text, btn);
    };
    var nextSrc = function () {
      if (a._i < a._urls.length - 1) {
        a._i++;
        a.src = a._urls[a._i];
        a.onerror = nextSrc;
        try { a.load(); } catch (e) {}
        var p = a.play();
        if (p && p.catch) p.catch(nextSrc);
      } else {
        fallback();
      }
    };
    try {
      if (audioEl && audioEl !== a) { audioEl.onerror = null; audioEl.pause(); }
      audioEl = a;
      try { a.currentTime = 0; } catch (e) {}
      a.onended = done;
      a.onplaying = function () { setLoading(btn, false); };
      a.oncanplay = function () { if (!a.paused) setLoading(btn, false); };
      a.onerror = nextSrc;
      var p = a.play();
      if (p && p.catch) p.catch(nextSrc);
      clearTimeout(audioTimer);
      audioTimer = setTimeout(function () {
        if (!fell && a.readyState < 3) nextSrc();
      }, 3000);
    } catch (e) { nextSrc(); }
  }

  /* ---------------- 学习数据 ---------------- */
  function learnedCount() { return Object.keys(S.words).length; }
  function newToday() { var t = today(), n = 0; for (var k in S.words) if (S.words[k].f === t) n++; return n; }
  function dueList() {
    var t = today(), out = [];
    for (var k in S.words) if (S.words[k].d <= t) out.push(k);
    out.sort(function (a, b) { return S.words[a].d < S.words[b].d ? -1 : 1; });
    return out;
  }
  function newPool() {
    return WORDS.filter(function (w) { return S.settings.levels.indexOf(w.level) > -1 && !S.words[w.ko]; });
  }
  function logAnswer(isNew, ok) {
    var t = today(), L = S.log[t] || (S.log[t] = { n: 0, r: 0, c: 0, w: 0 });
    if (isNew) L.n++; else L.r++;
    if (ok) L.c++; else L.w++;
    touchStreak();
  }
  function touchStreak() {
    var t = today();
    if (S.streak.last === t) return;
    S.streak.n = (S.streak.last === addDays(t, -1)) ? S.streak.n + 1 : 1;
    S.streak.last = t;
    if (S.streak.n > S.streak.best) S.streak.best = S.streak.n;
  }
  function reviewWord(ko, ok, noAdvance) {
    var t = today(), p = S.words[ko];
    if (!p) p = { s: 0, d: t, f: t, n: 0, c: 0, w: 0, t: 0 };
    p.n++;
    if (noAdvance) {
      // 同一场次内的“再考一次”不再推进记忆阶段，只记录对错
      if (ok) p.c++; else p.w++;
      if (!p.d) p.d = addDays(t, 1);
    } else if (ok) {
      p.s = Math.min(p.s + 1, STEPS.length); p.c++;
      p.d = addDays(t, STEPS[p.s - 1]);
    } else {
      p.s = 1; p.w++; p.d = addDays(t, 1);
    }
    p.t = Date.now();
    S.words[ko] = p;
    return p;
  }
  function intervalText(p) {
    var n = diffDays(today(), p.d);
    if (n <= 0) return '今天';
    if (n === 1) return '明天';
    return n + ' 天后';
  }

  /* ---------------- 出题 ---------------- */
  function makeOptions(w) {
    var picks = [], seen = {};
    seen[w.zh] = 1;
    function take(list, n) {
      var arr = shuffle(list);
      for (var i = 0; i < arr.length && picks.length < n; i++) {
        if (seen[arr[i].zh]) continue;
        seen[arr[i].zh] = 1; picks.push(arr[i].zh);
      }
    }
    var others = WORDS.filter(function (x) { return x.ko !== w.ko; });
    take(others.filter(function (x) { return x.level === w.level && x.pos === w.pos; }), 2);
    take(others.filter(function (x) { return x.level === w.level; }), 3);
    take(others, 3);
    return shuffle([w.zh].concat(picks.slice(0, 3)));
  }

  /* ---------------- 会话 ---------------- */
  var Q = null;
  function startSession() {
    var t = today();
    var due = dueList();
    var dueCap = 40;
    var reviews = due.slice(0, dueCap);
    var left = Math.max(0, S.settings.goal - newToday());
    var news = newPool().slice(0, left);
    var queue = reviews.map(function (k) { return { ko: k, kind: 'rev', retry: 0 }; })
      .concat(news.map(function (w) { return { ko: w.ko, kind: 'new', retry: 0 }; }));
    if (!queue.length) {
      if (due.length) { toast('复习词太多了，先来 40 个吧'); }
      else if (!newPool().length) { toast('这个范围的词库已经学完了 🎉'); return; }
      else { toast('今日目标已完成，休息一下吧'); return; }
    }
    Q = { queue: queue, i: 0, ok: 0, bad: 0, word: null, opts: [], answered: false, chosen: -1, totalNew: news.length, totalRev: reviews.length, streakOk: 0 };
    nextCard(true);
  }
  function nextCard(first) {
    if (!Q) return;
    if (!first) { Q.i++; }
    Q.answered = false; Q.chosen = -1;
    if (Q.i >= Q.queue.length) { finish(); return; }
    var item = Q.queue[Q.i];
    Q.word = MAP[item.ko];
    Q.opts = makeOptions(Q.word);
    save();
    renderQuiz();
    window.scrollTo(0, 0);
  }
  function answer(idx) {
    if (!Q || Q.answered) return;
    var w = Q.word, ok = Q.opts[idx] === w.zh;
    var isNew = !S.words[w.ko];
    Q.answered = true; Q.chosen = idx;
    Q.ok += ok ? 1 : 0; Q.bad += ok ? 0 : 1;
    var item0 = Q.queue[Q.i];
    reviewWord(w.ko, ok, item0.kind === 'again');
    logAnswer(isNew, ok);
    if (!ok) {
      var item = Q.queue[Q.i];
      if ((item.retry || 0) < 1) {
        Q.queue.splice(Math.min(Q.i + 4, Q.queue.length), 0, { ko: w.ko, kind: 'again', retry: 1 });
      }
    }
    save();
    haptic();
    renderQuiz();
    if (S.settings.autoSpeak) setTimeout(function () { playAudio(w.ko); }, 120);
    if (!SENT.buf) setTimeout(function () { ensureSentences(function () {}); }, 1500);
    requestAnimationFrame(function () {
      var d = $('.detail');
      if (d) d.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }
  function finish() {
    var total = Q.ok + Q.bad;
    var acc = total ? Math.round(Q.ok / total * 100) : 100;
    var box = { ok: Q.ok, bad: Q.bad, acc: acc, totalNew: Q.totalNew, totalRev: Q.totalRev };
    Q = null;
    renderSummary(box);
    window.scrollTo(0, 0);
  }

  /* ---------------- 图标 ---------------- */
  var IC = {
    learn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5"/><path d="M20 18v3H6.5A2.5 2.5 0 0 1 4 18.5"/><path d="M8 7h8M8 11h5"/></svg>',
    gram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h13"/><circle cx="18" cy="15" r="3"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-1.6.8-3 1.5-3.8C8 10 9 11 9.5 12c0-3 1-6 2.5-9Z"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2Z"/><path d="M12 6v14"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>'
  };

  /* ---------------- 导航 ---------------- */
  function nav(active) {
    var due = dueList().length;
    return '<nav class="nav">' +
      '<button data-act="nav" data-v="home" class="' + (active === 'home' ? 'on' : '') + '">' + IC.learn + (due ? '<i class="dot"></i>' : '') + '<span>学习</span></button>' +
      '<button data-act="nav" data-v="dict" class="' + (active === 'dict' ? 'on' : '') + '">' + IC.book + '<span>词典</span></button>' +
      '<button data-act="nav" data-v="grammar" class="' + (active === 'grammar' ? 'on' : '') + '">' + IC.gram + '<span>语法</span></button>' +
      '<button data-act="nav" data-v="stats" class="' + (active === 'stats' ? 'on' : '') + '">' + IC.chart + '<span>我的</span></button>' +
      '</nav>';
  }

  /* ---------------- 首页 ---------------- */
  function renderHome() {
    var t = today(), goal = S.settings.goal;
    var nt = newToday();
    var due = dueList().length;
    var pct = Math.min(100, Math.round(nt / goal * 100));
    var learned = learnedCount();
    var C = 2 * Math.PI * 52;
    var newsLeft = Math.max(0, goal - nt);
    var poolLeft = newPool().length;

    var ctaText, ctaSub = '', disabled = '';
    if (due > 0 && nt < goal && poolLeft > 0) ctaText = '开始学习';
    else if (due > 0) ctaText = '开始复习';
    else if (nt < goal && poolLeft > 0) ctaText = '开始学习';
    else if (due === 0 && poolLeft === 0) { ctaText = '词库已全部学完'; disabled = ' disabled'; }
    else { ctaText = '今日已完成'; disabled = ' disabled'; }

    var fc = '';
    var counts = [], fcTotal = 0;
    for (var i = 0; i < 7; i++) {
      var dk = addDays(t, i), c = 0;
      for (var k in S.words) if (S.words[k].d === dk) c++;
      if (i === 0) for (var k2 in S.words) if (S.words[k2].d < t) c++;
      counts.push(c); fcTotal += c;
    }
    var max = Math.max.apply(null, counts.concat([1]));
    if (fcTotal === 0) {
      fc = '<div class="fc-empty">还没有复习安排<br><span>今天开始学习，明天起这里就会出现要复习的词</span></div>';
    } else {
      for (var j = 0; j < 7; j++) {
        var d2 = addDays(t, j);
        var wd = '日一二三四五六'.split('')[new Date(d2.split('-')[0], d2.split('-')[1] - 1, d2.split('-')[2]).getDay()];
        var h = 6 + Math.round(58 * counts[j] / max);
        fc += '<div class="fc' + (j === 0 ? ' today' : '') + '"><span class="num">' + (counts[j] || '') + '</span>' +
          '<div class="bar" style="height:' + (counts[j] ? h : 5) + 'px"></div><span class="dow">' + (j === 0 ? '今天' : '周' + wd) + '</span></div>';
      }
    }

    var lvHTML = '';
    for (var lv = 1; lv <= 6; lv++) {
      var total = 0, done = 0;
      for (var x = 0; x < WORDS.length; x++) {
        if (WORDS[x].level === lv) { total++; if (S.words[WORDS[x].ko]) done++; }
      }
      lvHTML += '<div class="lv lv-' + lv + '"><div class="lv-badge"><b>' + lv + '</b><small>급</small></div>' +
        '<div class="lv-main"><div class="lv-top"><b>TOPIK ' + lv + '级</b><span>' + done + ' / ' + total + '</span></div>' +
        '<div class="track"><i style="width:' + (total ? Math.round(done / total * 100) : 0) + '%"></i></div></div></div>';
    }

    var head = '<div class="topbar"><div><div class="hi">오늘도 한 걸음</div><h1>' + (nt >= goal && goal > 0 ? '今日目标已完成 🎉' : '今天背几个单词？') + '</h1></div>' +
      '<div class="streak">' + IC.flame + '<b>' + (S.streak.n || 0) + '</b>天</div></div>';

    var hero = '<section class="hero">' +
      '<div class="hero-top"><span>今日学习</span><span>' + nt + ' / ' + goal + ' 新词</span></div>' +
      '<div class="hero-main">' +
      '<div class="ring"><svg viewBox="0 0 120 120"><circle class="bgc" cx="60" cy="60" r="52"/>' +
      '<circle class="fgc" cx="60" cy="60" r="52" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(1) + '"/></svg>' +
      '<div class="pct"><b>' + pct + '%</b><span>今日进度</span></div></div>' +
      '<div class="hero-stats"><div class="hero-stat"><b>' + due + '</b><span>待复习</span></div>' +
      '<div class="hero-stat"><b>' + learned + '</b><span>已学单词</span></div></div></div>' +
      '<button class="cta" data-act="start"' + disabled + '>' + ctaText + ' ' + IC.arrow + '</button>' +
      '<div class="hero-top" style="margin-top:10px"><span>预计 ' + Math.max(1, Math.round((Math.min(newsLeft, poolLeft) * 20 + due * 8) / 60)) + ' 分钟 · 复习 ' + due + ' 词</span><span>TOPIK ' + S.settings.levels.join('/') + '급</span></div>' +
      '</section>';

    var tip = '<div class="tip"><div class="ico">🧠</div><p><b>遗忘曲线复习：</b>每个词按 1 → 3 → 7 → 15 → 30 → 60 天的间隔重现。答错的词会在本次学习中<b>再考一次</b>，并安排到明天重新复习。</p></div>';

    app.innerHTML = '<div class="screen active">' + head + hero +
      '<div class="sec"><div class="sec-head"><h2>未来 7 天复习量</h2><span>按遗忘曲线安排</span></div><div class="card forecast">' + fc + '</div></div>' +
      '<div class="sec"><div class="sec-head"><h2>词库进度</h2><span>共 ' + WORDS.length + ' 词</span></div><div class="card lv-card">' + lvHTML + '</div></div>' +
      '<div class="sec">' + tip + '</div>' +
      '<p class="footnote">每天一点点，한 걸음씩 · 坚持 21 天就能看到变化</p>' +
      '</div>' + nav('home');
  }

  /* ---------------- 答题 ---------------- */
  function renderQuiz() {
    if (!Q) return;
    var item = Q.queue[Q.i], w = Q.word;
    preloadAudio(w.ko);
    var p = S.words[w.ko];
    var badge = item.kind === 'new' ? '<span class="badge new">新词</span>' :
      item.kind === 'again' ? '<span class="badge again">再考一次</span>' : '<span class="badge rev">复习</span>';
    var prog = Math.round((Q.i + 1) / Q.queue.length * 100);

    var opts = Q.opts.map(function (o, i) {
      var cls = 'opt', mark = '';
      if (Q.answered) {
        if (o === w.zh) { cls += ' correct'; mark = '<span class="mark">' + IC.check + '</span>'; }
        else if (i === Q.chosen) { cls += ' wrong'; mark = '<span class="mark">' + IC.x + '</span>'; }
        else cls += ' dim';
      }
      return '<button class="' + cls + '" data-act="answer" data-v="' + i + '"' + (Q.answered ? ' disabled' : '') + '>' +
        '<span class="kx">' + 'ABCD'.split('')[i] + '</span><span class="tx">' + esc(o) + '</span>' + mark + '</button>';
    }).join('');

    var detail = '';
    if (Q.answered) {
      var ok = Q.chosen > -1 && Q.opts[Q.chosen] === w.zh;
      var p2 = S.words[w.ko];
      var verdict = ok
        ? '<div class="verdict ok">' + IC.check + '<div>答对了 <span class="sub">· ' + (p2.s >= STEPS.length ? '已进入长期记忆' : intervalText(p2) + '再复习') + '</span></div></div>'
        : '<div class="verdict no">' + IC.x + '<div>答错了 <span class="sub">· 已排到本次稍后再考，明天再复习一遍</span></div></div>';

      var gramRow = '';
      if (w.gramKey) {
        var g = GMAP[w.gramKey];
        gramRow = '<div class="drow"><div class="dtag">语法</div><div class="dbody"><p>' + esc(w.gram || w.gramKey) + '</p>' +
          (g ? '<button class="gchip" data-act="gram" data-v="' + esc(g.key) + '">' + IC.book + ' ' + esc(g.title) + ' 详解</button>' : '') +
          '</div></div>';
      }

      var pinfo = pronFor(w);
      var pronRow = pinfo
        ? '<button class="d-pron" data-act="pron" data-v="' + esc(w.ko) + '">발음 <b>' + esc(pinfo.text) + '</b>' +
          pinfo.rules.slice(0, 2).map(function (r) { return '<span class="pr-tag">' + esc(r) + '</span>'; }).join('') +
          '<span class="pr-arrow">规则 ›</span></button>'
        : '';

      detail = '<div class="detail">' + verdict +
        '<div class="dcard">' +
        '<div class="d-mean"><span class="d-emoji">' + emojiFor(w) + '</span><div class="d-mean-tx"><b>' + esc(w.zh) + '</b><span>' + esc(w.pos) + ' · TOPIK ' + w.level + '급</span></div>' +
        '<button class="d-say" data-act="speak" data-v="' + esc(w.ko) + '" aria-label="发音">' + IC.speaker + '</button></div>' +
        pronRow +
        (w.note ? '<div class="drow"><div class="dtag">用法</div><div class="dbody"><p>' + esc(w.note) + '</p></div></div>' : '') +
        (w.ety ? '<div class="drow"><div class="dtag">构词</div><div class="dbody"><p>' + esc(w.ety) + '</p></div></div>' : '') +
        (w.ex ? '<div class="drow"><div class="dtag">例句</div><div class="dbody"><div class="ex"><span class="say" data-act="sayex" data-v="' + esc(w.ko) + '">' + IC.speaker + '</span><span>' + esc(w.ex) + '</span></div><p class="ex-zh">' + esc(w.exZh) + '</p></div></div>' : '') +
        gramRow +
        '</div>' +
        '<div class="dactions"><button class="btn primary" data-act="next">' + (Q.i + 1 >= Q.queue.length ? '完成学习' : '下一个') + ' ' + IC.arrow + '</button></div>' +
        '<div class="kbd-hint">按 1–4 选择 · 按 Enter 继续</div>' +
        '</div>';
    }

    app.innerHTML = '<div class="screen quiz active no-nav">' +
      '<div class="quiz-top">' +
      '<button class="icon-btn" data-act="quit">' + IC.x + '</button>' +
      '<div class="quiz-prog"><div class="meta"><span>第 ' + (Q.i + 1) + ' / ' + Q.queue.length + ' 个</span><span>' + Math.round((Q.ok / Math.max(1, Q.ok + Q.bad)) * 100) + '% 正确</span></div>' +
      '<div class="track"><i style="width:' + prog + '%"></i></div></div>' +
      '<span style="width:38px;flex:0 0 38px"></span>' +
      '</div>' +
      '<div class="quiz-body' + (Q.answered ? '' : ' centered') + '">' +
      '<div class="word-card"><div class="badges"><span class="badge lv' + w.level + '">TOPIK ' + w.level + '급</span><span class="badge">' + esc(w.pos) + '</span>' + badge + '</div>' +
      '<h1 class="word' + (w.ko.length > 6 ? ' long' : '') + '">' + esc(w.ko) + '</h1>' +
      '<button class="speaker" data-act="speak" data-v="' + esc(w.ko) + '">' + IC.speaker + '</button>' +
      '<p class="prompt">' + (Q.answered ? '正确答案已标出' : '选择正确的中文意思') + '</p></div>' +
      '<div class="options">' + opts + '</div>' +
      (Q.answered ? '' : '<button class="skip" data-act="skip">不认识？直接看答案</button>') +
      detail +
      '</div></div>';
  }

  /* ---------------- 总结 ---------------- */
  function renderSummary(b) {
    var days = [];
    for (var i = 1; i <= 6; i++) {
      var dk = addDays(today(), i), c = 0;
      for (var k in S.words) if (S.words[k].d === dk) c++;
      if (c) days.push({ d: fmtDate(dk), n: c });
    }
    var plan = days.slice(0, 3).map(function (x) {
      return '<li><span>' + x.d + '</span><b>' + x.n + ' 词</b></li>';
    }).join('');

    app.innerHTML = '<div class="screen active no-nav">' +
      '<div class="summary-head"><div class="emoji">' + (b.acc >= 80 ? '🎉' : b.acc >= 60 ? '💪' : '🌱') + '</div>' +
      '<h2>本次学习完成</h2><p>正确率 ' + b.acc + '%，错的词会再考一次</p></div>' +
      '<div class="sumgrid">' +
      '<div class="sumcell good"><b>' + b.ok + '</b><span>答对</span></div>' +
      '<div class="sumcell bad"><b>' + b.bad + '</b><span>答错</span></div>' +
      '<div class="sumcell"><b>' + b.totalNew + '</b><span>新学单词</span></div>' +
      '<div class="sumcell"><b>' + b.totalRev + '</b><span>复习单词</span></div>' +
      '</div>' +
      (plan ? '<div class="next-plan"><h4>接下来要复习</h4><ul>' + plan + '</ul></div>' : '') +
      '<div class="sum-actions">' +
      (dueList().length ? '<button class="btn primary" data-act="start">继续复习 ' + dueList().length + ' 词</button>' : '') +
      '<button class="btn ghost" data-act="nav" data-v="home">回到首页</button>' +
      '</div>' +
      '<p class="footnote">记忆需要重复。明天见 👋</p>' +
      '</div>' + nav('home');
  }

  /* ---------------- 词典 ---------------- */
  var DICT = { q: '', level: 0, status: 'all', limit: 60 };

  function dictFiltered() {
    var t = today(), q = DICT.q.trim().toLowerCase();
    return WORDS.filter(function (w) {
      if (DICT.level && w.level !== DICT.level) return false;
      var p = S.words[w.ko];
      if (DICT.status === 'today') { if (!p || p.f !== t) return false; }
      else if (DICT.status === 'new') { if (p) return false; }
      else if (DICT.status === 'wrong') { if (!p || !p.w) return false; }
      if (q && w.ko.indexOf(q) < 0 && w.zh.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function dictRows(list) {
    if (!list.length) return '<div class="empty" style="padding:36px 16px">没有符合条件的单词</div>';
    return list.map(function (w) {
      var p = S.words[w.ko];
      var cls = !p ? 'new' : (p.s >= 5 ? 'ok' : 'prog');
      var label = !p ? '未学' : (p.s >= 5 ? '已掌握' : '学习中');
      return '<button class="drow2" data-act="word" data-v="' + esc(w.ko) + '">' +
        '<span class="we">' + emojiFor(w) + '</span>' +
        '<span class="wm"><b>' + esc(w.ko) + '</b><small>' + esc(w.zh) + '</small></span>' +
        (p && p.w ? '<i class="wd">错' + p.w + '</i>' : '') +
        '<span class="ws ' + cls + '">' + label + '</span></button>';
    }).join('');
  }

  function dictCountText(n) {
    return '共 ' + WORDS.length + ' 词 · 当前 ' + n + ' 个 · 已学 ' + Object.keys(S.words).length;
  }

  function renderDict() {
    var list = dictFiltered();
    var statusChips = [['all', '全部'], ['today', '今天学的'], ['new', '未学'], ['wrong', '错词']].map(function (x) {
      return '<button class="chip' + (DICT.status === x[0] ? ' on' : '') + '" data-act="dictstatus" data-v="' + x[0] + '">' + x[1] + '</button>';
    }).join('');
    var lvChips = [[0, '全部级别']].concat([1, 2, 3, 4, 5, 6].map(function (n) { return [n, n + '급']; })).map(function (x) {
      return '<button class="chip' + (DICT.level === x[0] ? ' on' : '') + '" data-act="dictlevel" data-v="' + x[0] + '">' + x[1] + '</button>';
    }).join('');
    app.innerHTML = '<div class="screen active">' +
      '<div class="topbar"><div><div class="hi">단어장</div><h1>词典</h1></div>' +
      '<div class="streak">' + WORDS.length + ' 词</div></div>' +
      '<div class="searchbar">' + IC.search + '<input id="dictSearch" type="search" enterkeyhint="search" placeholder="搜韩语或中文，例如 사과 / 苹果" value="' + esc(DICT.q) + '"></div>' +
      '<div class="filters">' + statusChips + '</div>' +
      '<div class="filters">' + lvChips + '</div>' +
      '<div class="dict-meta" id="dictCount">' + dictCountText(list.length) + '</div>' +
      '<div class="card" style="padding:2px 14px" id="dictList">' + dictRows(list.slice(0, DICT.limit)) + '</div>' +
      '<button class="btn ghost" id="dictMore" style="width:100%;margin-top:12px;' + (list.length > DICT.limit ? '' : 'display:none') + '" data-act="dictmore">加载更多</button>' +
      '<p class="footnote">点任意单词可看释义、发音、构词和复习状态</p>' +
      '</div>' + nav('dict');
  }

  function updateDictList() {
    var list = dictFiltered();
    var el = document.getElementById('dictList');
    if (el) el.innerHTML = dictRows(list.slice(0, DICT.limit));
    var c = document.getElementById('dictCount');
    if (c) c.textContent = dictCountText(list.length);
    var more = document.getElementById('dictMore');
    if (more) {
      if (list.length > DICT.limit) { more.style.display = ''; more.textContent = '加载更多（还有 ' + (list.length - DICT.limit) + ' 个）'; }
      else more.style.display = 'none';
    }
  }

  function openWord(ko) {
    var w = MAP[ko];
    if (!w) return;
    var p = S.words[ko];
    var pinfo = pronFor(w);
    var status = !p ? '还没学过' : (p.s >= 5 ? '已掌握' : '学习中');
    var next = p ? ' · 下次复习：' + fmtDate(p.d) : '';
    var rows = '';
    if (w.ety) rows += '<div class="drow"><div class="dtag">构词</div><div class="dbody"><p>' + esc(w.ety) + '</p></div></div>';
    if (w.note) rows += '<div class="drow"><div class="dtag">用法</div><div class="dbody"><p>' + esc(w.note) + '</p></div></div>';
    if (w.ex) rows += '<div class="drow"><div class="dtag">例句</div><div class="dbody"><div class="ex"><span class="say" data-act="sayex" data-v="' + esc(w.ko) + '">' + IC.speaker + '</span><span>' + esc(w.ex) + '</span></div><p class="ex-zh">' + esc(w.exZh) + '</p></div></div>';
    rows += '<div class="drow"><div class="dtag">状态</div><div class="dbody"><p>' + status + next + '</p></div></div>';

    document.querySelectorAll('.modal').forEach(function (x) { x.remove(); });
    var m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="panel">' +
      '<div class="sheet-head"><span class="badge lv' + w.level + '">TOPIK ' + w.level + '급</span><button class="icon-btn" data-act="closemodal">' + IC.x + '</button></div>' +
      '<div class="d-mean" style="border:0;padding:12px 0 8px"><span class="d-emoji" style="font-size:38px">' + emojiFor(w) + '</span>' +
      '<div class="d-mean-tx"><b style="font-size:27px">' + esc(w.ko) + '</b><span style="font-size:14px;color:var(--ink2)">' + esc(w.zh) + '</span></div>' +
      '<button class="d-say" data-act="speak" data-v="' + esc(w.ko) + '">' + IC.speaker + '</button></div>' +
      (pinfo ? '<button class="d-pron" data-act="pron" data-v="' + esc(w.ko) + '">발음 <b>' + esc(pinfo.text) + '</b>' +
        pinfo.rules.slice(0, 2).map(function (r) { return '<span class="pr-tag">' + esc(r) + '</span>'; }).join('') +
        '<span class="pr-arrow">规则 ›</span></button>' : '') +
      rows +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      if (e.target === m || e.target.closest('[data-act="closemodal"]')) m.remove();
    });
  }

  /* ---------------- 语法 ---------------- */
  var G_FILTER = '全部';
  function renderGrammar() {
    var levels = ['全部', '초급', '중급', '고급'];
    var chips = levels.map(function (l) {
      return '<button class="chip' + (G_FILTER === l ? ' on' : '') + '" data-act="gfilter" data-v="' + l + '">' + (l === '全部' ? '全部' : l === '초급' ? '初级' : l === '중급' ? '中级' : '高级') + '</button>';
    }).join('');
    var list = GRAM.filter(function (g) { return G_FILTER === '全部' || g.level === G_FILTER; });
    var cards = list.map(function (g, i) {
      return '<details class="gcard card"><summary><span class="gno">' + String(GRAM.indexOf(g) + 1).padStart(2, '0') + '</span>' +
        '<div class="gtitle"><b>' + esc(g.title) + '</b><span>' + esc(g.level) + ' · ' + esc(g.sub) + '</span></div>' +
        '<span class="arw">' + IC.down + '</span></summary>' +
        '<div class="gbody"><div class="form">' + esc(g.form) + '</div><p>' + esc(g.desc) + '</p>' +
        g.ex.map(function (e) { return '<div class="gex"><div class="ko">' + esc(e[0]) + '</div><div class="zh">' + esc(e[1]) + '</div></div>'; }).join('') +
        (g.tip ? '<div class="gtip">💡 ' + esc(g.tip) + '</div>' : '') +
        '</div></details>';
    }).join('');

    app.innerHTML = '<div class="screen active">' +
      '<div class="topbar"><div><div class="hi">문법 노트</div><h1>语法点</h1></div>' +
      '<div class="streak">' + GRAM.length + ' 条</div></div>' +
      '<div class="filters">' + chips + '</div>' +
      '<div style="font-size:12.5px;color:var(--muted);margin:-6px 2px 14px;line-height:1.6">结合单词一起记，效果比死背语法书好得多。单词卡片下方的「语法」讲的就是这里对应的点。</div>' +
      cards +
      '<p class="footnote">以韩国人日常口语和 TOPIK 常见表达为准</p>' +
      '</div>' + nav('grammar');
  }

  function openGram(k, fromQuiz) {
    var g = GMAP[k];
    if (!g) return;
    document.querySelectorAll('.modal').forEach(function (x) { x.remove(); });
    var m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="panel"><div class="sheet-head"><span class="badge">' + esc(g.level) + '</span><button class="icon-btn" data-act="closemodal">' + IC.x + '</button></div>' +
      '<h2 style="font-size:22px;font-weight:750;letter-spacing:-.02em;margin:8px 0 4px">' + esc(g.title) + '</h2>' +
      '<p style="font-size:12.5px;color:var(--muted);margin-bottom:12px">' + esc(g.sub) + '</p>' +
      '<div class="form" style="background:var(--bg);border-radius:12px;padding:10px 12px;font-size:13px;color:var(--green3);font-weight:600">' + esc(g.form) + '</div>' +
      '<p style="font-size:14px;line-height:1.75;color:var(--ink2);margin-top:12px">' + esc(g.desc) + '</p>' +
      g.ex.map(function (e) { return '<div class="gex" style="margin-top:12px"><div class="ko">' + esc(e[0]) + '</div><div class="zh">' + esc(e[1]) + '</div></div>'; }).join('') +
      (g.tip ? '<div class="gtip">💡 ' + esc(g.tip) + '</div>' : '') +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      if (e.target === m || e.target.closest('[data-act="closemodal"]')) m.remove();
    });
  }

  /* ---------------- 发音规则 / 图形记忆 ---------------- */
  var PRON_RULES = {
    '连音': { desc: '前一个字的韵尾移到后一个字元音开头的位置，读成一个音节。', ex: '한국어 → 한구거' },
    '紧音化': { desc: '韵尾 ㄱ/ㄷ/ㅂ 后面的 ㄱ/ㄷ/ㅂ/ㅅ/ㅈ 要读成紧音 ㄲ/ㄸ/ㅃ/ㅆ/ㅉ。', ex: '학교 → 학꾜' },
    '鼻音化': { desc: '韵尾 ㄱ/ㄷ/ㅂ 遇到 ㄴ/ㅁ 时，变成 ㅇ/ㄴ/ㅁ。', ex: '국물 → 궁물' },
    '流音化': { desc: 'ㄴ 和 ㄹ 相遇时，两边都读成 ㄹ。', ex: '신라 → 실라' },
    'ㅎ 脱落': { desc: 'ㅎ 在元音前不发音，直接跳过。', ex: '좋아요 → 조아요' },
    'ㅎ 送气化': { desc: 'ㅎ 遇到 ㄱ/ㄷ/ㅈ 时，变成 ㅋ/ㅌ/ㅊ。', ex: '놓다 → 노타' },
    '送气化': { desc: '韵尾 ㄱ/ㄷ/ㅂ 遇到 ㅎ 时，变成 ㅋ/ㅌ/ㅍ。', ex: '축하 → 추카' },
    '腭化': { desc: '韵尾 ㄷ/ㅌ 后面接 이 时，读成 지/치。', ex: '같이 → 가치' },
    '叠韵尾简化': { desc: 'ㄳ/ㄵ/ㄻ 这类双韵尾，在辅音前只读其中一个。', ex: '값 → 갑' },
    '词尾平音化': { desc: '词尾的韵尾要读成 ㄱ/ㄷ/ㅂ 七个代表音之一。', ex: '옷 → 옫' },
    '平音化': { desc: 'ㅅ/ㅆ/ㅈ/ㅊ/ㅌ 在辅音前读成 ㄷ。', ex: '있다 → 읻따' },
    'ㅎ→ㄴ': { desc: 'ㅎ 在 ㄴ 前读成 ㄴ。', ex: '놓는 → 논는' },
    'ㅎ 紧音化': { desc: 'ㅎ 后面的 ㅅ 读成紧音 ㅆ。', ex: '좋소 → 조쏘' }
  };

  function pronFor(w) {
    var data = (w.pron || '').replace(/[ː:]/g, '').split('/')[0].trim();
    var eng = null;
    try { eng = window.KV_PRON ? window.KV_PRON.standard(w.ko) : null; } catch (e) { eng = null; }
    if (data && data !== w.ko) {
      return { text: data, rules: (eng && eng.pron === data) ? eng.applied : [], source: 'dict' };
    }
    if (eng && eng.applied.length) {
      return { text: eng.pron, rules: eng.applied, source: 'rule' };
    }
    return null;
  }

  function openPron(ko) {
    var w = ko ? MAP[ko] : null;
    var info = w ? pronFor(w) : null;
    var list = info && info.rules.length ? info.rules : Object.keys(PRON_RULES);
    var title = info ? esc(w.ko) : '发音规则';
    var sub = info ? '발음 ' + esc(info.text) + (info.source === 'rule' ? '（按规则推导）' : '') : '韩国语最常见的读音变化';
    var body = list.map(function (k) {
      var r = PRON_RULES[k];
      if (!r) return '';
      return '<div class="pr-row"><b>' + esc(k) + '</b><p>' + esc(r.desc) + '</p><span>' + esc(r.ex) + '</span></div>';
    }).join('');
    document.querySelectorAll('.modal').forEach(function (x) { x.remove(); });
    var m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="panel">' +
      '<div class="sheet-head"><span class="badge">발음</span><button class="icon-btn" data-act="closemodal">' + IC.x + '</button></div>' +
      '<h2 style="font-size:21px;font-weight:750;letter-spacing:-.02em;margin:8px 0 4px">' + title + '</h2>' +
      '<p style="font-size:12.5px;color:var(--muted);margin-bottom:14px">' + sub + '</p>' +
      body +
      (info && info.rules.length && info.rules.length < Object.keys(PRON_RULES).length
        ? '<button class="linkish" data-act="pronall" style="margin-top:12px">查看全部 ' + Object.keys(PRON_RULES).length + ' 条发音规则</button>' : '') +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      if (e.target === m || e.target.closest('[data-act="closemodal"]')) m.remove();
    });
  }

  /* 用 emoji 做图形记忆钩子（离线可用，不依赖图库） */
  var EMOJI = ('学校:🏫,公司:🏢,医院:🏥,银行:🏦,图书馆:📚,公园:🌳,市场:🛒,商店:🏪,餐厅:🍽️,咖啡厅:☕,电影院:🎬,机场:✈️,车站:🚉,邮局:📮,药店:💊,博物馆:🏛️,游泳池:🏊,洗手间:🚻,教室:🏫,公司职员:💼,' +
    '地铁:🚇,公交:🚌,出租车:🚕,火车:🚆,飞机:✈️,自行车:🚲,船:🚢,路:🛣️,' +
    '朋友:👫,家人:👨‍👩‍👧,父亲:👨,母亲:👩,爸爸:👨,妈妈:👩,儿子:👦,女儿:👧,孩子:🧒,男人:👨,女人:👩,老师:🧑‍🏫,学生:🎒,医生:👨‍⚕️,护士:👩‍⚕️,警察:👮,客人:🙋,主人:🏠,' +
    '钱:💰,书:📖,包:👜,衣服:👕,鞋:👟,电话:📞,电脑:💻,手机:📱,电视:📺,照片:📷,礼物:🎁,雨伞:☂️,帽子:🧢,眼镜:👓,手表:⌚,钥匙:🔑,桌子:🪑,椅子:🪑,床:🛏️,窗户:🪟,门:🚪,' +
    '今天:📅,明天:🌅,昨天:🌇,早上:🌄,中午:🕛,晚上:🌙,周末:🎉,生日:🎂,时间:⏰,春天:🌱,夏天:☀️,秋天:🍂,冬天:⛄,' +
    '苹果:🍎,水果:🍉,饭:🍚,面包:🍞,牛奶:🥛,咖啡:☕,茶:🍵,水:💧,肉:🥩,鸡蛋:🥚,蔬菜:🥬,泡菜:🥬,面条:🍜,啤酒:🍺,酒:🍺,糖:🍬,盐:🧂,药:💊,' +
    '山:⛰️,海:🌊,江:🏞️,河:🏞️,天空:🌌,云:☁️,雨:🌧️,雪:❄️,风:🌬️,太阳:☀️,月亮:🌙,星星:⭐,花:🌸,树:🌳,' +
    '吃:🍚,喝:🥤,睡:😴,跑:🏃,走:🚶,坐:🪑,站:🧍,笑:😄,哭:😭,唱歌:🎤,跳舞:💃,学习:✏️,工作:💼,运动:🏃,游泳:🏊,旅行:🧳,买:🛒,卖:💰,等:⏳,找:🔍,打电话:📞,读书:📖,' +
    '爱:❤️,喜欢:❤️,讨厌:👎,幸福:😊,悲伤:😢,生气:😠,害怕:😨,累:😫,忙:🏃,漂亮:🌸,可爱:🥰,好吃:😋,辣:🌶️,甜:🍬,冷:🥶,热:🥵,' +
    '天气:☀️,心情:😊,名字:🏷️,国家:🌏,韩国:🇰🇷,中国:🇨🇳,考试:📝,作业:📝,问题:❓,答案:✅,歌:🎵,音乐:🎵,电影:🎬')
    .split(',').map(function (s) { var i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1)]; })
    .sort(function (a, b) { return b[0].length - a[0].length; });

  function emojiFor(w) {
    for (var i = 0; i < EMOJI.length; i++) {
      if (w.zh.indexOf(EMOJI[i][0]) > -1) return EMOJI[i][1];
    }
    var p = w.pos;
    return p === '동사' ? '🔁' : p === '형용사' ? '✨' : p === '부사' ? '💨' : p === '대명사' ? '👤'
      : p === '수사' ? '🔢' : p === '감탄사' ? '💬' : p === '표현' ? '💬' : '📦';
  }

  /* ---------------- 我的 ---------------- */
  function renderStats() {
    var learning = learnedCount();
    var mastered = 0, right = 0, wrong = 0, wrongList = [];
    for (var k in S.words) {
      var p = S.words[k];
      if (p.s >= 6) mastered++;
      right += p.c; wrong += p.w;
      if (p.w > 0) wrongList.push({ ko: k, w: p.w, zh: MAP[k] ? MAP[k].zh : '' });
    }
    wrongList.sort(function (a, b) { return b.w - a.w; });
    var acc = (right + wrong) ? Math.round(right / (right + wrong) * 100) : 0;

    var bars = '', hasLog = false;
    for (var i = 6; i >= 0; i--) {
      var dk = addDays(today(), -i), L = S.log[dk] || { n: 0, r: 0 };
      if (L.n || L.r) hasLog = true;
      bars += '<div class="barcol' + (i === 0 ? ' today' : '') + '"><div class="stack" style="justify-content:flex-end">' +
        '<div class="b1" style="height:' + Math.min(70, L.n * 6) + 'px"></div>' +
        '<div class="b2" style="height:' + Math.min(60, L.r * 4) + 'px"></div></div>' +
        '<span class="lb">' + (i === 0 ? '今' : '周' + '日一二三四五六'.split('')[new Date(dk.split('-')[0], dk.split('-')[1] - 1, dk.split('-')[2]).getDay()]) + '</span></div>';
    }
    var chart = hasLog
      ? '<div class="bars">' + bars + '</div><div class="legend"><span><i style="background:var(--green)"></i>新词</span><span><i style="background:var(--mint2)"></i>复习</span></div>'
      : '<div class="empty" style="padding:34px 20px">还没有学习记录<br>今天先背 10 个词试试 👇</div>';

    var plan = '';
    for (var j = 0; j < 7; j++) {
      var pd = addDays(today(), j), c = 0;
      for (var kk in S.words) if (S.words[kk].d === pd) c++;
      if (j === 0) for (var ko in S.words) if (S.words[ko].d < today()) c++;
      plan += '<div class="planrow' + (j === 0 ? ' today' : '') + '"><span class="d">' + (j === 0 ? '今天（含逾期）' : fmtDate(pd)) + '</span><span class="n">' + c + ' 词</span></div>';
    }

    var wl = wrongList.slice(0, 8).map(function (x) {
      return '<div class="wrow"><span class="ko">' + esc(x.ko) + '</span><span class="zh">' + esc(x.zh) + '</span>' +
        '<span class="cnt">错 ' + x.w + '</span><button class="say" data-act="speak" data-v="' + esc(x.ko) + '">' + IC.speaker + '</button></div>';
    }).join('') || '<div class="empty">还没有错词。答错的词会自动记在这里。</div>';

    var goalChips = [10, 15, 20, 30, 50, 100].map(function (n) {
      return '<button class="' + (S.settings.goal === n ? 'on' : '') + '" data-act="goal" data-v="' + n + '">' + n + '</button>';
    }).join('');
    var lvlChips = [1, 2, 3, 4, 5, 6].map(function (n) {
      return '<button class="' + (S.settings.levels.indexOf(n) > -1 ? 'on' : '') + '" data-act="lvl" data-v="' + n + '">' + n + '급</button>';
    }).join('');

    var tday = today(), tw = [];
    for (var kt in S.words) if (S.words[kt].f === tday) tw.push(kt);
    tw.sort(function (a, b) { return (S.words[b].t || 0) - (S.words[a].t || 0); });

    app.innerHTML = '<div class="screen active">' +
      '<div class="topbar"><div><div class="hi">나의 기록</div><h1>学习记录</h1></div>' +
      '<div class="streak">' + IC.flame + '<b>' + (S.streak.n || 0) + '</b>天</div></div>' +
      '<div class="statgrid">' +
      '<div class="stat"><span class="lab">已学单词</span><b>' + learning + '<small>/ ' + WORDS.length + '</small></b></div>' +
      '<div class="stat"><span class="lab">已掌握</span><b>' + mastered + '<small>词</small></b></div>' +
      '<div class="stat"><span class="lab">总正确率</span><b>' + acc + '<small>%</small></b></div>' +
      '<div class="stat"><span class="lab">最长连续</span><b>' + (S.streak.best || 0) + '<small>天</small></b></div>' +
      '</div>' +
      '<div class="sec"><div class="sec-head"><h2>今天学的词</h2><span>' + tw.length + ' 个</span></div>' +
      '<div class="card">' + (tw.length
        ? '<div class="wlist">' + tw.slice(0, 6).map(function (k) {
            var w = MAP[k];
            if (!w) return '';
            return '<div class="wrow"><span class="ko">' + esc(w.ko) + '</span><span class="zh">' + esc(w.zh) + '</span>' +
              '<button class="say" data-act="speak" data-v="' + esc(w.ko) + '">' + IC.speaker + '</button></div>';
          }).join('') + '</div>'
        : '<div class="empty">今天还没开始，去学几个词吧</div>') + '</div>' +
      (tw.length ? '<button class="linkish" data-act="dicttoday" style="margin-top:10px">在词典里查看今天学的 ' + tw.length + ' 个词 →</button>' : '') +
      '</div>' +
      '<div class="sec"><div class="sec-head"><h2>最近 7 天</h2><span>新词 / 复习</span></div>' +
      '<div class="card">' + chart + '</div></div>' +
      '<div class="sec"><div class="sec-head"><h2>复习计划</h2><span>遗忘曲线</span></div><div class="card plan">' + plan + '</div></div>' +
      '<div class="sec"><div class="sec-head"><h2>错词本</h2><span>错得最多的</span></div><div class="card wlist">' + wl + '</div></div>' +
      '<div class="sec"><div class="sec-head"><h2>设置</h2><span>立即生效</span></div><div class="card" style="padding:4px 16px">' +
      '<div class="settings">' +
      '<div class="srow"><div class="sl"><b>每天背多少</b><span>' + S.settings.goal + ' 个新词</span></div><div class="seg">' + goalChips + '</div></div>' +
      '<div class="srow"><div class="sl"><b>词库范围</b><span>可多选</span></div><div class="seg">' + lvlChips + '</div>' +
      '<p class="mini">范围只影响新词。已学的词到期后仍会复习。</p></div>' +
      '<div class="srow"><div class="sl"><b>答对自动发音</b><span>韩国语音</span></div>' +
      '<div class="seg"><button class="' + (S.settings.autoSpeak ? 'on' : '') + '" data-act="autospeak">' + (S.settings.autoSpeak ? '已开启' : '已关闭') + '</button></div></div>' +
      '<div class="srow"><div class="sl"><b>发音规则</b><span>连音·紧音化·鼻音化…</span></div>' +
      '<div class="seg"><button data-act="pronall">查看 ' + Object.keys(PRON_RULES).length + ' 条</button></div></div>' +
      '<div class="srow"><div class="sl"><b>数据</b><span>存在本机浏览器</span></div>' +
      '<div class="seg"><button data-act="export">导出备份</button><button data-act="import">导入备份</button><button class="danger" data-act="reset">清空进度</button></div>' +
      '<p class="mini">换手机、换网址或清缓存前，建议先导出备份。</p></div>' +
      '</div></div></div>' +
      '<p class="footnote">한걸음 · 每天一步，韩语就会变成你的<br>精讲 644 词 + 延世 1–6 册词表（CC BY-SA 3.0）<br>发音由在线韩语语音提供</p>' +
      '</div>' + nav('stats');
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act'), v = t.getAttribute('data-v');
    switch (act) {
      case 'nav': {
        if (v === 'home') renderHome();
        else if (v === 'dict') renderDict();
        else if (v === 'grammar') renderGrammar();
        else renderStats();
        window.scrollTo(0, 0);
        break;
      }
      case 'start': startSession(); break;
      case 'dictstatus': DICT.status = v; DICT.limit = 60; renderDict(); window.scrollTo(0, 0); break;
      case 'dictlevel': DICT.level = parseInt(v, 10); DICT.limit = 60; renderDict(); window.scrollTo(0, 0); break;
      case 'dictmore': DICT.limit += 60; updateDictList(); break;
      case 'dicttoday': DICT.status = 'today'; DICT.level = 0; DICT.q = ''; DICT.limit = 60; renderDict(); window.scrollTo(0, 0); break;
      case 'word': openWord(v); break;
      case 'quit': {
        if (Q && (Q.ok + Q.bad) > 0) {
          if (!confirm('退出本次学习？已答的题目会保存进度。')) return;
        }
        Q = null; renderHome(); window.scrollTo(0, 0); break;
      }
      case 'answer': answer(parseInt(v, 10)); break;
      case 'skip': answer(-1); break;
      case 'next': nextCard(false); break;
      case 'speak': playAudio(v, t); break;
      case 'sayex': playSentence(v, t); break;
      case 'gram': openGram(v); break;
      case 'pron': openPron(v); break;
      case 'pronall': openPron(null); break;
      case 'closemodal': {
        var m = t.closest('.modal'); if (m) m.remove(); break;
      }
      case 'gfilter': G_FILTER = v; renderGrammar(); break;
      case 'goal': S.settings.goal = parseInt(v, 10); save(); renderStats(); break;
      case 'lvl': {
        var n = parseInt(v, 10), i = S.settings.levels.indexOf(n);
        if (i > -1) { if (S.settings.levels.length === 1) { toast('至少保留一个级别'); return; } S.settings.levels.splice(i, 1); }
        else { S.settings.levels.push(n); S.settings.levels.sort(); }
        save(); renderStats(); break;
      }
      case 'autospeak': S.settings.autoSpeak = !S.settings.autoSpeak; save(); renderStats(); break;
      case 'reset': {
        if (confirm('确定清空全部学习进度吗？此操作不可恢复。')) {
          S = defaults(); save(); renderHome(); toast('已清空，重新开始');
        }
        break;
      }
      case 'export': {
        var data = JSON.stringify(S, null, 2);
        var blob = new Blob([data], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'hangul-step-backup-' + today() + '.json';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        toast('已导出备份文件');
        break;
      }
      case 'import': {
        var inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,application/json';
        inp.style.display = 'none';
        inp.onchange = function () {
          var f = inp.files && inp.files[0];
          if (!f) { inp.remove(); return; }
          var rd = new FileReader();
          rd.onload = function () {
            try {
              var d = JSON.parse(rd.result);
              if (!d || !d.words || typeof d.words !== 'object') throw new Error('bad');
              if (!confirm('导入会覆盖当前进度，确定吗？')) { inp.remove(); return; }
              S = Object.assign(defaults(), d);
              save(); renderStats(); toast('导入成功');
            } catch (e) { toast('文件格式不对'); }
            inp.remove();
          };
          rd.readAsText(f);
        };
        document.body.appendChild(inp);
        inp.click();
        break;
      }
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'dictSearch') {
      DICT.q = e.target.value;
      DICT.limit = 60;
      updateDictList();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (!Q || !Q.answered) {
      if (Q && !Q.answered && ['1', '2', '3', '4'].indexOf(e.key) > -1) { answer(parseInt(e.key, 10) - 1); }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nextCard(false); }
  });

  /* ---------------- 启动 ---------------- */
  renderHome();
  window.KV_APP = {
    words: WORDS, grammar: GRAM,
    start: startSession, answer: answer, next: function () { nextCard(false); },
    home: renderHome, stats: renderStats, grammarView: renderGrammar,
    dict: renderDict, word: openWord,
    summary: function (b) { renderSummary(b || { ok: 14, bad: 2, acc: 88, totalNew: 12, totalRev: 4 }); },
    state: function () { return S; },
    session: function () { return Q; },
    demoCard: function (ko) {
      var w = MAP[ko];
      if (!w) return false;
      Q = { queue: [{ ko: ko, kind: 'new', retry: 0 }], i: 0, ok: 0, bad: 0, word: w,
        opts: makeOptions(w), answered: false, chosen: -1, totalNew: 1, totalRev: 0 };
      renderQuiz();
      return true;
    }
  };
})();
