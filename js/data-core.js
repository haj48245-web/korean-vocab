/* 한걸음 — 数据基础层
   单词行格式：韩语|中文释义|词性|TOPIK级别|例句|例句翻译|用法|语法点
   语法点格式：语法名称@说明（语法名称需与 grammar.js 中的 key 对应，可省略） */
window.KV_WORDS = window.KV_WORDS || [];

window.addWords = function (raw) {
  raw.trim().split('\n').forEach(function (line) {
    line = line.trim();
    if (!line || line.charAt(0) === '#') return;
    var p = line.split('|').map(function (s) { return s.trim(); });
    if (p.length < 6) return;
    var gram = p[7] || '';
    var gi = gram.indexOf('@');
    window.KV_WORDS.push({
      ko: p[0],
      zh: p[1],
      pos: p[2] || '명사',
      level: parseInt(p[3], 10) || 1,
      ex: p[4] || '',
      exZh: p[5] || '',
      note: p[6] || '',
      gramKey: gi > -1 ? gram.slice(0, gi) : gram,
      gram: gi > -1 ? gram.slice(gi + 1) : '',
      pron: '',
      ety: ''
    });
  });
};

/* 扩展词库：紧凑数组 [韩语, 中文, 词性, 级别, 发音, 构词] */
window.addCompact = function (rows) {
  rows.forEach(function (r) {
    window.KV_WORDS.push({
      ko: r[0], zh: r[1], pos: r[2], level: r[3],
      pron: r[4] || '', ety: r[5] || '',
      ex: '', exZh: '', note: '', gramKey: '', gram: ''
    });
  });
};

/* 给已有词条补充发音 / 构词（不覆盖已有内容） */
window.enrichWords = function (map) {
  window.KV_WORDS.forEach(function (w) {
    var m = map[w.ko];
    if (!m) return;
    if (!w.pron) w.pron = m.pron || '';
    if (!w.ety) w.ety = m.ety || '';
  });
};

/* 语法条目：key 用于与单词的语法点匹配 */
window.KV_GRAMMAR = window.KV_GRAMMAR || [];
window.addGrammar = function (arr) { window.KV_GRAMMAR = window.KV_GRAMMAR.concat(arr); };

/* 补充用法：单词|用法说明（只填补主词库中留空的“用法”） */
window.addNotes = function (raw) {
  var map = {};
  raw.trim().split('\n').forEach(function (line) {
    line = line.trim();
    if (!line || line.charAt(0) === '#') return;
    var i = line.indexOf('|');
    if (i < 0) return;
    map[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  window.KV_WORDS.forEach(function (w) {
    if (!w.note && map[w.ko]) w.note = map[w.ko];
  });
};
