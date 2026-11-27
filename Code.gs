/**
 * 事務員の仕事を100個奪う猫｜ネコの手 1個め「日報すいこみ口」（架空の工務店A社の見本）— 日報と写真を送ると、表に1行ずつ入る（現場は列）
 * データはすべて架空。実在の会社の仕組みではない。
 *
 * 置き場: 見本のスプレッドシートとは別の、独立したスクリプト（鍵の置き場を、シートを共有した相手に見せないため）
 * 鍵の置き場（スクリプトプロパティ）:
 *   LINE_TOKEN   LINEの鍵（チャネルアクセストークン・期限のない種類）。使う人が貼る
 *   PATH_SECRET  受け取り先の住所に付ける合言葉（setup が作る）
 *   JOIN_WORD    参加の合言葉。最初にこれを送った人だけ受け付ける（setup が作る）
 *   HASH_KEY     送った人の番号を、そのまま残さずに変換するための鍵（setup が作る）
 *   SHEET_ID・FOLDER_ID・BOT_USER_ID  見本の表・写真のフォルダ・見本のアカウントの番号（setup が入れる）
 *   JOINED・COUNTS・QUEUE・DONE・NOTES・CAPS  参加した人（変換した値）・1日の件数・しまう前の写真・しまった写真の番号・
 *                                           受付の記録に書く前の件数・表に書く前の一言（プログラムが使う）
 *   MADA_ON・SENDERS  3個め（日報まだ番・Mada.gs）を入れたときだけ: その印と、現場ごとに最後に日報か写真を送った人の LINE の番号
 *                     （催促を送るため、変換せずに持つ。表には書かない。印があっても Mada.gs が無ければ、番号はそのまま残さない）
 *   HOGUSHI_ON・HOGUSHI_PENDING・HOGUSHI_MARKED・GEMINI_API_KEY  4個め（日報ほぐし機・Hogushi.gs）を入れたときだけ: その印・読ませる日報がある印・
 *                     入れる前の日報に印を付け終えた印・AI の鍵（使う人が貼る）
 *   TEGAKI_ON・TEGAKI_QUEUE  6個め（手書きすいこみ口・Tegaki.gs）を入れたときだけ: その印と、AI に読ませる手書きの写真（受付番号とドライブの番号）
 *   RYOSHU_ON・RYOSHU_QUEUE・RYOSHU_SHEET_ID・RYOSHU_FOLDER_ID  8個め（レシートすいこみ口・Ryoshu.gs）を入れたときだけ: その印・AI に読ませる
 *                     レシートの写真・経費の表（日報とは別のファイル）・領収書の写真のフォルダ（setupRyoshu が入れる）
 *   WAKE_AT  片付けの自動実行を置いた時刻（プログラムが使う）
 *   SETTINGS_ID  2個め（Yugata.gs）からあと: 保護をかけた「設定」のシートの番号（setupYugata などが入れる）
 *
 * LINEは2秒以内に応えないと「時間切れ」と記録する。写真は取り出してしまうのに6秒ほどかかる（見本で測った値）ので、
 * 受け取ったときは番号だけ控えてすぐ返事し、取り出してフォルダと表にしまうのは drainPhotos（片付け）。
 * 受付の記録も、受け取るたびには表に書かず、件数を数えておいて drainPhotos でまとめて書く。日報（文）だけは、すぐ表に入れる。
 * 片付けは、何か届いたときに受け取りが「1分後に1回だけ動く自動実行」を置いて起こす（置いてあるあいだは置き足さない）。
 * 毎分は動かさない（見本で測ると、何も無い回も1回1秒ほどかかり、毎分では、無料のアカウントの自動実行の1日90分のうち27分ほどを使うため）。
 * 写真が多い回は、片付けの始まりから3分で区切り、残りは次の回にしまう（1回6分の上限で止まって、取り出した写真を失わないように）。
 * 片付けが取り出した写真は、しまい終わるまで控え（QUEUE）に残し、取り出した印（g）を付ける。印のある写真も受け付けの40枚に数え、
 * 片付けが途中で止まったときは、印が7分より古くなってから、次の片付けがもう一度扱う（表とドライブに入れ終えた写真は、2つ作らない）。
 *
 * 段1（写真台帳）: 写真をしまうとき、現場ごとの「台帳_現場1」に、印刷用の台帳の形（写真の横に 工事名・送信日時・内容・元の写真）で
 * 枠を1つ足す。貼るのはLINEの小さい版（表に貼れるのは1枚2MBまで）。写真のあと5分以内の最初の文を「一言」として、台帳の内容と、
 * 日報のシートの写真の行に入れる。
 *
 * 表の形: データは「日報」1枚（全部の現場・現場は列）と「現場」の一覧（現場・工事名）。現場ごとに分けるのは、
 * 工事ごとに印刷して出す写真台帳だけ。LINEのボタンの現場の名前は、届くたびに表を読まないよう、このプログラムの SITES に持つ。
 *
 * GASは届いた知らせの署名を読めないので、住所の合言葉・宛先・参加の合言葉の3つで守る。ほかに、10分より古い・5分より先の時刻の
 * 知らせは捨てる（LINE の「Webhookの再送」は切ったままにする）。参加は400人まで。しまわない操作（現場を選ぶ・スタンプなど）は1人1日60回まで。
 * このファイルの返事は Reply だけ。お知らせ（Push）は使わない（無料の月200通を使わないため。使うのは3個めの催促だけ）。
 * doPost は何も返さない（中身を返すと別の住所への案内になり、LINEに「失敗」と記録されるため）。
 */

var TZ = 'Asia/Tokyo';
var SITES = ['現場1', '現場2', '現場3', '現場4'];
var REPORT_SHEET = '日報';
var HEADERS = ['受付日時', '現場', '種類', '内容', '写真', '受付番号'];
var COL_CONTENT = HEADERS.indexOf('内容') + 1;
var COL_ID = HEADERS.indexOf('受付番号') + 1;
var SITE_SHEET = '現場';
var SITE_HEADERS = ['現場', '工事名'];
var LOG_SHEET = '受付の記録';
var LOG_HEADERS = ['日付', '受け付けた件数', '上限で断った', '現場を選ぶ前', '写真を取り出せない', '文と写真以外', '返事の失敗', '止まった', '最長の処理（秒）'];
var SHEET_NAME = '【見本・架空データ】LINEの日報を表に';
var FOLDER_NAME = '【見本・架空データ】LINEの日報の写真';
var API = 'https://api.line.me/v2/bot';
var API_DATA = 'https://api-data.line.me/v2/bot';

var SITE_MINUTES = 30; // 選んだ現場を覚えておく時間
var LIMIT_ALL = 100; // 1日の受付（全体）
var LIMIT_USER = 30; // 1日の受付（1人）
var LIMIT_OPS = 60; // 1日の、しまわない操作（現場を選ぶ・スタンプ・合言葉の送り直し・上限で断るなど。1人）
var JOIN_MAX = 400; // 参加できる人数（変換した番号1つで19字。鍵の置き場の1つ9KBを超えないように）
var EVENT_OLD_MS = 10 * 60 * 1000; // これより古い時刻の知らせは捨てる
var EVENT_AHEAD_MS = 5 * 60 * 1000; // これより先の時刻の知らせは捨てる
var MAX_TEXT = 500; // 日報の文の長さ
var SEEN_SECONDS = 21600; // 受け取った知らせの番号を一時置き場に覚えておく時間（上限の6時間）
var SET_SECONDS = 600; // まとめて送った写真の数えを覚えておく時間
var LOCK_MS = 10000; // 返事の札は1分有効。それより短く待つ
var QUEUE_MAX = 40; // しまう前の写真の控え（自動実行が止まっても、鍵の置き場の1つ9KBを超えないように）
var DONE_KEEP = 200; // しまった写真の番号を覚えておく数（同じ知らせの2回目をはじくため）
var DRAIN = 'drainPhotos'; // 届いたあとに1回だけ動く自動実行で動かす関数（片付け）
var WAKE_AT = 'WAKE_AT'; // 片付けの自動実行を置いた時刻（置いてあるあいだは置き足さない）
var WAKE_MS = 60 * 1000; // 届いてから片付けるまで
var WAKE_STALE_MS = 15 * 60 * 1000; // 置いたまま、これより長く動いていなければ、置き直す
var DRAIN_BUDGET_MS = 3 * 60 * 1000; // 片付けの始まりからこれを過ぎたら、残りの写真は次の回へ（このあと一言・受付の記録・6個め・4個めも動く）
var TAKEN_STALE_MS = 7 * 60 * 1000; // 取り出した印がこれより古ければ、止まった片付けの写真（片付けは1回6分で止まる）
var MADA_ON = 'MADA_ON'; // 3個め（日報まだ番）を入れた印（setupMada が入れる）
var SENDERS = 'SENDERS'; // 現場ごとに最後に送った人の LINE の番号（3個めを入れたときだけ）
var HOGUSHI_ON = 'HOGUSHI_ON'; // 4個め（日報ほぐし機・Hogushi.gs）を入れた印（setupHogushi が入れる）
var HOGUSHI_PENDING = 'HOGUSHI_PENDING'; // 4個めに読ませる日報がある印（日報を表に入れたときに付け、片付けが4個めを呼ぶ）
var HOGUSHI_STATE = 'ほぐし'; // 4個めが日報のシートに足す列のうち、読んだ結果の印の列（3個めも見る）
var EMPTY_MARK = '中身なし'; // 作業の内容が無い日報の印（3個めは、届いていないと数える）
var TEGAKI_ON = 'TEGAKI_ON'; // 6個め（手書きすいこみ口・Tegaki.gs）を入れた印（setupTegaki が入れる）
var TEGAKI_QUEUE = 'TEGAKI_QUEUE'; // 6個めに読ませる手書きの写真（しまったあとに足し、片付けが6個めを呼ぶ）
var TEGAKI_KIND = '手書き'; // 日報のシートの種類（ボタンの字も同じ）
var TEGAKI_MINUTES = 10; // 「手書き」を押してから、送った写真を手書きとして受け付ける時間
var TEGAKI_QUEUE_MAX = 60; // 読む前の手書きの控えがこれだけあれば、受け付けで断る（1つ約75字。しまう前の控え40と合わせても、鍵の置き場の1つ9KBを超えない）
var TEGAKI_WAITING = '（読み取り待ち）'; // 手書きの行の、AI が読むまでの内容
var TEGAKI_FAILED = '（読めませんでした。写真を見てください）';
var TEGAKI_NOT_REPORT = '（日報の字が見つかりませんでした。写真を見てください）';
var TEGAKI_NOTES = [TEGAKI_WAITING, TEGAKI_FAILED, TEGAKI_NOT_REPORT]; // 人が写真を見る手書きの行（4個めは読まない＝中身なしと数えず、まだ番は届いたと数える）
var REPORT_KINDS = ['日報', TEGAKI_KIND]; // 日報として読む・数える種類（4個めの分け方・2個めの夕方のメール・3個めのまだ番）
var RYOSHU_ON = 'RYOSHU_ON'; // 8個め（レシートすいこみ口・Ryoshu.gs）を入れた印（setupRyoshu が入れる）
var RYOSHU_QUEUE = 'RYOSHU_QUEUE'; // 8個めに読ませるレシートの写真（しまったあとに足し、片付けが8個めを呼ぶ）
var RYOSHU_KIND = '領収書'; // ボタンの字
var RYOSHU_MINUTES = 10; // 「領収書」を押してから、送った写真をレシートとして受け付ける時間
var RYOSHU_QUEUE_MAX = 60; // 読む前のレシートの控えがこれだけあれば、受け付けで断る（手書きの控えと同じ考え方）
var RECENT_ROWS = 500; // 同じ知らせの2回目・一言を入れる写真の行は、日報の下からこの行数までで探す（全部の現場が1枚に入るので、表が大きくなってもLINEの2秒に間に合うように）

// 写真台帳（印刷用の形）。写真1枚で4行の枠。A4の縦に3枚入る高さにそろえる
var LEDGER_PREFIX = '台帳_';
var LEDGER_LABELS = ['工事名', '送信日時', '内容', '元の写真'];
var LEDGER_HEIGHTS = [44, 44, 150, 44];
var LEDGER_FIRST = 3; // 1・2行目は題と注記
var LEDGER_PHOTO = { width: 360, height: 262, pad: 10 }; // 写真を収める大きさ（4行の高さの合計 − 上下の余白）
var MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 表に貼れる写真の上限（公式: The maximum supported blob size is 2MB）
var CAPTION_MINUTES = 5; // 写真のあと、この時間までの最初の文を一言にする
var CAPTION_MAX = 200; // 一言の長さ
var CAPTION_GROUPS = 5; // 表に書く前の一言を覚えておく数（鍵の置き場の1つ9KBを超えないように）
var CAPTION_WAIT_MINUTES = 30; // しまっている途中の写真の一言を、待つ時間

// 返事の文。自分の会社で使うときは、hello・onlyTextPhoto・limit の「見本」「架空の会社」を、自分の会社の言い方に書き換える
var MSG = {
  hello: '見本のアカウントです（架空の会社）。個人の情報は送らないでください。',
  joined: '参加を受け付けました。現場を選んでください。',
  already: '参加済みです。現場を選んでください。',
  choose: '先に現場を選んでください。',
  onlyTextPhoto: '見本では、文と写真だけ受け付けます。',
  limit: '見本のため、本日の受付は終わりました。',
  handBusy: '手書きの読み取りが混んでいます。少し時間をおいて、もう一度送ってください。',
  receiptBusy: 'レシートの読み取りが混んでいます。少し時間をおいて、もう一度送ってください。',
  full: '参加できる人数の上限に達しているため、参加を受け付けられません。',
};

// LINEからの知らせの受け取り口（ウェブアプリとして公開する）
function doPost(e) {
  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('PATH_SECRET');
  var key = (e && e.parameter && e.parameter.k) || (e && e.pathInfo) || '';
  // 落とした理由は実行の一覧（console.log）に残す。合言葉は、中身も長さも出さない
  // Logger.log は、ウェブアプリとして呼ばれたときは実行の一覧に残らないので使わない
  if (!key) {
    console.log('受け取り先の住所に合言葉（?k=）が無いので、何もしませんでした');
    return;
  }
  if (!secret || key !== secret) {
    console.log('受け取り先の合言葉が違うので、何もしませんでした');
    return;
  }
  var body = parseBody_(e);
  if (!body || !Array.isArray(body.events)) {
    console.log('知らせの形が読めないので、何もしませんでした');
    return;
  }
  if (body.destination !== botUserId_(props)) {
    console.log('宛先が見本のアカウントと違うので、何もしませんでした');
    return;
  }
  var stale = body.events.filter(function (event) {
    return event && !fresh_(event);
  }).length;
  if (stale > 0) console.log('時刻が10分より古い・5分より先の知らせ ' + stale + ' 件を、何もせずに落としました（LINE の「Webhookの再送」は切ったままにする）');
  var joined = joinedList_(props);
  var events = body.events.filter(function (event) {
    return admitted_(props, joined, event);
  });
  if (events.length === 0) {
    if (body.events.length > 0) console.log('参加していない人の知らせなど ' + body.events.length + ' 件を、何もせずに落としました');
    return;
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) {
    console.log('順番待ちが長すぎて、知らせを ' + events.length + ' 件しまえませんでした'); // 中身は記録に出さない
    return;
  }
  try {
    var ctx = context_(props);
    events.forEach(function (event) {
      handleEvent_(ctx, event);
    });
    if (ctx.worked || pendingWork_(props)) wake_(props); // 片付けを起こす（受け取りにかかった秒数に含める）
    if (ctx.worked) count_(ctx, '最長の処理（秒）', (Date.now() - started) / 1000); // LINEが待った時間
  } finally {
    lock.releaseLock();
  }
}

// 最初に1回だけ、スクリプトの画面から動かす（LINE_TOKEN を貼ったあと）。表・フォルダ・合言葉を用意して、記録に出す
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('LINE_TOKEN')) throw new Error('LINE_TOKEN（LINEの鍵）がまだ貼られていません。手順書の「鍵を貼る」を見てください');
  ['PATH_SECRET', 'HASH_KEY'].forEach(function (name) {
    if (!props.getProperty(name)) props.setProperty(name, (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  });
  if (!props.getProperty('JOIN_WORD')) props.setProperty('JOIN_WORD', 'sanka-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12));

  var ss = props.getProperty('SHEET_ID') ? SpreadsheetApp.openById(props.getProperty('SHEET_ID')) : SpreadsheetApp.create(SHEET_NAME);
  props.setProperty('SHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone(TZ);
  textColumn_(reportSheet_(ss)); // 前に作った表にも、同じ書式を入れ直す
  siteList_(ss);
  logSheet_(ss);
  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if ([REPORT_SHEET, SITE_SHEET, LOG_SHEET].indexOf(name) < 0 && sheet.getLastRow() === 0) ss.deleteSheet(sheet);
  });

  var root = props.getProperty('FOLDER_ID') ? DriveApp.getFolderById(props.getProperty('FOLDER_ID')) : DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', root.getId());
  SITES.forEach(function (site) {
    siteFolder_(props, site);
  });

  var bot = botInfo_(props.getProperty('LINE_TOKEN'));
  if (!bot) throw new Error('LINEの鍵で見本のアカウントを読めませんでした。LINE_TOKEN を貼り直してください');
  props.setProperty('BOT_USER_ID', bot.userId);
  clearWake_(props); // 前の版が置いた毎分の自動実行も外す。片付けは、届いたときに受け取りが起こす
  Logger.log('準備ができました。見本のアカウント: ' + bot.displayName + '（写真と受付の記録は、届いてから1分ほどでしまいます）');
  Logger.log('表: ' + ss.getUrl());
  Logger.log('写真のフォルダ: ' + root.getUrl());
  // 次の2つは、行をまるごとコピーできるように、それだけを1行で出す
  Logger.log('スマホから最初に1回送る、参加の合言葉（次の行）:');
  Logger.log(props.getProperty('JOIN_WORD'));
  Logger.log('LINEの Webhook URL は、公開したときのURL（…/exec）のすぐ後ろに、次の行をつなげたもの:');
  Logger.log('?k=' + props.getProperty('PATH_SECRET'));
}

// ===== 1つの知らせ =====

// 順番待ち・表・一時置き場に触れる前に、受け付ける知らせだけに絞る。
// 参加していない人の知らせは、参加の合言葉ちょうどのとき以外は落とす（いたずらで見本の動きを止めないため）
function admitted_(props, joined, event) {
  if (!event || event.mode === 'standby') return false; // 待機中の知らせは何もしない
  if (!event.source || event.source.type !== 'user') return false; // 1対1のやりとりだけ
  if (!fresh_(event)) return false;
  if (event.type === 'follow') return true; // あいさつは返す
  if (joined.indexOf(hash_(props.getProperty('HASH_KEY'), event.source.userId)) >= 0) return true;
  var message = event.message;
  return event.type === 'message' && message.type === 'text' && sameWord_(message.text, props.getProperty('JOIN_WORD'));
}

// 届いた時刻の知らせか（10分より古い・5分より先・時刻の無い知らせは捨てる。合言葉が漏れたとき、作った知らせを過去の日報として入れさせない）
function fresh_(event) {
  var age = Date.now() - Number(event.timestamp);
  return age <= EVENT_OLD_MS && age >= -EVENT_AHEAD_MS;
}

function handleEvent_(ctx, event) {
  var seenKey = 'seen:' + event.webhookEventId;
  if (ctx.cache.get(seenKey)) return; // 同じ知らせの2回目
  ctx.cache.put(seenKey, '1', SEEN_SECONDS);
  ctx.day = stamp_(event.timestamp, 'yyyy/MM/dd');
  try {
    var who = hash_(ctx.hashKey, event.source.userId);
    if (event.type === 'follow') {
      if (!opWithin_(ctx, who)) return;
      return reply_(ctx, event, [textMsg_(MSG.hello)]);
    }
    if (event.type !== 'message') return;
    var message = event.message;
    var joined = joinedList_(ctx.props);
    if (joined.indexOf(who) < 0) {
      if (message.type !== 'text' || !sameWord_(message.text, ctx.joinWord)) return; // admitted_ で絞ってあるので、ふつうは来ない
      if (joined.length >= JOIN_MAX) {
        if (!opWithin_(ctx, who)) return;
        console.log('参加できる人数（' + JOIN_MAX + '人）に達しているので、参加を断りました');
        count_(ctx, '上限で断った', 1);
        return reply_(ctx, event, [textMsg_(MSG.full)]);
      }
      joined.push(who);
      ctx.props.setProperty('JOINED', JSON.stringify(joined));
      return reply_(ctx, event, [chooser_(MSG.joined)]);
    }
    if (message.type === 'text') return onText_(ctx, event, who);
    if (message.type === 'image') return onImage_(ctx, event, who);
    if (!opWithin_(ctx, who)) return;
    count_(ctx, '文と写真以外', 1);
    reply_(ctx, event, [textMsg_(MSG.onlyTextPhoto)]);
  } catch (err) {
    console.log('止まりました: ' + (err && err.message)); // 送られた中身は記録に出さない
    count_(ctx, '止まった', 1);
  }
}

function onText_(ctx, event, who) {
  var text = String(event.message.text).trim();
  var site = siteName_(text);
  var hand = ctx.props.getProperty(TEGAKI_ON) === '1';
  var receipt = receiptOn_(ctx.props);
  if (site) {
    if (!opWithin_(ctx, who)) return;
    ctx.cache.put('site:' + who, site, SITE_MINUTES * 60);
    return reply_(ctx, event, [siteReply_(site, hand, receipt)]);
  }
  if (sameWord_(text, ctx.joinWord)) {
    if (!opWithin_(ctx, who)) return;
    return reply_(ctx, event, [chooser_(MSG.already)]);
  }
  var current = ctx.cache.get('site:' + who);
  if (!current) {
    if (!opWithin_(ctx, who)) return;
    count_(ctx, '現場を選ぶ前', 1);
    return reply_(ctx, event, [chooser_(MSG.choose)]);
  }
  // 6個め: 「手書き」を押したあと10分の写真は、手書きの日報として受け付ける（表には入れない）
  if (hand && sameWord_(text, TEGAKI_KIND)) {
    if (!opWithin_(ctx, who)) return;
    ctx.cache.put('hand:' + who, current, TEGAKI_MINUTES * 60);
    ctx.cache.remove('receipt:' + who); // 「手書き」と「領収書」は、あとから押したほうが効く
    var rec = JSON.parse(ctx.cache.get('cap:' + who) || 'null');
    if (rec && rec.r === 1) ctx.cache.remove('cap:' + who); // レシートの一言の待ちも閉じる（このあとの文を、レシートの一言に吸わせない）
    return reply_(ctx, event, [textMsg_('手書きの日報の写真をどうぞ（' + current + '・' + TEGAKI_MINUTES + '分のあいだ）。')]);
  }
  // 8個め: 「領収書」を押したあと10分の写真は、レシートとして受け付ける（表には入れない）
  if (receipt && sameWord_(text, RYOSHU_KIND)) {
    if (!opWithin_(ctx, who)) return;
    ctx.cache.put('receipt:' + who, current, RYOSHU_MINUTES * 60);
    ctx.cache.remove('hand:' + who);
    return reply_(ctx, event, [textMsg_('レシートの写真をどうぞ（' + current + '・' + RYOSHU_MINUTES + '分のあいだ）。写真のあとに、何に使ったかを一言どうぞ（例: 会議費 打合せのお茶）。')]);
  }
  // 8個め: レシートの写真のあと5分以内の最初の文は、そのレシートの一言（日報の表には入れない。ほぐし機・夕方のメール・まだ番に混ぜない）
  if (receiptCaptionWaiting_(ctx, who, current, event)) {
    if (!opWithin_(ctx, who)) return;
    captionFromText_(ctx, who, current, event, plainText_(text.slice(0, CAPTION_MAX)));
    return reply_(ctx, event, [textMsg_('受け付けました（' + current + '・' + RYOSHU_KIND + 'の一言）')]);
  }
  if (!withinLimit_(ctx, who)) {
    if (!opWithin_(ctx, who)) return;
    count_(ctx, '上限で断った', 1);
    return reply_(ctx, event, [textMsg_(MSG.limit)]);
  }
  var sheet = reportSheet_(book_(ctx));
  if (already_(sheet, event.webhookEventId)) return;
  store_(ctx, sheet, event, who, [current, '日報', plainText_(text.slice(0, MAX_TEXT)), '']);
  rememberSender_(ctx, current, event.source.userId);
  if (ctx.props.getProperty(HOGUSHI_ON) === '1') ctx.props.setProperty(HOGUSHI_PENDING, '1'); // 4個めに読ませる（AI は数秒かかるので、ここでは呼ばない）
  reply_(ctx, event, [textMsg_('受け付けました（' + current + '・日報）')]);
  try {
    captionFromText_(ctx, who, current, event, plainText_(text.slice(0, CAPTION_MAX)));
  } catch (err) {
    console.log('一言を控えられませんでした: ' + (err && err.message)); // 日報と返事は済んでいる
  }
}

// 写真は、受け取ったときは番号だけ控えてすぐ返事する（表もドライブも開かない）。しまうのは、届いたあとに起こす drainPhotos（片付け）。
// まとめて送った写真は、1枚ずつ別の知らせで、順番もばらばらに届く（imageSet に何枚中何枚目か）
function onImage_(ctx, event, who) {
  var set = event.message.imageSet;
  var current = ctx.cache.get('site:' + who);
  // 返事をするときだけ、しまわない操作に数える（まとめて送った写真への返事は1回なので、1回と数える）
  if (!current) {
    count_(ctx, '現場を選ぶ前', 1);
    if (firstInSet_(ctx, set, 'choose') && opWithin_(ctx, who)) reply_(ctx, event, [chooser_(MSG.choose)]);
    return;
  }
  var queue = listProp_(ctx.props, 'QUEUE'); // 片付けが取り出して、しまっている途中の写真も数える
  if (!withinLimit_(ctx, who) || queue.length >= QUEUE_MAX) {
    count_(ctx, '上限で断った', 1);
    if (firstInSet_(ctx, set, 'limit') && opWithin_(ctx, who)) reply_(ctx, event, [textMsg_(MSG.limit)]);
    return;
  }
  var eventId = event.webhookEventId;
  var seen = queue.some(function (item) {
    return item.e === eventId;
  });
  if (seen || listProp_(ctx.props, 'DONE').indexOf(eventId) >= 0) return; // 一時置き場が先に消えたときの2回目
  var receipt = receiptOn_(ctx.props) && ctx.cache.get('receipt:' + who) === current; // 8個め: 「領収書」を押したあと10分
  var hand = !receipt && ctx.props.getProperty(TEGAKI_ON) === '1' && ctx.cache.get('hand:' + who) === current; // 6個め: 「手書き」を押したあと10分
  if (hand && listProp_(ctx.props, TEGAKI_QUEUE).length >= TEGAKI_QUEUE_MAX) {
    count_(ctx, '上限で断った', 1); // AI が止まっているあいだに溜まりすぎない（読めない写真を、表に入れたまま失わない）
    if (firstInSet_(ctx, set, 'handBusy') && opWithin_(ctx, who)) reply_(ctx, event, [textMsg_(MSG.handBusy)]);
    return;
  }
  if (receipt && listProp_(ctx.props, RYOSHU_QUEUE).length >= RYOSHU_QUEUE_MAX) {
    count_(ctx, '上限で断った', 1);
    if (firstInSet_(ctx, set, 'receiptBusy') && opWithin_(ctx, who)) reply_(ctx, event, [textMsg_(MSG.receiptBusy)]);
    return;
  }
  var item = {
    e: eventId,
    m: event.message.id,
    p: (event.message.contentProvider || {}).type,
    t: event.timestamp,
    s: current,
    n: set ? set.index : 1,
    w: who,
    d: ctx.day,
  };
  if (hand) item.k = 1;
  if (receipt) item.k = 2;
  queue.push(item);
  ctx.props.setProperty('QUEUE', JSON.stringify(queue));
  countUp_(ctx, who);
  if (!receipt) rememberSender_(ctx, current, event.source.userId); // レシートは現場の報告ではないので、まだ番の催促の宛先にしない
  try {
    if (!hand) rememberPhoto_(ctx, who, current, event, receipt); // 手書きの日報の写真には、一言を付けない（読んだ文を上書きしない）
  } catch (err) {
    console.log('写真を一言のために覚えられませんでした: ' + (err && err.message)); // 写真は控えてあるので、返事は出す
  }
  ctx.worked = true;
  var kind = receipt ? RYOSHU_KIND : hand ? TEGAKI_KIND : null;
  if (!set) return reply_(ctx, event, [textMsg_(queuedMessage_(current, 1, kind))]);
  if (setComplete_(ctx, set)) reply_(ctx, event, [textMsg_(queuedMessage_(current, set.total, kind))]);
}

// 3個め（日報まだ番）を入れたときだけ、その現場に最後に日報か写真を送った人の LINE の番号を覚える（催促の宛先）。
// 印があっても Mada.gs が無ければ覚えない（3個めをやめた人のところで、番号を覚え続けない）。覚えられなくても、受け付けと返事は止めない
function rememberSender_(ctx, site, userId) {
  if (ctx.props.getProperty(MADA_ON) !== '1' || typeof sendMada !== 'function') return;
  try {
    var senders = JSON.parse(ctx.props.getProperty(SENDERS) || '{}');
    if (senders[site] === userId) return;
    senders[site] = userId;
    ctx.props.setProperty(SENDERS, JSON.stringify(senders));
  } catch (err) {
    console.log('担当を覚えられませんでした: ' + (err && err.message));
  }
}

// kind は、手書き（TEGAKI_KIND）・領収書（RYOSHU_KIND）・ふつうの写真（null）
function queuedMessage_(site, count, kind) {
  if (kind) return '受け付けました（' + site + '・' + kind + count + '枚）。表には2分ほどで入ります。'; // AI が読む分、遅い
  return '受け付けました（' + site + '・写真' + count + '枚）。表には1分ほどで入ります。';
}

// 8個め（Ryoshu.gs）を入れたか（印があっても、ファイルが無ければ入れていないと扱う）
function receiptOn_(props) {
  return props.getProperty(RYOSHU_ON) === '1' && typeof ryoshu_ === 'function';
}

// 8個め: いま届いた文が、レシートの写真のあと5分以内の、同じ現場の最初の文か
function receiptCaptionWaiting_(ctx, who, site, event) {
  var rec = JSON.parse(ctx.cache.get('cap:' + who) || 'null');
  if (!rec || rec.r !== 1 || rec.s !== site) return false;
  return rec.photos.some(function (photo) {
    return event.timestamp - photo.t <= CAPTION_MINUTES * 60000;
  });
}

// ===== 写真のあとの一言 =====

// まだ一言の付いていない写真を、人ごとに覚えておく（同じ現場に続けて送った、同じ種類の写真が、1つのまとまり。receipt はレシートの写真）
function rememberPhoto_(ctx, who, site, event, receipt) {
  var key = 'cap:' + who;
  var rec = JSON.parse(ctx.cache.get(key) || 'null');
  if (!rec || rec.s !== site || (rec.r === 1) !== !!receipt) rec = { s: site, photos: [] };
  if (receipt) rec.r = 1;
  rec.photos.push({ e: event.webhookEventId, t: event.timestamp });
  ctx.cache.put(key, JSON.stringify(rec), SET_SECONDS);
}

// 写真のあと5分以内に、同じ人が同じ現場に送った最初の文を、その写真の一言にする。
// ここでは控えるだけ。表に書くのは drainPhotos（受け取りを遅くしない・しまう前の写真にも入れられる）
function captionFromText_(ctx, who, site, event, caption) {
  var key = 'cap:' + who;
  var rec = JSON.parse(ctx.cache.get(key) || 'null');
  if (!rec) return;
  ctx.cache.remove(key); // 文が来たら、写真のまとまりは閉じる（2つ目の文で上書きしない）
  if (rec.s !== site) return;
  var ids = rec.photos
    .filter(function (photo) {
      return event.timestamp - photo.t <= CAPTION_MINUTES * 60000; // 5分より前の写真には付けない
    })
    .map(function (photo) {
      return photo.e;
    });
  if (ids.length === 0) return;
  var groups = listProp_(ctx.props, 'CAPS');
  var group = { c: caption, s: site, ids: ids, t: event.timestamp };
  if (rec.r === 1) group.r = 1; // レシートの一言（経費の表に入れる）
  groups.push(group);
  ctx.props.setProperty('CAPS', JSON.stringify(groups.slice(-CAPTION_GROUPS)));
}

// 控えた一言のうち、いま表に書けるもの（しまい終わった写真の分）を取り出す。順番待ちの中で呼び、表には触れない。
// まだしまっていない写真・別の回がしまっている途中の写真の分は残す（待つのは30分まで）
function takeCaptions_(props, done, now) {
  var groups = listProp_(props, 'CAPS');
  if (groups.length === 0) return [];
  var finished = {};
  done.forEach(function (id) {
    finished[id] = true;
  });
  var ready = [];
  var left = [];
  groups.forEach(function (group) {
    var waiting = group.ids.filter(function (id) {
      if (!finished[id]) return true;
      ready.push({ s: group.s, e: id, c: group.c, r: group.r });
      return false;
    });
    if (waiting.length > 0 && now - group.t <= CAPTION_WAIT_MINUTES * 60000) {
      var rest = { c: group.c, s: group.s, ids: waiting, t: group.t };
      if (group.r) rest.r = group.r;
      left.push(rest);
    }
  });
  props.setProperty('CAPS', JSON.stringify(left));
  return ready;
}

// 一言を、台帳の内容と、日報のシートの写真の行に入れる。しまえなかった写真（表に無い）の分は、何もしない
function writeCaptions_(ctx, captions) {
  captions.forEach(function (caption) {
    try {
      if (!caption.r) writeCaption_(ctx, caption.s, caption.e, caption.c);
      else if (typeof receiptCaption_ === 'function') receiptCaption_(ctx, caption.e, caption.c); // 8個め: 経費の表の行に入れる
    } catch (err) {
      console.log('一言を表に書けませんでした: ' + (err && err.message));
    }
  });
}

function writeCaption_(ctx, site, eventId, caption) {
  var ss = book_(ctx);
  var sheet = ss.getSheetByName(REPORT_SHEET);
  var row = sheet ? recentRowOf_(sheet, COL_ID, eventId) : 0;
  if (!row) return; // しまえなかった写真
  sheet.getRange(row, COL_CONTENT).setNumberFormat('@').setValue(caption); // '@'＝文のまま（「1-2」を日付に変えさせない）
  var ledger = ss.getSheetByName(LEDGER_PREFIX + site);
  var top = ledger ? rowOf_(ledger, LEDGER_FIRST, 4, eventId) : 0;
  if (top) ledger.getRange(top + 2, 3).setValue(caption);
}

// ===== しまう =====

function store_(ctx, sheet, event, who, values) {
  sheet.appendRow([stamp_(event.timestamp, 'yyyy/MM/dd HH:mm')].concat(values, [event.webhookEventId]));
  countUp_(ctx, who);
  count_(ctx, '受け付けた件数', 1);
  ctx.worked = true;
}

// 一時置き場が先に消えたときのために、表の受付番号でも2回目をはじく
function already_(sheet, eventId) {
  return recentRowOf_(sheet, COL_ID, eventId) > 0;
}

// 日報の下から RECENT_ROWS 行までで、col 列に value がある行の番号（無ければ 0）
function recentRowOf_(sheet, col, value) {
  return rowOf_(sheet, Math.max(2, sheet.getLastRow() - RECENT_ROWS + 1), col, value);
}

// first 行目から下で、col 列に value がある行の番号（無ければ 0）
function rowOf_(sheet, first, col, value) {
  var last = sheet.getLastRow();
  if (last < first) return 0;
  var values = sheet.getRange(first, col, last - first + 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === value) return first + i;
  }
  return 0;
}

// 片付け（届いたあとに受け取りが置く、1回だけ動く自動実行）。控えた写真をLINEから取り出して、現場のフォルダと表にしまい、受付の記録を書く。
// 終わったときに、まだ残っている仕事（止まって戻した写真・待っている一言）があれば、次の片付けを置く。
// 順番待ちは、控えを取り出すときと結果を書くときだけ使う（写真の取り出しは数秒かかるので、その間に受け取りを止めない）。
// 取り出した写真は控えに残したまま印（g）を付け、しまい終わってから外す（途中で止まっても、写真を失わない）
function drainPhotos() {
  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) {
    rewake_(props); // 次の回にまわす（置いた自動実行は1回きりなので、置き直す）
    return;
  }
  var items;
  try {
    clearWake_(props);
    if (!pendingWork_(props)) return; // 何も無い回は書かない
    wake_(props); // 保険: このあと途中で落ちても（表を開けない・時間切れ）、1分後にもう一度片付ける。最後まで済んで仕事が無ければ外す
    // 印の無い写真と、止まった片付けの写真（印が古い）を、この回が取り出す。ほかの回がしまっている写真には触らない
    var queue = listProp_(props, 'QUEUE').map(function (item) {
      return item.g && started - item.g <= TAKEN_STALE_MS ? item : marked_(item, started);
    });
    items = queue.filter(function (item) {
      return item.g === started;
    });
    if (items.length > 0) props.setProperty('QUEUE', JSON.stringify(queue));
  } finally {
    lock.releaseLock();
  }
  var ctx = context_(props);
  var results = items.map(function (item) {
    if (Date.now() - started > DRAIN_BUDGET_MS) return 'later'; // 残りは次の回（控えに残す）
    try {
      return storePhoto_(ctx, item);
    } catch (err) {
      console.log('写真をしまう途中で止まりました: ' + (err && err.message));
      return 'retry';
    }
  });
  if (!lock.tryLock(LOCK_MS * 3)) {
    console.log('写真の結果を書く順番待ちが取れませんでした（' + items.length + ' 件。控えに残してあり、取り出した印が古くなってから、もう一度扱います）');
    rewake_(props);
    return;
  }
  var notes;
  var captions;
  try {
    var resultOf = {};
    items.forEach(function (item, i) {
      resultOf[item.e] = results[i];
    });
    var done = listProp_(props, 'DONE');
    var left = [];
    // いまの控えを読み直して、この回が取り出した写真だけを片付ける（そのあいだに届いた写真・ほかの回の写真は、そのまま残す）
    listProp_(props, 'QUEUE').forEach(function (item) {
      var result = item.g === started ? resultOf[item.e] : undefined;
      if (result === undefined) return left.push(item);
      ctx.day = item.d;
      if (result === 'later') return left.push(marked_(item, 0)); // 時間で残した写真（止まった回数には数えない）
      if (result === 'retry' && (item.r || 0) < 2) {
        var again = marked_(item, 0);
        again.r = (item.r || 0) + 1; // 止まった写真は控えに残して、次の回にしまう（3回まで）
        return left.push(again);
      }
      done.push(item.e);
      if (result === 'stored' || result === 'stored-no-ledger') count_(ctx, '受け付けた件数', 1);
      if (result === 'unreadable') count_(ctx, '写真を取り出せない', 1);
      if (result === 'retry' || result === 'stored-no-ledger') count_(ctx, '止まった', 1);
      if (result === 'unreadable' || result === 'retry') countDown_(ctx, item.w); // しまえなかった写真は、1日の件数から外す
    });
    done = done.slice(-DONE_KEEP);
    props.setProperty('QUEUE', JSON.stringify(left));
    props.setProperty('DONE', JSON.stringify(done));
    captions = takeCaptions_(props, done, Date.now());
    notes = JSON.parse(props.getProperty('NOTES') || '{}');
    props.setProperty('NOTES', '{}');
  } finally {
    lock.releaseLock();
  }
  writeCaptions_(ctx, captions);
  writeNotes_(ctx, notes);
  // 6個めが読んだ文を、同じ回に4個めが分けられるよう、先に読む。6個めが止まっても（鍵が違うなど）、4個めと次の片付けの用意は済ませてから止まる
  var stopped = null;
  try {
    readHandwriting_(props, started);
  } catch (err) {
    stopped = err;
    console.log('手書きすいこみ口で止まりました: ' + (err && err.message)); // 番号と理由の名前だけ（読んだ文・鍵は入らない）
  }
  // 8個め（レシートすいこみ口）も同じ: 止まっても、4個めと次の片付けの用意は済ませてから止まる
  try {
    readReceipts_(props, started);
  } catch (err) {
    stopped = stopped || err;
    console.log('レシートすいこみ口で止まりました: ' + (err && err.message)); // 番号と理由の名前だけ（読んだ値・鍵は入らない）
  }
  readReports_(props);
  // 仕事が残っていれば（止まって戻した写真・しまい終わるのを待っている一言）保険の片付けをそのまま残し、無ければ外す
  if (lock.tryLock(LOCK_MS)) {
    try {
      if (pendingWork_(props)) wake_(props);
      else clearWake_(props);
    } finally {
      lock.releaseLock();
    }
  }
  if (stopped) throw stopped; // 止まったことを、Google から持ち主に届ける
}

// ===== 片付けを起こす（1回だけ動く自動実行） =====

// 片付けの仕事が残っているか（しまう前の写真・表に書く前の件数・表に書く前の一言・4個めに読ませる日報・6個めに読ませる手書きの写真・
// 8個めに読ませるレシートの写真）
function pendingWork_(props) {
  return (
    listProp_(props, 'QUEUE').length > 0 ||
    (props.getProperty('NOTES') || '{}') !== '{}' ||
    listProp_(props, 'CAPS').length > 0 ||
    props.getProperty(HOGUSHI_PENDING) === '1' ||
    listProp_(props, TEGAKI_QUEUE).length > 0 ||
    listProp_(props, RYOSHU_QUEUE).length > 0
  );
}

// 8個め（レシートすいこみ口）に読ませる写真があれば、読ませる。8個めのファイルが無ければ控えを外す（片付けを起こし続けないため。行は「読み取り待ち」のまま）
function readReceipts_(props, started) {
  if (listProp_(props, RYOSHU_QUEUE).length === 0) return;
  if (typeof ryoshu_ !== 'function') {
    props.deleteProperty(RYOSHU_QUEUE);
    console.log('レシートすいこみ口（Ryoshu.gs）が無いので、読む控えを外しました');
    return;
  }
  ryoshu_(props, started);
}

// 6個め（手書きすいこみ口）に読ませる写真があれば、読ませる。6個めのファイルが無ければ控えを外す（片付けを起こし続けないため。行は「読み取り待ち」のまま）
function readHandwriting_(props, started) {
  if (listProp_(props, TEGAKI_QUEUE).length === 0) return;
  if (typeof tegaki_ !== 'function') {
    props.deleteProperty(TEGAKI_QUEUE);
    console.log('手書きすいこみ口（Tegaki.gs）が無いので、読む控えを外しました');
    return;
  }
  tegaki_(props, started);
}

// AI に読ませる写真を、読む控え（6個めは TEGAKI_QUEUE・8個めは RYOSHU_QUEUE）に足す（順番待ちの中で、いまの控えを読み直してから書く）。
// 足せなければ false
function queueForReading_(props, name, max, eventId, fileId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS * 3)) return false;
  try {
    var items = listProp_(props, name);
    var known = items.some(function (item) {
      return item.e === eventId;
    });
    if (known) return true; // 止まってしまい直したときの2回目
    if (items.length >= max + QUEUE_MAX) return false; // 受け付けで断っているので、ふつうは来ない
    items.push({ e: eventId, f: fileId });
    props.setProperty(name, JSON.stringify(items));
    return true;
  } finally {
    lock.releaseLock();
  }
}

// 4個め（日報ほぐし機）に読ませる日報があれば、読ませる。4個めのファイルが無ければ印を外す（片付けを起こし続けないため）
function readReports_(props) {
  if (props.getProperty(HOGUSHI_PENDING) !== '1') return;
  if (typeof hogushi_ !== 'function') {
    props.deleteProperty(HOGUSHI_PENDING);
    console.log('日報ほぐし機（Hogushi.gs）が無いので、読む印を外しました');
    return;
  }
  hogushi_(props);
}

// 1分後に1回だけ動く片付けを置く。置いてあるあいだは置き足さない。置いたまま15分動いていなければ（消えたなど）、外して置き直す。
// 置けなくても止めない（受け取りと返事は済ませる。控えは残るので、次に届いたときに、もう一度置く）
function wake_(props) {
  var at = Number(props.getProperty(WAKE_AT) || 0);
  if (at && Date.now() - at < WAKE_STALE_MS) return;
  try {
    if (at) deleteWakes_();
    ScriptApp.newTrigger(DRAIN).timeBased().after(WAKE_MS).create();
    props.setProperty(WAKE_AT, String(Date.now()));
  } catch (err) {
    console.log('片付けの自動実行を置けませんでした: ' + (err && err.message));
  }
}

// 動き終わった片付けの自動実行を外す（1回きりの自動実行も、外すまで一覧に残る。1つのスクリプトに置ける数には上限がある）。
// 外せなくても「置いてある」の印は消す（残すと、次に届いたときに置き直さず、15分待たせるため）。外せなかった分は、次の片付けで外す
function clearWake_(props) {
  try {
    deleteWakes_();
  } catch (err) {
    console.log('片付けの自動実行を外せませんでした: ' + (err && err.message));
  }
  if (props.getProperty(WAKE_AT)) props.deleteProperty(WAKE_AT);
}

// 控えの写真の写しに、取り出した印を付ける（at が 0 なら外す）
function marked_(item, at) {
  var copy = JSON.parse(JSON.stringify(item));
  if (at) copy.g = at;
  else delete copy.g;
  return copy;
}

function rewake_(props) {
  clearWake_(props);
  wake_(props);
}

function deleteWakes_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === DRAIN) ScriptApp.deleteTrigger(trigger);
  });
}

// 控えた写真を1枚しまう。'stored'（しまった）・'stored-no-ledger'（しまったが、台帳に足せなかった）・
// 'unreadable'（LINEから取り出せない）・'already'（もうしまってある）
function storePhoto_(ctx, item) {
  // 8個め: レシートは、経費の表（日報とは別のファイル）と領収書のフォルダに（Ryoshu.gs）。ファイルが無ければ、ふつうの写真としてしまう（写真を失わない）
  if (item.k === 2 && typeof storeReceipt_ === 'function') return storeReceipt_(ctx, item);
  var sheet = reportSheet_(book_(ctx));
  if (already_(sheet, item.e)) return 'already';
  var file = savePhoto_(ctx, item);
  if (!file) return 'unreadable';
  if (item.k === 1) {
    // 6個め: 手書きの日報は「手書き」の行（内容は AI が読むまで「読み取り待ち」）。台帳には貼らない（工事写真ではないため）。
    // 読む控えに先に足してから行を入れる（行を入れたあとに止まっても、読み取り待ちのまま残らない）。足せなければ、人が写真を見る印
    var queued = queueForReading_(ctx.props, TEGAKI_QUEUE, TEGAKI_QUEUE_MAX, item.e, file.getId());
    sheet.appendRow([stamp_(item.t, 'yyyy/MM/dd HH:mm'), item.s, TEGAKI_KIND, queued ? TEGAKI_WAITING : TEGAKI_FAILED, file.getUrl(), item.e]);
    return 'stored';
  }
  sheet.appendRow([stamp_(item.t, 'yyyy/MM/dd HH:mm'), item.s, '写真', '写真', file.getUrl(), item.e]);
  try {
    addToLedger_(ctx, item, file.getUrl()); // 台帳は日報の表から作る見せ方。ここで止まっても、写真をやり直さない（ドライブに同じ写真を2つ作らない）
  } catch (err) {
    console.log('台帳に足せませんでした: ' + (err && err.message));
    return 'stored-no-ledger';
  }
  return 'stored';
}

// ===== 写真台帳（印刷用の形） =====

// 写真1枚ぶんの枠（4行）を足す。左に小さい版の写真、右に 工事名・送信日時・内容・元の写真
function addToLedger_(ctx, item, url) {
  var sheet = ledgerSheet_(book_(ctx), item.s);
  var top = Math.max(sheet.getLastRow() + 1, LEDGER_FIRST);
  var short = top + LEDGER_LABELS.length - 1 - sheet.getMaxRows(); // 表は1000行で始まる。足りなければ、行を足してから書く
  if (short > 0) sheet.insertRowsAfter(sheet.getMaxRows(), short);
  var values = [projectName_(ctx, item.s), stamp_(item.t, 'yyyy/MM/dd HH:mm'), '', ''];
  sheet.getRange(top, 2, 4, 2).setValues(
    LEDGER_LABELS.map(function (label, i) {
      return [label, values[i]];
    }),
  );
  sheet.getRange(top + 3, 3).setFormula('=HYPERLINK("' + url + '","ドライブで開く")');
  sheet.getRange(top, 4).setValue(item.e); // 見えない列。同じ写真を2回貼らない・一言をあとから入れるための目印
  LEDGER_HEIGHTS.forEach(function (height, i) {
    sheet.setRowHeight(top + i, height);
  });
  sheet.getRange(top, 1, 4, 1).merge();
  sheet.getRange(top, 1, 4, 3).setBorder(true, true, true, true, true, true).setVerticalAlignment('middle');
  sheet.getRange(top, 2, 4, 1).setBackground('#f3f3f3').setFontWeight('bold');
  sheet.getRange(top + 1, 3).setNumberFormat('yyyy/mm/dd hh:mm').setHorizontalAlignment('left');
  sheet.getRange(top + 2, 3).setNumberFormat('@').setWrap(true).setVerticalAlignment('top'); // '@'＝文のまま
  if (!pastePreview_(ctx, sheet, item, top)) {
    sheet.getRange(top, 1).setValue('（写真を貼れませんでした。元の写真は右のリンクから）').setWrap(true).setHorizontalAlignment('center');
  }
}

// LINEの小さい版（プレビュー）を、枠の左に収まる大きさで貼る。取り出せない・2MBを超える・貼れないときは false
function pastePreview_(ctx, sheet, item, top) {
  try {
    var res = UrlFetchApp.fetch(API_DATA + '/message/' + encodeURIComponent(item.m) + '/content/preview', {
      headers: { Authorization: 'Bearer ' + ctx.token },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) return false;
    var blob = res.getBlob();
    if (blob.getBytes().length > MAX_IMAGE_BYTES) return false;
    var image = sheet.insertImage(blob, 1, top, LEDGER_PHOTO.pad, LEDGER_PHOTO.pad);
    var width = image.getWidth();
    var height = image.getHeight();
    var scale = Math.min(LEDGER_PHOTO.width / width, LEDGER_PHOTO.height / height);
    image.setWidth(Math.round(width * scale));
    image.setHeight(Math.round(height * scale));
    return true;
  } catch (err) {
    console.log('台帳に写真を貼れませんでした: ' + (err && err.message));
    return false;
  }
}

// 台帳の工事名は「現場」のシートから（空のあいだは現場の名前）。1回の自動実行で1度だけ読む
function projectName_(ctx, site) {
  if (!ctx.projects) {
    ctx.projects = {};
    var sheet = book_(ctx).getSheetByName(SITE_SHEET);
    var last = sheet ? sheet.getLastRow() : 0;
    if (last >= 2) {
      sheet.getRange(2, 1, last - 1, 2).getValues().forEach(function (row) {
        ctx.projects[String(row[0])] = String(row[1]).trim();
      });
    }
  }
  return ctx.projects[site] || site;
}

function ledgerSheet_(ss, site) {
  var name = LEDGER_PREFIX + site;
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  sheet = ss.insertSheet(name);
  sheet.getRange(1, 1).setValue('工事写真台帳　' + site + '（見本・架空の会社のデータ）').setFontSize(14).setFontWeight('bold');
  sheet.getRange(2, 1).setValue('送信日時は、LINEで送った時刻です。').setFontColor('#666666');
  sheet.setFrozenRows(2);
  [LEDGER_PHOTO.width + LEDGER_PHOTO.pad * 2, 80, 260, 120].forEach(function (width, i) {
    sheet.setColumnWidth(i + 1, width);
  });
  sheet.hideColumns(4);
  return sheet;
}

// LINEから写真の中身を取り出せたときだけ、フォルダ（渡さなければ現場のフォルダ）にしまう（作り話の番号では取り出せない）
function savePhoto_(ctx, item, folder) {
  if (item.p !== 'line') return null;
  var res = UrlFetchApp.fetch(API_DATA + '/message/' + encodeURIComponent(item.m) + '/content', {
    headers: { Authorization: 'Bearer ' + ctx.token },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return null;
  var blob = res.getBlob().setName(stamp_(item.t, 'yyyyMMdd_HHmmss') + '_' + item.s + '_' + item.n + '.jpg');
  return (folder || siteFolder_(ctx.props, item.s)).createFile(blob);
}

// まとめて送った写真が、全部控えにそろったときに1回だけ true
function setComplete_(ctx, set) {
  var key = 'set:' + set.id;
  var count = Number(ctx.cache.get(key) || 0) + 1;
  ctx.cache.put(key, String(count), SET_SECONDS);
  if (count < set.total || ctx.cache.get(key + ':done')) return false;
  ctx.cache.put(key + ':done', '1', SET_SECONDS);
  return true;
}

// まとめて送った写真への同じ返事は、1回だけにする
function firstInSet_(ctx, set, kind) {
  if (!set) return true;
  var key = 'once:' + kind + ':' + set.id;
  if (ctx.cache.get(key)) return false;
  ctx.cache.put(key, '1', SET_SECONDS);
  return true;
}

// ===== 1日の上限（全体100件・1人30件。日本時間の日付で数え直す） =====

function counts_(ctx) {
  var counts = JSON.parse(ctx.props.getProperty('COUNTS') || '{}');
  return counts.day === ctx.day ? counts : { day: ctx.day, all: 0, users: {} };
}

function withinLimit_(ctx, who) {
  var counts = counts_(ctx);
  return counts.all < LIMIT_ALL && (counts.users[who] || 0) < LIMIT_USER;
}

// しまわない操作（現場を選ぶ・スタンプ・合言葉の送り直し・上限で断るなど）を、1人1日60回まで数える。超えたら false（返事もせずに捨てる。
// 連打で、無料のアカウントの1日の上限を使わせない）。受付の記録には、超えた最初の1回だけ残す。数えは一時置き場に置く（6時間あくと消える）
function opWithin_(ctx, who) {
  var key = 'ops:' + ctx.day + ':' + who;
  var used = Number(ctx.cache.get(key) || 0);
  if (used > LIMIT_OPS) return false;
  ctx.cache.put(key, String(used + 1), SEEN_SECONDS);
  if (used < LIMIT_OPS) return true;
  count_(ctx, '上限で断った', 1);
  return false;
}

function countUp_(ctx, who) {
  var counts = counts_(ctx);
  counts.all += 1;
  counts.users[who] = (counts.users[who] || 0) + 1;
  ctx.props.setProperty('COUNTS', JSON.stringify(counts));
}

// その日の数えが残っているときだけ減らす（日が変わっていたら、何もしない）
function countDown_(ctx, who) {
  var counts = JSON.parse(ctx.props.getProperty('COUNTS') || '{}');
  if (counts.day !== ctx.day) return;
  counts.all = Math.max(0, counts.all - 1);
  counts.users[who] = Math.max(0, (counts.users[who] || 0) - 1);
  ctx.props.setProperty('COUNTS', JSON.stringify(counts));
}

// ===== 受付の記録（件数とはじいた理由だけ。中身は残さない） =====

// 受け取るたびには表に書かず、鍵の置き場で数えておく（受け取りを2秒より速くするため）。表に書くのは drainPhotos
function count_(ctx, column, amount) {
  var notes = JSON.parse(ctx.props.getProperty('NOTES') || '{}');
  var day = ctx.day || Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd');
  var row = notes[day] || (notes[day] = {});
  row[column] = column === '最長の処理（秒）' ? Math.max(row[column] || 0, Math.round(amount * 10) / 10) : (row[column] || 0) + amount;
  ctx.props.setProperty('NOTES', JSON.stringify(notes));
}

function writeNotes_(ctx, notes) {
  var days = Object.keys(notes);
  if (days.length === 0) return;
  var sheet = logSheet_(book_(ctx));
  days.forEach(function (day) {
    var row = logRow_(sheet, day);
    Object.keys(notes[day]).forEach(function (column) {
      var cell = sheet.getRange(row, LOG_HEADERS.indexOf(column) + 1);
      var now = Number(cell.getValue()) || 0;
      var amount = notes[day][column];
      cell.setValue(column === '最長の処理（秒）' ? Math.max(now, amount) : now + amount);
    });
  });
}

function logRow_(sheet, day) {
  var last = sheet.getLastRow();
  if (last >= 2) {
    var days = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = days.length - 1; i >= 0; i--) {
      var value = days[i][0];
      if ((value instanceof Date ? Utilities.formatDate(value, TZ, 'yyyy/MM/dd') : String(value)) === day) return i + 2;
    }
  }
  sheet.appendRow(
    [day].concat(
      LOG_HEADERS.slice(1).map(function () {
        return 0;
      }),
    ),
  );
  return sheet.getLastRow();
}

// ===== 表とフォルダ =====

function book_(ctx) {
  if (!ctx.ss) ctx.ss = SpreadsheetApp.openById(ctx.props.getProperty('SHEET_ID'));
  return ctx.ss;
}

// 全部の現場の日報と写真が、届いた順に1行ずつ入る（現場は列）
function reportSheet_(ss) {
  var sheet = ss.getSheetByName(REPORT_SHEET);
  if (sheet) return sheet;
  sheet = ss.insertSheet(REPORT_SHEET);
  sheet.appendRow(HEADERS);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#e8eef7');
  sheet.getRange(2, 1, 999, 1).setNumberFormat('yyyy/mm/dd hh:mm');
  textColumn_(sheet);
  [140, 70, 60, 360, 260, 110].forEach(function (width, i) {
    sheet.setColumnWidth(i + 1, width);
  });
  return sheet;
}

// 「内容」の列は、文のまま入れる（「1-2」や「007」を、表が日付や数に読み替えないように）
function textColumn_(sheet) {
  sheet.getRange(2, COL_CONTENT, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
}

// 現場の一覧。工事名は使う人が入れる（写真台帳の工事名になる）。2回目からは、足りない現場の行だけ足す
function siteList_(ss) {
  var sheet = ss.getSheetByName(SITE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SITE_SHEET);
    sheet.appendRow(SITE_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, SITE_HEADERS.length).setFontWeight('bold').setBackground('#e8eef7');
    [100, 300].forEach(function (width, i) {
      sheet.setColumnWidth(i + 1, width);
    });
  }
  SITES.forEach(function (site) {
    if (!rowOf_(sheet, 2, 1, site)) sheet.appendRow([site, '']);
  });
  return sheet;
}

function logSheet_(ss) {
  var sheet = ss.getSheetByName(LOG_SHEET);
  if (sheet) return sheet;
  sheet = ss.insertSheet(LOG_SHEET);
  sheet.appendRow(LOG_HEADERS);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, LOG_HEADERS.length).setFontWeight('bold').setBackground('#e8eef7');
  sheet.getRange(2, 1, 999, 1).setNumberFormat('yyyy/mm/dd');
  return sheet;
}

function siteFolder_(props, site) {
  var root = DriveApp.getFolderById(props.getProperty('FOLDER_ID'));
  var found = root.getFoldersByName(site);
  return found.hasNext() ? found.next() : root.createFolder(site);
}

// ===== LINEとのやりとり =====

// 返事（Reply）だけを使う。失敗してもお知らせ（Push）では送り直さず、受付の記録に残す
function reply_(ctx, event, messages) {
  if (!event.replyToken) return;
  var res = UrlFetchApp.fetch(API + '/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ctx.token },
    payload: JSON.stringify({ replyToken: event.replyToken, messages: messages }),
    muteHttpExceptions: true,
  });
  ctx.worked = true;
  if (res.getResponseCode() !== 200) count_(ctx, '返事の失敗', 1);
}

function textMsg_(text) {
  return { type: 'text', text: text };
}

// 現場を選ぶボタン（クイックリプライ）つきの返事。押すと「現場1」などの文が送られる
function chooser_(text) {
  return {
    type: 'text',
    text: text,
    quickReply: {
      items: SITES.map(function (site) {
        return { type: 'action', action: { type: 'message', label: site, text: site } };
      }),
    },
  };
}

// 現場を選んだときの返事。6個め・8個めを入れていれば、「手書き」「領収書」のボタンも付ける
function siteReply_(site, hand, receipt) {
  var text = site + 'で受け付けます。日報や写真をどうぞ。';
  if (hand && receipt) return kindButtons_(text + '紙の日報は「' + TEGAKI_KIND + '」、レシートは「' + RYOSHU_KIND + '」を押してから写真を送ってください。', [TEGAKI_KIND, RYOSHU_KIND]);
  if (hand) return kindButtons_(text + '紙の日報は「' + TEGAKI_KIND + '」を押してから写真を送ってください。', [TEGAKI_KIND]);
  if (receipt) return kindButtons_(text + 'レシートは「' + RYOSHU_KIND + '」を押してから写真を送ってください。', [RYOSHU_KIND]);
  return textMsg_(text);
}

// 「手書き」「領収書」のボタン（クイックリプライ）つきの返事。押すと、その字の文が送られる
function kindButtons_(text, kinds) {
  return {
    type: 'text',
    text: text,
    quickReply: {
      items: kinds.map(function (kind) {
        return { type: 'action', action: { type: 'message', label: kind, text: kind } };
      }),
    },
  };
}

function botUserId_(props) {
  var id = props.getProperty('BOT_USER_ID');
  if (id) return id;
  var bot = botInfo_(props.getProperty('LINE_TOKEN'));
  if (!bot) return null;
  props.setProperty('BOT_USER_ID', bot.userId);
  return bot.userId;
}

function botInfo_(token) {
  if (!token) return null;
  var res = UrlFetchApp.fetch(API + '/info', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null;
}

// ===== 小さな道具 =====

function context_(props) {
  return {
    props: props,
    token: props.getProperty('LINE_TOKEN'),
    joinWord: props.getProperty('JOIN_WORD'),
    hashKey: props.getProperty('HASH_KEY'),
    cache: CacheService.getScriptCache(),
    ss: null, // 表は、要るときだけ開く
    projects: null, // 現場ごとの工事名（台帳に入れるときだけ読む）
    day: null,
    worked: false, // 返事をした・しまった・控えた（かかった秒数を残す）
  };
}

function parseBody_(e) {
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return null;
  }
}

// 送った人の番号は、鍵つきで変換した値だけを使う（シートには書かない）
function hash_(hashKey, userId) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(userId), hashKey)).slice(0, 16);
}

// 参加の合言葉は、打ち方の違い（頭の大文字・全角・長音の「ー」・空白）をならしてから比べる（スマホで打つと変わるため）
function sameWord_(text, word) {
  return !!word && normalizeWord_(text) === normalizeWord_(word);
}

function normalizeWord_(text) {
  return String(text)
    .replace(/[！-～]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    })
    .replace(/[ー−‐―–—]/g, '-')
    .replace(/\s+/g, '')
    .toLowerCase();
}

// 「=」「+」「-」「@」で始まる文は、表の中で計算式として動くので、頭に「'」を付けて文のまま入れる（「'」は表には出ない）
function plainText_(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function joinedList_(props) {
  return listProp_(props, 'JOINED');
}

function listProp_(props, name) {
  return JSON.parse(props.getProperty(name) || '[]');
}

// 「現場１」のような全角の数字も受け付ける
function siteName_(text) {
  var normalized = text.replace(/[０-９]/g, function (d) {
    return String.fromCharCode(d.charCodeAt(0) - 0xfee0);
  });
  return SITES.indexOf(normalized) >= 0 ? normalized : null;
}

function stamp_(timestamp, format) {
  return Utilities.formatDate(new Date(timestamp), TZ, format);
}
