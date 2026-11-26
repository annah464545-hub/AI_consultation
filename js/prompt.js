/* =====================================================
   プロンプト生成ロジック（画面に依存しない部分）
   将来、サーバー側の有料機能から再利用できるように分離しています。
===================================================== */
(function (root) {
  'use strict';

  var MAX_EXPERTS = 4;

  var EXPERTS = [
    { id: 'auto', icon: '🪄', name: 'おまかせ編成', sub: '相談内容に合わせて、AIが最適な専門家を2〜4人選びます', wide: true, persona: '', solo: '' },
    { id: 'counselor', icon: '🧠', name: '心理カウンセラー', sub: 'モヤモヤ・人間関係・心の疲れ',
      persona: '経験豊富で温厚な心理カウンセラー。相談者の感情を否定せず受け止め、傾聴と優しい問いかけを行う。',
      solo: 'あなたは経験豊富で温厚な心理カウンセラーです。相談者の感情を否定せず受け止め、心が軽くなるように傾聴と優しい問いかけを行ってください。' },
    { id: 'career', icon: '💼', name: 'キャリアコーチ', sub: '仕事・転職・将来・目標設定',
      persona: '論理的かつ前向きなキャリアコーチ。強みや価値観を引き出し、仕事や将来の選択肢を整理して具体的な一歩を提案する。',
      solo: 'あなたは論理的かつ前向きなキャリアコーチです。相談者の強みや価値観を引き出し、仕事や将来の選択肢を整理して具体的な一歩を提案してください。' },
    { id: 'business', icon: '💡', name: 'ビジネス・企画顧問', sub: 'アイデア出し・業務改善・副業',
      persona: '実践的な経営・ビジネスコンサルタント。課題の本質を素早く見抜き、実行可能で効果的なアイデアや解決策を示す。',
      solo: 'あなたは実践的な経営・ビジネスコンサルタントです。課題の本質を素早く見抜き、実行可能で効果的なアイデアや解決策を分かりやすく提示してください。' },
    { id: 'life', icon: '🌿', name: '生活・習慣アドバイザー', sub: '時間管理・片付け・日々の悩み',
      persona: '生活習慣や家計・時間管理に詳しいライフアドバイザー。無理なく続けられる現実的で優しい工夫を提案する。',
      solo: 'あなたは生活習慣や家計・時間管理に詳しいライフアドバイザーです。無理なく続けられる現実的で優しい工夫を提案してください。' },
    { id: 'health', icon: '🏃', name: '健康・ウェルネス顧問', sub: '睡眠・運動・食事・ストレス',
      persona: '睡眠・運動・栄養・ストレスケアに詳しい健康アドバイザー。診断や治療の指示はせず一般的な情報提供にとどめ、必要に応じて医療機関の受診を勧める。',
      solo: 'あなたは睡眠・運動・栄養・ストレスケアに詳しい健康アドバイザーです。診断や治療の指示はせず一般的な情報提供にとどめ、必要に応じて医療機関の受診を勧めながら、無理なく続けられる工夫を提案してください。' },
    { id: 'money', icon: '💰', name: 'お金・ライフプラン顧問', sub: '家計・貯蓄・保険・制度',
      persona: 'ファイナンシャルプランナーの視点を持つ顧問。特定の金融商品の購入を断定的に勧めず、判断材料とリスクを整理して示す。',
      solo: 'あなたはファイナンシャルプランナーの視点を持つ顧問です。特定の金融商品の購入を断定的に勧めず、判断に必要な材料・選択肢・リスクを整理して分かりやすく示してください。' },
    { id: 'learning', icon: '📚', name: '学び・スキルアップコーチ', sub: '勉強法・資格・習慣化',
      persona: '学習設計と習慣化に詳しいコーチ。目標から逆算した学習計画と、続けやすい小さな仕組みを提案する。',
      solo: 'あなたは学習設計と習慣化に詳しいコーチです。目標から逆算した学習計画と、続けやすい小さな仕組みを具体的に提案してください。' },
    { id: 'communication', icon: '✉️', name: '伝え方・文章アドバイザー', sub: 'メール・言い方・断り方',
      persona: '伝え方と文章表現に詳しいアドバイザー。相手との関係を保ちながら、誤解されにくい言い方や文面の案を示す。',
      solo: 'あなたは伝え方と文章表現に詳しいアドバイザーです。相手との関係を保ちながら、誤解されにくい言い方や文面の案を、複数のトーンで示してください。' },
    { id: 'custom', icon: '✏️', name: '自由に指定', sub: '上記にない分野の専門家を自分で指定', persona: '', solo: '' }
  ];

  var MODES = {
    ask:   { id: 'ask',   icon: '❓', name: 'まず質問してもらう', sub: '情報が少ないとき向け。AIが先に質問し、答えてから助言します',
             defaults: { search: false, counter: false, confidence: false, steps: true } },
    quick: { id: 'quick', icon: '⚡', name: 'すぐ答えてもらう', sub: '専門家が1回の返答の中で議論して答えます',
             defaults: { search: true, counter: false, confidence: true, steps: true } },
    deep:  { id: 'deep',  icon: '🔬', name: 'じっくり深掘り', sub: '調査・反対意見・選択肢の比較まで。大事な決断向け',
             defaults: { search: true, counter: true, confidence: true, steps: true } }
  };

  var OPTS = [
    { id: 'search', icon: '🔎', name: '最新情報・出典を調べてもらう',
      why: 'AIの知識は古いことがあります。検索させて出典を示させると、間違いに気づきやすくなります。' },
    { id: 'counter', icon: '⚖️', name: '反対意見・見落としも挙げてもらう',
      why: 'AIは相談者に同調しがちです。あえて反論させると、偏った結論を避けられます。' },
    { id: 'confidence', icon: '🎯', name: '確からしさを表示してもらう',
      why: '「確かな情報」「一般論」「推測」を分けさせると、どこまで信じてよいか判断できます。' },
    { id: 'steps', icon: '✅', name: '今日できる小さな一歩に落とし込んでもらう',
      why: '読んで終わりにせず、すぐ行動できる形にしてもらいます。' }
  ];

  var CTX_FIELDS = [
    { id: 'background', label: '状況・背景', placeholder: '例：入社3年目。部署異動で業務量が倍になった' },
    { id: 'goal', label: 'どうなりたいか（ゴール）', placeholder: '例：残業を減らして、週末は休めるようにしたい' },
    { id: 'limits', label: '制約（時間・お金・体力など）', placeholder: '例：平日は自由な時間が1時間もない' },
    { id: 'tried', label: 'すでに試したこと', placeholder: '例：上司に相談したが、人手不足と言われた' },
    { id: 'deadline', label: '期限・決めたい時期', placeholder: '例：来月の評価面談までに' }
  ];

  var EXAMPLES = [
    '仕事が忙しすぎて、何から手を付けていいか分からない',
    '転職するか、今の会社に残るか迷っている',
    '副業を始めたいが、何をすればいいか分からない',
    '貯金が増えない。家計をどう見直せばいいか知りたい'
  ];

  var FOLLOWUPS = [
    { label: '🔍 もっと具体的に', text: 'もう少し具体的に教えてください。特に「今日」「今週」「今月」にやることに分けてください。' },
    { label: '⚖️ 反対の立場から', text: 'いまの結論に対して、あえて反対の立場から、デメリット・失敗しやすいパターン・見落としを挙げてください。' },
    { label: '🔀 他の選択肢', text: '別の選択肢を3つ挙げて、それぞれのメリット・デメリットを比べてください。' },
    { label: '❓ 足りない情報を質問して', text: 'より的確に答えるために、私に確認したいことを最大5個、答えやすい形で質問してください。' },
    { label: '✉️ 相手への伝え方', text: '相手に伝えるための文面を、丁寧版とカジュアル版の2パターンで書いてください。' },
    { label: '📝 3行でまとめて', text: 'ここまでの内容を、結論・理由・次の一歩の3行でまとめてください。' },
    { label: '🗓 1か月プラン', text: '1か月間で無理なく進めるための週ごとのプランにしてください。' },
    { label: '👥 専門家を追加', text: 'ここに【　　　】の専門家も加えて、もう一度議論してください。' }
  ];

  function pushAll(arr, items) { items.forEach(function (x) { arr.push(x); }); }

  function isPanel(s) {
    var n = (s.experts || []).length;
    return !!s.auto || n > 1 || s.mode === 'deep';
  }

  function ctxLines(ctx) {
    var out = [];
    CTX_FIELDS.forEach(function (f) {
      var v = ctx && ctx[f.id] ? String(ctx[f.id]).trim() : '';
      if (v) { out.push('【' + f.label + '】\n' + v); }
    });
    return out;
  }

  function ctxCount(ctx) {
    return ctxLines(ctx).length;
  }

  function build(s) {
    var experts = s.experts || [];
    var auto = !!s.auto;
    var mode = MODES[s.mode] ? s.mode : 'quick';
    var o = s.opts || {};
    if (!auto && !experts.length) { return ''; }
    var panel = isPanel(s);
    var content = (s.content || '').trim() || '（ここに相談内容が入ります）';
    var sample = auto ? '専門家の名前' : experts[0].name;
    var out = [];

    // 1. 役割
    if (!panel) {
      out.push(experts[0].solo);
    } else {
      out.push('あなたはこれから、一人で複数の専門家になりきり、協力して相談者の悩みを解決する「専門家会議」を行ってください。');
      out.push('\n【参加者】');
      out.push('- ファシリテーター：進行役。議論を整理し、最後に全員の意見を統合して結論をまとめる。');
      if (mode === 'deep') { out.push('- リサーチャー：調査担当。調べた事実と推測を区別して共有する。'); }
      if (auto) {
        var cands = EXPERTS.filter(function (e) { return e.id !== 'auto' && e.id !== 'custom'; }).map(function (e) { return e.name; }).join('、');
        out.push('- 専門家（2〜4人）：相談内容に最も役立つ専門家をあなたが選び、最初に編成を宣言する（候補の例：' + cands + '。これ以外の分野でもよい）。');
      } else {
        pushAll(out, experts.map(function (e) { return '- ' + e.name + '：' + e.persona; }));
      }
    }

    // 2. 進め方
    if (mode === 'ask') {
      out.push('\n【進め方】');
      out.push('まだ情報が足りないかもしれないので、いきなり助言せず、次の順で進めてください。');
      out.push('1. 相談内容を2文で要約し、理解が合っているかを確認する。');
      out.push('2. 的確に助言するために必要な情報を、答えやすい質問として最大5個、番号つきで聞く（分からないものはスキップしてよいと伝える）。');
      out.push('3. 私が答えるまで、助言はしない。');
      out.push('4. 私の回答を受け取ったら、下の【回答の形式】で答える。');
    }

    out.push(mode === 'ask' ? '\n【回答の形式（私の回答を受け取ったあと）】' : (panel ? '\n【会議の進め方】' : '\n【回答の形式】'));
    if (panel) {
      var deep = mode === 'deep';
      if (deep) { out.push('ステップ0（調査）：リサーチャーが、ウェブ検索で公的情報・最新情報を調べ、事実と推測を分けて、出典つきの調査メモを出す（検索できない場合はその旨を明記する）。'); }
      out.push('ステップ1：各専門家が、' + (deep ? '調査メモを踏まえ、' : '') + '自分の専門の視点から、見立てと意見を1つずつ述べる。');
      out.push('ステップ2：専門家同士が、互いの意見に対して補足・改善案・反論を述べ合う。意見が割れる点は無理にまとめず、違いをはっきり示す。');
      out.push('ステップ3：ファシリテーターが全員の意見を統合し、結論を示す。' +
        (deep ? '選択肢を2〜3案に分けて、それぞれのメリット・デメリットと、どんな人・状況に向くかも示す。' : ''));
    } else {
      out.push('- 最初に、相談者の状況や気持ちを一言で受け止める。');
      out.push('- 次に、見立て → おすすめ → 注意点の順に答える。');
    }

    // 3. 出力ルール
    out.push('\n【出力ルール】');
    if (mode === 'ask') { out.push('- 最初の返信は、手順1と2（要約と質問）だけにする。'); }
    if (panel) {
      out.push('- 各発言の冒頭に、必ず発言者の名前（例：「ファシリテーター」「' + sample + '」）を明記する。');
      out.push('- ステップ' + (mode === 'deep' ? '0' : '1') + '〜3は、' + (mode === 'ask' ? '私の回答を受け取ったあとの返信で、' : '') + '1回の出力で最後まで行う。');
    }
    out.push('- 回答の長さ：' + s.length);
    if (o.search && mode !== 'deep') { out.push('- 最新の制度・数字・統計などが関係する場合は、ウェブ検索で確認して出典（サイト名）を示す。検索できない場合はその旨を書く。'); }
    if (o.counter) { out.push('- 結論の前に、その結論が外れるケース・見落としやすい点・反対意見を必ず挙げる（相談者に同調しすぎない）。'); }
    if (o.confidence) { out.push('- 重要な主張には【確かな情報】【一般論】【推測】のラベルを付け、どこまで信じてよいか分かるようにする。'); }
    if (o.steps) { out.push('- 最後に「今日からできる小さな一歩」を1〜3個、具体的なチェックリスト（- [ ] ）で示す。'); }
    if (s.profile) { out.push('- 【相談者について】を参考に、言い方・順序・量・提案の仕方を調整する。診断や決めつけとして扱わず、食い違うときは確認する。避けてほしいと書かれた言い方・話題は使わない。ただし、耳の痛い事実や反対意見も、配慮した言い方で伝える。'); }
    out.push('- 医療・法律・投資などは一般的な情報提供にとどめ、必要に応じて専門機関への相談を勧める。');
    out.push('- 私が強い苦痛や自分を傷つけたい気持ちを示した場合は、助言より先に気持ちを受け止め、身近な人や専門の相談窓口につながることを勧める。');
    out.push('- 最後に、続けて相談するための質問を1つだけ添える。');

    // 4. 相談内容
    out.push('\n【希望する対応スタンス】\n' + s.stance);
    out.push('\n【相談内容】\n' + content);
    ctxLines(s.ctx).forEach(function (l) { out.push('\n' + l); });
    if (s.profile) { out.push('\n【相談者について（自己申告）】\n' + s.profile); }
    out.push('\n' + (mode === 'ask' ? 'まずは手順1と2だけを行ってください。' :
      (panel ? '以上を踏まえて、専門家会議を始めてください。' : 'まずは上記の相談内容に対して、専門家として最初の返答をしてください。')));
    return out.join('\n');
  }

  // 「このプロンプトにどんな工夫が入っているか」の解説
  function explain(s) {
    var items = [];
    var experts = s.experts || [];
    var mode = MODES[s.mode] ? s.mode : 'quick';
    var o = s.opts || {};
    var panel = isPanel(s);
    if (panel) {
      items.push({ icon: '🗣', title: '専門家チームに役割を与える',
        why: '1人の万能なAIに聞くより、立場の違う専門家に議論させるほうが、多面的で偏りの少ない答えになります。' });
    } else if (experts.length) {
      items.push({ icon: '🎭', title: '専門家の役割を与える', why: '「誰として答えるか」を決めると、答えの視点と口調が安定します。' });
    }
    if (s.profile) { items.push({ icon: '🧑', title: 'あなたの性格・好みを伝える', why: '同じ助言でも、言い方や順序が合わないと、伝わらなかったり、傷つけたりします。あなたに合わせて調整してもらいます。' }); }
    var n = ctxCount(s.ctx);
    if (n > 0) { items.push({ icon: '🧩', title: '背景・目標・制約など' + n + '項目を渡す', why: '状況を具体的に伝えるほど、一般論ではなく、あなた向けの答えになります。' }); }
    else { items.push({ icon: '💡', title: 'ヒント：詳しい情報を入れるともっと良くなります', why: '「もっと詳しく伝える」に背景やゴールを書くと、答えが具体的になります。' }); }
    if (mode === 'ask') { items.push({ icon: '❓', title: '先にAIから質問させる', why: '情報が足りないまま助言させると、的外れになりがちです。先に聞いてもらうことで精度が上がります。' }); }
    if (mode === 'deep') { items.push({ icon: '🔬', title: '調査 → 議論 → 選択肢の比較まで段階を踏ませる', why: '一気に結論を出させず、手順を踏ませると、大事な決断でも抜け漏れが減ります。' }); }
    OPTS.forEach(function (op) { if (o[op.id]) { items.push({ icon: op.icon, title: op.name, why: op.why }); } });
    items.push({ icon: '📐', title: '回答の形式と長さを指定する', why: '出力の形を決めておくと、読みやすく、次の行動に移しやすくなります。' });
    return items;
  }

  root.AIC = {
    MAX_EXPERTS: MAX_EXPERTS, EXPERTS: EXPERTS, MODES: MODES, OPTS: OPTS,
    CTX_FIELDS: CTX_FIELDS, EXAMPLES: EXAMPLES, FOLLOWUPS: FOLLOWUPS,
    build: build, explain: explain, isPanel: isPanel, ctxCount: ctxCount
  };
})(typeof window !== 'undefined' ? window : globalThis);
