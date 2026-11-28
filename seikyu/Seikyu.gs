/** Seikyu.gs — ネコの手 9個め「請求書つくり機」
 *  「請求の一覧」に1行（取引先・内容・金額・税率・期日）を書くと、請求書の PDF がドライブの月のフォルダにでき、
 *  その行に請求番号・PDF のリンク・作った日時が入り、Gmail の下書きに PDF の付いた相手あてのメールができる。
 *
 *  - 1個め〜8個めとは別のスクリプトに、このファイルだけを貼る（LINE も AI も使わない）。スクリプトは、だれとも共有しない
 *  - 前の請求書を元にしない。作るたびに、空の「請求書_ひな形」を写し、宛名を「取引先」のシートから引いて差しこむ
 *  - 差しこんで PDF にする作業は、だれとも共有しない「作業用」の表でやる（表を共有した人が、作りかけの請求書に触れないように）
 *  - メールは下書きまで。このプログラムは、メールを出す命令を持たない（中を確かめて出すのは人）
 *  - 「設定」と「請求書_ひな形」は、持ち主だけが書き換えられる（表を共有した人が、振込先を書き換えられないように）
 *  - 使い方: setupSeikyu を1回動かす →「設定」と「取引先」を入れる →「請求の一覧」に1行 → 10分おきにひとりでに（急ぐときは「今すぐ作る」の箱） */

var TZ = 'Asia/Tokyo';
var BOOK_NAME = '請求書つくり機';
var FOLDER_NAME = '請求書'; // PDF の置き場（この下に、請求日の月ごとのフォルダ）
var OLD_FOLDER = '作り直し前'; // 作り直す前の PDF を移す所（消さない）
var LIST_SHEET = '請求の一覧';
var CUSTOMER_SHEET = '取引先';
var TEMPLATE_SHEET = '請求書_ひな形';
var SETTINGS_SHEET = '設定';
var WORK_NAME = '請求書つくり機（作業用・共有しない）'; // 請求書を作るときだけ使う表（請求の一覧の表とは別。持ち主だけが開ける）
var WORK_NOTE = 'この表は、請求書つくり機が請求書を作るときに使う作業用の表です。共有しないでください。消さないでください（消したら setupSeikyu をもう一度）。';
var TEMP_PREFIX = '（作成中）'; // 作業用の表に、ひな形を写した一時のシートの名前の頭（作り終えたら消す）
var OLD_SUFFIX = '（前のもの・確かめる'; // 準備が、番号の合わない同じ名前のシートに付ける名前のうしろ

// 請求の一覧の形（1行め＝題と「今すぐ作る」の箱、2行め＝見出し、3行めから1行＝請求書1枚）
var HEADER_ROW = 2;
var FIRST_ROW = 3;
var NOW_ROW = 1;
var NOW_COL = 3; // 「今すぐ作る」の箱
var RESULT_COL = 7; // 結果の1行（箱の説明の字は右へはみ出して見えるので、重ならない所まで離す）
var LIST_HEADERS = ['取引先', '内容', '金額（税抜）', '税率', '期日', '請求日', '取引日', '備考', '請求番号', '消費税', '合計（税込）', 'PDF', '作った日時', '下書き', '気になる所', 'やり直し'];
var REQUIRED = ['取引先', '内容', '金額（税抜）', '税率', '期日']; // 人が必ず入れる5つ。そろうまでは作らない
var CUSTOMER_HEADERS = ['取引先', '敬称', '郵便番号', '住所', '担当', 'メール', 'メモ'];

// 上限
var MAX_PER_RUN = 10; // 1回に作る数
var LIMIT_MS = 4 * 60 * 1000; // 1回の時間（過ぎたら、残りは次の回）
var MAX_TRIES = 3; // PDF の作り直し・行への書き戻しをやり直す回数
var LOCK_MS = 1000;
var MAX_AMOUNT = 999999999;
var CONTENT_MAX = 60;
var MAX_LEN = { name: 60, honorific: 6, zip: 12, address: 80, person: 40, tradeDay: 30, memo: 200 }; // 請求書に出る字の長さの上限（超えたら、切らずに知らせる）
var YEAR_MIN = 2000;
var YEAR_MAX = 2100;

// 鍵の置き場（スクリプト プロパティ）に持つもの
var PROP = { book: 'SEIKYU_SHEET_ID', work: 'SEIKYU_WORK_ID', folder: 'SEIKYU_FOLDER_ID', guarded: 'SEIKYU_GUARDED', inv: 'SEIKYU_INV_' };

// 「設定」のシートの項目（左の名前は変えない）
var SETTINGS = [
  ['自社の名前', '', '請求書の発行者と、メールの下書きの最後に出ます（必ず入れる）'],
  ['自社の郵便番号と住所', '', ''],
  ['自社の電話', '', ''],
  ['登録番号', '', '適格請求書発行事業者の登録番号（T と13けたの数字）。空なら請求書に出しません'],
  ['お振込先', '', '例: ◯◯銀行 ◯◯支店 普通 1234567 口座の名義'],
  ['消費税の端数', '切り捨て', '切り捨て・四捨五入・切り上げ のどれか'],
  ['選べる税率', '10%, 8%', '請求の一覧の「税率」に入れられるもの（カンマで区切る）'],
  ['軽減税率', '8%', 'この税率の行には「※」を付けて、下に注記を出します'],
  ['メールの下書き', '作る', '作る・作らない のどちらか'],
  ['請求書の下の一言', '', '請求書のいちばん下に出す一言（空でもよい）'],
];
var ROUNDINGS = ['切り捨て', '四捨五入', '切り上げ'];

// ひな形の差しこみ口（{{名前}}）
var NUMBER = /^\d{6}-\d{3,6}$/; // 請求番号の形（年月＋連番）
var SLOT = /\{\{([^{}]+)\}\}/g;
var NEEDED_SLOTS = ['宛名', '敬称', '請求番号', '請求日', '期日', '取引日', '内容', '税率', '金額', '消費税', '合計', '軽減の注記'];
var KNOWN_SLOTS = NEEDED_SLOTS.concat(['宛先の住所', '担当', '自社の名前', '自社の住所', '自社の電話', '登録番号', '振込先', '備考', '下の一言']);

var NOTE = {
  noCustomer: '取引先の表に無い名前です',
  twoCustomers: '取引先の表に同じ名前が2つあります',
  amount: '金額は1円以上の整数で',
  rate: '税率は「設定」にあるものから',
  due: '期日が日付ではありません',
  issued: '請求日が日付ではありません',
  dueBefore: '期日が請求日より前です',
  content: '内容は60字まで・1行で',
  brace: '「{{」は使えません',
  long: '長すぎる欄があります（取引先60字・敬称6字・郵便番号12字・住所80字・担当40字・取引日30字・備考200字まで）',
  tradeDay: '取引日の日付を確かめてください',
  same: 'ほかの行と同じ請求番号です。コピーした行のほうの、請求番号から右の列を消してください（新しい番号で作ります）',
  sameOrigin: 'ほかの行と同じ請求番号です。この行は元の行です（コピーした行のほうの、請求番号から右の列を消してください）',
  sameCopy: 'ほかの行と同じ請求番号です。この行はコピーした行です。この行の請求番号から右の列を消してください（新しい番号で作ります）',
  nameLine: '取引先の名前は1行で',
  typed: '請求番号の列は空のままにしてください（スクリプトが入れます）',
  edited: '作ったあとに行が直されています（PDF は前のまま）。作り直すなら「やり直し」に印',
  pdfFailed: 'PDF を作れませんでした。「やり直し」に印を付けると、もう一度試します',
  gone: '前の下書きがありません（送ったあとなら、同じ番号で作り直さないでください）',
  unsure: '前の下書きを確かめられませんでした。次の回にもう一度試します',
  unsureStop: '前の下書きを確かめられませんでした。Gmail の許可を見てから、もう一度「やり直し」に印を付けてください',
  noRecord: '前の記録が無いので、作り直せません。新しい行で作ってください',
};
var DRAFT = {
  made: '下書きあり',
  none: '宛先なし',
  off: '下書きは作らない設定',
  bad: 'メールの形ではありません（下書きなし）',
  failed: '下書きを作れませんでした',
  kept: '前の下書きを消せませんでした（Gmail の下書きを見て、もう一度「やり直し」に印を）',
};

// ===== 準備（1回動かす。何回動かしても増えない） =====

function setupSeikyu() {
  var store = PropertiesService.getScriptProperties();
  var ss = existingBook_(store);
  var fresh = !ss;
  if (fresh) {
    ss = SpreadsheetApp.create(BOOK_NAME);
    store.setProperty(PROP.book, ss.getId());
  }
  ss.setSpreadsheetTimeZone(TZ);
  ss.setSpreadsheetLocale('ja_JP');
  var customers = customerSheet_(ss);
  listSheet_(ss, customers);
  var guarded = guardedIds_(store);
  var settings = settingsSheet_(ss, guarded.s);
  var template = templateSheet_(ss, guarded.t);
  store.setProperty(PROP.guarded, JSON.stringify({ s: settings.getSheetId(), t: template.getSheetId() }));
  if (fresh) dropEmptySheets_(ss);
  workBook_(store);
  var folder = usableFolder_(store) || DriveApp.createFolder(FOLDER_NAME);
  store.setProperty(PROP.folder, folder.getId());
  resetTriggers_(ss.getId());
  console.log('準備ができました。請求の一覧の表: ' + ss.getUrl());
  console.log('準備: 請求書の PDF が入るフォルダ: ' + folder.getUrl());
  console.log('準備: 次に、表の「設定」に自分の会社の名前・登録番号・お振込先を、「取引先」に相手を入れてください');
  if (!settingValue_(settings, '登録番号')) {
    console.log('準備: 「設定」の登録番号が空のあいだは、請求書に登録番号を出しません（適格請求書〈インボイス〉の形になりません。登録していなければ、空のままで動きます）');
  }
}

// 請求書を作るときだけ使う、作業用の表（無ければ作る）。だれとも共有しない
function workBook_(store) {
  var work = usableWork_(store);
  if (!work) {
    work = SpreadsheetApp.create(WORK_NAME);
    store.setProperty(PROP.work, work.getId());
    work.getSheets()[0].getRange(1, 1).setValue(WORK_NOTE);
  }
  work.setSpreadsheetTimeZone(TZ); // 請求の一覧の表と同じ設定に（PDF の字の形と日付の扱いをそろえる）
  work.setSpreadsheetLocale('ja_JP');
  return work;
}

function usableWork_(store) {
  var id = store.getProperty(PROP.work);
  if (!id) return null;
  try {
    if (DriveApp.getFileById(id).isTrashed()) return null;
    return SpreadsheetApp.openById(id);
  } catch (e) {
    return null; // 作業用の表が消されていたら、作り直す
  }
}

function settingValue_(sheet, name) {
  var last = sheet.getLastRow();
  var rows = last > 0 ? sheet.getRange(1, 1, last, 2).getValues() : [];
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim() === name) return text_(rows[i][1]).trim();
  return '';
}

function existingBook_(store) {
  var id = store.getProperty(PROP.book);
  if (!id) return null;
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    return null; // 表が消されていたら、作り直す
  }
}

function usableFolder_(store) {
  var id = store.getProperty(PROP.folder);
  if (!id) return null;
  try {
    var folder = DriveApp.getFolderById(id);
    return folder.isTrashed() ? null : folder;
  } catch (e) {
    return null; // フォルダが消されていたら、作り直す
  }
}

function listSheet_(ss, customers) {
  if (ss.getSheetByName(LIST_SHEET)) return;
  var sheet = ss.insertSheet(LIST_SHEET);
  var n = LIST_HEADERS.length;
  sheet.getRange(NOW_ROW, 1).setValue('請求の一覧').setFontSize(13).setFontWeight('bold');
  sheet.getRange(NOW_ROW, NOW_COL).insertCheckboxes().setValue(false).setBackground('#e6f4ea').setHorizontalAlignment('center');
  sheet.getRange(NOW_ROW, NOW_COL + 1).setValue('← 印を付けると、今すぐ作ります').setFontColor('#6b7280').setFontSize(9);
  sheet.getRange(NOW_ROW, RESULT_COL).setFontColor('#1e7e45').setFontSize(9);
  sheet.getRange(HEADER_ROW, 1, 1, n).setValues([LIST_HEADERS]).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#e8eef7');
  sheet.getRange(HEADER_ROW, 1, 1, REQUIRED.length).setBackground('#fff4cc'); // 人が必ず入れる5つ
  var rows = sheet.getMaxRows() - HEADER_ROW;
  var col = function (name) {
    return LIST_HEADERS.indexOf(name) + 1;
  };
  ['内容', '税率', '取引日', '備考', '請求番号', 'PDF', '作った日時', '下書き', '気になる所'].forEach(function (name) {
    sheet.getRange(FIRST_ROW, col(name), rows, 1).setNumberFormat('@'); // 文のまま
  });
  ['金額（税抜）', '消費税', '合計（税込）'].forEach(function (name) {
    sheet.getRange(FIRST_ROW, col(name), rows, 1).setNumberFormat('#,##0');
  });
  ['期日', '請求日'].forEach(function (name) {
    sheet.getRange(FIRST_ROW, col(name), rows, 1).setNumberFormat('yyyy/m/d');
  });
  // 税率は「10%」の字のまま持つ（%の書式にすると、10 と打った値が 1000% に見えるため）。選べるのは、はじめの2つ（打ってもよい）
  sheet.getRange(FIRST_ROW, col('税率'), rows, 1).setHorizontalAlignment('center').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['10%', '8%'], true).setAllowInvalid(true).build());
  // 「やり直し」の箱は、ここでは付けない（先に並べると、箱の「外れている」が値として数えられて、表の最後の行が1,000行めになる）。
  // 請求番号を入れた行にだけ、そのときに付ける
  sheet.getRange(FIRST_ROW, col('やり直し'), rows, 1).setHorizontalAlignment('center');
  // 取引先は、取引先のシートから選べる（打ってもよい。表に無い名前は、作らずに「気になる所」に出る）
  var names = customers.getRange(2, 1, customers.getMaxRows() - 1, 1);
  sheet.getRange(FIRST_ROW, col('取引先'), rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(names, true).setAllowInvalid(true).build());
  sheet.getRange(FIRST_ROW, col('気になる所'), rows, 1).setFontColor('#b3261e');
  [170, 220, 100, 60, 100, 100, 110, 160, 110, 90, 100, 120, 130, 110, 280, 80].forEach(function (width, i) {
    sheet.setColumnWidth(i + 1, width);
  });
  sheet.setFrozenRows(HEADER_ROW);
}

function customerSheet_(ss) {
  var sheet = ss.getSheetByName(CUSTOMER_SHEET);
  if (sheet) return sheet;
  sheet = ss.insertSheet(CUSTOMER_SHEET);
  sheet.getRange(1, 1, 1, CUSTOMER_HEADERS.length).setValues([CUSTOMER_HEADERS]).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#e8eef7');
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, CUSTOMER_HEADERS.length).setNumberFormat('@');
  [200, 70, 100, 280, 160, 220, 200].forEach(function (width, i) {
    sheet.setColumnWidth(i + 1, width);
  });
  sheet.setFrozenRows(1);
  return sheet;
}

// 「設定」のシート。無ければ作り、足りない項目を足して、持ち主だけが書き換えられるようにする
function settingsSheet_(ss, id) {
  var sheet = sheetById_(ss, id);
  if (!sheet) {
    setAside_(ss, SETTINGS_SHEET);
    sheet = ss.insertSheet(SETTINGS_SHEET);
    sheet.appendRow(['項目', '値', '説明']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e8eef7');
    sheet.getRange(1, 2, sheet.getMaxRows(), 1).setNumberFormat('@');
    [200, 320, 460].forEach(function (width, i) {
      sheet.setColumnWidth(i + 1, width);
    });
  }
  var last = sheet.getLastRow();
  var have = last > 0 ? sheet.getRange(1, 1, last, 1).getValues().map(function (row) {
    return String(row[0]);
  }) : [];
  SETTINGS.forEach(function (item) {
    if (have.indexOf(item[0]) < 0) sheet.appendRow(item);
  });
  ownerOnly_(sheet, '発行者・登録番号・お振込先の欄。持ち主だけが書き換えられます（ネコの手の setupSeikyu がかけた保護）');
  return sheet;
}

// 「請求書_ひな形」のシート。無いときだけ作る（自分で直したひな形は、作り直さない）
function templateSheet_(ss, id) {
  var sheet = sheetById_(ss, id);
  if (!sheet) {
    setAside_(ss, TEMPLATE_SHEET);
    sheet = ss.insertSheet(TEMPLATE_SHEET);
    buildTemplate_(sheet);
  }
  ownerOnly_(sheet, '請求書のひな形。持ち主だけが書き換えられます（ネコの手の setupSeikyu がかけた保護）');
  return sheet;
}

// 覚えた番号のシートが無いのに、同じ名前のシートがあるとき。だれが作ったか分からないので、信じずに名前を替えて残す
function setAside_(ss, name) {
  var same = ss.getSheetByName(name);
  if (!same) return;
  var old = name + OLD_SUFFIX + ' ' + stamp_(Date.now()).replace(/[\/: ]/g, '') + '）';
  same.setName(old);
  console.log('準備: 「' + name + '」のシートを新しく作りました。前からあった同じ名前のシートは、使わずに「' + old + '」に名前を替えて残しています。中身を自分の目で確かめてから、要る所だけ写してください');
}

// 保護をかけただけでは、表と同じ人が書き換えられる。持ち主のほかの編集者を外して、はじめて守られる（持ち主は外れない）
function ownerOnly_(sheet, description) {
  var before = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (before.length > 0 && !before.some(ownerOnlyNow_)) {
    console.log('準備: 「' + sheet.getName() + '」のシートの保護がゆるんでいました。締め直しましたが、中身（とくにお振込先）が書き換えられていないかを、自分の目で確かめてください');
  }
  var protection = sheet.protect().setDescription(description).setWarningOnly(false);
  protection.removeEditors(protection.getEditors());
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}

function dropEmptySheets_(ss) {
  var ours = [LIST_SHEET, CUSTOMER_SHEET, TEMPLATE_SHEET, SETTINGS_SHEET];
  ss.getSheets().forEach(function (sheet) {
    if (ours.indexOf(sheet.getName()) < 0 && sheet.getLastRow() === 0) ss.deleteSheet(sheet);
  });
}

function resetTriggers_(bookId) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    var name = trigger.getHandlerFunction();
    if (name === 'makeInvoices' || name === 'onSeikyuEdit') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('makeInvoices').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('onSeikyuEdit').forSpreadsheet(bookId).onEdit().create();
}

// ひな形（A4・縦・4列）。名前・金額・日付は書かず、差しこみ口だけを置く
function buildTemplate_(sheet) {
  var rows = 26;
  var grid = [];
  for (var r = 0; r < rows; r++) grid.push(['', '', '', '']);
  var put = function (row, col, text) {
    grid[row - 1][col - 1] = text;
  };
  put(1, 1, '請　求　書');
  put(3, 1, '{{宛名}} {{敬称}}');
  put(3, 3, '請求番号');
  put(3, 4, '{{請求番号}}');
  put(4, 1, '{{宛先の住所}}');
  put(4, 3, '請求日');
  put(4, 4, '{{請求日}}');
  put(5, 1, '{{担当}}');
  put(5, 3, 'お支払期限');
  put(5, 4, '{{期日}}');
  put(6, 1, '下記のとおりご請求申し上げます。');
  put(8, 1, 'ご請求金額（税込）');
  put(8, 2, '{{合計}}');
  put(8, 3, '{{自社の名前}}');
  put(9, 3, '{{自社の住所}}');
  put(10, 3, '{{自社の電話}}');
  put(11, 3, '{{登録番号}}');
  ['取引日', '内容', '税率', '金額（税抜）'].forEach(function (text, i) {
    put(13, i + 1, text);
  });
  ['{{取引日}}', '{{内容}}', '{{税率}}', '{{金額}}'].forEach(function (text, i) {
    put(14, i + 1, text);
  });
  put(18, 3, '小計（{{税率}}対象）');
  put(18, 4, '{{金額}}');
  put(19, 3, '消費税（{{税率}}）');
  put(19, 4, '{{消費税}}');
  put(20, 3, '合計');
  put(20, 4, '{{合計}}');
  put(22, 1, '{{振込先}}');
  put(23, 1, '{{軽減の注記}}');
  put(24, 1, '{{備考}}');
  put(26, 1, '{{下の一言}}');
  // 先に全部を「文のまま」の書式にする（金額や日付の字を、表が数や日付に読み替えないように）
  sheet.getRange(1, 1, sheet.getMaxRows(), 4).setNumberFormat('@').setFontSize(10).setVerticalAlignment('middle').setWrap(true);
  sheet.getRange(1, 1, rows, 4).setValues(grid);
  var spare = sheet.getMaxColumns() - 4;
  if (spare > 0) sheet.deleteColumns(5, spare); // 使わない列を消す（PDF に空の列を出さない）
  styleTemplate_(sheet);
}

function styleTemplate_(sheet) {
  var line = '#333333';
  var pale = '#eef1f5';
  var solid = SpreadsheetApp.BorderStyle.SOLID;
  sheet.setHiddenGridlines(true);
  [130, 260, 130, 150].forEach(function (width, i) {
    sheet.setColumnWidth(i + 1, width);
  });
  sheet.getRange(1, 1, 1, 4).merge().setFontSize(20).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setRowHeight(1, 48);
  sheet.getRange(3, 1, 1, 2).merge().setFontSize(14).setFontWeight('bold').setBorder(null, null, true, null, null, null, line, solid);
  [4, 5, 6].forEach(function (row) {
    sheet.getRange(row, 1, 1, 2).merge();
  });
  sheet.getRange(3, 3, 3, 1).setFontColor('#6b7280').setFontSize(9).setHorizontalAlignment('right');
  sheet.getRange(3, 4, 3, 1).setHorizontalAlignment('right');
  sheet.getRange(8, 1).setBackground(pale).setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center'); // 「ご請求金額（税込）」が1行に収まる幅と字の大きさ
  sheet.getRange(8, 2).setFontSize(16).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange(8, 1, 1, 2).setBorder(true, true, true, true, null, null, line, solid);
  sheet.setRowHeight(8, 40);
  [8, 9, 10, 11].forEach(function (row) {
    sheet.getRange(row, 3, 1, 2).merge().setHorizontalAlignment('right');
  });
  sheet.getRange(8, 3).setFontWeight('bold');
  sheet.getRange(9, 3, 3, 1).setFontSize(9);
  sheet.getRange(13, 1, 1, 4).setBackground(pale).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange(13, 1, 5, 4).setBorder(true, true, true, true, true, true, '#9aa3ae', solid);
  sheet.getRange(14, 3, 4, 1).setHorizontalAlignment('center');
  sheet.getRange(14, 4, 4, 1).setHorizontalAlignment('right');
  sheet.getRange(18, 3, 3, 2).setBorder(true, true, true, true, true, true, '#9aa3ae', solid);
  sheet.getRange(18, 3, 3, 1).setBackground(pale).setHorizontalAlignment('center');
  sheet.getRange(18, 4, 3, 1).setHorizontalAlignment('right');
  sheet.getRange(20, 3, 1, 2).setFontWeight('bold');
  [22, 23, 24, 26].forEach(function (row) {
    sheet.getRange(row, 1, 1, 4).merge();
  });
  sheet.getRange(22, 1).setBackground(pale);
  sheet.getRange(23, 1).setFontSize(9);
  sheet.getRange(26, 1).setFontSize(9).setFontColor('#6b7280');
}

// ===== 動かす入口（10分おきの自動実行と、「今すぐ作る」の箱） =====

function makeInvoices() {
  return run_(false);
}

// 表を書き換えたときの自動実行。「今すぐ作る」の箱に印が付いたときだけ動く
function onSeikyuEdit(e) {
  if (!e || !e.range) return null;
  if (e.range.getRow() !== NOW_ROW || e.range.getColumn() !== NOW_COL) return null;
  if (e.range.getSheet().getName() !== LIST_SHEET) return null;
  if (String(e.value).toUpperCase() !== 'TRUE') return null;
  return run_(true);
}

function run_(manual) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) {
    if (manual) tellNow_('いま別の回が動いています。少し待ってから、もう一度どうぞ');
    return { made: 0, noted: 0, later: 0, stuck: 0 };
  }
  try {
    var summary = work_();
    report_(summary, manual);
    if (summary.stuck > 0) throw new Error('請求の一覧に書けませんでした（' + summary.stuck + '行）。行やシートの保護・入力の決まりを確かめてください');
    return summary;
  } catch (e) {
    if (manual) tellNow_('止まりました: ' + String((e && e.message) || e));
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// 「今すぐ作る」の箱の印を外して、結果の1行を出す（表が開けないときは、何もしない。止まった理由は、元の知らせで届く）
function tellNow_(text) {
  var ss = existingBook_(PropertiesService.getScriptProperties());
  var list = ss && ss.getSheetByName(LIST_SHEET);
  if (!list) return;
  try {
    list.getRange(NOW_ROW, NOW_COL).setValue(false);
    list.getRange(NOW_ROW, RESULT_COL).setValue(text);
  } catch (e) {
    console.warn('結果の1行を書けませんでした');
  }
}

function report_(summary, manual) {
  var did = summary.made > 0 || summary.noted > 0 || summary.later > 0 || summary.stuck > 0;
  if (did) console.log('請求書つくり機: 作った ' + summary.made + '・気になる所 ' + summary.noted + '・あとでもう一度 ' + summary.later + '・書けなかった ' + summary.stuck);
  if (!manual && summary.made === 0) return;
  var text = summary.made > 0 ? summary.made + '通作りました' : '作る行はありませんでした';
  if (summary.noted > 0) text += '・気になる所のある行 ' + summary.noted;
  if (summary.later > 0) text += '・あとでもう一度作る行 ' + summary.later;
  tellNow_(text + '（' + stamp_(Date.now()) + '）');
}

// ===== 1回ぶんの仕事 =====

function work_() {
  var store = PropertiesService.getScriptProperties();
  var ss = existingBook_(store);
  if (!ss) throw new Error('請求の一覧の表が見つかりません。setupSeikyu を先に動かしてください');
  var list = needSheet_(ss, LIST_SHEET);
  var table = readTable_(list, HEADER_ROW, LIST_HEADERS, LIST_SHEET);
  var ctx = { ss: ss, list: list, col: table.col, store: store, records: recordsOf_(store), used: Object.create(null), started: Date.now(), summary: { made: 0, noted: 0, later: 0, stuck: 0 } };
  ctx.count = Object.create(null); // 請求番号ごとの行の数（行をコピーすると、同じ番号が2行になる）
  table.rows.forEach(function (values) {
    var no = text_(values[table.col['請求番号']]).trim();
    if (no) ctx.count[no] = (ctx.count[no] || 0) + 1;
  });
  ctx.origin = originRows_(ctx, table);
  var states = table.rows.map(function (values, i) {
    return stateOf_(ctx, FIRST_ROW + i, values);
  });
  var active = states.filter(function (state) {
    return state.kind !== 'idle';
  });
  if (active.length === 0) return ctx.summary; // 作る行が無い回は、ここで終わる（10分おきの回を軽くする）

  var guarded = guardedIds_(store);
  ctx.settings = readSettings_(guardedSheet_(ss, guarded.s, SETTINGS_SHEET));
  ctx.template = guardedSheet_(ss, guarded.t, TEMPLATE_SHEET);
  ctx.customers = readCustomers_(needSheet_(ss, CUSTOMER_SHEET));
  var jobs = active.filter(function (state) {
    return ready_(ctx, state);
  });
  if (jobs.length === 0) return ctx.summary;

  ctx.folder = folder_(store);
  ctx.work = privateWork_(store);
  checkTemplate_(ctx.template, ctx.customers);
  cleanWork_(ctx.work);
  var tried = 0;
  for (var i = 0; i < jobs.length; i++) {
    if (tried >= MAX_PER_RUN || Date.now() - ctx.started > LIMIT_MS) break;
    if (jobs[i].kind !== 'writeback') tried += 1;
    var outcome = runJob_(ctx, jobs[i]);
    if (outcome === 'stuck') ctx.summary.stuck += 1;
    if (outcome === 'later') ctx.summary.later += 1;
  }
  return ctx.summary;
}

/** 1行の今の様子。kind: idle（何もしない）／new（これから作る）／resume（番号は取ったが PDF がまだ）／writeback（PDF はできたが行に書けていない）／redo（やり直し） */
function stateOf_(ctx, index, values) {
  var get = function (name) {
    return values[ctx.col[name]];
  };
  var no = text_(get('請求番号')).trim();
  var state = { index: index, no: no, kind: 'idle', redo: get('やり直し') === true, note: text_(get('気になる所')), rec: no ? ctx.records[no] || null : null, input: null };
  var hasPdf = text_(get('PDF')).trim() !== '';
  if (no && !NUMBER.test(no)) {
    setNote_(ctx, state, NOTE.typed); // スクリプトの入れる形ではない番号
    return state;
  }
  if (no && hasPdf) ctx.used[no] = true;
  if (no && ctx.count[no] > 1) {
    // 同じ番号の行が2つ。どちらも、作り直し・書き戻しをしない。どちらを直すかが分かるよう、元の行とコピーした行で文を分ける
    var origin = ctx.origin[no];
    setNote_(ctx, state, origin === undefined ? NOTE.same : origin === index ? NOTE.sameOrigin : NOTE.sameCopy);
    return state;
  }
  if (!no) {
    if (REQUIRED.some(function (name) { return blank_(get(name)); })) setNote_(ctx, state, ''); // 入れている途中。そろうまで待つ
    else state.kind = 'new';
  } else if (!hasPdf) {
    if (!state.rec) setNote_(ctx, state, NOTE.typed);
    else if (state.rec.p) state.kind = (state.rec.w || 0) <= MAX_TRIES ? 'writeback' : 'idle';
    else if ((state.rec.t || 0) >= MAX_TRIES && !state.redo) setNote_(ctx, state, NOTE.pdfFailed);
    else state.kind = 'resume';
  } else if (state.redo) {
    state.kind = 'redo';
  } else if (state.rec && state.rec.f) {
    // 「やり直し」で出た知らせ（前の下書きが無い・確かめられない・PDF を作れない）は、ひとりでには消さない（作り直せたとき・人が消したときに消える）
    var reasons = [NOTE.gone, NOTE.unsureStop, NOTE.pdfFailed];
    var edited = printOf_(inputOf_(get), '') !== state.rec.f;
    if (edited && reasons.indexOf(state.note) < 0) setNote_(ctx, state, NOTE.edited);
    if (!edited && [NOTE.edited, NOTE.same, NOTE.sameOrigin, NOTE.sameCopy].indexOf(state.note) >= 0) setNote_(ctx, state, '');
  }
  if (state.kind !== 'idle' && state.kind !== 'writeback') state.input = inputOf_(get);
  return state;
}

/** 同じ請求番号が2行以上あるとき、どの行が元の行か（作ったときの中身と同じ行のうち、いちばん上）。分からなければ入れない */
function originRows_(ctx, table) {
  var origin = Object.create(null);
  table.rows.forEach(function (values, i) {
    var no = text_(values[table.col['請求番号']]).trim();
    var rec = ctx.records[no];
    if (!no || !(ctx.count[no] > 1) || origin[no] !== undefined || !rec || !rec.f) return;
    var get = function (name) {
      return values[table.col[name]];
    };
    if (printOf_(inputOf_(get), '') === rec.f) origin[no] = FIRST_ROW + i;
  });
  return origin;
}

/** 作ってよい行か。形の違う所は「気になる所」に書いて、作らない */
function ready_(ctx, state) {
  if (state.kind === 'writeback') return true;
  if (state.kind === 'redo' && !state.rec) {
    setNote_(ctx, state, NOTE.noRecord);
    uncheck_(ctx, state);
    return false;
  }
  var checked = validate_(ctx, state.input);
  if (checked.notes.length > 0) {
    setNote_(ctx, state, checked.notes.join('／'));
    return false;
  }
  state.data = checked.data;
  return true;
}

function runJob_(ctx, job) {
  if (job.kind === 'writeback') return writeBackOnly_(ctx, job);
  if (job.kind === 'redo') return redo_(ctx, job);
  return issue_(ctx, job);
}

// 新しく作る・番号を取ったあと PDF ができていなかった行を、同じ番号でもう一度
function issue_(ctx, job) {
  var issued = job.input.issued || today_();
  var no = job.no;
  var rec = job.rec;
  if (job.kind === 'new') {
    no = nextNumber_(ctx, issued.slice(0, 4) + issued.slice(5, 7));
    rec = { t: 1 };
    saveRecord_(ctx, no, rec);
    try {
      // 先に、この行に書けるかを確かめる。書けない行は、何も作らない（同じ請求書を作り続けないため）。
      // 請求番号は、いちばん最後に書く（箱で止まっても、番号だけの行を残さない。番号だけが残ると、次の行に同じ番号が付く）
      if (!job.input.issued) setCell_(ctx, job.index, '請求日', new Date(issued + 'T00:00:00+09:00'));
      ctx.list.getRange(job.index, ctx.col['やり直し'] + 1).insertCheckboxes().setValue(false); // 「やり直し」の箱は、番号を入れる行にだけ付ける
      setCell_(ctx, job.index, '請求番号', no);
    } catch (e) {
      dropRecord_(ctx, no);
      return 'stuck';
    }
  } else if ((rec.t || 0) >= MAX_TRIES) {
    rec.t = 1; // 「やり直し」の印で、もう3回だけ試す。印はここで外す（付いたままでも、試し続けない）
    saveRecord_(ctx, no, rec);
    uncheck_(ctx, job);
  } else {
    rec.t = (rec.t || 0) + 1;
    saveRecord_(ctx, no, rec);
  }
  var pdf = makePdf_(ctx, no, job.data, issued);
  if (!pdf) return 'later';
  return settle_(ctx, job, no, rec, issued, pdf);
}

// 「やり直し」の印: 同じ番号で作り直す。前の下書きがもう無い（送った・消した）ときは、作り直さない
function redo_(ctx, job) {
  var rec = job.rec;
  if (rec.d) {
    var draft = draftState_(rec.d);
    if (draft === 'gone') {
      setNote_(ctx, job, NOTE.gone);
      uncheck_(ctx, job);
      return 'skipped';
    }
    if (draft === 'unsure') {
      rec.u = (rec.u || 0) + 1;
      if (rec.u >= MAX_TRIES) {
        rec.u = 0; // 3回確かめられなかったら、印を外して知らせる（10分ごとに、たずね続けない）
        setNote_(ctx, job, NOTE.unsureStop);
        uncheck_(ctx, job);
      } else {
        setNote_(ctx, job, NOTE.unsure);
      }
      saveRecord_(ctx, job.no, rec);
      return 'skipped';
    }
  }
  var issued = job.input.issued || today_();
  if (!job.input.issued) {
    try {
      setCell_(ctx, job.index, '請求日', new Date(issued + 'T00:00:00+09:00')); // 空の請求日には、作り直した日を入れる
    } catch (e) {
      return 'stuck';
    }
  }
  var pdf = makePdf_(ctx, job.no, job.data, issued);
  if (!pdf) {
    rec.r = (rec.r || 0) + 1;
    if (rec.r >= MAX_TRIES) {
      rec.r = 0;
      setNote_(ctx, job, NOTE.pdfFailed);
      uncheck_(ctx, job);
    }
    saveRecord_(ctx, job.no, rec);
    return 'later';
  }
  return settle_(ctx, job, job.no, rec, issued, pdf);
}

// PDF をしまい、下書きを作り、行に書き戻す。作った記録は、行に書く前に鍵の置き場に残す（書き戻しで止まっても、次の回は作り直さない）
function settle_(ctx, job, no, rec, issued, pdf) {
  var data = job.data;
  var money = taxOf_(data.amount, data.rate, ctx.settings.rounding);
  var file = subFolder_(ctx.folder, issued.slice(0, 7)).createFile(pdf.setName(pdfName_(no, data.name)));
  var old = { p: rec.p, d: rec.d };
  rec.p = file.getId();
  rec.f = printOf_(job.input, issued);
  rec.m = Date.now();
  rec.x = money.tax;
  rec.s = money.total;
  rec.t = 0;
  rec.r = 0;
  rec.u = 0;
  rec.w = 0;
  saveRecord_(ctx, no, rec);
  // 前の下書きを消せなかったときは、新しい下書きを作らない（同じ件名で、金額の違う下書きを2通にしない）
  var cleared = job.kind !== 'redo' || retire_(ctx, old);
  if (cleared) {
    rec.d = '';
    rec.l = draft_(ctx, no, data, money, pdf, rec);
  } else {
    rec.l = DRAFT.kept;
  }
  saveRecord_(ctx, no, rec);
  ctx.summary.made += 1;
  return writeBack_(ctx, job.index, no, rec, file.getUrl()) ? 'made' : 'stuck';
}

// PDF はできているのに、行に書けていなかったとき。作り直さずに、書き戻しだけやり直す
function writeBackOnly_(ctx, job) {
  var url;
  try {
    url = DriveApp.getFileById(job.rec.p).getUrl();
  } catch (e) {
    saveRecord_(ctx, job.no, { t: 0 }); // PDF がもう無い。次の回に、同じ番号で作り直す
    return 'later';
  }
  return writeBack_(ctx, job.index, job.no, job.rec, url) ? 'wrote' : 'stuck';
}

// PDF のリンクは最後に書く（リンクの無い行は、まだ途中だと分かるように）
function writeBack_(ctx, index, no, rec, url) {
  try {
    setCell_(ctx, index, '消費税', rec.x);
    setCell_(ctx, index, '合計（税込）', rec.s);
    setCell_(ctx, index, '作った日時', stamp_(rec.m));
    setCell_(ctx, index, '下書き', rec.l);
    setCell_(ctx, index, '気になる所', '');
    setCell_(ctx, index, 'やり直し', false);
    setCell_(ctx, index, 'PDF', url);
    return true;
  } catch (e) {
    rec.w = (rec.w || 0) + 1;
    saveRecord_(ctx, no, rec);
    return false;
  }
}

// 作り直す前の PDF は「作り直し前」のフォルダへ移し（消さない）、前の下書きは消す。前の下書きが片付いたか（消せた・もう無い）を返す
function retire_(ctx, old) {
  if (old.p) {
    try {
      var file = DriveApp.getFileById(old.p);
      file.setName(file.getName().replace(/\.pdf$/, '') + '（作り直し前 ' + stamp_(Date.now()).replace(/[\/: ]/g, '') + '）.pdf');
      file.moveTo(subFolder_(ctx.folder, OLD_FOLDER));
    } catch (e) {
      console.warn('請求書つくり機: 前の PDF を移せませんでした 1件'); // 前の PDF が、もう消されていた
    }
  }
  if (!old.d) return true;
  try {
    Gmail.Users.Drafts.remove('me', old.d);
    return true;
  } catch (e) {
    if (missing_(e)) return true;
    console.warn('請求書つくり機: 前の下書きを消せませんでした 1件');
    return false;
  }
}

// ===== 行を読む・確かめる =====

/** 行の入力を、決まった形にそろえる（全角は半角に。形の違う値は null） */
function inputOf_(get) {
  var content = text_(get('内容')).trim();
  var tradeDay = get('取引日');
  var input = {
    name: text_(get('取引先')).trim(),
    content: content,
    amount: amountOf_(get('金額（税抜）')),
    rate: rateOf_(get('税率')),
    due: ymdOf_(get('期日')),
    issued: ymdOf_(get('請求日')),
    tradeDay: isDate_(tradeDay) ? '' : oneLine_(tradeDay),
    memo: oneLine_(get('備考')),
  };
  if (isDate_(tradeDay)) {
    var day = ymdOf_(tradeDay);
    input.tradeDay = day ? jaDate_(day) : '';
    input.tradeDayBad = !day;
  }
  input.contentBad = content.length > CONTENT_MAX || /[\r\n]/.test(content);
  return input;
}

function validate_(ctx, input) {
  var notes = [];
  var found = ctx.customers[input.name];
  if (!found) notes.push(NOTE.noCustomer);
  else if (found.count > 1) notes.push(NOTE.twoCustomers);
  if (input.amount === null) notes.push(NOTE.amount);
  if (input.rate === null || ctx.settings.rates.indexOf(input.rate) < 0) notes.push(NOTE.rate);
  if (!input.due) notes.push(NOTE.due);
  if (input.issued === null) notes.push(NOTE.issued);
  if (input.due && input.issued !== null && input.due < (input.issued || today_())) notes.push(NOTE.dueBefore);
  if (input.contentBad) notes.push(NOTE.content);
  if (/[\r\n]/.test(input.name)) notes.push(NOTE.nameLine);
  if (input.tradeDayBad) notes.push(NOTE.tradeDay);
  var lengths = [[input.name, MAX_LEN.name], [input.tradeDay, MAX_LEN.tradeDay], [input.memo, MAX_LEN.memo]];
  if (found) lengths = lengths.concat([[found.honorific, MAX_LEN.honorific], [found.zip, MAX_LEN.zip], [found.address, MAX_LEN.address], [found.person, MAX_LEN.person]]);
  var tooLong = lengths.some(function (pair) {
    return Array.from(pair[0]).length > pair[1];
  });
  if (tooLong) notes.push(NOTE.long); // 切らずに知らせる（請求書の字が、途中で切れたまま出ないように）
  var words = [input.name, input.content, input.tradeDay, input.memo];
  if (found) words = words.concat([found.honorific, found.zip, found.address, found.person]);
  if (words.join('\n').indexOf('{{') >= 0) notes.push(NOTE.brace);
  if (notes.length > 0) return { notes: notes, data: null };
  var mail = emailOf_(found.email);
  return {
    notes: [],
    data: {
      name: input.name,
      honorific: found.honorific || '御中',
      place: [found.zip, found.address].filter(Boolean).join(' '),
      person: found.person,
      email: mail.email,
      emailBad: mail.bad,
      content: input.content,
      amount: input.amount,
      rate: input.rate,
      due: input.due,
      tradeDay: input.tradeDay,
      memo: input.memo,
    },
  };
}

// 行の入力の指紋（作ったあとに行が直されたかを見る。請求日が空のときは、入れた日で数える）
function printOf_(input, issued) {
  var text = [input.name, input.content, input.amount, input.rate, input.due, input.issued || issued, input.tradeDay, input.memo].join('\u0001');
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)).slice(0, 12);
}

function amountOf_(value) {
  if (typeof value === 'number') return isWhole_(value) && value >= 1 && value <= MAX_AMOUNT ? value : null;
  var text = half_(value).replace(/^¥\s*/, '').replace(/\s*円$/, '');
  if (!/^\d{1,9}$/.test(text) && !/^\d{1,3}(,\d{3})+$/.test(text)) return null; // カンマは3けたごとの形だけ（「3,00」「30 00」は通さない）
  var amount = Number(text.replace(/,/g, ''));
  return amount >= 1 && amount <= MAX_AMOUNT ? amount : null;
}

// 税率（%の整数）。表の「10%」は 0.1 で届くので、1より小さい数は100倍して読む
function rateOf_(value) {
  var number = value;
  if (typeof value !== 'number') {
    var text = half_(value).replace(/[%\s]/g, '');
    if (!/^\d{1,2}(\.\d+)?$/.test(text)) return null;
    number = Number(text);
  }
  if (number > 0 && number < 1) number = number * 100;
  var rounded = Math.round(number);
  return Math.abs(number - rounded) < 1e-6 && rounded >= 0 && rounded <= 99 ? rounded : null;
}

/** 日付を「年-月-日」に。空は ''、日付でなければ（2000〜2100年の外も）null */
function ymdOf_(value) {
  if (blank_(value)) return '';
  if (isDate_(value)) {
    var year = Number(Utilities.formatDate(value, TZ, 'yyyy'));
    return year >= YEAR_MIN && year <= YEAR_MAX ? Utilities.formatDate(value, TZ, 'yyyy-MM-dd') : null;
  }
  var m = half_(value).match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
  if (!m) return null;
  var y = Number(m[1]);
  if (y < YEAR_MIN || y > YEAR_MAX) return null;
  var mo = Number(m[2]);
  var d = Number(m[3]);
  var date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null; // 無い日（2月30日など）
  return m[1] + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}

function emailOf_(value) {
  var text = half_(value);
  if (text === '') return { email: '', bad: false };
  var ok = text.length <= 254 && /^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(text); // 宛先は1つ。改行・空白・カンマ・おかしな位置の点が入っていれば使わない
  return { email: ok ? text : '', bad: !ok };
}

function readCustomers_(sheet) {
  var table = readTable_(sheet, 1, ['取引先'], CUSTOMER_SHEET);
  var customers = Object.create(null);
  table.rows.forEach(function (values, i) {
    var get = function (name) {
      return name in table.col ? text_(values[table.col[name]]).trim() : '';
    };
    var name = get('取引先');
    if (!name) return;
    if (customers[name]) {
      customers[name].count += 1;
      return;
    }
    customers[name] = { count: 1, row: i + 2, honorific: oneLine_(get('敬称')), zip: oneLine_(get('郵便番号')), address: oneLine_(get('住所')), person: oneLine_(get('担当')), email: get('メール') };
  });
  return customers;
}

function readSettings_(sheet) {
  var last = sheet.getLastRow();
  var values = Object.create(null);
  (last > 0 ? sheet.getRange(1, 1, last, 2).getValues() : []).forEach(function (row) {
    values[String(row[0]).trim()] = row[1];
  });
  var get = function (name) {
    return oneLine_(values[name]);
  };
  var stop = function (name, how) {
    throw new Error('「' + SETTINGS_SHEET + '」のシートの「' + name + '」を確かめてください（' + how + '）');
  };
  var settings = { company: get('自社の名前'), address: get('自社の郵便番号と住所'), tel: get('自社の電話'), bank: get('お振込先'), footer: get('請求書の下の一言') };
  if (!settings.company) stop('自社の名前', '空です');
  settings.regNo = half_(values['登録番号']);
  if (settings.regNo !== '' && !/^T\d{13}$/.test(settings.regNo)) stop('登録番号', 'T と13けたの数字で。空なら請求書に出しません');
  settings.rounding = get('消費税の端数');
  if (ROUNDINGS.indexOf(settings.rounding) < 0) stop('消費税の端数', ROUNDINGS.join('・') + 'のどれか');
  settings.rates = ratesOf_(values['選べる税率']);
  if (settings.rates === null || settings.rates.length === 0) stop('選べる税率', '例: 10%, 8%');
  settings.reduced = ratesOf_(values['軽減税率']);
  if (settings.reduced === null) stop('軽減税率', '例: 8%');
  var draft = get('メールの下書き');
  if (draft !== '作る' && draft !== '作らない') stop('メールの下書き', '作る・作らない のどちらか');
  settings.draft = draft === '作る';
  return settings;
}

function ratesOf_(value) {
  if (typeof value === 'number') value = String(rateOf_(value));
  var rates = half_(value).split(/[,、\s]+/).filter(Boolean).map(rateOf_);
  return rates.indexOf(null) >= 0 ? null : rates;
}

/** 見出しの名前で列を探す（あとの道具が列を足しても・並べ替えても動くように） */
function readTable_(sheet, headerRow, required, label) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var values = lastRow >= headerRow && lastCol >= 1 ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
  var col = Object.create(null);
  (values[headerRow - 1] || []).forEach(function (header, i) {
    var name = String(header).trim();
    if (name && !(name in col)) col[name] = i;
  });
  var missing = required.filter(function (name) {
    return !(name in col);
  });
  if (missing.length > 0) throw new Error('「' + label + '」のシートに、見出しがありません: ' + missing.join('・') + '（見出しの名前は変えないでください。作り直すなら setupSeikyu）');
  return { col: col, rows: values.slice(headerRow) };
}

// ===== 番号と、作った記録（鍵の置き場） =====

/** 請求番号（請求日の年月＋3けたの連番）。作った記録（鍵の置き場）と表の両方を見るので、消した行の番号も二度使わない */
function nextNumber_(ctx, ym) {
  var max = 0;
  var numbers = Object.keys(ctx.records).concat(Object.keys(ctx.used));
  numbers.forEach(function (no) {
    var m = no.match(/^(\d{6})-(\d+)$/);
    if (m && m[1] === ym) max = Math.max(max, Number(m[2]));
  });
  return ym + '-' + ('00' + (max + 1)).slice(-Math.max(3, String(max + 1).length));
}

function recordsOf_(store) {
  var all = store.getProperties();
  var records = Object.create(null);
  Object.keys(all).forEach(function (key) {
    if (key.indexOf(PROP.inv) !== 0) return;
    try {
      records[key.slice(PROP.inv.length)] = JSON.parse(all[key]);
    } catch (e) {
      console.warn('請求書つくり機: 読めない記録が1つあります');
    }
  });
  return records;
}

function saveRecord_(ctx, no, rec) {
  ctx.records[no] = rec;
  ctx.store.setProperty(PROP.inv + no, JSON.stringify(rec));
}

function dropRecord_(ctx, no) {
  delete ctx.records[no];
  ctx.store.deleteProperty(PROP.inv + no);
}

// ===== 守り（保護・フォルダ・ひな形） =====

function guardedIds_(store) {
  try {
    return JSON.parse(store.getProperty(PROP.guarded)) || {};
  } catch (e) {
    return {};
  }
}

function sheetById_(ss, id) {
  if (id === undefined || id === null || id === '') return null;
  var found = ss.getSheets().filter(function (sheet) {
    return String(sheet.getSheetId()) === String(id);
  });
  return found.length > 0 ? found[0] : null;
}

// 保護をかけたシート（覚えた番号で探す。同じ名前で作り直されたシートは使わない）。保護がゆるんでいれば止まる
function guardedSheet_(ss, id, name) {
  var sheet = sheetById_(ss, id);
  if (!sheet) throw new Error('保護をかけた「' + name + '」のシートが見つかりません。setupSeikyu を動かしてください（同じ名前のシートがあっても、そのままは使いません。名前を替えて残すので、中身を確かめてから写してください）');
  var guarded = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).some(ownerOnlyNow_);
  if (!guarded) {
    throw new Error(
      '「' + name + '」のシートの保護が外れているか、ゆるんでいます（表を共有した人が、振込先や請求書の形を書き換えられます）。' +
        '先に、「設定」の値（とくにお振込先）と、ひな形の字が書き換えられていないかを自分の目で確かめてから、setupSeikyu を動かし直してください。' +
        '動かし直しても止まるときは、スクリプトを動かすアカウントが、表の持ち主かを確かめてください',
    );
  }
  return sheet;
}

// 持ち主だけが書き換えられる保護か（注意だけの保護・組織の人が書ける保護・編集者が2人以上、は違う）
function ownerOnlyNow_(protection) {
  return !protection.isWarningOnly() && !protection.canDomainEdit() && protection.getEditors().length <= 1;
}

/** 作業用の表（だれとも共有していないことを確かめて返す）。共有されていれば、どの行も作らない */
function privateWork_(store) {
  var id = store.getProperty(PROP.work);
  var work = null;
  var file = null;
  try {
    file = id ? DriveApp.getFileById(id) : null;
    work = file && !file.isTrashed() ? SpreadsheetApp.openById(id) : null;
  } catch (e) {
    work = null;
  }
  if (!work) throw new Error('請求書を作るための作業用の表が見つかりません（ゴミ箱に入っていないかを見てください）。setupSeikyu を動かすと、作り直します');
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE || file.getEditors().length > 0 || file.getViewers().length > 0) {
    throw new Error('作業用の表「' + WORK_NAME + '」が、ほかの人と共有されています。共有を外してください（作りかけの請求書を書き換えられないよう、この表は持ち主だけが開ける形で使います）');
  }
  return work;
}

function needSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('「' + name + '」のシートが見つかりません。setupSeikyu を動かしてください（無いシートだけ作り直します）');
  return sheet;
}

function folder_(store) {
  var folder = usableFolder_(store);
  if (!folder) throw new Error('請求書の PDF を入れるフォルダが見つかりません（ゴミ箱に入っていないかを見てください）。setupSeikyu を動かすと、新しいフォルダを作ります');
  return folder;
}

function subFolder_(parent, name) {
  var found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

// 作業用の表に、途中で止まって残った一時のシートがあれば消す（使い回さない）。はじめの1枚（説明の書いてあるシート）だけ残す
function cleanWork_(work) {
  work.getSheets().slice(1).forEach(function (sheet) {
    work.deleteSheet(sheet);
  });
}

/** ひな形の見張り: 知らない差しこみ口・足りない差しこみ口・取引先の名前が書かれている、のどれかなら、どの行も作らない */
function checkTemplate_(template, customers) {
  var text = template
    .getDataRange()
    .getValues()
    .map(function (row) {
      return row.join('\n');
    })
    .join('\n');
  var slots = Object.create(null);
  text.replace(SLOT, function (whole, name) {
    slots[name] = true;
    return whole;
  });
  var show = function (names) {
    return names.map(function (name) { return '{{' + name + '}}'; }).join('・');
  };
  var unknown = Object.keys(slots).filter(function (name) {
    return KNOWN_SLOTS.indexOf(name) < 0;
  });
  if (unknown.length > 0) throw new Error('「' + TEMPLATE_SHEET + '」のひな形に、知らない差しこみ口があります: ' + show(unknown) + '（使えるのは ' + show(KNOWN_SLOTS) + '）');
  var missing = NEEDED_SLOTS.filter(function (name) {
    return !slots[name];
  });
  if (missing.length > 0) throw new Error('「' + TEMPLATE_SHEET + '」のひな形に、差しこみ口がありません: ' + show(missing) + '（宛名・金額・日付は、じかに書かずに差しこみ口で）');
  Object.keys(customers).forEach(function (name) {
    if (name.length >= 2 && text.indexOf(name) >= 0) {
      throw new Error('ひな形に、取引先の名前が書かれています（「' + CUSTOMER_SHEET + '」のシートの ' + customers[name].row + ' 行めの名前）。「' + TEMPLATE_SHEET + '」から消してください');
    }
  });
}

// ===== 請求書を作る =====

/** ひな形を、共有しない作業用の表に写して差しこみ、PDF にする。混んでいて作れなかったときは null（次の回にもう一度）。
 *  請求の一覧の表には、作りかけの請求書を置かない（表を共有した人が、書き出しまでのあいだに振込先を書き換えられないように） */
function makePdf_(ctx, no, data, issued) {
  var temp = ctx.template.copyTo(ctx.work);
  try {
    temp.setName(TEMP_PREFIX + no);
    fill_(temp, wordsOf_(ctx.settings, no, data, issued));
    return exportPdf_(ctx.work, temp);
  } finally {
    ctx.work.deleteSheet(temp);
  }
}

function wordsOf_(settings, no, data, issued) {
  var money = taxOf_(data.amount, data.rate, settings.rounding);
  var reduced = settings.reduced.indexOf(data.rate) >= 0;
  return {
    宛名: data.name,
    敬称: data.honorific,
    宛先の住所: data.place,
    担当: data.person,
    請求番号: no,
    請求日: jaDate_(issued),
    期日: jaDate_(data.due),
    取引日: data.tradeDay || jaDate_(issued),
    内容: data.content + (reduced ? ' ※' : ''),
    税率: data.rate + '%',
    金額: yen_(data.amount),
    消費税: yen_(money.tax),
    合計: yen_(money.total),
    自社の名前: settings.company,
    自社の住所: settings.address,
    自社の電話: settings.tel ? 'TEL ' + settings.tel : '',
    登録番号: settings.regNo ? '登録番号 ' + settings.regNo : '',
    振込先: settings.bank ? 'お振込先: ' + settings.bank : '',
    軽減の注記: reduced ? '※は軽減税率の対象' : '',
    備考: data.memo ? '備考: ' + data.memo : '',
    下の一言: settings.footer,
  };
}

function fill_(sheet, words) {
  var range = sheet.getDataRange();
  var filled = range.getValues().map(function (row) {
    return row.map(function (cell) {
      if (typeof cell !== 'string' || cell.indexOf('{{') < 0) return cell;
      return plain_(
        cell.replace(SLOT, function (whole, name) {
          return Object.prototype.hasOwnProperty.call(words, name) ? words[name] : whole;
        }),
      );
    });
  });
  range.setValues(filled);
  // 出す前の点検: 差しこみ口が1つも残っていない
  var left = [].concat.apply([], filled).some(function (cell) {
    return String(cell).indexOf('{{') >= 0;
  });
  if (left) throw new Error('請求書に差しこみ口が残りました。「' + TEMPLATE_SHEET + '」のひな形を確かめてください');
}

/** 一時のシートを、A4・縦・幅に合わせる・目盛り線なしの PDF で書き出す（自分の作業用の表の住所だけを呼ぶ） */
function exportPdf_(ss, sheet) {
  SpreadsheetApp.flush();
  Utilities.sleep(500); // 書きこんだ中身が、書き出しに間に合うように
  var query = 'format=pdf&size=7&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED&fzr=false' +
    '&top_margin=0.6&bottom_margin=0.6&left_margin=0.6&right_margin=0.6&gid=' + sheet.getSheetId();
  var response;
  try {
    response = UrlFetchApp.fetch(ss.getUrl().replace(/\/edit.*$/, '') + '/export?' + query, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
  } catch (e) {
    return null; // 通信が切れた。次の回にもう一度
  }
  var code = response.getResponseCode();
  if (code === 429 || code >= 500) return null; // 混んでいる・Google の不調。次の回にもう一度
  var blob = code === 200 ? response.getBlob() : null;
  if (!blob || !isPdf_(blob)) throw new Error('請求書を PDF で書き出せません（' + code + '）。setupSeikyu をもう一度動かして、許可をやり直してください');
  return blob;
}

function isPdf_(blob) {
  var bytes = blob.getBytes();
  return bytes.length > 4 && bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70; // 「%PDF」で始まる
}

/** 消費税（請求書1枚で1回）。円と税率（%）の整数だけで計算する */
function taxOf_(amount, rate, rounding) {
  var hundredths = amount * rate;
  var tax = Math.floor(hundredths / 100);
  var rest = hundredths % 100;
  if (rounding === '切り上げ' && rest > 0) tax += 1;
  if (rounding === '四捨五入' && rest >= 50) tax += 1;
  return { tax: tax, total: amount + tax };
}

function pdfName_(no, name) {
  return '請求書_' + no + '_' + name.replace(/[\\\/:*?"<>|\r\n\t]/g, '_').slice(0, 60) + '.pdf';
}

// ===== メールの下書き（作るだけ。出す命令は無い） =====

function draft_(ctx, no, data, money, pdf, rec) {
  if (!ctx.settings.draft) return DRAFT.off;
  if (!data.email) return data.emailBad ? DRAFT.bad : DRAFT.none;
  var body = [
    data.name + ' ' + data.honorific,
    '',
    '請求書（' + no + '）をお送りします。',
    'ご請求金額は ' + commas_(money.total) + '円（税込）、お支払いの期日は ' + jaDate_(data.due) + ' です。',
    '添付のPDFをご確認ください。',
    '',
    ctx.settings.company,
    '',
  ].join('\r\n');
  try {
    var made = Gmail.Users.Drafts.create({ message: { raw: rawMail_(data.email, '請求書をお送りします（' + no + '）', body, pdf, '請求書_' + no + '.pdf') } }, 'me');
    rec.d = made.id;
    return DRAFT.made;
  } catch (e) {
    console.warn('請求書つくり機: 下書きを作れませんでした 1件');
    return DRAFT.failed;
  }
}

// 前の下書きが、まだ下書きにあるか（there）・もう無いか（gone）・確かめられなかったか（unsure）
function draftState_(id) {
  try {
    Gmail.Users.Drafts.get('me', id);
    return 'there';
  } catch (e) {
    return missing_(e) ? 'gone' : 'unsure';
  }
}

// Gmail が「その下書きは無い」と答えたか
function missing_(e) {
  return /not found|404/i.test(String((e && e.message) || e));
}

/** メールの生の形（宛先は To の1つだけ・本文と PDF の添付）。頭の行に入る字は、決まった形の宛先と番号だけ */
function rawMail_(to, subject, body, pdf, fileName) {
  var boundary = 'neko' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  var encoded = function (bytes) {
    return Utilities.base64Encode(bytes).match(/.{1,76}/g).join('\r\n');
  };
  var lines = [
    'To: ' + to,
    'Subject: ' + headerWords_(subject).join('\r\n '),
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encoded(Utilities.newBlob(body).getBytes()),
    '--' + boundary,
    'Content-Type: application/pdf;',
    ' name="' + headerWords_(fileName).join('') + '"',
    'Content-Disposition: attachment;',
    ' filename="' + headerWords_(fileName).join('') + '"',
    'Content-Transfer-Encoding: base64',
    '',
    encoded(pdf.getBytes()),
    '--' + boundary + '--',
    '',
  ];
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(lines.join('\r\n')).getBytes());
}

// メールの頭の行に日本語を入れるときの形（1つ39バイトまでに分ける）
function headerWords_(text) {
  var words = [];
  var chunk = '';
  var size = 0;
  Array.from(String(text).replace(/[\r\n]/g, ' ')).forEach(function (ch) {
    var code = ch.codePointAt(0);
    var bytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (size + bytes > 39) {
      words.push(chunk);
      chunk = '';
      size = 0;
    }
    chunk += ch;
    size += bytes;
  });
  if (chunk) words.push(chunk);
  return words.map(function (word) {
    return '=?UTF-8?B?' + Utilities.base64Encode(Utilities.newBlob(word).getBytes()) + '?=';
  });
}

// ===== 小さな道具 =====

function setCell_(ctx, index, name, value) {
  ctx.list.getRange(index, ctx.col[name] + 1).setValue(value);
}

// 「気になる所」を書く（同じ文なら書かない）。書けなければ、書けなかった行に数える
function setNote_(ctx, state, text) {
  if (state.note === text) return;
  try {
    setCell_(ctx, state.index, '気になる所', text);
    state.note = text;
    if (text) ctx.summary.noted += 1;
  } catch (e) {
    ctx.summary.stuck += 1;
  }
}

function uncheck_(ctx, state) {
  try {
    setCell_(ctx, state.index, 'やり直し', false);
  } catch (e) {
    ctx.summary.stuck += 1;
  }
}

function blank_(value) {
  return value === '' || value === null || value === undefined;
}

function text_(value) {
  return blank_(value) ? '' : String(value);
}

// 全角の数字・記号を半角にそろえて、前後の空白を外す
function half_(value) {
  return text_(value).normalize('NFKC').trim();
}

function oneLine_(value) {
  return text_(value).replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

function isDate_(value) {
  return Object.prototype.toString.call(value) === '[object Date]';
}

function isWhole_(number) {
  return isFinite(number) && Math.floor(number) === number;
}

// 「=」「+」「-」「@」で始まる字は、計算式として動かないよう文のまま入れる
function plain_(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function commas_(number) {
  return String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function yen_(number) {
  return '¥' + commas_(number);
}

function jaDate_(ymd) {
  var parts = ymd.split('-');
  return Number(parts[0]) + '年' + Number(parts[1]) + '月' + Number(parts[2]) + '日';
}

function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function stamp_(ms) {
  return Utilities.formatDate(new Date(ms), TZ, 'yyyy/MM/dd HH:mm');
}
