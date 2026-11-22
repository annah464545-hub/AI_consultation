(function () {
  'use strict';

  var A = window.AIC;
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
          toast(ok ? '「' + f.label.replace(/^\S+\s/, '') + '」をコピーしました。AIの画面に貼り付けて送信してください。' : 'コピーに失敗しました。', !ok);
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
      content: $('content').value, ctx: ctx
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
    $('safety').hidden = !/死にたい|自殺|消えたい|いなくなりたい|自傷|リスカ|生きて(い)?たくない/.test($('content').value);
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
      A.OPTS.forEach(function (op) { opts[op.id] = !!s.opts[op.id]; });
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
  // chatgpt・claude: URLでの自動入力に対応（claudeは長い文章だと使えない） / gemini: 非対応（貼り付けが必要）
  var SERVICES = {
    chatgpt: { name: 'ChatGPT', base: 'https://chatgpt.com/', param: '?q=', hashParam: '#?q=', autoFill: true },
    claude:  { name: 'Claude',  base: 'https://claude.ai/new', param: '?q=', hashParam: null, autoFill: true },
    gemini:  { name: 'Gemini',  base: 'https://gemini.google.com/app', param: null, hashParam: null, autoFill: false }
  };

  function showGuide(svc, ok, autoFilled) {   // autoFilled: URLに相談文を入れて開いたか
    var g = $('launchGuide');
    g.textContent = '';
    g.hidden = false;
    g.appendChild(el('b', 'title', ok ? '✅ コピーしました。次の手順で進めてください' : '⚠ 自動コピーに失敗しました。下の「プロンプトを見る」から手動でコピーしてください'));
    var ol = el('ol');
    if (autoFilled) {
      ol.appendChild(el('li', null, svc.name + 'のタブが開き、相談文が入力欄に自動で入ります（入らない場合は、次の貼り付けをお願いします）。'));
      ol.appendChild(el('li', null, '入力欄が空のときは、入力欄をタップして貼り付けてください（Ctrl/⌘ + V、スマホは長押し→ペースト）。'));
      ol.appendChild(el('li', null, '内容を確認して、送信ボタンを押します。'));
    } else {
      ol.appendChild(el('li', null, svc.name + 'のタブが開きます' + (svc.autoFill ? '（相談文が長いため、自動入力はできません）。' : '。')));
      ol.appendChild(el('li', null, '入力欄をタップして貼り付けます（Ctrl/⌘ + V、スマホは長押し→ペースト）。'));
      ol.appendChild(el('li', null, '内容を確認して、送信ボタンを押します。'));
    }
    g.appendChild(ol);
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

  function launch(key) {
    var prompt = validate();
    if (!prompt) { return; }
    var svc = SERVICES[key], url = svc.base, auto = false;
    var enc = encodeURIComponent(prompt);
    if (svc.param && enc.length <= URL_LIMIT) {
      url = svc.base + svc.param + enc; auto = svc.autoFill;
    } else if (svc.hashParam && enc.length <= HASH_LIMIT) {
      url = svc.base + svc.hashParam + enc; auto = svc.autoFill;   // 長い文章は、サーバーに送られない # 側に入れる
    }
    var copying = copyText(prompt);        // 失敗時の保険として、必ずコピーもする。クリック直後に同期でタブを開く（ポップアップブロック対策）
    window.open(url, '_blank', 'noopener');
    $('toast').textContent = '';
    copying.then(function (ok) {
      if (!ok) { $('previewBox').open = true; }
      showGuide(svc, ok, auto);
    });
    saveHistory();
  }

  function copyOnly() {
    var prompt = validate();
    if (!prompt) { return; }
    copyText(prompt).then(function (ok) {
      $('launchGuide').hidden = true;
      if (ok) { toast('プロンプトをコピーしました！お好みのAIに貼り付けて送信してください。'); }
      else { $('previewBox').open = true; toast('自動コピーに失敗しました。プロンプト欄から手動でコピーしてください。', true); }
    });
    saveHistory();
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
      if ((stored.length || hasDraft) &&
          !confirm('この端末に保存されている履歴（' + stored.length + '件）と下書きを削除します。よろしいですか？')) {
        renderPrivacy();
        return;
      }
      lsRemove(LS_DRAFT); lsRemove(LS_HIST);
      privacy = 'nosave'; lsSet(LS_PRIV, 'nosave');
      toast('「保存しない」にしました。この端末に残っていた履歴と下書きは削除しました。');
    } else {
      var carry = memHistory;
      privacy = 'save'; lsSet(LS_PRIV, 'save');
      if (!$('content').value.trim()) { applyState(lsGet(LS_DRAFT)); }
      if (carry.length) { lsSet(LS_HIST, carry.concat(getStoredHistory()).slice(0, HIST_MAX)); }
      memHistory = [];
      toast('「保存する」にしました。共用の端末では、使い終わったら必ず履歴を消してください。');
    }
    renderPrivacy(); update(); renderHistory();
  }

  function wipeAll() {
    if (!confirm('入力中の内容と、この端末に保存された履歴・下書きをすべて消します。よろしいですか？')) { return; }
    lsRemove(LS_DRAFT); lsRemove(LS_HIST); memHistory = [];
    $('content').value = ''; $('customName').value = '';
    A.CTX_FIELDS.forEach(function (f) { $('ctx_' + f.id).value = ''; });
    selected = ['auto']; mode = 'quick'; opts = Object.assign({}, A.MODES.quick.defaults);
    refreshOpts(); update();
    lsRemove(LS_DRAFT);
    renderHistory();
    toast('入力内容と履歴をすべて消しました。ChatGPT・Claude・Gemini側の会話も、必要に応じてそちらで削除・ログアウトしてください。');
  }

  /* ---------- 初期化 ---------- */
  function init() {
    renderExamples(); renderCtx(); renderExperts(); renderModes(); renderOpts(); renderFollowups();
    refreshOpts();
    var p = lsGet(LS_PRIV);
    privacy = (p === 'save' || p === 'nosave') ? p : null;
    if (canSave()) { applyState(lsGet(LS_DRAFT)); }
    renderPrivacy();
    update();
    renderHistory();
    $('btnPrivSave').addEventListener('click', function () { setPrivacy('save'); });
    $('btnPrivNoSave').addEventListener('click', function () { setPrivacy('nosave'); });
    $('noSave').addEventListener('change', function () { setPrivacy($('noSave').checked ? 'nosave' : 'save'); });
    $('btnWipe').addEventListener('click', wipeAll);
    $('btnWipe2').addEventListener('click', wipeAll);

    ['stance', 'length'].forEach(function (id) { $(id).addEventListener('change', update); });
    ['content', 'customName'].forEach(function (id) { $(id).addEventListener('input', update); });
    $('preview').addEventListener('input', function () { $('charCount').textContent = '（' + $('preview').value.length + '文字）'; });
    $('content').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); copyOnly(); }
    });
    $('btnChatGPT').addEventListener('click', function () { launch('chatgpt'); });
    $('btnClaude').addEventListener('click', function () { launch('claude'); });
    $('btnGemini').addEventListener('click', function () { launch('gemini'); });
    $('btnCopy').addEventListener('click', copyOnly);
    $('btnClearHistory').addEventListener('click', function () {
      if (confirm('履歴をすべて削除しますか？')) { lsRemove(LS_HIST); memHistory = []; renderHistory(); }
    });
  }

  init();
})();
