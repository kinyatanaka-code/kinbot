// ───────────────────────────────────────────────────────────
// selfcheck.js — kinbotが自分の動きを点検する
//
// 田中さんの代わりに、決まった間隔でkinbotが自分を見に行き、
// おかしいところを見つけて「直し方の案」を出します。
//
// ★ 守ること（絶対に破らない）
//   1. DOC Team など、チームのスペースには送らない。
//      送り先は「点検用に指定した1か所」だけ。指定が無ければ送らない。
//   2. Salesforceは一切書き換えない。読むだけ。
//   このファイルからは notifyAll（全員宛）と、Salesforceの更新関数を呼びません。
// ───────────────────────────────────────────────────────────
import { notifyChat } from "./chat.js";

// 点検の結果を1つ作る
const item = (key, title, ok, detail, fix = "") => ({ key, title, ok, detail, fix });

// ライブ配信が届く状態になっているか
export function checkLive({ info, relayUrl, relaySecret, relayCount, reach }) {
  const out = [];
  out.push(item("live.config", "ライブ配信の設定", !!info.configured,
    info.configured ? `${info.provider}で配信できます` : "配信の鍵（CF_ACCOUNT_ID / CF_STREAM_TOKEN）がありません",
    "Railwayの環境変数に、Cloudflare Streamの鍵を入れる"));

  if (relayUrl) {
    out.push(item("live.relay", "中継サーバーへの通信", !!(reach && reach.ok),
      reach && reach.ok ? `${reach.host}:${reach.port} につながります` : `つながりません（${(reach && reach.why) || "理由不明"}）`,
      "RailwayのTCP Proxyが有効か、LIVE_RELAY_RTMP のホストとポートが合っているかを見る"));

    out.push(item("live.secret", "中継サーバーとの合言葉", !!relaySecret,
      relaySecret ? "設定あり" : "RELAY_SECRET がありません",
      "kinbotと中継サーバーの両方に、同じ RELAY_SECRET を入れる"));

    out.push(item("live.dest", "配信の宛先の覚え", true,
      `${relayCount}件を覚えています`,
      ""));
  }
  return out;
}

// プロセスシートが動いているか
export function checkProcessSheet({ sheetId, sheetName, reportId, last, autoRun }) {
  const out = [];
  const ready = !!(sheetId && sheetName && reportId);
  out.push(item("sheet.config", "プロセスシートの設定", ready,
    ready ? `${sheetName} に書き込みます` : "シートID・シート名・SFレポートのどれかが未設定です",
    "SF連携→プロセスシートで、3つとも入っているか見る"));
  if (!ready) return out;

  out.push(item("sheet.auto", "自動での書き込み", autoRun !== false,
    autoRun !== false ? "30分おきに動きます" : "自動がOFFです（手で押したときだけ動きます）",
    "自動にするなら、プロセスシートの画面で「自動で書き込む」をONにする"));

  const at = last && last.at ? new Date(last.at) : null;
  const hours = at ? (Date.now() - at.getTime()) / 3600000 : null;
  if (!at) {
    out.push(item("sheet.last", "最後の書き込み", false, "まだ一度も動いていません",
      "プロセスシートの画面で「試算」してから、実行してみる"));
  } else if (last.ok === false) {
    out.push(item("sheet.last", "最後の書き込み", false,
      `失敗しています：${last.error || "理由不明"}`,
      "エラーの文言に沿って直す。権限エラーならApps Script経由の設定を見る"));
  } else if (hours > 6) {
    out.push(item("sheet.last", "最後の書き込み", false,
      `${Math.round(hours)}時間、書き込まれていません`,
      "自動実行の時間帯（平日の指定時間）と、Google連携が切れていないかを見る"));
  } else {
    out.push(item("sheet.last", "最後の書き込み", true,
      `${Math.round(hours * 10) / 10}時間前に ${last.count || 0}か所を書きました`, ""));
  }
  return out;
}

// つながり（連携）が切れていないか
export function checkLinks({ google, gmail, salesforce, recall, chat }) {
  return [
    item("link.google", "Googleカレンダー", !!google,
      google ? "つながっています" : "連携が切れています",
      "設定→外部連携→Google連携をやり直す"),
    item("link.gmail", "Gmail", !!gmail,
      gmail ? "使えます" : "使えません（権限が足りないかもしれません）",
      "設定→外部連携から、Gmailの権限を付け直す"),
    item("link.sf", "Salesforce（読み取り）", !!salesforce,
      salesforce ? "つながっています" : "つながっていません",
      "設定→外部連携→Salesforceで、つなぎ直す"),
    item("link.recall", "録音（Recall）", !!recall,
      recall ? "使えます" : "鍵がありません",
      "RailwayのRECALL_API_KEYを見る"),
    item("link.chat", "Google Chat通知", !!chat,
      chat ? "送れます" : "送り先がありません",
      "設定→外部連携→Google Chatで送り先を足す"),
  ];
}

// 見つかった問題から、直し方の案を作る。
// AIが使えないときは、点検の「直し方」をそのまま並べる。
export async function buildProposal(bad, callLLM) {
  if (!bad.length) return "";
  const material = bad.map((x) => `- ${x.title}：${x.detail}${x.fix ? `\n    直し方の案：${x.fix}` : ""}`).join("\n");
  if (!callLLM) return material;
  try {
    const system =
      "あなたはB2B営業支援システム kinbot の面倒を見ている人です。" +
      "点検で見つかった問題を読み、開発者がすぐ動ける形にまとめてください。\n" +
      "決まり:\n" +
      "- 日本語。むずかしい言葉を使わない。\n" +
      "- 影響が大きい順に、多くても4件。\n" +
      "- 1件につき「いま：〜」「直し方：〜」を1行ずつ。\n" +
      "- 前置きや締めの言葉は書かない。\n";
    const t = await callLLM(system, `点検で見つかった問題:\n${material}`, 900, { json: false });
    return String(t || "").trim() || material;
  } catch {
    return material;
  }
}

// 点検の結果を知らせる。
// ★ 送り先は「点検用に指定した1か所」だけ。指定が無ければ何もしない。
//   チームのスペースに流さないための決まりなので、ここは変えないこと。
export async function notifyCheck(text, { url = "", space = "" } = {}) {
  if (!url && !space) return { ok: false, skipped: true, reason: "点検の送り先が未設定です" };
  return notifyChat(text, { url, space });
}
