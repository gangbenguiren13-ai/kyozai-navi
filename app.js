/* 英語教材ナビ
   - ローカル版：data.local.js（window.KYOZAI_DATA）を読む。実物パスを持つ。
   - 公開版　　：data.public.json を読む。実物パスは持たない。
   外部への通信は一切行わない。お気に入り・履歴は localStorage のみ。 */

(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var KEY_FAV = 'kyozai.fav', KEY_RECENT = 'kyozai.recent', KEY_HOME = 'kyozai.home';

  var DATA = [];
  var IS_LOCAL_DATA = false;
  var IS_FILE = location.protocol === 'file:';
  var IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var state = { q: '', grade: '', unit: '', lesson: '', gram: '', type: '', skill: '', time: '', st: '', favOnly: false };
  var home = { grade: '', unit: '', lesson: '' };
  var openRows = {};
  var openMenu = null;

  /* ───────── 保存 ───────── */
  /* 保存された値は、形が壊れていることがある（他のページの残り、手で書き換えた、など）。
     期待した形でなければ既定値に戻す。画面全体が止まるのを防ぐため。 */
  function load(k, d, ok) {
    try {
      var v = JSON.parse(localStorage.getItem(k));
      if (v === null || v === undefined) return d;
      if (ok && !ok(v)) { localStorage.removeItem(k); return d; }
      return v;
    } catch (e) {
      try { localStorage.removeItem(k); } catch (e2) {}
      return d;
    }
  }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function isIdList(v) {
    return Object.prototype.toString.call(v) === '[object Array]' &&
           v.every(function (x) { return typeof x === 'string'; });
  }
  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && Object.prototype.toString.call(v) !== '[object Array]';
  }
  /* ホーム設定は { grade, unit, lesson }（古い形式は g / u / l）。
     中身が文字か空欄でなければ、壊れているとみなす。 */
  function isHomeSetting(v) {
    if (!isPlainObject(v)) return false;
    var keys = ['grade', 'unit', 'lesson', 'g', 'u', 'l'];
    for (var i = 0; i < keys.length; i++) {
      var x = v[keys[i]];
      if (x !== undefined && x !== null && typeof x !== 'string') return false;
    }
    return true;
  }

  var favs = load(KEY_FAV, [], isIdList);
  var recents = load(KEY_RECENT, [], isIdList);

  function isFav(id) { return favs.indexOf(id) >= 0; }
  function toggleFav(id) {
    var i = favs.indexOf(id);
    if (i >= 0) { favs.splice(i, 1); toast('お気に入りから外しました'); }
    else { favs.push(id); toast('お気に入りに入れました'); }
    save(KEY_FAV, favs); render(); renderSide();
  }
  function pushRecent(id) {
    recents = recents.filter(function (x) { return x !== id; });
    recents.unshift(id); recents = recents.slice(0, 5);
    save(KEY_RECENT, recents); renderSide();
  }

  /* ───────── 小道具 ───────── */
  var tt;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('on'); }, 1800);
  }
  function copy(txt) {
    var done = function () { toast('パスをコピーしました'); };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(done, fallback); }
    else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('コピーできませんでした'); }
      ta.remove();
    }
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function uniq(a) { var s = {}, o = []; a.forEach(function (v) { if (v && !s[v]) { s[v] = 1; o.push(v); } }); return o; }
  function no(u) { var m = /(\d+)/.exec(u || ''); return m ? parseInt(m[1], 10) : 999; }
  function byId(id) { for (var i = 0; i < DATA.length; i++) { if (DATA[i].id === id) return DATA[i]; } return null; }
  function asArray(v) { if (v == null || v === '') return []; return Object.prototype.toString.call(v) === '[object Array]' ? v : [v]; }

  /* ───────── 「実物を開く」の判定 ───────── */
  function openInfo(m) {
    var url = m.実物URL && String(m.実物URL).trim();
    if (url) {
      return m.公開区分 === '認証限定'
        ? { kind: 'url', label: '実物を開く（要ログイン）', href: url }
        : { kind: 'url', label: '実物を開く', href: url };
    }
    if (m.公開区分 === '認証限定') return { kind: 'reason', tone: 'r-amber', label: '認証が必要です' };

    var p = m.実物パス && String(m.実物パス).trim();
    if (!p) {
      // 公開版は実物パスを持たない。未特定なのか端末の都合なのかを取り違えない
      if (m.実物あり === false) return { kind: 'reason', tone: 'r-grey', label: '実物未特定' };
      if (!IS_LOCAL_DATA) return { kind: 'reason', tone: 'r-blue', label: '自宅PCで開けます' };
      return { kind: 'reason', tone: 'r-grey', label: '実物未特定' };
    }
    if (m.実物あり === false) return { kind: 'reason', tone: 'r-grey', label: '実物未特定（ファイルが見つかりません）' };
    if (IS_MOBILE) return { kind: 'reason', tone: 'r-red', label: 'この端末からは開けません' };
    if (!IS_FILE) return { kind: 'reason', tone: 'r-blue', label: '自宅PCで開けます' };
    return { kind: 'file', label: '実物を開く', href: encodeURI('file:///' + p.replace(/\\/g, '/')), path: p };
  }

  /* ───────── 絞り込み ───────── */
  function timeMatch(mins, cond) {
    if (!cond) return true;
    if (mins == null) return false;
    if (cond === '10分以内') return mins <= 10;
    if (cond === '25分以内') return mins <= 25;
    if (cond === '40分以上') return mins >= 40;
    return true;
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.filter(function (m) {
      if (state.grade && m.学年 !== state.grade) return false;
      if (state.unit && m.単元 !== state.unit) return false;
      if (state.lesson && m.レッスン !== state.lesson) return false;
      if (state.gram && m.文法.indexOf(state.gram) < 0) return false;
      if (state.type && m.形式 !== state.type) return false;
      if (state.skill && m.技能.indexOf(state.skill) < 0) return false;
      if (state.st && m.状態 !== state.st) return false;
      if (!timeMatch(m.所要時間, state.time)) return false;
      if (state.favOnly && !isFav(m.id)) return false;
      if (q) {
        var hay = [m.教材名, m.ねらい || '', m.語彙 || '', m.文法.join(' '), m.単元, m.レッスン].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function lists() {
    return {
      grade: uniq(DATA.map(function (m) { return m.学年; })),
      unit: uniq(DATA.map(function (m) { return m.単元; })).sort(function (a, b) { return no(a) - no(b); }),
      lesson: uniq(DATA.map(function (m) { return m.レッスン; })).sort(function (a, b) { return no(a) - no(b); }),
      gram: uniq([].concat.apply([], DATA.map(function (m) { return m.文法; }))).sort(),
      type: uniq(DATA.map(function (m) { return m.形式; })),
      skill: ['聞く', '話す', '読む', '書く'].filter(function (k) {
        return DATA.some(function (m) { return m.技能.indexOf(k) >= 0; });
      }),
      st: uniq(DATA.map(function (m) { return m.状態; }))
    };
  }

  /* ───────── ホームの選択メニュー ───────── */
  var MENUS = [
    { key: 'grade', label: '学年', all: 'すべての学年' },
    { key: 'unit', label: '単元', all: 'すべての単元' },
    { key: 'lesson', label: 'レッスン', all: 'すべてのレッスン' }
  ];

  function makeMenu(def, values, scope, onPick) {
    var wrap = el('div', 'menu');
    wrap.dataset.id = scope + ':' + def.key;
    wrap.dataset.scope = scope;
    wrap.dataset.key = def.key;
    wrap.dataset.all = def.all || 'すべて';
    wrap.appendChild(el('span', 'menu-label', def.label));

    var trig = el('button', 'menu-trigger');
    trig.appendChild(el('span', 'menu-value'));
    trig.appendChild(el('i', 'chev'));
    trig.addEventListener('click', function (e) {
      e.stopPropagation();
      openMenu = (openMenu === wrap.dataset.id) ? null : wrap.dataset.id;
      paintMenus();
    });
    wrap.appendChild(trig);

    var pop = el('div', 'menu-pop');
    pop.hidden = true;
    [{ value: '', label: wrap.dataset.all }]
      .concat(values.map(function (v) { return { value: v, label: v }; }))
      .forEach(function (o) {
        var b = el('button');
        b.appendChild(el('span', null, o.label));
        b.appendChild(el('span', 'tick', '✓'));
        b.dataset.value = o.value;
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          openMenu = null;
          onPick(o.value);
        });
        pop.appendChild(b);
      });
    wrap.appendChild(pop);
    return wrap;
  }

  function buildMenus() {
    var L = lists();
    var box = $('#home-menus');
    box.innerHTML = '';
    MENUS.forEach(function (def) {
      box.appendChild(makeMenu(def, L[def.key], 'home', function (v) {
        home[def.key] = v;
        save(KEY_HOME, home);
        paintMenus(); homeCount();
      }));
    });
    paintMenus();
  }

  function paintMenus() {
    $$('.menu').forEach(function (wrap) {
      var key = wrap.dataset.key;
      var v = (wrap.dataset.scope === 'home' ? home[key] : state[key]) || '';
      var isOpen = openMenu === wrap.dataset.id;
      wrap.classList.toggle('is-open', isOpen);
      var val = wrap.querySelector('.menu-value');
      val.textContent = v || wrap.dataset.all;
      val.classList.toggle('has-value', !!v);
      wrap.querySelector('.menu-pop').hidden = !isOpen;
      Array.prototype.forEach.call(wrap.querySelectorAll('.menu-pop button'), function (b) {
        b.classList.toggle('is-on', b.dataset.value === v);
      });
    });
  }

  function homeCount() {
    var n = DATA.filter(function (m) {
      return (!home.grade || m.学年 === home.grade) &&
             (!home.unit || m.単元 === home.unit) &&
             (!home.lesson || m.レッスン === home.lesson);
    }).length;
    $('#h-count').textContent = n;
  }

  /* ───────── 絞り込みパネル ───────── */
  var FILTERS = [
    { key: 'grade', label: '学年' }, { key: 'unit', label: '単元' },
    { key: 'lesson', label: 'レッスン' }, { key: 'gram', label: '文法' },
    { key: 'type', label: '形式' }, { key: 'skill', label: '技能' },
    { key: 'time', label: '所要時間' }, { key: 'st', label: '状態' }
  ];

  function buildFilters() {
    var L = lists();
    L.time = ['10分以内', '25分以内', '40分以上'];
    var box = $('#filters');
    box.innerHTML = '';
    FILTERS.forEach(function (def) {
      box.appendChild(makeMenu(def, L[def.key], 'filter', function (v) {
        state[def.key] = v;
        sync(); render();
      }));
    });
    paintMenus();
  }

  /* ───────── 結果 ───────── */
  function stateTone(s) { return s === '完成' ? 't-green' : s === '要追記' ? 't-amber' : 't-purple'; }

  function firstLine(txt) {
    var a = String(txt || '').replace(/\*\*/g, '').replace(/\[\[|\]\]/g, '')
      .split('\n').filter(function (l) { return l.trim(); })[0] || '';
    return a;
  }

  function fullText(txt) {
    return String(txt || '').replace(/\*\*/g, '').replace(/\[\[|\]\]/g, '').trim();
  }

  function specRow(k, v, cls) {
    var r = el('div', 'r');
    r.appendChild(el('span', 'k', k));
    r.appendChild(el('span', 'v' + (cls ? ' ' + cls : ''), v));
    return r;
  }

  function rowNode(m, i, animate) {
    var row = el('div', 'row' + (openRows[m.id] ? ' is-open' : ''));

    var head = el('div', 'row-head');
    var main = el('button', 'row-main');
    main.appendChild(el('span', 'dot d-' + (m.形式 || 'その他')));

    var txt = el('span', 'row-text');
    txt.appendChild(el('span', 'row-name', m.教材名));
    var subBits = [m.レッスン, m.形式, m.所要時間 != null ? m.所要時間 + '分' : null]
      .concat(m.技能 || []).filter(Boolean);
    var aimLine = firstLine(m.ねらい);
    txt.appendChild(el('span', 'row-sub', aimLine || subBits.join(' ・ ')));
    main.appendChild(txt);

    var tags = el('span', 'row-tags');
    if (m.形式) tags.appendChild(el('span', 'mini', m.形式));
    (m.文法 || []).slice(0, 2).forEach(function (g) { tags.appendChild(el('span', 'mini m-amber', g)); });
    if (m.レッスン) tags.appendChild(el('span', 'mini m-blue', m.レッスン));
    main.appendChild(tags);

    main.appendChild(el('span', 'row-time', m.所要時間 != null ? m.所要時間 + '分' : '—'));
    main.appendChild(el('span', 'tag state-tag ' + stateTone(m.状態), m.状態 || '状態なし'));
    var chev = el('span', 'chev-r', '›');
    chev.setAttribute('aria-hidden', 'true');
    main.appendChild(chev);
    main.setAttribute('aria-expanded', openRows[m.id] ? 'true' : 'false');
    main.setAttribute('aria-label', m.教材名 + ' の詳細を' + (openRows[m.id] ? '閉じる' : '開く'));
    main.addEventListener('click', function () {
      openRows[m.id] = !openRows[m.id];
      render(true);
    });
    head.appendChild(main);

    var star = el('button', 'star' + (isFav(m.id) ? ' is-on' : ''), isFav(m.id) ? '★' : '☆');
    star.setAttribute('aria-label', isFav(m.id) ? 'お気に入りから外す' : 'お気に入りに入れる');
    star.addEventListener('click', function () { toggleFav(m.id); });
    head.appendChild(star);
    row.appendChild(head);

    if (!openRows[m.id]) {
      var peek = el('div', 'row-peek');
      var pin = el('div', 'in');
      var aimP = fullText(m.ねらい);
      pin.appendChild(el('p', 'txt', aimP ? (aimP.length > 150 ? aimP.slice(0, 150) + '…' : aimP) : 'ねらいは未記入です。'));
      var meta = el('div', 'meta');
      [[ '学年・単元', [m.学年, m.単元].filter(Boolean).join(' ') ],
       [ 'レッスン', m.レッスン ],
       [ '技能', (m.技能 || []).join('・') ],
       [ '文法', (m.文法 || []).join('・') ],
       [ '公開区分', m.公開区分 ]].forEach(function (p) {
        if (p[1]) meta.appendChild(el('span', null, p[0] + '：' + p[1]));
      });
      if (meta.childNodes.length) pin.appendChild(meta);
      peek.appendChild(pin);
      row.appendChild(peek);
    }

    if (openRows[m.id]) {
      var body = el('div', 'row-body');

      var left = el('div', 'body-main');
      var badges = el('div', 'badges');
      (m.文法 || []).forEach(function (g) { badges.appendChild(el('span', 'tag t-amber', g)); });
      (m.技能 || []).forEach(function (s) { badges.appendChild(el('span', 'tag t-grey', s)); });
      if (badges.childNodes.length) left.appendChild(badges);

      var aimTxt = fullText(m.ねらい);
      if (aimTxt) {
        var p = el('p', 'aim', aimTxt);
        left.appendChild(p);
        if (aimTxt.length > 260) {
          p.className = 'aim clamp';
          var more = el('button', 'more', '全文を表示');
          more.addEventListener('click', function () {
            var open = p.className.indexOf('clamp') < 0;
            p.className = open ? 'aim clamp' : 'aim';
            more.textContent = open ? '全文を表示' : '閉じる';
          });
          left.appendChild(more);
        }
      } else {
        left.appendChild(el('p', 'aim', 'ねらいは未記入です。'));
      }
      body.appendChild(left);

      var side = el('div', 'body-side');
      var spec = el('div', 'spec');
      spec.appendChild(specRow('学年・単元', [m.学年, m.単元].filter(Boolean).join(' ') || '—'));
      spec.appendChild(specRow('レッスン', m.レッスン || '—'));
      spec.appendChild(specRow('形式', m.形式 || '—'));
      spec.appendChild(specRow('所要時間', m.所要時間 != null ? m.所要時間 + '分' : '未記入'));
      spec.appendChild(specRow('状態', m.状態 || '—'));
      spec.appendChild(specRow('公開区分', m.公開区分 || '—'));
      if (m.実物パス) spec.appendChild(specRow('保存場所', m.実物パス, 'path'));
      side.appendChild(spec);

      if (m.語彙) {
        var v = el('div', 'vocab');
        v.appendChild(el('h4', null, '語彙'));
        v.appendChild(document.createTextNode(m.語彙));
        side.appendChild(v);
      }
      body.appendChild(side);
      var acts = el('div', 'actions');
      var info = openInfo(m);
      if (info.kind === 'reason') {
        acts.appendChild(el('span', 'reason ' + info.tone, info.label));
      } else {
        var a = el('a', 'btn btn-primary', info.label);
        a.href = info.href;
        if (info.kind !== 'file') { a.target = '_blank'; a.rel = 'noopener'; }
        a.addEventListener('click', function () { pushRecent(m.id); });
        acts.appendChild(a);
      }
      if (info.kind === 'file') {
        var cp = el('button', 'btn btn-ghost', 'パスをコピー');
        cp.addEventListener('click', function () { copy(info.path); pushRecent(m.id); });
        acts.appendChild(cp);
      }
      if (m.音声URL) {
        var au = el('a', 'btn btn-ghost', '音声ページを開く');
        au.href = m.音声URL; au.target = '_blank'; au.rel = 'noopener';
        acts.appendChild(au);
      }
      body.appendChild(acts);
      row.appendChild(body);
    }
    return row;
  }

  function renderPills() {
    var box = $('#pills');
    box.innerHTML = '';
    var defs = [
      ['q', state.q ? 'キーワード：' + state.q : ''], ['grade', state.grade], ['unit', state.unit],
      ['lesson', state.lesson], ['gram', state.gram], ['type', state.type], ['skill', state.skill],
      ['time', state.time], ['st', state.st], ['favOnly', state.favOnly ? '★お気に入りだけ' : '']
    ].filter(function (p) { return p[1]; });

    if (!defs.length) { box.appendChild(el('span', 'none', '絞り込みなし')); return; }
    defs.forEach(function (p) {
      var s = el('span', 'pill');
      s.appendChild(document.createTextNode(p[1]));
      var b = el('button', null, '×');
      b.setAttribute('aria-label', p[1] + ' を外す');
      b.addEventListener('click', function () {
        state[p[0]] = (p[0] === 'favOnly') ? false : '';
        sync(); render();
      });
      s.appendChild(b);
      box.appendChild(s);
    });
  }

  function setCount(n) {
    var box = $('.count'), el0 = $('#count');
    var from = parseInt(el0.textContent, 10);
    if (REDUCED || isNaN(from) || from === n) { el0.textContent = n; return; }
    if (box) { box.classList.add('bump'); setTimeout(function () { box.classList.remove('bump'); }, 220); }
    var t0 = performance.now(), dur = 380;
    (function step(t) {
      var p = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el0.textContent = Math.round(from + (n - from) * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  function pinHeads() {
    $$('.group-head').forEach(function (h) {
      // 貼りついたかの判定にも、実際に測ったヘッダーの高さを使う（スマホでは2段になるため）
      var pinned = h.getBoundingClientRect().top <= headH() + 2 && h.parentNode.getBoundingClientRect().bottom > 120;
      h.classList.toggle('pinned', pinned);
    });
    var t = $('.top');
    if (t) t.classList.toggle('scrolled', (window.pageYOffset || 0) > 8);
  }

  var lastSig = null;

  function render(keepStill) {
    var list = filtered();
    setCount(list.length);
    renderPills();

    var sig = [state.grade, state.unit, state.lesson, state.gram, state.type, state.skill, state.time, state.st, state.favOnly].join('|');
    var animate = !REDUCED && !keepStill && sig !== lastSig;
    lastSig = sig;

    var box = $('#results');
    box.innerHTML = '';

    if (!list.length) {
      var z = el('div', 'zero');
      z.appendChild(el('p', null, '条件に合う教材がありませんでした。'));
      var btns = el('div', 'btns');
      var b1 = el('button', 'btn btn-ghost', '絞り込みを1つ外す');
      b1.addEventListener('click', function () {
        var order = ['time', 'skill', 'st', 'gram', 'lesson', 'type', 'unit', 'q', 'grade'];
        for (var i = 0; i < order.length; i++) { if (state[order[i]]) { state[order[i]] = ''; break; } }
        if (state.favOnly) state.favOnly = false;
        sync(); render();
      });
      var b2 = el('button', 'btn btn-primary', 'すべてクリア');
      b2.addEventListener('click', function () { clearAll(); });
      btns.appendChild(b1); btns.appendChild(b2);
      z.appendChild(btns);
      box.appendChild(z);
      return;
    }

    list.sort(function (a, b) {
      var d = no(a.単元) - no(b.単元);
      if (d) return d;
      return no(a.レッスン) - no(b.レッスン);
    });

    var groups = [], byKey = {};
    list.forEach(function (m) {
      var key = [m.学年, m.単元].filter(Boolean).join(' ') || 'その他';
      if (!byKey[key]) { byKey[key] = { title: key, grade: m.学年 || '', unit: m.単元 || 'その他', items: [] }; groups.push(byKey[key]); }
      byKey[key].items.push(m);
    });

    groups.forEach(function (g, gi) {
      var sec = el('section', 'group');
      var head = el('div', 'group-head');
      if (animate) head.setAttribute('data-reveal', '0');

      var idx = el('span', 'gi');
      idx.textContent = ('0' + (gi + 1)).slice(-2);
      head.appendChild(idx);

      var ttl = el('span', 't');
      if (g.grade) ttl.appendChild(el('span', 'g', g.grade));
      ttl.appendChild(el('span', 'u', g.unit));
      head.appendChild(ttl);

      var lessons = [];
      g.items.forEach(function (m) { if (m.レッスン && lessons.indexOf(m.レッスン) < 0) lessons.push(m.レッスン); });
      if (lessons.length) {
        var ls = lessons.length > 2
          ? lessons[0] + ' – ' + lessons[lessons.length - 1]
          : lessons.join('・');
        head.appendChild(el('span', 'ls', ls));
      }

      head.appendChild(el('span', 'bar'));
      head.appendChild(el('span', 'c', g.items.length + '件'));
      sec.appendChild(head);
      g.items.forEach(function (m, i) { sec.appendChild(rowNode(m, i, animate)); });
      box.appendChild(sec);
    });

    reveal();
    pinHeads();
    scrollNodes = $$('#results .row');
    hoverRow = null;
    hoverP = 0; hoverTo = 0;
    pushRows = []; pushSecs = []; peekH = 0;
    wireRowHover();
    scrollTick();
  }

  function renderSide() {
    fill('#recent-list', recents, 'まだありません。教材を開くとここに残ります。');
    fill('#fav-list', favs, '★を押すとここに入ります。');
  }
  function fill(sel, ids, emptyMsg) {
    var ul = $(sel);
    ul.innerHTML = '';
    var found = ids.map(byId).filter(Boolean);
    if (!found.length) { ul.appendChild(el('li', 'empty', emptyMsg)); return; }
    found.forEach(function (m) {
      var li = el('li');
      var b = el('button');
      b.appendChild(el('span', 'nm', m.教材名));
      b.appendChild(el('span', 'sb', [m.単元, m.レッスン, m.形式].filter(Boolean).join('・')));
      b.addEventListener('click', function () {
        clearAll(true);
        state.q = m.教材名;
        openRows[m.id] = true;
        sync(); showView('search'); render();
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  /* ───────── 操作 ───────── */
  function sync() {
    $('#q').value = state.q;
    paintMenus();
    $('#only-fav').classList.toggle('is-on', state.favOnly);
    $$('.chip[data-quick]').forEach(function (c) {
      c.classList.toggle('is-on', state.time === c.dataset.quick);
    });
  }

  function clearAll(silent) {
    state = { q: '', grade: '', unit: '', lesson: '', gram: '', type: '', skill: '', time: '', st: '', favOnly: false };
    sync();
    if (!silent) { render(); toast('すべての条件を外しました'); }
  }

  function showView(name) {
    $('#view-home').hidden = name !== 'home';
    $('#view-search').hidden = name !== 'search';
    $$('.tab').forEach(function (t) { t.classList.toggle('is-on', t.dataset.view === name); });
    window.scrollTo(0, 0);
    var shown = $(name === 'home' ? '#view-home' : '#view-search');
    if (shown && !REDUCED) {
      shown.classList.remove('view-in');
      void shown.offsetWidth;
      shown.classList.add('view-in');
    }
    reveal();
    pinHeads();
    scrollTick();
    homeTick();
  }

  function wire() {
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { showView(t.dataset.view); });
    });

    $('#h-go').addEventListener('click', function () {
      clearAll(true);
      state.grade = home.grade; state.unit = home.unit; state.lesson = home.lesson;
      sync(); showView('search'); render();
    });

    /* 1文字ごとに全件を描き直すと、教材が増えたときに重くなる。
       入力が止まってから描き直す。Enterキーはすぐ反映する。 */
    var qTimer = null;
    function applyQuery(v) { if (state.q === v) return; state.q = v; render(); }
    $('#q').addEventListener('input', function () {
      var v = this.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(function () { applyQuery(v); }, 180);
    });
    $('#q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { clearTimeout(qTimer); applyQuery(this.value); }
    });
    $('#q').addEventListener('blur', function () { clearTimeout(qTimer); applyQuery(this.value); });

    $('#toggle-filters').addEventListener('click', function () {
      var box = $('#filters');
      box.hidden = !box.hidden;
      this.setAttribute('aria-expanded', String(!box.hidden));
      this.textContent = box.hidden ? '絞り込み ＋' : '絞り込み －';
    });

    $('#only-fav').addEventListener('click', function () {
      state.favOnly = !state.favOnly; sync(); render();
    });

    $('#clear').addEventListener('click', function () { clearAll(); });

    $$('.chip[data-quick]').forEach(function (c) {
      c.addEventListener('click', function () {
        var v = c.dataset.quick;
        state.time = (state.time === v) ? '' : v;
        sync(); showView('search'); render();
      });
    });

    // メニューの外側を押したら閉じる
    document.addEventListener('pointerdown', function (e) {
      if (!openMenu) return;
      if (e.target.closest && e.target.closest('.menu')) return;
      openMenu = null; paintMenus();
    }, true);
    document.addEventListener('keydown', function (e) {
      if (openMenu && e.key === 'Escape') { openMenu = null; paintMenus(); }
    });
  }

  /* ───────── 動き ───────── */
  function reveal() {
    var nodes = $$('[data-reveal]:not([data-shown])');
    if (!nodes.length) return;
    if (REDUCED || !('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.setAttribute('data-shown', '1'); });
      return;
    }
    if (!reveal._io) {
      reveal._io = new IntersectionObserver(function (entries, io) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          en.target.style.transitionDelay = (parseInt(en.target.dataset.reveal || '0', 10) * 70) + 'ms';
          en.target.setAttribute('data-shown', '1');
          io.unobserve(en.target);
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    }
    var limit = window.innerHeight * 0.88;
    nodes.forEach(function (n) {
      if (n.getBoundingClientRect().top < limit) { n.setAttribute('data-shown', '1'); return; }
      reveal._io.observe(n);
    });
  }

  var mouse = { x: 0, y: 0 };
  var applyParallax = function () {};

  function parallax() {
    if (REDUCED) return;
    var shapes = $$('.sh');
    if (!shapes.length) return;
    var raf = 0;
    function apply() {
      raf = 0;
      var y = window.pageYOffset || document.documentElement.scrollTop;
      shapes.forEach(function (s) {
        var host = s.dataset.rel ? s.closest('section') : null;
        var base = host ? y - host.offsetTop : y;
        var t = base * (parseFloat(s.dataset.speed) || 0) * 0.2;
        var r = base * (parseFloat(s.dataset.spin) || 0) * 0.05 + (parseFloat(s.dataset.base) || 0);
        var z = base * (parseFloat(s.dataset.z) || 0) * 0.25;
        var rx = base * (parseFloat(s.dataset.rx) || 0) * 0.05 + mouse.y * 8;
        var ry = base * (parseFloat(s.dataset.ry) || 0) * 0.05 - mouse.x * 8;
        s.style.transform = 'translate3d(' + (mouse.x * 14).toFixed(1) + 'px,' + t.toFixed(1) + 'px,' + z.toFixed(1) + 'px)' +
          (rx ? ' rotateX(' + rx.toFixed(1) + 'deg)' : '') + (ry ? ' rotateY(' + ry.toFixed(1) + 'deg)' : '') +
          (r ? ' rotate(' + r.toFixed(1) + 'deg)' : '');
      });
    }
    window.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
    window.addEventListener('resize', function () { if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
    applyParallax = function () { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
  }

  function homeTick() {
    if (REDUCED) return;
    var home = $('#view-home');
    if (!home || home.hidden) return;
    var y = window.pageYOffset || 0, vh = window.innerHeight;

    var inner = $('.hero-inner');
    if (inner) {
      var p = clamp01(y / 620);
      inner.style.transform =
        'translate3d(' + (mouse.x * 10).toFixed(1) + 'px,' + (y * 0.14).toFixed(1) + 'px,' + (-p * 160).toFixed(1) + 'px)' +
        ' rotateX(' + (p * 7 + mouse.y * 2.5).toFixed(2) + 'deg)' +
        ' rotateY(' + (mouse.x * -3).toFixed(2) + 'deg)';
      inner.style.opacity = (1 - p * 0.25).toFixed(3);
    }

    var band = $('.band-inner');
    if (band) {
      var r0 = band.getBoundingClientRect();
      var bp = clamp01((vh - r0.top) / (vh * 0.9));
      band.style.transform = 'scale(' + (0.94 + 0.06 * bp).toFixed(3) + ') translate3d(0,' + ((1 - bp) * 18).toFixed(1) + 'px,0)';
    }

    $$('.panel').forEach(function (pn, i) {
      var r = pn.getBoundingClientRect();
      var q = clamp01((vh - r.top) / (vh * 0.55));
      pn.dataset.q = q.toFixed(4);
      pn.dataset.i = i;
      paintPanel(pn);
      pn.style.opacity = (0.5 + 0.5 * q).toFixed(3);
    });
  }

  function paintPanel(pn) {
    var q = parseFloat(pn.dataset.q || '1'), i = parseInt(pn.dataset.i || '0', 10);
    var hp = parseFloat(pn.dataset.hp || '0');
    pn.style.transform =
      'translate3d(0,' + ((1 - q) * 60 - 6 * hp).toFixed(2) + 'px,' + (-(1 - q) * 180 + 40 * hp).toFixed(1) + 'px)' +
      ' rotateX(' + ((1 - q) * 14).toFixed(2) + 'deg)' +
      ' rotateY(' + ((1 - q) * (i % 2 ? -5 : 5)).toFixed(2) + 'deg)' +
      ' scale(' + (1 + 0.015 * hp).toFixed(4) + ')';
  }

  function wirePanelHover() {
    if (REDUCED) return;
    $$('.panel').forEach(function (pn) {
      if (pn.dataset.hoverWired) return;
      pn.dataset.hoverWired = '1';
      var raf = 0, to = 0;
      var loop = function () {
        raf = 0;
        var p = parseFloat(pn.dataset.hp || '0');
        p += (to - p) * 0.18;
        if (Math.abs(to - p) < 0.004) p = to;
        pn.dataset.hp = p;
        paintPanel(pn);
        if (p !== to) raf = requestAnimationFrame(loop);
      };
      pn.addEventListener('pointerenter', function () { to = 1; if (!raf) raf = requestAnimationFrame(loop); });
      pn.addEventListener('pointerleave', function () { to = 0; if (!raf) raf = requestAnimationFrame(loop); });
    });
  }

  function mouseFx() {
    return; /* カーソル連動の傾きはなし */
  }

  var hoverRow = null, hoverP = 0, hoverTo = 0, hoverRaf = 0, hoverPrev = null;
  var pushRows = [], pushSecs = [], peekH = 0;

  function buildPush() {
    pushRows = []; pushSecs = [];
    peekH = 0;
    if (!hoverRow) return;
    var peek = hoverRow.querySelector('.row-peek');
    peekH = peek ? peek.offsetHeight + 4 : 0;
    var sec = hoverRow.parentNode;
    var sibs = Array.prototype.slice.call(sec.querySelectorAll(':scope > .row'));
    var i = sibs.indexOf(hoverRow);
    pushRows = sibs.slice(i + 1);
    var secs = $$('#results .group');
    var si = secs.indexOf(sec);
    pushSecs = secs.slice(si + 1);
    var foot = $('#view-search .foot');
    if (foot) pushSecs.push(foot);
  }

  function paintPush(hp) {
    var d = (peekH * hp).toFixed(2);
    pushRows.forEach(function (n) {
      var by = parseFloat(n.dataset.by || '0'), bs = parseFloat(n.dataset.bs || '1');
      n.style.transform = 'translate3d(0,' + (by + peekH * hp).toFixed(2) + 'px,0) scale(' + bs.toFixed(4) + ')';
    });
    pushSecs.forEach(function (s) { s.style.transform = 'translate3d(0,' + d + 'px,0)'; });
  }

  function clearPush() {
    pushSecs.forEach(function (s) { s.style.transform = ''; });
    pushRows.forEach(function (n) {
      var by = parseFloat(n.dataset.by || '0'), bs = parseFloat(n.dataset.bs || '1');
      n.style.transform = 'translate3d(0,' + by.toFixed(2) + 'px,0) scale(' + bs.toFixed(4) + ')';
    });
  }

  function hoverLoop() {
    hoverRaf = 0;
    hoverP += (hoverTo - hoverP) * 0.18;
    if (Math.abs(hoverTo - hoverP) < 0.003) hoverP = hoverTo;
    paintHover();
    if (hoverP !== hoverTo) hoverRaf = requestAnimationFrame(hoverLoop);
  }

  // マウスを乗せた行がふわっと浮くときの「横に広がる量」。
  // 割合（1.2%）のままだと、スマホでは約4pxでも、Windowsの広い画面では
  // 16pxほど横に広がってしまい、その行だけが枠からはみ出して見える。
  // そこで、画面の広さによらず横の広がりが約4pxで収まるようにする。
  var 横のふくらみ = 0.012;
  function 横のふくらみを決める(n) {
    var w = n ? n.offsetWidth : 0;
    横のふくらみ = w > 0 ? Math.min(0.012, 4.4 / w) : 0.012;
  }

  function paintNode(n, hp, grow) {
    var by = parseFloat(n.dataset.by || '0'), bs = parseFloat(n.dataset.bs || '1');
    var g = (typeof grow === 'number') ? grow : 0.012;
    var s = bs * (1 + g * hp), y = by - 3 * hp;
    n.style.transform = 'translate3d(0,' + y.toFixed(2) + 'px,0) scale(' + s.toFixed(4) + ')';
  }

  function paintHover() {
    if (hoverRow) paintNode(hoverRow, hoverP, 横のふくらみ);
    paintPush(hoverP);
    if (hoverPrev && hoverPrev !== hoverRow) { paintNode(hoverPrev, 0); hoverPrev = null; }
  }

  function setHover(r) {
    if (r === hoverRow) return;
    if (hoverRow) { hoverRow.classList.remove('hovering'); hoverPrev = hoverRow; }
    paintPush(0); clearPush();
    hoverRow = r;
    if (hoverRow) hoverRow.classList.add('hovering');
    横のふくらみを決める(hoverRow);
    buildPush();
    hoverP = hoverRow ? Math.min(hoverP, 0.15) : hoverP;
    hoverTo = hoverRow ? 1 : 0;
    if (!hoverRaf) hoverRaf = requestAnimationFrame(hoverLoop);
  }

  function insideHover(e) {
    if (!hoverRow) return false;
    var r = hoverRow.getBoundingClientRect();
    var peek = hoverRow.querySelector('.row-peek');
    var bottom = r.bottom + (peek && hoverRow.classList.contains('hovering') ? peek.offsetHeight - 6 : 0);
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 2 && e.clientY <= bottom;
  }

  function wireRowHover() {
    var box = $('#results');
    if (!box || box.dataset.hoverWired) return;
    box.dataset.hoverWired = '1';
    var pending = 0, last = null;
    box.addEventListener('pointermove', function (e) {
      last = e;
      if (pending) return;
      pending = requestAnimationFrame(function () {
        pending = 0;
        if (insideHover(last)) return;
        var el0 = document.elementFromPoint(last.clientX, last.clientY);
        var r = el0 && el0.closest ? el0.closest('.row') : null;
        setHover(r && box.contains(r) ? r : null);
      });
    }, { passive: true });
    box.addEventListener('pointerleave', function () { setHover(null); });
  }

  var scrollNodes = [];

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function scrollTick() {
    if (REDUCED) return;
    var vh = window.innerHeight, headBottom = 66;
    for (var i = 0; i < scrollNodes.length; i++) {
      var n = scrollNodes[i], r = n.getBoundingClientRect();
      if (r.bottom < -240 || r.top > vh + 240) {
        if (n.dataset.fx !== 'off') { n.dataset.fx = 'off'; n.style.opacity = ''; n.style.transform = ''; }
        continue;
      }
      n.dataset.fx = 'on';
      var inP = clamp01((vh - r.top) / 190);
      var outP = clamp01((r.bottom - headBottom) / 150);
      var o = (0.72 + 0.28 * inP) * (0.8 + 0.2 * outP);
      var y = 0;
      var s = 1;
      var hp = (n === hoverRow) ? hoverP : 0;
      var push = pushRows.indexOf(n) >= 0 ? peekH * hoverP : 0;
      n.dataset.by = y.toFixed(2);
      n.dataset.bs = s.toFixed(4);
      n.style.opacity = o.toFixed(3);
      n.style.transform = 'translate3d(0,' + (y - 3 * hp + push).toFixed(2) + 'px,0) scale(' + (s * (1 + 0.012 * hp)).toFixed(4) + ')';
    }
    var view = $('#view-search');
    if (!view || view.hidden) return;
    var title = $('#view-search .page-title'), sbox = $('#view-search .searchbox');
    var y0 = window.pageYOffset || 0;
    if (title) {
      var tp = clamp01(y0 / 260);
      title.style.transform = 'translate3d(0,' + (y0 * 0.16).toFixed(1) + 'px,0)';
      title.style.opacity = (1 - tp * 0.5).toFixed(3);
    }
    if (sbox) {
      var sp = clamp01((y0 - 120) / 420);
      sbox.style.transform = 'scale(' + (1 - sp * 0.02).toFixed(4) + ')';
      sbox.style.opacity = (1 - sp * 0.15).toFixed(3);
    }
  }

  function scrollFx() {
    var raf2 = 0;
    var run = function () { raf2 = 0; pinHeads(); scrollTick(); homeTick(); };
    window.addEventListener('scroll', function () {
      if (openMenu) { openMenu = null; paintMenus(); }
      if (!raf2) raf2 = requestAnimationFrame(run);
    }, { passive: true });
    window.addEventListener('resize', function () { if (!raf2) raf2 = requestAnimationFrame(run); }, { passive: true });
    run();
  }

  /* ───────── 起動 ───────── */
  function start(payload, isLocal) {
    var list = payload && payload.教材;
    if (Object.prototype.toString.call(list) !== '[object Array]') { fail(); return; }
    DATA = list.filter(function (m) {
      return isPlainObject(m) && typeof m.id === 'string' && typeof m.教材名 === 'string';
    });
    DATA.forEach(function (m) { m.文法 = asArray(m.文法); m.技能 = asArray(m.技能); });
    IS_LOCAL_DATA = isLocal;

    var saved = load(KEY_HOME, null, isHomeSetting);
    if (saved) { home.grade = saved.grade || saved.g || ''; home.unit = saved.unit || saved.u || ''; home.lesson = saved.lesson || saved.l || ''; }

    buildMenus();
    buildFilters();
    homeCount();

    /* 公開版には「ねらい」「語彙」が入っていないので、案内文から外す */
    if (!isLocal) { $('#q').setAttribute('placeholder', '教材名・単元・文法'); }

    var note = (isLocal ? 'ローカル版' : '公開版') + '・' + DATA.length + '件';
    $('#datanote').textContent = note;
    $('#datafoot').textContent = note + '／データ作成 ' + (payload.作成日時 || '不明');

    headHeight();
    wire(); sync(); render(); renderSide(); reveal(); parallax(); scrollFx(); mouseFx(); wirePanelHover(); heroInit();
  }

  /* ヘッダーは画面幅によって2段になることがある。実際の高さを測って CSS に渡し、
     単元の見出し（貼りつく帯）がヘッダーの下に隠れないようにする。 */
  var HEAD_H = 65;                    // 測る前の初期値
  function headH() { return HEAD_H; }
  function headHeight() {
    var top = document.querySelector('.top');
    if (!top) return;
    var set = function () {
      var h = Math.round(top.getBoundingClientRect().height);
      if (h > 0) { HEAD_H = h; document.documentElement.style.setProperty('--head-h', h + 'px'); }
    };
    set();
    var raf = 0;
    window.addEventListener('resize', function () {
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; set(); });
    }, { passive: true });
    if (window.ResizeObserver) { new ResizeObserver(set).observe(top); }
  }

  /* ───────── ヒーローのメッセージ切り替え ───────── */
  var HERO = [
    { e: '明日の授業', t: 'どの教材を、<br>どこで使う？', l: '学年・単元・レッスンを選ぶだけ。その範囲の教材だけを、そのまま一覧にします。' },
    { e: '職員室で3秒', t: '探す時間を、<br>授業の時間に。', l: '学年と単元さえ決まっていれば、あとは開くだけ。迷う手数を減らします。' },
    { e: '空き時間から', t: '10分でも、<br>できることがある。', l: '残り時間に合う長さの教材だけを表示します。急な埋め合わせにも。' },
    { e: '状態がわかる', t: '完成、要追記、<br>下書き。', l: '手を入れる必要があるかどうかが、開く前に文字でわかります。' },
    { e: 'この端末の中だけ', t: 'お気に入りは、<br>ここに残る。', l: '★を押した教材と最近開いた教材は、この端末の中だけに保存されます。' }
  ];
  var heroI = 0, heroTimer = 0, heroBox = null, heroDots = null, heroBusy = false;

  function heroFill(layer, h) {
    layer.querySelector('.eyebrow').textContent = h.e;
    layer.querySelector('.hero-title').innerHTML = h.t;
    layer.querySelector('.lead').textContent = h.l;
  }

  function heroGo(dir, to) {
    if (!heroBox || heroBusy) return;
    var next = (to != null) ? to : (heroI + dir + HERO.length) % HERO.length;
    if (next === heroI) return;
    heroBusy = true;

    var layers = heroBox.querySelectorAll('.hero-layer');
    var cur = heroBox.querySelector('.hero-layer.is-on');
    var off = (layers[0] === cur) ? layers[1] : layers[0];

    heroFill(off, HERO[next]);
    heroBox.classList.toggle('rev', dir < 0);
    off.style.transform = dir < 0 ? 'translate3d(0,-14px,0)' : 'translate3d(0,14px,0)';
    off.offsetHeight;

    requestAnimationFrame(function () {
      cur.classList.remove('is-on');
      cur.style.transform = dir < 0 ? 'translate3d(0,14px,0)' : 'translate3d(0,-14px,0)';
      off.style.transform = '';
      off.classList.add('is-on');
      cur.setAttribute('aria-hidden', 'true');
      off.removeAttribute('aria-hidden');
      heroI = next;
      setTimeout(function () { heroBusy = false; }, 1150);
    });

    heroRestart();
  }

  function heroRestart() {
    clearInterval(heroTimer);
    heroTimer = setInterval(function () {
      if (document.hidden || $('#view-home').hidden) return;
      heroGo(1);
    }, 7000);
  }

  function heroInit() {
    heroBox = $('#hero-msg');
    if (!heroBox) return;
    heroBox.addEventListener('click', function () { heroGo(1); });

    var x0 = null;
    heroBox.addEventListener('pointerdown', function (e) { x0 = e.clientX; });
    heroBox.addEventListener('pointerup', function (e) {
      if (x0 == null) return;
      var d = e.clientX - x0;
      x0 = null;
      if (Math.abs(d) > 40) heroGo(d < 0 ? 1 : -1);
    });
    heroRestart();
  }

  function fail() {
    document.querySelector('main').innerHTML =
      '<div class="search-wrap"><section class="zero"><p>データが読み込めませんでした。</p>' +
      '<p style="font-size:16px;color:#6E6E73">manager フォルダの「教材ナビを更新する」を実行してから、もう一度開いてください。</p></section></div>';
  }

  if (window.KYOZAI_DATA) {
    start(window.KYOZAI_DATA, true);
  } else {
    fetch('data.public.json').then(function (r) { return r.json(); })
      .then(function (j) { start(j, false); })
      .catch(fail);
  }
})();

