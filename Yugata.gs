/**
 * 事務員の仕事を100個奪う猫｜ネコの手 2個め「日報ゆうがた便」（架空の工務店A社の見本）— 毎日夕方、今日の日報を現場ごとに並べて、1通のメールで送る
 * データはすべて架空。実在の会社の仕組みではない。
 *
 * 1個め（Code.gs・日報すいこみ口）と同じスクリプトに、このファイルを足して使う（表の番号 SHEET_ID・現場の SITES・日本時間 TZ・
 * 日報のシートの形 HEADERS を共有する）。最初に1回、スクリプトの画面から setupYugata を動かす: 表に「設定」のシートを作り、
 * 毎日17時台の自動実行を付ける。送り先は「設定」のシートの「ゆうがた便の送り先」の右のマスに入れる（カンマか読点で区切れば何人にでも）。
 *
 * 自動実行の時刻は、Google の決まりで1時間の幅（17時から18時のあいだのどこか）になる。
 * メールに入るのは、動いた時点までに届いた今日の日報だけ（写真の行は入れない）。そのあとに届いた分は、メールの下のリンクから表で見る。
 * 日報の無い現場は「まだ届いていません」と書き、全部の現場に無い日も送る（届いていないことが分かるように）。
 * 送るのは1日1通。メールの送信の上限（無料のアカウントは1日100人ぶん。宛先の人数で数える）の残りが足りない日は、送らずに止まる（止まったことは Google から持ち主に届く）。
 * 記録（console.log）には件数だけを出し、日報の中身と送り先は出さない。
 */

var YUGATA = 'sendYugata'; // 毎日の自動実行で動かす関数
var YUGATA_HOUR = 17;
var YUGATA_NAME = '日報ゆうがた便'; // メールの差出人の名前
var YUGATA_NONE = 'まだ届いていません';
var SETTINGS_SHEET = '設定'; // 1行に1つ、A列に項目・B列に値（このあとの道具も、ここに行を足す）
var YUGATA_TO_LABEL = 'ゆうがた便の送り先';
var EMAIL_PATTERN = /^[^\s@,、]+@[^\s@,、]+\.[^\s@,、]+$/;

// 最初に1回だけ、スクリプトの画面から動かす（1個めの setup のあと）。2回目に動かしても、自動実行は増えず、入れた送り先も消さない
function setupYugata() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_ID')) throw new Error('先に1個めの setup を動かしてください（日報の表がまだありません）');
  var ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  settingRow_(settingsSheet_(ss), YUGATA_TO_LABEL);
  var has = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === YUGATA;
  });
  if (!has) ScriptApp.newTrigger(YUGATA).timeBased().everyDays(1).atHour(YUGATA_HOUR).inTimezone(TZ).create();
  Logger.log('準備ができました。毎日' + YUGATA_HOUR + '時台に、今日の日報をメールで送ります');
  Logger.log('送り先は、表の「' + SETTINGS_SHEET + '」のシートの「' + YUGATA_TO_LABEL + '」の右のマスに入れてください: ' + ss.getUrl());
}

// 毎日17時台の自動実行（setupYugata が作る）。スクリプトの画面から手で動かせば、その場で送る
function sendYugata() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('先に1個めの setup を動かしてください（日報の表がまだありません）');
  var ss = SpreadsheetApp.openById(sheetId);
  var to = yugataRecipients_(ss);
  var mail = yugataMail_(ss, new Date(Date.now()));
  // 残りの数は、通数ではなく宛先の人数で数える（Google の決まり）
  if (MailApp.getRemainingDailyQuota() < to.length) throw new Error('今日のメールの送信の上限に達したので、日報ゆうがた便を送れませんでした');
  MailApp.sendEmail({ to: to.join(','), subject: mail.subject, body: mail.body, name: YUGATA_NAME });
  console.log('日報ゆうがた便を送りました（今日の日報 ' + mail.count + ' 件）');
}

// 「設定」のシートの送り先
function yugataRecipients_(ss) {
  return settingAddresses_(ss, YUGATA_TO_LABEL, 'setupYugata');
}

// 「設定」のシートの、その項目の右のマスのメールアドレス（カンマか読点で区切れば何人でも）。3個め（Mada.gs）も使う。
// 空・メールアドレスでないものがあれば止まる（どれが違うかは、何番目かだけ言う。アドレスは記録に出さない）
function settingAddresses_(ss, label, setupName) {
  var sheet = ss.getSheetByName(SETTINGS_SHEET);
  var row = sheet ? rowOf_(sheet, 1, 1, label) : 0;
  if (!row) throw new Error('「' + SETTINGS_SHEET + '」のシートに「' + label + '」の欄がありません。先に ' + setupName + ' を動かしてください');
  var list = String(sheet.getRange(row, 2).getValue())
    .split(/[,、\s]+/)
    .filter(function (address) {
      return address !== '';
    });
  if (list.length === 0) throw new Error('「' + SETTINGS_SHEET + '」のシートの「' + label + '」の右に、送り先のメールアドレスを入れてください');
  list.forEach(function (address, i) {
    if (!EMAIL_PATTERN.test(address)) throw new Error('「' + label + '」の ' + (i + 1) + ' 番目が、メールアドレスの形ではありません');
  });
  return list;
}

// 今日の日報（写真の行は除く）を、現場1〜4の順に、それぞれ届いた順に並べた1通
function yugataMail_(ss, now) {
  var bySite = {};
  SITES.forEach(function (site) {
    bySite[site] = [];
  });
  var count = 0;
  todaysReports_(ss, Utilities.formatDate(now, TZ, 'yyyy/MM/dd')).forEach(function (report) {
    if (!bySite[report.site]) return; // 一覧に無い現場（表を手で直した行など）は入れない
    bySite[report.site].push(report.time + ' ' + report.text);
    count++;
  });
  var sections = SITES.map(function (site) {
    return '【' + site + '】\n' + (bySite[site].length > 0 ? bySite[site].join('\n') : YUGATA_NONE);
  });
  return {
    subject: '今日の日報（' + Utilities.formatDate(now, TZ, 'M/d') + '）',
    body: sections.join('\n\n') + '\n\nこのあと届いた分は、表で見られます:\n' + ss.getUrl(),
    count: count,
  };
}

// 日報のシートの、その日の「日報」と「手書き」の行
function todaysReports_(ss, day) {
  return reportsBetween_(ss, day, day);
}

// 日報のシートの、from から to までの日（どちらも 'yyyy/MM/dd'・その日を含む）の「日報」と「手書き」の行。受付日時のマスは、日時の値でも文でも読む。
// 4個め（日報ほぐし機）を入れていれば、作業の内容が無い日報に empty の印（3個めは、届いていないと数える）。row は表の行の番号（7個めが人数を読む）
function reportsBetween_(ss, from, to) {
  var sheet = ss.getSheetByName(REPORT_SHEET);
  var last = sheet ? sheet.getLastRow() : 0;
  if (last < 2) return [];
  var stateCol = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].indexOf(HOGUSHI_STATE) + 1;
  return sheet
    .getRange(2, 1, last - 1, Math.max(COL_CONTENT, stateCol))
    .getValues()
    .map(function (row, i) {
      var at = row[0] instanceof Date ? Utilities.formatDate(row[0], TZ, 'yyyy/MM/dd HH:mm') : String(row[0]);
      return { row: i + 2, day: at.slice(0, 10), time: at.slice(11, 16), site: String(row[1]), kind: String(row[2]), text: String(row[3]), empty: stateCol > 0 && row[stateCol - 1] === EMPTY_MARK };
    })
    .filter(function (report) {
      return report.day >= from && report.day <= to && REPORT_KINDS.indexOf(report.kind) >= 0; // 手書き（6個め）も日報として並べる・数える
    });
}

function settingsSheet_(ss) {
  var sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (sheet) return sheet;
  sheet = ss.insertSheet(SETTINGS_SHEET);
  [180, 360].forEach(function (width, i) {
    sheet.setColumnWidth(i + 1, width);
  });
  return sheet;
}

// 項目の行（無ければ、いちばん下に足す）
function settingRow_(sheet, label) {
  var row = rowOf_(sheet, 1, 1, label);
  if (row) return row;
  row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1).setValue(label).setFontWeight('bold');
  sheet.getRange(row, 2).setValue('');
  return row;
}
