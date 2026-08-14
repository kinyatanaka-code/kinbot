// ───────────────────────────────────────────────────────────
// docs.js — 送った資料が「いつ・何ページまで・どれくらい見られたか」を記録する
//
// 考え方
//   ・PDFを添付するのをやめ、宛先ごとに1本ずつURLを発行して送る
//   ・受け取った人がそのURLを開くと、ページごとの滞在時間まで取れる
//   ・閲覧を検知したらGoogle Chatへ即座に知らせる
//
// 開封（メールに埋め込む画像）も取れるようにしてあるが、
// iPhoneの標準メールは受信時に画像を先読みするため、
// 「開いていないのに開封になる」ことがある。参考値として扱う。
// ───────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import {
  getDocLink, startDocView, beatDocView, markDocViewNotified, addDocEvent,
  endDocView, staleDocViews, getSettings, displayNameOf,
} from "./db.js";
import { appendSheetRow } from "./google.js";
import { notifyChat, notifyAll } from "./chat.js";

// 通知の条件。短すぎる閲覧（開いてすぐ閉じた）は流さない。
const NOTIFY_MIN_SECONDS = Number(process.env.DOC_NOTIFY_MIN_SECONDS || 20);

// アップロードされたファイル名の文字化けを直す。
// multipart（ファイルアップロード）のファイル名はlatin1として読まれるため、
// 日本語のファイル名が「ã€ã¨ã...」のように壊れる。UTF-8として読み直す。
export function fixMojibake(str) {
  const t = String(str || "");
  if (!t) return "";
  // 半角英数だけなら壊れていない
  if (!/[\u0080-\u00FF]/.test(t)) return t;
  try {
    const re = Buffer.from(t, "latin1").toString("utf8");
    // 読み直して壊れ（置換文字）が出るなら、元のままが正しい
    if (re && !re.includes("\uFFFD")) return re;
  } catch {}
  return t;
}

// IPはそのまま残さず、日付を混ぜたハッシュにする。
// 同じ日の同一人物の見分けはつくが、個人の追跡には使えない。
export function hashIp(ip) {
  const salt = process.env.DOC_IP_SALT || "kinbot";
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${salt}|${day}|${ip || ""}`).digest("hex").slice(0, 16);
}

export function clientIp(req) {
  const f = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return f || req.socket?.remoteAddress || "";
}

// 「1分23秒」の形にする
export function fmtSeconds(sec) {
  const s = Math.max(0, parseInt(sec, 10) || 0);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}分${s % 60}秒` : `${m}分`;
}

// よく見られたページを上位から並べる
export function topPages(pages, n = 3) {
  const e = Object.entries(pages || {})
    .map(([p, v]) => [parseInt(p, 10), parseInt(v, 10) || 0])
    .filter(([p, v]) => p > 0 && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
  return e.map(([p, v]) => `${p}p ${fmtSeconds(v)}`).join(" / ");
}

// 閲覧を検知したときのChat通知
export async function notifyDocView(link, view) {
  const who = [link.company, link.contact].filter(Boolean).join(" ") || link.email || "宛先不明";
  const rep = link.owner ? await displayNameOf(link.owner).catch(() => "") : "";
  const tp = topPages(view.pages);
  // 行数を抑える。スマホのChatで折り返しが増えると読みづらいため。
  // 長く見ているほど脈があるので、ひと目で分かるようにする
  const hot = view.seconds >= 120 ? "🔥 " : "";
  const lines = [
    `👀 ${hot}*資料を見ました*　${who}`,
    `📄 ${fixMojibake(link.doc_name) || "-"}`,
    `⏱ ${fmtSeconds(view.seconds)}　📖 ${view.max_page ? `${view.max_page}ページまで` : "ページ不明"}`,
    tp ? `🔎 ${tp}` : "",
    rep ? `👤 ${rep}` : "",
  ].filter(Boolean);
  return notifyAll(lines.join("\n"), "doc");
}

// 送った資料のURLを組み立てる
export function docUrl(base, slug) {
  return `${String(base || "").replace(/\/+$/, "")}/d/${slug}`;
}
export function pixelUrl(base, slug) {
  return `${String(base || "").replace(/\/+$/, "")}/px/${slug}.png`;
}
export function clickUrl(base, slug, target) {
  return `${String(base || "").replace(/\/+$/, "")}/c/${slug}?u=${encodeURIComponent(target || "")}`;
}

// 1×1の透明PNG（開封計測用）
export const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

// ───────────────────────────────────────────────────────────
// 画面から呼ばれる処理（認証なし。受け取った人が使うため）
// ───────────────────────────────────────────────────────────

// 資料を開いたとき：閲覧を1件つくる
export async function openDocView(slug, req) {
  const link = await getDocLink(slug);
  if (!link) return { error: "見つかりません" };
  const view = await startDocView(link.id, {
    ua: req.headers["user-agent"],
    referrer: req.headers.referer,
    ipHash: hashIp(clientIp(req)),
  });
  console.log(`[doc] 閲覧開始 ${slug}（${link.company || link.email || "-"}）`);
  return { link, view };
}

// 数秒おきの進捗を受ける。
// 通知は「閉じたとき」に出す。途中で出すと滞在時間が実際より短く見えるため。
export async function beatDocViewAndNotify(slug, viewId, body) {
  const link = await getDocLink(slug);
  if (!link) return { error: "見つかりません" };
  const view = await beatDocView(viewId, {
    seconds: body?.seconds,
    maxPage: body?.maxPage,
    pages: body?.pages,
  });
  if (!view) return { error: "記録できませんでした" };

  // 閉じたときだけ知らせる（短すぎる閲覧は流さない）
  if (body?.final) {
    const done = await endDocView(view.id);
    await finishView(link, done || view);
  }
  return { ok: true, seconds: view.seconds };
}

// 1回の閲覧が終わったときの処理。通知とシートへの記録をまとめて行う。
export async function finishView(link, view) {
  if (!view || view.notified) return;
  await markDocViewNotified(view.id);
  if (view.seconds < NOTIFY_MIN_SECONDS) return; // 開いてすぐ閉じた分は流さない
  notifyDocView(link, view).catch(() => {});
  logViewToSheet(link, view).catch(() => {});
}

// 閉じる合図が届かなかったぶんを拾う（タブごと落ちた場合など）
export async function sweepStaleViews(idleSeconds = 90) {
  const rows = await staleDocViews(idleSeconds).catch(() => []);
  for (const v of rows) {
    const link = await getDocLink(v.slug).catch(() => null);
    if (!link) continue;
    await endDocView(v.id).catch(() => {});
    await finishView(link, v).catch(() => {});
  }
  return rows.length;
}

// スプレッドシートに1行足す。設定していなければ何もしない。
export async function logViewToSheet(link, view) {
  try {
    const st = await getSettings();
    const id = String(st?.docSheetId || "").trim();
    if (!id) return;
    const owner = String(st?.docSheetOwner || "").trim();
    if (!owner) return;
    const jst = (d) => new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
    await appendSheetRow(owner, id, String(st?.docSheetName || "").trim() || "資料閲覧", [
      jst(view.started_at),                 // 開いた日時
      jst(view.last_at || new Date()),      // 閉じた日時
      link.company || "",
      link.contact || "",
      link.email || "",
      fixMojibake(link.doc_name) || "",
      view.seconds,                          // 滞在（秒）
      fmtSeconds(view.seconds),              // 滞在（表示用）
      view.max_page || 0,                    // 到達ページ
      topPages(view.pages, 5),               // よく見たページ
      link.owner || "",
      link.slug,
    ]);
    console.log(`[doc] シートに記録しました（${link.company || link.slug}）`);
  } catch (e) {
    console.warn("[doc] シートへの記録に失敗", e.message);
  }
}

// 開封（画像の読み込み）
export async function recordOpen(slug, req) {
  const link = await getDocLink(slug);
  if (!link) return null;
  const ua = String(req.headers["user-agent"] || "");
  await addDocEvent(link.id, "open", { ua });
  console.log(`[doc] 開封 ${slug}（${link.company || link.email || "-"}）`);
  return link;
}

// ダウンロード。
// 資料を保存＝社内で共有される可能性が高いので、閲覧とは別に知らせる。
// 同じ人が続けて押したときに何度も流れないよう、少しのあいだは1回にまとめる。
const dlSeen = new Map();
const DL_QUIET_MS = Number(process.env.DOC_DOWNLOAD_QUIET_MS || 5 * 60 * 1000);

export async function recordDownload(slug, req) {
  const link = await getDocLink(slug);
  if (!link) return null;
  const ua = String(req.headers["user-agent"] || "");
  await addDocEvent(link.id, "download", { ua });
  console.log(`[doc] ダウンロード ${slug}（${link.company || link.email || "-"}）`);

  const key = `${slug}|${hashIp(clientIp(req))}`;
  const now = Date.now();
  // 古いものを捨てる（増え続けないように）
  for (const [k, t] of dlSeen) if (now - t > DL_QUIET_MS) dlSeen.delete(k);
  if (!dlSeen.has(key)) {
    dlSeen.set(key, now);
    notifyDocDownload(link).catch(() => {});
  }
  return link;
}

// ダウンロードのChat通知
export async function notifyDocDownload(link) {
  const who = [link.company, link.contact].filter(Boolean).join(" ") || link.email || "宛先不明";
  const rep = link.owner ? await displayNameOf(link.owner).catch(() => "") : "";
  const lines = [
    `⬇️ *資料をダウンロードしました*　${who}`,
    `📄 ${fixMojibake(link.doc_name) || "-"}`,
    `💡 手元に保存＝社内で共有される可能性があります`,
    rep ? `👤 ${rep}` : "",
  ].filter(Boolean);
  return notifyAll(lines.join("\n"), "doc");
}

// リンクのクリック
export async function recordClick(slug, url, req) {
  const link = await getDocLink(slug);
  if (!link) return null;
  await addDocEvent(link.id, "click", { url, ua: req.headers["user-agent"] });
  console.log(`[doc] クリック ${slug} → ${String(url).slice(0, 80)}`);
  return link;
}
