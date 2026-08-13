/**
 * kinbot から、保護されたシートに書き込むための受け口
 *
 * 使い方
 *   1. 対象のスプレッドシートを開く
 *   2. 拡張機能 → Apps Script
 *   3. このコードをまるごと貼り付ける
 *   4. 下の SECRET を、自分で決めた合言葉に書き換える（推測されにくいもの）
 *   5. 右上「デプロイ」→「新しいデプロイ」→ 種類は「ウェブアプリ」
 *        次のユーザーとして実行： 自分（＝このシートを編集できる人）
 *        アクセスできるユーザー： 全員
 *   6. 表示されたURLを、kinbot の「Apps ScriptのURL」に貼る
 *   7. 同じ合言葉を kinbot の「合言葉」に入れて保存
 *
 * なぜこれで書けるのか
 *   Apps Script は「デプロイした人の権限」で動く。
 *   シートを編集できる人がデプロイすれば、保護のかかった範囲にも書き込める。
 *
 * 安全のために
 *   ・合言葉が合わないリクエストは、何もせず断る
 *   ・書き込めるのは、決まった形のセル指定だけ（A1形式）
 *   ・シートの追加や削除、数式の書き換えはしない
 */

// ★ここを、自分で決めた合言葉に書き換えてください（英数字20文字くらい）
const SECRET = "ここに合言葉を入れてください";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");

    // 合言葉が合わないものは受け付けない
    if (!SECRET || SECRET === "ここに合言葉を入れてください") {
      return reply({ error: "Apps Script側の合言葉が未設定です" });
    }
    if (body.secret !== SECRET) {
      return reply({ error: "合言葉が違います" });
    }

    const sheetName = String(body.sheetName || "");
    const cells = Array.isArray(body.cells) ? body.cells : [];
    if (!sheetName) return reply({ error: "シート名がありません" });
    if (!cells.length) return reply({ error: "書き込む内容がありません" });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return reply({ error: "「" + sheetName + "」というシートがありません" });

    let updated = 0;
    for (const c of cells) {
      const range = String(c.range || "");
      // A1形式（K32 など）だけを受け付ける。範囲指定や数式は受け付けない。
      if (!/^[A-Z]{1,3}[0-9]{1,5}$/.test(range)) continue;
      const v = c.value;
      // 数字か短い文字だけ。数式（=で始まるもの）は入れない。
      if (typeof v === "string" && v.charAt(0) === "=") continue;
      sh.getRange(range).setValue(v);
      updated++;
    }

    return reply({ ok: true, updated: updated });
  } catch (err) {
    return reply({ error: String(err) });
  }
}

// 動いているかの確認用（ブラウザでURLを開くと表示される）
function doGet() {
  return reply({ ok: true, message: "kinbotの受け口は動いています" });
}

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
