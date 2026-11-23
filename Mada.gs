/**
 * 事務員の仕事を100個奪う猫｜ネコの手 3個め「日報まだ番」（架空の工務店A社の見本）— 毎日夕方、今日の日報が無い現場の担当に LINE で催促し、事務の人に「まだの現場」をメールで知らせる
 * データはすべて架空。実在の会社の仕組みではない。
 *
 * 1個め（Code.gs・日報すいこみ口）と2個め（Yugata.gs・日報ゆうがた便）と同じスクリプトに、このファイルを足して使う
 * （表の番号 SHEET_ID・現場の SITES・日本時間 TZ・今日の日報の拾い方・「設定」のシート・LINE の鍵 LINE_TOKEN を共有する）。
 * 最初に1回、スクリプトの画面から setupMada を動かす: 「現場」のシートに「今日は動く」の列（チェックの箱）、「設定」のシートに
 * 「まだ番の知らせ先」の欄を作り、毎日18時台の自動実行を付ける。知らせ先は「まだ番の知らせ先」の右のマスに入れる（カンマか読点で区切れば何人にでも）。
 *
 * 担当は、その現場に最後に日報か写真を送った人。setupMada のあと、1個めが現場ごとに覚えはじめる
 * （LINE の番号は、表を共有した人には見えないスクリプトの鍵の置き場に持ち、表には書かない）。一度も届いていない現場は、担当が分からない。
 * 数えるのは文の日報と手書きの日報（6個め）だけ（写真だけの現場には催促する）。4個め（日報ほぐし機）が「中身なし」の印を付けた日報も数えない。「今日は動く」の印を外した現場と、日曜は送らない。
 * 催促は LINE のお知らせ（Push）で、無料の月200通（宛先の人数で数える）を使う。残りは問い合わせずに送り、断られた現場は事務の人への一覧に書く。
 * 催促を受け取った人は、30分のあいだ、その現場を選んだことにする（そのまま日報を返せる）。全部の現場に届いている日は、何も送らない。
 * 事務の人へのメールの送信の上限（無料のアカウントは1日100人ぶん）の残りが足りない日は、催促も送らずに止まる（止まったことは Google から持ち主に届く）。
 * 記録（console.log）には件数だけを出し、LINE の番号・知らせ先・日報の中身は出さない。
 */

var MADA = 'sendMada'; // 毎日の自動実行で動かす関数
var MADA_HOUR = 18;
var MADA_NAME = '日報まだ番'; // メールの差出人の名前
var MADA_TO_LABEL = 'まだ番の知らせ先';
var ACTIVE_HEADER = '今日は動く'; // 「現場」のシートの、チェックの箱の列
var MADA_STATES = {
  sent: '担当に催促を送りました',
  failed: '催促を送れませんでした。電話でお願いします',
  unknown: '担当がまだ分かりません。この現場から一度も届いていません',
};

// 最初に1回だけ、スクリプトの画面から動かす（1個めの setup のあと）。2回目に動かしても、自動実行・列は増えず、外した印と知らせ先も消さない
function setupMada() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_ID')) throw new Error('先に1個めの setup を動かしてください（日報の表がまだありません）');
  var ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  activeMarks_(siteList_(ss));
  settingRow_(settingsSheet_(ss), MADA_TO_LABEL);
  props.setProperty(MADA_ON, '1');
  var has = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === MADA;
  });
  if (!has) ScriptApp.newTrigger(MADA).timeBased().everyDays(1).atHour(MADA_HOUR).inTimezone(TZ).create();
  Logger.log('準備ができました。毎日' + MADA_HOUR + '時台に、今日の日報が無い現場の担当に催促します（日曜は送りません）');
  Logger.log('担当は、このあと各現場に日報か写真を送った人から覚えます。休みの現場は「' + SITE_SHEET + '」のシートの「' + ACTIVE_HEADER + '」の印を外してください');
  Logger.log('知らせ先は、表の「' + SETTINGS_SHEET + '」のシートの「' + MADA_TO_LABEL + '」の右のマスに入れてください: ' + ss.getUrl());
}

// 毎日18時台の自動実行（setupMada が作る）。スクリプトの画面から手で動かせば、その場で催促する
function sendMada() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) throw new Error('先に1個めの setup を動かしてください（日報の表がまだありません）');
  var now = new Date(Date.now());
  var day = Utilities.formatDate(now, TZ, 'yyyy/MM/dd');
  // その日付の曜日（日本時間の日付を、同じ時間帯で読み直して数える）
  if (new Date(day).getDay() === 0) {
    console.log('日報まだ番: 日曜なので送りません');
    return;
  }
  var ss = SpreadsheetApp.openById(sheetId);
  var active = activeSites_(ss);
  var reported = {};
  todaysReports_(ss, day).forEach(function (report) {
    if (!report.empty) reported[report.site] = true; // 中身なし（「いま書くとこ」など。4個めの印）は、届いていないと数える
  });
  var missing = active.filter(function (site) {
    return !reported[site];
  });
  if (missing.length === 0) {
    console.log('日報まだ番: 印のある現場の今日の日報は、全部届いています（送りません）');
    return;
  }
  var to = settingAddresses_(ss, MADA_TO_LABEL, 'setupMada');
  // 催促だけ届いて、事務の人に一覧が届かない形にしない（残りの数は、宛先の人数で数える）
  if (MailApp.getRemainingDailyQuota() < to.length) throw new Error('今日のメールの送信の上限に達したので、日報まだ番を動かせませんでした（催促も送っていません）');
  var results = remind_(props, missing, now);
  var mail = madaMail_(ss, results, now);
  MailApp.sendEmail({ to: to.join(','), subject: mail.subject, body: mail.body, name: MADA_NAME });
  var count = function (state) {
    return results.filter(function (result) {
      return result.state === state;
    }).length;
  };
  console.log('日報まだ番: まだ ' + missing.length + ' 現場（催促 ' + count('sent') + '・送れず ' + count('failed') + '・担当が分からない ' + count('unknown') + '）');
}

// 「現場」のシートの「今日は動く」の列（無ければ足す）。印の無い行（足したばかりの現場）には、チェックの箱を付けて印を入れる
function activeMarks_(sheet) {
  var col = headerColumn_(sheet, ACTIVE_HEADER);
  if (!col) {
    col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue(ACTIVE_HEADER).setFontWeight('bold').setBackground('#e8eef7');
  }
  for (var row = 2; row <= sheet.getLastRow(); row++) {
    var cell = sheet.getRange(row, col);
    if (cell.getValue() === '') cell.insertCheckboxes().setValue(true);
  }
}

// 1行目で name の書いてある列の番号（無ければ 0）
function headerColumn_(sheet, name) {
  var cols = sheet.getLastColumn();
  if (cols < 1) return 0;
  return sheet.getRange(1, 1, 1, cols).getValues()[0].indexOf(name) + 1;
}

// 「今日は動く」に印のある現場（「現場」のシートの順）
function activeSites_(ss) {
  var sheet = ss.getSheetByName(SITE_SHEET);
  var col = sheet ? headerColumn_(sheet, ACTIVE_HEADER) : 0;
  if (!col) throw new Error('「' + SITE_SHEET + '」のシートに「' + ACTIVE_HEADER + '」の列がありません。先に setupMada を動かしてください');
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet
    .getRange(2, 1, last - 1, col)
    .getValues()
    .filter(function (row) {
      return row[col - 1] === true && SITES.indexOf(String(row[0])) >= 0;
    })
    .map(function (row) {
      return String(row[0]);
    });
}

// まだの現場ごとに、最後に送った人へ催促する。返すのは [{ site, state: 'sent'・'failed'・'unknown' }]
function remind_(props, missing, now) {
  var senders = JSON.parse(props.getProperty(SENDERS) || '{}');
  var token = props.getProperty('LINE_TOKEN');
  var hashKey = props.getProperty('HASH_KEY');
  var cache = CacheService.getScriptCache();
  var date = Utilities.formatDate(now, TZ, 'M/d');
  return missing.map(function (site) {
    var userId = senders[site];
    if (!userId) return { site: site, state: 'unknown' };
    if (!pushText_(token, userId, reminderText_(site, date))) return { site: site, state: 'failed' };
    try {
      cache.put('site:' + hash_(hashKey, userId), site, SITE_MINUTES * 60); // 1個めと同じ「選んだ現場」の覚え方
    } catch (err) {
      console.log('選んだ現場を覚えられませんでした: ' + (err && err.message)); // 催促は届いている
    }
    return { site: site, state: 'sent' };
  });
}

// 催促の文
function reminderText_(site, date) {
  return ['【' + site + '】今日の日報がまだです（' + date + '）', 'いつものように、今日の作業を一言送ってください。', 'このままここに送れば、' + site + 'の日報になります（' + SITE_MINUTES + '分以内）。'].join('\n');
}

// LINE のお知らせ（Push）を1通。断られても止まらない（番号だけ記録に出す）。送り直しても2通にならないよう、送るたびの番号を付ける
function pushText_(token, to, text) {
  try {
    var res = UrlFetchApp.fetch(API + '/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, 'X-Line-Retry-Key': Utilities.getUuid() },
      payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    if (code !== 200) console.log('催促を送れませんでした（番号 ' + code + '）'); // 429 は、無料の通数の上限か、送る回数の上限
    return code === 200;
  } catch (err) {
    console.log('催促を送れませんでした: ' + (err && err.message));
    return false;
  }
}

// 事務の人への一覧（まだの現場ごとに、催促できたか・できなかったか・担当が分からないか）
function madaMail_(ss, results, now) {
  var lines = results.map(function (result) {
    return '・' + result.site + '（' + MADA_STATES[result.state] + '）';
  });
  return {
    subject:
      'まだの現場: ' +
      results
        .map(function (result) {
          return result.site;
        })
        .join('・') +
      '（' +
      Utilities.formatDate(now, TZ, 'M/d') +
      '）',
    body: '今日の日報がまだの現場（' + Utilities.formatDate(now, TZ, 'HH:mm') + ' の時点）:\n' + lines.join('\n') + '\n\nこのあと届いた分は、表で見られます:\n' + ss.getUrl(),
  };
}
