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
} from "./db.js";
import { notifyChat } from "./chat.js";

// 通知の条件。短すぎる閲覧（開いてすぐ閉じた）は流さない。
const NOTIFY_MIN_SECONDS = Number(process.env.DOC_NOTIFY_MIN_SECONDS || 20);

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
  return e.map(([p, v]) => `${p}ページ ${fmtSeconds(v)}`).join("／");
}

// 閲覧を検知したときのChat通知
export async function notifyDocView(link, view) {
  const who = [link.company, link.contact].filter(Boolean).join(" ") || link.email || "宛先不明";
  const lines = [
    "*資料が閲覧されました*",
    `${who}`,
    `資料：${link.doc_name || "-"}`,
    `滞在 ${fmtSeconds(view.seconds)}／${view.max_page ? `${view.max_page}ページまで` : "ページ不明"}`,
  ];
  const tp = topPages(view.pages);
  if (tp) lines.push(`よく見たページ：${tp}`);
  if (link.owner) lines.push(`担当：${String(link.owner).split("@")[0]}`);
  return notifyChat(lines.join("\n"));
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

// 数秒おきの進捗。しきい値を超えたら、その閲覧について1回だけ通知する。
export async function beatDocViewAndNotify(slug, viewId, body) {
  const link = await getDocLink(slug);
  if (!link) return { error: "見つかりません" };
  const view = await beatDocView(viewId, {
    seconds: body?.seconds,
    maxPage: body?.maxPage,
    pages: body?.pages,
  });
  if (!view) return { error: "記録できませんでした" };
  if (!view.notified && view.seconds >= NOTIFY_MIN_SECONDS) {
    await markDocViewNotified(view.id);
    notifyDocView(link, view).catch(() => {});
  }
  return { ok: true, seconds: view.seconds };
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

// リンクのクリック
export async function recordClick(slug, url, req) {
  const link = await getDocLink(slug);
  if (!link) return null;
  await addDocEvent(link.id, "click", { url, ua: req.headers["user-agent"] });
  console.log(`[doc] クリック ${slug} → ${String(url).slice(0, 80)}`);
  return link;
}
