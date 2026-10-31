/* 韩语标准发音规则引擎（浏览器 / Node 通用）
   standard(word) -> { pron, applied: ['紧音化', ...] } */
(function (root) {
  var CHO = 19, JUNG = 21, JONG = 28;
  var T = { G: 0, GG: 1, N: 2, D: 3, DD: 4, R: 5, M: 6, B: 7, BB: 8, S: 9, SS: 10, NG: 11, J: 12, JJ: 13, CH: 14, K: 15, TT: 16, P: 17, H: 18 };
  var J = { A: 0, AE: 1, YA: 2, YAE: 3, EO: 4, E: 5, YEO: 6, YE: 7, O: 8, WA: 9, WAE: 10, OI: 11, YO: 12, U: 13, WEO: 14, WE: 15, WI: 16, YU: 17, EU: 18, UI: 19, I: 20 };

  function dec(ch) {
    var c = ch.charCodeAt(0) - 0xAC00;
    if (c < 0 || c > 11171) return null;
    return { cho: Math.floor(c / (JUNG * JONG)), jung: Math.floor((c % (JUNG * JONG)) / JONG), jong: c % JONG };
  }
  function comp(o) { return String.fromCharCode(0xAC00 + o.cho * (JUNG * JONG) + o.jung * JONG + o.jong); }

  var SIMPLIFY = { 3: 1, 5: 4, 6: 4, 9: 1, 10: 6, 11: 8, 12: 8, 13: 8, 14: 17, 15: 8, 18: 17 };
  var SPLIT = { 3: [1, T.S], 5: [4, T.J], 6: [4, T.H], 9: [8, T.G], 10: [8, T.M], 11: [8, T.B], 12: [8, T.S], 13: [8, T.TT], 14: [8, T.P], 15: [8, T.H], 18: [17, T.S] };
  var TENS = { 0: 1, 3: 4, 7: 8, 9: 10, 12: 13 };
  var NASAL = { 1: 21, 7: 4, 17: 16 };
  var ASP = { 0: T.K, 3: T.TT, 12: T.CH };
  // 韵尾索引 → 辅音索引（连音时用）
  var J2C = { 1: 0, 2: 1, 4: 2, 7: 3, 8: 5, 16: 6, 17: 7, 19: 9, 20: 10, 22: 12, 23: 14, 24: 15, 25: 16, 26: 17, 27: 18 };
  // 词尾平音化：所有韵尾在词末读成七代表音
  var FINAL = { 2: 1, 3: 1, 19: 7, 20: 7, 22: 7, 23: 7, 25: 7, 24: 1, 26: 17, 27: 7, 5: 4, 6: 4, 9: 1, 10: 6, 11: 8, 12: 8, 13: 8, 14: 17, 15: 8, 18: 17 };

  function part(s) {
    var syl = [], i;
    for (i = 0; i < s.length; i++) {
      var d = dec(s[i]);
      if (!d) return null;
      syl.push(d);
    }
    var applied = [];
    function mark(name) { if (applied.indexOf(name) < 0) applied.push(name); }

    for (i = 0; i < syl.length - 1; i++) {
      var a = syl[i], b = syl[i + 1];
      if (a.jong === 0) continue;

      // 叠韵尾在辅音前简化
      if (a.jong in SIMPLIFY && b.cho !== T.NG) {
        if ((a.jong === 6 || a.jong === 15) && (b.cho === T.G || b.cho === T.D || b.cho === T.J)) {
          a.jong = a.jong === 6 ? 4 : 8;
          b.cho = b.cho === T.G ? T.K : b.cho === T.D ? T.TT : T.CH;
          mark('ㅎ 送气化');
          continue;
        }
        a.jong = SIMPLIFY[a.jong];
        mark('叠韵尾简化');
      }
      if (a.jong === 0) continue;
      if (a.jong === 21) continue; // 韵尾 ㅇ 不参与连音

      // ㅅ/ㅆ/ㅈ/ㅊ/ㅌ 在辅音前读成 ㄷ（平音化）
      if ((a.jong === 19 || a.jong === 20 || a.jong === 22 || a.jong === 23 || a.jong === 25) &&
          b.cho !== T.NG && b.cho !== T.H) {
        a.jong = 7; mark('平音化');
      }

      // ㅎ 相关
      if (a.jong === 27) {
        if (b.cho === T.NG) { a.jong = 0; mark('ㅎ 脱落'); continue; }
        if (ASP[b.cho] !== undefined) { b.cho = ASP[b.cho]; a.jong = 0; mark('ㅎ 送气化'); continue; }
        if (b.cho === T.N) { a.jong = 4; mark('ㅎ→ㄴ'); continue; }
        if (b.cho === T.S) { b.cho = T.SS; a.jong = 0; mark('ㅎ 紧音化'); continue; }
        if (b.cho === T.R) { a.jong = 0; mark('ㅎ 脱落'); continue; }
        a.jong = 0; mark('ㅎ 脱落'); continue;
      }
      // 韵尾 + ㅎ 送气
      if (b.cho === T.H && (a.jong === 1 || a.jong === 7 || a.jong === 17)) {
        b.cho = a.jong === 1 ? T.K : a.jong === 7 ? T.TT : T.P;
        a.jong = 0; mark('送气化'); continue;
      }
      if (b.cho === T.H && a.jong === 19) { a.jong = 0; b.cho = T.TT; mark('送气化'); continue; }
      // ㄹ + ㅎ：ㅎ 脱落，ㄹ 移到下一音节（말하다 → 마라다）
      if (b.cho === T.H && a.jong === 8) {
        a.jong = 0; b.cho = T.R; mark('ㅎ 脱落'); continue;
      }
      // 腭化：ㄷ/ㅌ + 이
      if ((a.jong === 7 || a.jong === 25) && b.cho === T.NG && b.jung === J.I) {
        b.cho = a.jong === 7 ? T.J : T.CH;
        a.jong = 0; mark('腭化'); continue;
      }
      // 连音
      if (b.cho === T.NG) {
        if (a.jong in SPLIT) {
          var sp = SPLIT[a.jong];
          a.jong = sp[0]; b.cho = sp[1];
          mark('连音');
          if (b.cho === T.S) { b.cho = T.SS; mark('紧音化'); }
        } else {
          b.cho = J2C[a.jong]; a.jong = 0; mark('连音');
        }
        continue;
      }
      // 紧音化
      if ((a.jong === 1 || a.jong === 7 || a.jong === 17) && (b.cho in TENS)) {
        b.cho = TENS[b.cho]; mark('紧音化'); continue;
      }
      // 鼻音化
      if ((a.jong === 1 || a.jong === 7 || a.jong === 17) && (b.cho === T.N || b.cho === T.M)) {
        a.jong = NASAL[a.jong]; mark('鼻音化'); continue;
      }
      // 流音化
      if (a.jong === 4 && b.cho === T.R) { a.jong = 8; b.cho = T.R; mark('流音化'); continue; }
      if (a.jong === 8 && b.cho === T.N) { b.cho = T.R; mark('流音化'); continue; }
      // 韵尾 ㄹ + ㄹ
      if (a.jong === 8 && b.cho === T.R) { b.cho = T.R; continue; }
    }
    // 末音节韵尾平音化
    var last = syl[syl.length - 1];
    if (last.jong in FINAL) { last.jong = FINAL[last.jong]; mark('词尾平音化'); }
    return { pron: syl.map(comp).join(''), applied: applied };
  }

  function standard(word) {
    var parts = word.split(' ');
    var out = [], applied = [];
    for (var i = 0; i < parts.length; i++) {
      var r = part(parts[i]);
      if (!r) return null;
      out.push(r.pron);
      r.applied.forEach(function (x) { if (applied.indexOf(x) < 0) applied.push(x); });
    }
    return { pron: out.join(' '), applied: applied };
  }

  var api = { standard: standard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KV_PRON = api;
})(typeof window !== 'undefined' ? window : this);
