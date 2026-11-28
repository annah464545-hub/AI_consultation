(function () {
  'use strict';

  var A = window.AIC;
  var P = window.AICP;
  var APP_VERSION = 'v23';
  var URL_LIMIT = 7500;      // ?q= 方式で安全に送れる、エンコード後の長さの目安（超えるとサーバー側でエラーになることがある）
  var HASH_LIMIT = 100000;   // #?q= 方式（サーバーに送られない部分に入れる）の上限
  var HIST_MAX = 10;
  var LS_DRAFT = 'aiConsult.draft.v3';
  var LS_HIST = 'aiConsult.history.v3';
  var LS_PRIV = 'aiConsult.privacy.v1';   // 'save' | 'nosave'（未選択の間は何も保存しない）

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text != null) { e.textContent = text; }
    return e;
  }
  function lsGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }
  function lsRemove(key) { try { localStorage.removeItem(key); } catch (e) { /* noop */ } }
  function findExpert(id) { return A.EXPERTS.filter(function (e) { return e.id === id; })[0]; }

  var selected = ['auto'];
  var mode = 'quick';
  var opts = Object.assign({}, A.MODES.quick.defaults);
  var toastTimer = null;
  var privacy = null;        // 'save' / 'nosave' / null(未選択)
  var memHistory = [];       // 保存しない間の履歴（ページを閉じると消える）
  function canSave() { return privacy === 'save'; }

  /* ---------- 描画 ---------- */
  function renderExamples() {
    var wrap = $('exampleChips');
    wrap.textContent = '';
    wrap.appendChild(el('span', 'note', '入力例：'));
    A.EXAMPLES.forEach(function (ex) {
      var b = el('button', 'chip', ex);
      b.type = 'button';
      b.addEventListener('click', function () { $('content').value = ex; update(); $('content').focus(); });
      wrap.appendChild(b);
    });
  }

  function renderCtx() {
    var wrap = $('ctxFields');
    wrap.textContent = '';
    A.CTX_FIELDS.forEach(function (f) {
      var lab = el('label', null, f.label);
      lab.htmlFor = 'ctx_' + f.id;
      var ta = el('textarea', 'small');
      ta.id = 'ctx_' + f.id;
      ta.placeholder = f.placeholder;
      ta.addEventListener('input', update);
      wrap.appendChild(lab);
      wrap.appendChild(ta);
    });
  }

  function renderExperts() {
    var wrap = $('expertList');
    wrap.textContent = '';
    A.EXPERTS.forEach(function (ex) {
      var b = el('button', 'expert-btn' + (ex.wide ? ' wide' : ''));
      b.type = 'button';
      b.dataset.id = ex.id;
      b.appendChild(el('span', 'expert-title', ex.icon + ' ' + ex.name));
      b.appendChild(el('span', 'expert-sub', ex.sub));
      b.addEventListener('click', function () { toggleExpert(ex.id); });
      wrap.appendChild(b);
    });
  }

  function renderModes() {
    var wrap = $('modeList');
    wrap.textContent = '';
    ['quick', 'ask', 'deep'].forEach(function (id) {
      var m = A.MODES[id];
      var b = el('button', 'mode-btn');
      b.type = 'button';
      b.dataset.id = id;
      b.appendChild(el('span', 'mode-title', m.icon + ' ' + m.name));
      b.appendChild(el('span', 'mode-sub', m.sub));
      b.addEventListener('click', function () {
        mode = id;
        opts = Object.assign({}, m.defaults);   // 進め方に合わせて、工夫の初期設定を切り替える
        refreshOpts();
        update();
      });
      wrap.appendChild(b);
    });
  }

  function renderOpts() {
    var wrap = $('optList');
    wrap.textContent = '';
    A.OPTS.forEach(function (op) {
      var box = el('div', 'opt');
      var lab = el('label', 'opt-head');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'opt_' + op.id;
      cb.addEventListener('change', function () { opts[op.id] = cb.checked; update(); });
      lab.appendChild(cb);
      lab.appendChild(el('span', null, op.icon + ' ' + op.name));
      box.appendChild(lab);
      box.appendChild(el('div', 'opt-why', op.why));
      wrap.appendChild(box);
    });
  }

  function renderFollowups() {
    var wrap = $('followChips');
    wrap.textContent = '';
    A.FOLLOWUPS.forEach(function (f) {
      var b = el('button', 'chip', f.label);
      b.type = 'button';
      b.addEventListener('click', function () {
        copyText(f.text).then(function (ok) {
          toast(ok ? '「' + f.label.replace(/^\S+\s/, '') + '」をコピーしました。相談中のAIの画面（会話の続き）に貼り付けて送信してください。' : 'コピーに失敗しました。', !ok);
        });
      });
      wrap.appendChild(b);
    });
  }

  function refreshOpts() {
    A.OPTS.forEach(function (op) { $('opt_' + op.id).checked = !!opts[op.id]; });
  }

  /* ---------- 専門家の選択 ---------- */
  function toggleExpert(id) {
    if (id === 'auto') {
      selected = ['auto'];
    } else {
      selected = selected.filter(function (x) { return x !== 'auto'; });
      var i = selected.indexOf(id);
      if (i >= 0) { selected.splice(i, 1); }
      else {
        if (selected.length >= A.MAX_EXPERTS) { toast('専門家は最大' + A.MAX_EXPERTS + '人まで選べます', true); return; }
        selected.push(id);
      }
      if (!selected.length) { selected = ['auto']; }
    }
    update();
    if (id === 'custom' && selected.indexOf('custom') >= 0) { $('customName').focus(); }
  }

  function isAuto() { return selected.indexOf('auto') >= 0; }
  function customLabel() { return $('customName').value.trim().replace(/\s+/g, ' ').slice(0, 30); }

  function getExperts() {
    var list = [];
    selected.forEach(function (id) {
      if (id === 'auto') { return; }
      if (id === 'custom') {
        var n = customLabel();
        if (!n) { return; }
        list.push({
          name: n,
          persona: '「' + n + '」の分野に詳しい専門家。その分野の知識と経験に基づいて助言する。',
          solo: 'あなたは「' + n + '」の分野に詳しい経験豊富な専門家です。その分野の知識と経験に基づき、相談者に寄り添って分かりやすく助言してください。'
        });
      } else {
        list.push(findExpert(id));
      }
    });
    return list;
  }

  function currentState() {
    var ctx = {};
    A.CTX_FIELDS.forEach(function (f) { ctx[f.id] = $('ctx_' + f.id).value; });
    return {
      experts: getExperts(), auto: isAuto(), mode: mode, opts: opts,
      stance: $('stance').value, length: $('length').value,
      content: $('content').value, ctx: ctx,
      profile: profileAttach()
    };
  }

  /* ---------- 画面更新 ---------- */
  function refreshState() {
    Array.prototype.forEach.call($('expertList').children, function (b) {
      var on = selected.indexOf(b.dataset.id) >= 0;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call($('modeList').children, function (b) {
      var on = b.dataset.id === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('customName').classList.toggle('show', selected.indexOf('custom') >= 0);

    var note = $('modeNote');
    var s = currentState();
    if (isAuto()) {
      note.className = 'mode-note panel';
      note.textContent = '🪄 おまかせ編成：相談内容に合わせて、AIが最適な専門家を2〜4人選び、チームで議論します。';
    } else if (A.isPanel(s)) {
      var names = selected.map(function (id) { return id === 'custom' ? (customLabel() || '（自由指定）') : findExpert(id).name; });
      note.className = 'mode-note panel';
      note.textContent = '🗣 専門家会議：' + names.join('・') + ' が議論します。';
    } else {
      var one = selected[0] === 'custom' ? (customLabel() || '（自由指定）') : findExpert(selected[0]).name;
      note.className = 'mode-note';
      note.textContent = '👤 ' + one + ' に相談します。複数選ぶと、専門家どうしの会議になります。';
    }
    var n = A.ctxCount(s.ctx);
    $('ctxState').textContent = n ? '（' + n + '項目入力済み）' : '（任意・書くほど答えが具体的になります）';
    $('safety').hidden = !/死にたい|死にたく|死のう|死んでしまいたい|死ぬしか|自殺|消えたい|いなくなりたい|自傷|リスカ|オーバードーズ|生きて(い)?たくない|生きていけない|生きる意味がない|終わりにしたい/.test($('content').value);
  }

  function renderExplain(s) {
    var ul = $('explainList');
    ul.textContent = '';
    if (!s.experts.length && !s.auto) { return; }
    A.explain(s).forEach(function (it) {
      var li = el('li');
      li.appendChild(el('b', null, it.icon + ' ' + it.title));
      li.appendChild(el('span', null, it.why));
      ul.appendChild(li);
    });
  }

  function update() {
    refreshState();
    var s = currentState();
    $('preview').value = A.build(s);
    $('charCount').textContent = '（' + $('preview').value.length + '文字）';
    renderExplain(s);
    renderLaunch();
    saveDraft();
  }

  function toast(msg, isError) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.textContent = ''; }, 7000);
  }

  /* ---------- 下書き・履歴 ---------- */
  function snapshot() {
    var s = currentState();
    return { selected: selected.slice(), custom: $('customName').value, mode: mode, opts: Object.assign({}, opts),
      stance: s.stance, length: s.length, content: s.content, ctx: s.ctx };
  }
  function saveDraft() { if (canSave()) { lsSet(LS_DRAFT, snapshot()); } }

  function setSelectValue(sel, v) {
    if (typeof v !== 'string') { return; }
    for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === v) { sel.value = v; return; } }
  }
  function applyState(s) {
    if (!s) { return; }
    var ids = Array.isArray(s.selected) ? s.selected.filter(function (id) { return !!findExpert(id); }).slice(0, A.MAX_EXPERTS) : [];
    if (ids.length) { selected = ids; }
    if (typeof s.custom === 'string') { $('customName').value = s.custom.slice(0, 30); }
    if (A.MODES[s.mode]) { mode = s.mode; }
    if (s.opts && typeof s.opts === 'object') {
      A.OPTS.forEach(function (op) { opts[op.id] = (op.id in s.opts) ? !!s.opts[op.id] : !!A.MODES[mode].defaults[op.id]; });
    } else { opts = Object.assign({}, A.MODES[mode].defaults); }
    setSelectValue($('stance'), s.stance);
    setSelectValue($('length'), s.length);
    if (typeof s.content === 'string') { $('content').value = s.content; }
    A.CTX_FIELDS.forEach(function (f) {
      $('ctx_' + f.id).value = (s.ctx && typeof s.ctx[f.id] === 'string') ? s.ctx[f.id] : '';
    });
    refreshOpts();
    var hasCtx = A.ctxCount(s.ctx || {}) > 0;
    $('ctxBox').open = hasCtx;
  }

  function getStoredHistory() { var h = lsGet(LS_HIST); return Array.isArray(h) ? h : []; }
  function getHistory() { return canSave() ? getStoredHistory() : memHistory; }
  function saveHistory() {
    var entry = snapshot();
    entry.t = Date.now();
    var key = entry.selected.join(',') + '|' + entry.mode + '|' + entry.content.trim();
    var h = getHistory().filter(function (x) {
      return (Array.isArray(x.selected) ? x.selected.join(',') : '') + '|' + x.mode + '|' + String(x.content || '').trim() !== key;
    });
    h.unshift(entry);
    h = h.slice(0, HIST_MAX);
    if (canSave()) { while (h.length && !lsSet(LS_HIST, h)) { h.pop(); } }
    else { memHistory = h; }
    renderHistory();
  }
  function renderHistory() {
    var h = getHistory(), list = $('historyList');
    list.textContent = '';
    $('historyCount').textContent = h.length ? '（' + h.length + '件）' : '';
    $('btnClearHistory').style.display = h.length ? '' : 'none';
    if (!h.length) {
      list.appendChild(el('p', 'empty', canSave() ? 'まだ履歴はありません。AIを開く／コピーすると、ここに残ります。'
        : (privacy === 'nosave' ? '「保存しない」設定です。履歴はこのページを開いている間だけ表示され、閉じると消えます。'
          : '保存方法が未選択のため、履歴は保存されません。上の「相談内容の保存について」で選んでください。')));
      return;
    }
    h.forEach(function (x) {
      var b = el('button', 'history-item');
      b.type = 'button';
      var names = (x.selected || []).map(function (id) {
        if (id === 'custom') { return (x.custom || '').trim() || '自由指定'; }
        var e = findExpert(id); return e ? e.name : '';
      }).filter(Boolean).join('・');
      var m = A.MODES[x.mode] ? A.MODES[x.mode].name : '';
      b.appendChild(el('span', 'history-head', new Date(x.t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '　' + names + (m ? '／' + m : '')));
      b.appendChild(el('span', 'history-body', String(x.content || '').replace(/\s+/g, ' ')));
      b.addEventListener('click', function () {
        applyState(x); update();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('履歴から復元しました。');
      });
      list.appendChild(b);
    });
  }

  /* ---------- AIに渡す ---------- */
  // chatgpt・claude: URLでの自動入力に対応（claudeは長い文章だと使えない） / gemini: 非対応 / other: 自分でAIを開いて貼り付ける（タブは開かない）
  var SERVICES = {
    chatgpt: { id: 'chatgpt', name: 'ChatGPT', base: 'https://chatgpt.com/', param: '?q=', hashParam: '#?q=', autoFill: true,
               pkg: 'com.openai.chatgpt', hostPath: 'chatgpt.com/',
               sub: '相談文が自動で入力されます' },
    claude:  { id: 'claude', name: 'Claude', base: 'https://claude.ai/new', param: '?q=', hashParam: null, autoFill: true,
               pkg: 'com.anthropic.claude', hostPath: 'claude.ai/new',
               sub: '自動で入力されます（長い場合は貼り付け）' },
    gemini:  { id: 'gemini', name: 'Gemini', base: 'https://gemini.google.com/app', param: null, hashParam: null, autoFill: false,
               pkg: 'com.google.android.apps.bard', hostPath: 'gemini.google.com/app',
               sub: '貼り付けが必要です' },
    other:   { id: 'other', name: 'その他のAI', base: '', param: null, hashParam: null, autoFill: false, manual: true,
               sub: '普段使っているAIで使う（コピーして、自分で開いて貼り付け）' }
  };
  var aiChoice = null;      // 選択中のAI（まだ選んでいなければ null）

  // どのURLで開くか、相談文が自動入力されるかを決める
  function isAndroid() { return /Android/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || ''); }
  function isMobile() { return /Android|iPhone|iPad|iPod/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || ''); }
  var mobileOpen = 'app';   // スマホでの開き方：'app'（アプリ。貼り付けが必要）／'browser'（ブラウザ。自動入力・要ログイン）
  var APP_REASON = '※スマホのアプリには、相談文を自動で入れる方法がないため、貼り付けが必要です。ブラウザ版で使う場合は、上の「ブラウザで開く」を選んでください。';

  // Androidでアプリを直接開くためのアドレス（アプリが無い場合は、ブラウザのアドレスに切り替わる）
  function buildIntent(svc) {
    return 'intent://' + svc.hostPath + '#Intent;scheme=https;package=' + svc.pkg +
      ';S.browser_fallback_url=' + encodeURIComponent(svc.base) + ';end';
  }

  function planLaunch(svc, prompt) {
    if (svc.manual) { return { url: null, auto: false }; }
    if (isMobile() && mobileOpen === 'app') {
      // アプリで開く：URLに相談文は入れない（アプリには自動入力の方法がないため。ブラウザが勝手に開くのも防ぐ）
      return { url: svc.base, auto: false, app: true, intent: (isAndroid() && svc.pkg) ? buildIntent(svc) : null };
    }
    var url = svc.base, auto = false;
    var enc = encodeURIComponent(prompt);
    if (svc.param && enc.length <= URL_LIMIT) {
      url = svc.base + svc.param + enc; auto = svc.autoFill;
    } else if (svc.hashParam && enc.length <= HASH_LIMIT) {
      url = svc.base + svc.hashParam + enc; auto = svc.autoFill;   // 長い文章は、サーバーに送られない # 側に入れる
    }
    return { url: url, auto: auto };
  }

  function openPlan(plan) {
    if (!plan.url) { return; }
    if (plan.app && plan.intent) { window.location.href = plan.intent; return; }
    window.open(plan.url, '_blank', 'noopener');
  }

  // コピー → AIを開く。ブラウザで開くときは、ポップアップブロック対策としてクリック直後に開く。
  // アプリで開くときは、コピーが終わってから開く（アプリに切り替わる前に、確実にコピーを完了させるため）。
  function openAfter(plan, copying, done) {
    if (plan.app) { copying.then(function (ok) { openPlan(plan); done(ok); }); }
    else { openPlan(plan); copying.then(done); }
  }

  // スマホのときだけ表示する、「アプリで開く／ブラウザで開く」の切り替え
  function appendMobileToggle(g, svc) {
    if (!isMobile() || svc.manual) { return; }
    var row = el('div', 'chips');
    row.appendChild(el('span', 'note', '開き方：'));
    [['app', '📱 アプリで開く（貼り付けが必要）'], ['browser', '🌐 ブラウザで開く（自動入力・要ログイン）']].forEach(function (o) {
      var b = el('button', 'chip' + (mobileOpen === o[0] ? ' active' : ''), o[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', mobileOpen === o[0] ? 'true' : 'false');
      b.addEventListener('click', function () { mobileOpen = o[0]; rerenderLaunchers(); });
      row.appendChild(b);
    });
    g.appendChild(row);
  }
  function rerenderLaunchers() {
    renderLaunch();
    if (typeof memLauncher !== 'undefined') { memLauncher.render(); }
    if (typeof deepLauncher !== 'undefined') { deepLauncher.render(); }
  }

  function renderAiChoices() {
    var wrap = $('aiChoices');
    wrap.textContent = '';
    ['chatgpt', 'claude', 'gemini', 'other'].forEach(function (id) {
      var svc = SERVICES[id];
      var b = el('button', 'ai-btn svc-' + id);
      b.type = 'button';
      b.dataset.id = id;
      b.appendChild(el('span', 'ai-title', svc.name));
      b.appendChild(el('span', 'ai-sub', svc.sub));
      b.addEventListener('click', function () { aiChoice = id; renderLaunch(); });
      wrap.appendChild(b);
    });
  }

  // 選んだAIに合わせて、「移動する前の手順」と実行ボタンを表示する
  function renderLaunch() {
    Array.prototype.forEach.call($('aiChoices').children, function (b) {
      var on = b.dataset.id === aiChoice;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var g = $('launchGuide'), btn = $('btnGo');
    g.textContent = '';
    if (!aiChoice) {
      g.className = 'guide empty-guide';
      g.appendChild(el('p', 'note', '上でAIを選ぶと、ここに手順が表示されます。'));
      btn.disabled = true; btn.textContent = 'AIを選んでください'; btn.className = 'act go';
      return;
    }
    var svc = SERVICES[aiChoice];
    var plan = planLaunch(svc, $('preview').value.trim());
    g.className = 'guide';
    g.appendChild(el('b', 'title', '📋 ' + (svc.manual ? '普段使っているAIで相談する手順' : svc.name + 'に相談する手順')));
    appendMobileToggle(g, svc);
    var ol = el('ol');
    var pasteHow = '（Ctrl/⌘ + V、スマホは長押し→ペースト）';
    if (svc.manual) {
      ol.appendChild(el('li', null, '下の「プロンプトをコピーする」ボタンを押します。相談文がコピーされます（AIのタブは開きません）。'));
      ol.appendChild(el('li', null, '普段お使いのAI（アプリやサイト）を、ご自身で開きます。'));
      ol.appendChild(el('li', null, '入力欄をタップして、コピーした相談文を貼り付けます' + pasteHow + '。'));
    } else if (plan.app) {
      ol.appendChild(el('li', null, '下の「' + svc.name + 'を開いて相談する」ボタンを押します。相談文は自動でコピーされ、' + svc.name + 'アプリが開きます（アプリが入っていない場合は、ブラウザで開きます）。'));
      ol.appendChild(el('li', null, 'アプリの入力欄を長押しして「貼り付け（ペースト）」を選びます。'));
    } else {
      ol.appendChild(el('li', null, '下の「' + svc.name + 'を開いて相談する」ボタンを押します。相談文は自動でコピーされ、' + svc.name + 'が新しいタブで開きます。'));
      if (plan.auto) {
        ol.appendChild(el('li', null, svc.name + 'の入力欄に、相談文が自動で入ります。入らない場合だけ、入力欄をタップして貼り付けてください' + pasteHow + '。'));
      } else {
        ol.appendChild(el('li', null, '入力欄をタップして、貼り付けてください' + pasteHow + '。'));
      }
    }
    ol.appendChild(el('li', null, '内容を確認して、送信します。'));
    ol.appendChild(el('li', null, 'AIの返事が来たあとの会話は、そのAIの画面の中で続けてください（このサイトに返事は表示されません）。新しく別の相談をしたいときは、このサイトにもう一度来て、相談内容を入力してください。'));
    g.appendChild(ol);
    if (plan.app) {
      g.appendChild(el('p', 'reason', APP_REASON));
    } else if (!plan.auto && !svc.manual) {
      g.appendChild(el('p', 'reason', svc.autoFill
        ? '※相談文が長いため、' + svc.name + 'には自動入力できません。貼り付けが必要です。'
        : '※' + svc.name + 'は、サービス側の仕様でURLからの自動入力ができません。貼り付けが必要です。'));
    }
    btn.disabled = false;
    btn.textContent = svc.manual ? '📋 プロンプトをコピーする' : '▶ ' + svc.name + 'を開いて相談する ↗';
    btn.className = 'act go svc-' + svc.id;
  }

  function copyText(text) {
    function fallback() {
      return new Promise(function (resolve) {
        try {
          var ta = document.createElement('textarea');
          ta.value = text; ta.setAttribute('readonly', '');
          ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          var ok = document.execCommand('copy');
          document.body.removeChild(ta);
          resolve(ok);
        } catch (e) { resolve(false); }
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    }
    return fallback();
  }

  function validate() {
    if (!$('content').value.trim()) { toast('相談内容を入力してください。', true); $('content').focus(); return null; }
    if (!isAuto() && getExperts().length === 0) { toast('「自由に指定」の専門家名を入力してください。', true); $('customName').focus(); return null; }
    var p = $('preview').value.trim();
    if (!p) { update(); p = $('preview').value.trim(); }
    return p;
  }

  function launch() {
    if (!aiChoice) { toast('先に、相談するAIを選んでください。', true); return; }
    var prompt = validate();
    if (!prompt) { return; }
    var svc = SERVICES[aiChoice];
    if (svc.manual) { copyOnly(); return; }
    var plan = planLaunch(svc, prompt);
    var copying = copyText(prompt);        // 失敗時の保険として、必ずコピーもする
    openAfter(plan, copying, function (ok) {
      if (!ok) { $('previewBox').open = true; toast('自動コピーに失敗しました。プロンプト欄から手動でコピーしてください。', true); }
      else if (plan.app) { toast(svc.name + 'アプリを開きます。入力欄に貼り付けて送信してください。'); }
      else { toast(svc.name + 'を開きました。開いたタブで、手順に沿って進めてください。'); }
    });
    saveHistory();
  }

  function copyOnly() {
    var prompt = validate();
    if (!prompt) { return; }
    copyText(prompt).then(function (ok) {
      if (ok) { toast('コピーしました！普段お使いのAIをご自身で開いて、入力欄に貼り付けてください。'); }
      else { $('previewBox').open = true; toast('自動コピーに失敗しました。プロンプト欄から手動でコピーしてください。', true); }
    });
    saveHistory();
  }

  /* ---------- プロフィール（あなたについて） ---------- */
  var LS_PROF = 'aiConsult.profile.v1';
  var profile = null;                // { ans, lines, attach, t }
  var formAns = P.emptyAns();
  var scaleBtns = [], chipBtns = [], textInputs = [];

  function loadProfile() {
    var p = lsGet(LS_PROF);
    if (p && typeof p === 'object' && typeof p.lines === 'string') {
      profile = p;
      formAns = (p.ans && p.ans.scale) ? p.ans : P.emptyAns();
    }
  }
  function saveProfile() {
    if (!canSave()) { return; }
    if (profile) { lsSet(LS_PROF, profile); } else { lsRemove(LS_PROF); }
  }
  function profileAttach() {
    return (profile && profile.attach !== false && profile.lines && profile.lines.trim()) ? profile.lines.trim() : '';
  }

  function renderProfileForm() {
    var wrap = $('profileForm');
    wrap.textContent = '';
    scaleBtns = []; chipBtns = []; textInputs = [];
    P.SCALE.forEach(function (q) {
      var fs = el('fieldset', 'pq');
      fs.appendChild(el('legend', null, q.title));
      var row = el('div', 'pq-row');
      q.choices.forEach(function (c, i) {
        var b = el('button', 'pq-btn', c.s);
        b.type = 'button';
        b.addEventListener('click', function () {
          if (formAns.scale[q.id] === i) { delete formAns.scale[q.id]; } else { formAns.scale[q.id] = i; }
          paintProfileForm();
        });
        row.appendChild(b);
        scaleBtns.push({ b: b, q: q.id, i: i });
      });
      fs.appendChild(row);
      wrap.appendChild(fs);
    });
    P.MULTI.forEach(function (m) {
      var fs = el('fieldset', 'pq');
      var lg = el('legend', null, m.title + ' ');
      lg.appendChild(el('small', null, m.hint));
      fs.appendChild(lg);
      var row = el('div', 'pq-chips');
      m.items.forEach(function (it) {
        var b = el('button', 'pq-btn', it);
        b.type = 'button';
        b.addEventListener('click', function () {
          var arr = formAns.multi[m.id] || [];
          var k = arr.indexOf(it);
          if (k >= 0) { arr.splice(k, 1); } else { arr.push(it); }
          formAns.multi[m.id] = arr;
          paintProfileForm();
        });
        row.appendChild(b);
        chipBtns.push({ b: b, m: m.id, v: it });
      });
      fs.appendChild(row);
      wrap.appendChild(fs);
    });
    P.TEXTS.forEach(function (t) {
      var fs = el('fieldset', 'pq');
      var lg = el('legend', null, t.title + ' ');
      lg.appendChild(el('small', null, '（任意）'));
      fs.appendChild(lg);
      var inp = el('input');
      inp.type = 'text'; inp.maxLength = t.max; inp.placeholder = t.placeholder;
      inp.setAttribute('aria-label', t.title);
      inp.addEventListener('input', function () { formAns.text[t.id] = inp.value; });
      fs.appendChild(inp);
      wrap.appendChild(fs);
      textInputs.push({ inp: inp, id: t.id });
    });
    syncProfileInputs();
    paintProfileForm();
  }

  function paintProfileForm() {
    scaleBtns.forEach(function (x) {
      var on = formAns.scale[x.q] === x.i;
      x.b.classList.toggle('active', on);
      x.b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    chipBtns.forEach(function (x) {
      var on = (formAns.multi[x.m] || []).indexOf(x.v) >= 0;
      x.b.classList.toggle('active', on);
      x.b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function syncProfileInputs() {
    textInputs.forEach(function (x) { x.inp.value = (formAns.text && formAns.text[x.id]) || ''; });
  }
  function resetProfileForm() {
    formAns = P.emptyAns();
    syncProfileInputs();
    paintProfileForm();
  }

  function makeProfile() {
    if (P.countAnswered(formAns) === 0) { toast('1つ以上、質問に答えてください。', true); return; }
    var lines = P.buildLines(formAns);
    if (!lines) { toast('「どちらでも」だけの回答のため、プロフィールに載せる内容がありません。他の質問にも答えてみてください。', true); return; }
    profile = { ans: JSON.parse(JSON.stringify(formAns)), lines: lines, attach: profile ? profile.attach !== false : true, t: Date.now(), source: 'site' };
    saveProfile();
    renderProfile();
    update();
    toast('プロフィールを作りました。下の手順で、AIに記憶させてください。');
  }

  function renderProfile() {
    var has = !!profile;
    $('profileResult').hidden = !has;
    $('btnProfileMake').textContent = has ? '🔄 プロフィールを更新する' : '✨ プロフィールを作る';
    var st = $('profileState');
    if (has) {
      st.textContent = profile.source === 'ai' ? '✓ 作成済み（AIが作成）' : '✓ 作成済み（' + P.countAnswered(profile.ans || P.emptyAns()) + '項目）';
      st.className = 'state ok';
      $('profileText').value = profile.lines;
      $('profAttach').checked = profile.attach !== false;
    } else {
      st.textContent = '未作成（任意・約3分）';
      st.className = 'state';
    }
    renderProfStep2();
  }

  function deleteProfile() {
    if (!confirm('プロフィールを削除します。\n（AI側に記憶させた内容は、AIの設定画面で別に削除する必要があります）\nよろしいですか？')) { return; }
    profile = null; lsRemove(LS_PROF); profSkip = false; profPath = null;
    resetProfileForm(); renderProfile(); update();
    toast('プロフィールを削除しました。AIに記憶させていた場合は、AIの設定画面（メモリ）でも削除してください。');
  }

  function copyProfile(kind) {
    if (!profile || !profile.lines.trim()) { toast('先にプロフィールを作ってください。', true); return; }
    var text = kind === 'mem' ? P.memoryPrompt(profile.lines.trim()) : P.shortSettings(profile.lines.trim());
    copyText(text).then(function (ok) {
      toast(ok ? (kind === 'mem' ? '記憶させる文章をコピーしました。AIのチャット欄に貼り付けて送信してください。'
                                  : '設定欄用の短縮版をコピーしました。AIの「保存済みの情報」などに貼り付けてください。')
               : 'コピーに失敗しました。', !ok);
    });
  }

  /* ---------- プロフィール STEP2：そのまま記憶させる／AIで追加診断 ---------- */
  var profPath = null;       // 'memory'（① これで十分） | 'deep'（② もっと自分に合わせたい）
  var profSkip = false;      // 基本診断を飛ばして、AIだけで診断する
  var PASTE_HOW = '（Ctrl/⌘ + V、スマホは長押し→ペースト）';

  // 「AIを選ぶ → 手順を表示 → 実行（コピー＆AIを開く）」の共通部品
  function makeLauncher(cfg) {
    var ai = null;

    function label(svc) { return svc.manual ? cfg.manualLabel : '▶ ' + svc.name + cfg.goSuffix; }

    function renderChoices() {
      var wrap = $(cfg.choices);
      wrap.textContent = '';
      ['chatgpt', 'claude', 'gemini', 'other'].forEach(function (id) {
        var svc = SERVICES[id];
        var b = el('button', 'ai-btn svc-' + id);
        b.type = 'button';
        b.dataset.id = id;
        b.appendChild(el('span', 'ai-title', svc.name));
        b.appendChild(el('span', 'ai-sub', svc.sub));
        b.addEventListener('click', function () { ai = id; render(); });
        wrap.appendChild(b);
      });
    }

    function render() {
      Array.prototype.forEach.call($(cfg.choices).children, function (b) {
        var on = b.dataset.id === ai;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var g = $(cfg.guide), btn = $(cfg.btn);
      g.textContent = '';
      var text = ai ? cfg.text(ai) : '';
      if (!ai || !text) {
        g.className = 'guide empty-guide';
        g.appendChild(el('p', 'note', !ai ? '上でAIを選ぶと、ここに手順が表示されます。' : cfg.needText));
        btn.disabled = true; btn.textContent = 'AIを選んでください'; btn.className = 'act go';
        return;
      }
      var svc = SERVICES[ai];
      var plan = planLaunch(svc, text);
      g.className = 'guide';
      g.appendChild(el('b', 'title', '📋 ' + cfg.title(svc)));
      appendMobileToggle(g, svc);
      var ol = el('ol');
      var btnLabel = label(svc);
      if (svc.manual) {
        ol.appendChild(el('li', null, '下の「' + btnLabel + '」ボタンを押します（AIのタブは開きません）。'));
        ol.appendChild(el('li', null, '普段お使いのAIをご自身で開き、入力欄に貼り付けて送信します' + PASTE_HOW + '。'));
      } else if (plan.app) {
        ol.appendChild(el('li', null, '下の「' + btnLabel + '」ボタンを押します。' + cfg.what + 'は自動でコピーされ、' + svc.name + 'アプリが開きます（アプリが入っていない場合は、ブラウザで開きます）。'));
        ol.appendChild(el('li', null, 'アプリの入力欄を長押しして「貼り付け（ペースト）」を選び、送信します。'));
      } else {
        ol.appendChild(el('li', null, '下の「' + btnLabel + '」ボタンを押します。' + cfg.what + 'は自動でコピーされ、' + svc.name + 'が新しいタブで開きます。'));
        ol.appendChild(el('li', null, plan.auto
          ? svc.name + 'の入力欄に、' + cfg.what + 'が自動で入ります。入らない場合だけ、貼り付けてください' + PASTE_HOW + '。送信します。'
          : '入力欄をタップして、貼り付けてください' + PASTE_HOW + '。送信します。'));
      }
      cfg.steps(ai).forEach(function (t) { ol.appendChild(el('li', null, t)); });
      g.appendChild(ol);
      if (plan.app) {
        g.appendChild(el('p', 'reason', APP_REASON));
      } else if (!svc.manual && !plan.auto) {
        g.appendChild(el('p', 'reason', svc.autoFill ? '※' + cfg.what + 'が長いため、' + svc.name + 'には自動入力できません。貼り付けが必要です。'
          : '※' + svc.name + 'は、サービス側の仕様でURLからの自動入力ができません。貼り付けが必要です。'));
      }
      btn.disabled = false;
      btn.textContent = btnLabel;
      btn.className = 'act go svc-' + svc.id;
    }

    function go() {
      if (!ai) { toast('先に、AIを選んでください。', true); return; }
      var text = cfg.text(ai);
      if (!text) { toast(cfg.needText, true); return; }
      var svc = SERVICES[ai];
      var plan = planLaunch(svc, text);
      var copying = copyText(text);
      function done(ok) {
        if (!ok) { toast('自動コピーに失敗しました。もう一度お試しください。', true); }
        else if (svc.manual) { toast('コピーしました！普段お使いのAIをご自身で開いて、入力欄に貼り付けてください。'); }
        else if (plan.app) { toast(svc.name + 'アプリを開きます。入力欄に貼り付けて送信してください。'); }
        else { toast(svc.name + 'を開きました。開いたタブで、手順に沿って進めてください。'); }
      }
      if (svc.manual) { copying.then(done); } else { openAfter(plan, copying, done); }
    }

    return { renderChoices: renderChoices, render: render, go: go };
  }

  // ① そのまま記憶させる
  var memLauncher = makeLauncher({
    choices: 'memAiChoices', guide: 'memGuide', btn: 'btnMemGo',
    what: '記憶させる依頼文', goSuffix: 'を開いて記憶させる ↗', manualLabel: '📋 記憶させる依頼文をコピーする',
    needText: '先に、STEP 1の基本診断でプロフィールを作ってください。',
    title: function (svc) { return svc.manual ? '普段使っているAIに記憶させる手順' : svc.name + 'に記憶させる手順'; },
    text: function (ai) { return (profile && profile.lines.trim()) ? P.memoryPrompt(profile.lines.trim(), ai) : ''; },
    steps: function (ai) {
      return [
        'AIが「記憶しました」などの返事をします。保存できない場合は、その旨が返ってきます。',
        ai === 'gemini'
          ? 'うまく記憶されない場合は、設定の「保存済みの情報（Saved info）」に、下の「設定欄に貼る用の短縮版」を貼り付けてください。'
          : '記憶した内容は、AIの設定の「メモリ」「パーソナライズ」などで、確認・修正・削除できます（メニュー名はサービスやプランで変わります）。',
        '記憶させたあとは、STEP 1の「毎回の相談文にも自動で添える」は、オフでも大丈夫です。'
      ];
    }
  });

  // ② 基本診断をAIに渡して、追加診断してもらう
  var deepLauncher = makeLauncher({
    choices: 'profAiChoices', guide: 'profAiGuide', btn: 'btnProfAiGo',
    what: '診断の依頼文', goSuffix: 'を開いて診断してもらう ↗', manualLabel: '📋 診断の依頼文をコピーする',
    needText: '',
    title: function (svc) { return svc.manual ? '普段使っているAIに診断してもらう手順' : svc.name + 'に診断してもらう手順'; },
    text: function (ai) {
      var base = ($('profUseSite').checked && profile) ? profile.lines : '';
      return P.interviewPrompt({ ai: ai, count: parseInt($('profCount').value, 10), base: base });
    },
    steps: function () {
      return [
        'AIが質問を始めます。1問ずつ答えてください（答えたくない質問は「パス」でOKです）。',
        '最後にAIが「プロフィール案」を出します。違うところは、そのままAIに伝えて直してもらってください。',
        '内容がよければ「OK」と返事します。AIが記憶に保存します（保存できない場合は、その旨が返ってきます）。',
        '記憶機能を使わない・使えない場合は、プロフィール案をコピーして、下の欄に貼り付けてください。毎回の相談文に自動で添えられます。'
      ];
    }
  });

  function scrollToEl(e) { if (e && e.scrollIntoView) { e.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }

  function renderProfStep2() {
    $('btnProfSkip').hidden = !!profile || profSkip;   // 基本診断を終えた／飛ばすと決めたあとは、リンクを隠す
    $('profStep1Body').hidden = profSkip;              // 飛ばすと決めたら、STEP 1の質問を畳む
    $('profSkipNote').hidden = !profSkip;
    $('profUseSiteLabel').hidden = !profile;           // 基本プロフィールが無いときは「土台にする」を隠す
    var show = !!profile || profSkip;
    $('profStep2').hidden = !show;
    if (!show) { return; }
    if (!profile && profSkip) { profPath = 'deep'; }
    $('pathMemoryBtn').disabled = !profile;
    ['memory', 'deep'].forEach(function (k) {
      var btn = $(k === 'memory' ? 'pathMemoryBtn' : 'pathDeepBtn');
      var on = profPath === k;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      $(k === 'memory' ? 'pathMemory' : 'pathDeep').hidden = !on;
    });
    memLauncher.render();
    deepLauncher.render();
  }

  function setProfPath(k) {
    if (k === 'memory' && !profile) { return; }
    profPath = k;
    renderProfStep2();
  }

  function usePasted() {
    var t = $('profPaste').value.trim();
    if (!t) { toast('AIが作ったプロフィール案を貼り付けてください。', true); return; }
    var cut = false;
    if (t.length > 2000) { t = t.slice(0, 2000); cut = true; }
    profile = { ans: P.emptyAns(), lines: t, attach: profile ? profile.attach !== false : true, t: Date.now(), source: 'ai' };
    saveProfile();
    renderProfile();
    update();
    toast(cut ? 'プロフィールとして使います（長いため、2,000文字までにしました）。' : 'プロフィールとして使います。毎回の相談文に自動で添えられます。');
  }

  /* ---------- プライバシー設定 ---------- */
  function renderPrivacy() {
    var unset = privacy !== 'save' && privacy !== 'nosave';
    $('privacyBox').className = 'privacy' + (unset ? ' unset' : '');
    $('privChoice').hidden = !unset;
    $('privSwitch').hidden = unset;
    $('noSave').checked = privacy === 'nosave';
    var st = $('privStatus');
    if (privacy === 'save') {
      st.className = 'priv-status on-save';
      st.textContent = '現在：保存する（この端末のこのブラウザに、履歴・下書きが残ります）';
    } else if (privacy === 'nosave') {
      st.className = 'priv-status on-nosave';
      st.textContent = '現在：保存しない（ページを閉じると、履歴・下書きは消えます）';
    } else {
      st.className = 'priv-status';
      st.textContent = '';
    }
    $('afterHint').hidden = privacy === 'nosave';
  }

  function setPrivacy(v) {
    if (v === 'nosave') {
      var stored = getStoredHistory();
      var hasDraft = !!lsGet(LS_DRAFT);
      var hasProf = !!lsGet(LS_PROF);
      if ((stored.length || hasDraft || hasProf) &&
          !confirm('この端末に保存されている履歴（' + stored.length + '件）・下書き' + (hasProf ? '・プロフィール' : '') + 'を削除します。よろしいですか？')) {
        renderPrivacy();
        return;
      }
      lsRemove(LS_DRAFT); lsRemove(LS_HIST); lsRemove(LS_PROF);
      privacy = 'nosave'; lsSet(LS_PRIV, 'nosave');
      toast('「保存しない」にしました。この端末に残っていた履歴・下書き・プロフィールは削除しました（いま開いているページ内には残っています）。');
    } else {
      var carry = memHistory;
      privacy = 'save'; lsSet(LS_PRIV, 'save');
      if (!profile) { loadProfile(); renderProfile(); syncProfileInputs(); paintProfileForm(); } else { saveProfile(); }
      if (!$('content').value.trim()) { applyState(lsGet(LS_DRAFT)); }
      if (carry.length) { lsSet(LS_HIST, carry.concat(getStoredHistory()).slice(0, HIST_MAX)); }
      memHistory = [];
      toast('「保存する」にしました。共用の端末では、使い終わったら必ず履歴を消してください。');
    }
    renderPrivacy(); update(); renderHistory();
  }

  function wipeAll() {
    if (!confirm('入力中の内容と、この端末に保存された履歴・下書き・プロフィールをすべて消します。よろしいですか？')) { return; }
    lsRemove(LS_DRAFT); lsRemove(LS_HIST); lsRemove(LS_PROF); memHistory = [];
    profile = null; profSkip = false; profPath = null; resetProfileForm();
    $('content').value = ''; $('customName').value = '';
    A.CTX_FIELDS.forEach(function (f) { $('ctx_' + f.id).value = ''; });
    selected = ['auto']; mode = 'quick'; opts = Object.assign({}, A.MODES.quick.defaults);
    refreshOpts(); update();
    lsRemove(LS_DRAFT);
    renderProfile();
    renderHistory();
    toast('入力内容・履歴・プロフィールをすべて消しました。ChatGPT・Claude・Gemini側の会話も、必要に応じてそちらで削除・ログアウトしてください。');
  }

  /* ---------- 初期化 ---------- */
  function init() {
    renderExamples(); renderCtx(); renderExperts(); renderModes(); renderOpts(); renderFollowups(); renderAiChoices(); renderProfileForm(); memLauncher.renderChoices(); deepLauncher.renderChoices();
    refreshOpts();
    var p = lsGet(LS_PRIV);
    privacy = (p === 'save' || p === 'nosave') ? p : null;
    if (canSave()) { applyState(lsGet(LS_DRAFT)); loadProfile(); syncProfileInputs(); paintProfileForm(); }
    renderProfile();
    $('profileBox').open = !profile;
    renderPrivacy();
    update();
    renderHistory();
    $('btnPrivSave').addEventListener('click', function () { setPrivacy('save'); });
    $('btnPrivNoSave').addEventListener('click', function () { setPrivacy('nosave'); });
    $('noSave').addEventListener('change', function () { setPrivacy($('noSave').checked ? 'nosave' : 'save'); });
    $('btnProfileMake').addEventListener('click', makeProfile);
    $('btnProfSkip').addEventListener('click', function () {
      profSkip = true; profPath = 'deep'; renderProfStep2();
      scrollToEl($('profStep2'));   // STEP 2へ移動する（STEP 1の質問は畳まれる）
      toast('基本診断は飛ばしました。STEP 2で、AIを選んでください。');
    });
    $('btnProfBack').addEventListener('click', function () {
      profSkip = false;
      if (!profile) { profPath = null; }
      renderProfStep2();
      scrollToEl($('profStep1Body'));
    });
    $('pathMemoryBtn').addEventListener('click', function () { setProfPath('memory'); });
    $('pathDeepBtn').addEventListener('click', function () { setProfPath('deep'); });
    $('btnMemGo').addEventListener('click', memLauncher.go);
    $('btnMemShort').addEventListener('click', function () { copyProfile('short'); });
    $('profCount').addEventListener('change', deepLauncher.render);
    $('profUseSite').addEventListener('change', deepLauncher.render);
    $('btnProfAiGo').addEventListener('click', deepLauncher.go);
    $('btnProfPaste').addEventListener('click', usePasted);
    $('btnProfDelete').addEventListener('click', deleteProfile);
    $('profAttach').addEventListener('change', function () {
      if (profile) { profile.attach = $('profAttach').checked; saveProfile(); update(); }
    });
    $('profileText').addEventListener('input', function () {
      if (profile) { profile.lines = $('profileText').value; saveProfile(); update(); renderProfStep2(); }
    });
    $('btnWipe').addEventListener('click', wipeAll);
    $('btnWipe2').addEventListener('click', wipeAll);

    ['stance', 'length'].forEach(function (id) { $(id).addEventListener('change', update); });
    ['content', 'customName'].forEach(function (id) { $(id).addEventListener('input', update); });
    $('preview').addEventListener('input', function () { $('charCount').textContent = '（' + $('preview').value.length + '文字）'; renderLaunch(); });
    $('content').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); copyOnly(); }
    });
    $('btnGo').addEventListener('click', launch);
    $('btnClearHistory').addEventListener('click', function () {
      if (confirm('履歴をすべて削除しますか？')) { lsRemove(LS_HIST); memHistory = []; renderHistory(); }
    });
  }

  init();
  $('verJs').textContent = APP_VERSION;
})();
