// ───────────────────────────────────────────────────────────
// bulklinks.js — 名簿ファイルから、資料URLをまとめて発行する
//
// CSV・Excel・タブ区切り・Googleスプレッドシートの表を読み込み、
// 「会社名・担当者名・メール」を取り出して、少しずつURLを発行します。
//
// 数千件になるので、
//   ・少しずつ（100件ずつ）進める
//   ・いまどこまで進んだかを、画面から見られるようにする
//   ・途中で止めても、そこまでは残る
// ───────────────────────────────────────────────────────────
import * as XLSX from "xlsx";

// 進み具合をここに覚えておく（画面から聞かれたら返す）
const jobs = new Map();

export function newJobId() {
  return "bulk_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function getJob(id) {
  return jobs.get(String(id)) || null;
}

export function cancelJob(id) {
  const j = jobs.get(String(id));
  if (j && j.state === "running") { j.cancel = true; return true; }
  return false;
}

// 古い記録は片付ける（増え続けないように）
function sweepJobs() {
  const cut = Date.now() - 60 * 60 * 1000;
  for (const [id, j] of jobs) if (j.finishedAt && j.finishedAt < cut) jobs.delete(id);
}

// ───────── 表を読む ─────────

// 見出しの言い方はまちまちなので、いろいろな書き方を受け止める
const HEAD = {
  company: ["会社名", "会社", "企業名", "企業", "法人名", "取引先名", "取引先", "顧客名", "顧客", "company", "account", "corp"],
  name: ["担当者名", "担当者", "担当", "氏名", "名前", "宛名", "ご担当", "name", "contact", "person"],
  email: ["メール", "メールアドレス", "email", "mail", "e-mail", "アドレス"],
};

function pickCols(header) {
  const norm = (v) => String(v || "").replace(/[\s　_\-]/g, "").toLowerCase();
  const idx = { company: -1, name: -1, email: -1 };
  header.forEach((h, i) => {
    const t = norm(h);
    if (!t) return;
    for (const key of ["company", "name", "email"]) {
      if (idx[key] !== -1) continue;
      if (HEAD[key].some((w) => t === norm(w) || t.includes(norm(w)))) idx[key] = i;
    }
  });
  return idx;
}

// メールらしい文字列か
const looksMail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

// 表（2次元の配列）から、宛先の一覧を作る。
// 見出しが無くても、メールらしい列を見つけて拾う。
export function rowsFromTable(table) {
  const rows = (table || []).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "").trim()) : []));
  const nonEmpty = rows.filter((r) => r.some((c) => c));
  if (!nonEmpty.length) return { items: [], note: "中身が空でした" };

  // 1行目が「見出し」かどうかを見分ける。
  // 列名らしい言葉が入っていて、かつメールアドレスが入っていない行を見出しとみなす。
  // （1行目からデータが始まる表を、見出しと間違えないため）
  const first = nonEmpty[0];
  const firstHasMail = first.some((c) => looksMail(c));
  let idx = pickCols(first);
  const named = ["company", "name", "email"].filter((k) => idx[k] !== -1).length;
  const hasHeader = !firstHasMail && named >= 1;
  let body = nonEmpty;
  if (hasHeader) body = nonEmpty.slice(1);
  else idx = { company: -1, name: -1, email: -1 };

  // 見出しが無いときは、メールらしい列を探して決める
  if (!hasHeader) {
    const width = Math.max(...nonEmpty.map((r) => r.length));
    for (let c = 0; c < width; c++) {
      const hit = nonEmpty.filter((r) => looksMail(r[c])).length;
      if (hit >= Math.max(1, Math.floor(nonEmpty.length * 0.5))) { idx.email = c; break; }
    }
    // 会社名・担当者名は、メール列の左側から順に当てる
    const others = [];
    const width2 = Math.max(...nonEmpty.map((r) => r.length));
    for (let c = 0; c < width2; c++) if (c !== idx.email) others.push(c);
    idx.company = others[0] ?? -1;
    idx.name = others[1] ?? -1;
  }

  const items = [];
  const skipped = [];
  for (const r of body) {
    const company = idx.company >= 0 ? r[idx.company] || "" : "";
    const name = idx.name >= 0 ? r[idx.name] || "" : "";
    let email = idx.email >= 0 ? r[idx.email] || "" : "";
    // 列がずれていても、行の中にメールがあれば拾う
    if (!looksMail(email)) {
      const found = r.find((c) => looksMail(c));
      if (found) email = found;
    }
    if (!company && !name && !email) continue;
    if (email && !looksMail(email)) { skipped.push({ 行: r.join(" / "), 理由: "メールの形が違います" }); continue; }
    items.push({ company, name, email });
  }
  return {
    items,
    列: {
      会社名: idx.company >= 0 ? idx.company + 1 + "列目" : "なし",
      担当者名: idx.name >= 0 ? idx.name + 1 + "列目" : "なし",
      メール: idx.email >= 0 ? idx.email + 1 + "列目" : "なし",
    },
    見出しあり: hasHeader,
    飛ばした: skipped.slice(0, 20),
  };
}

// Excelのファイルかどうかを、中身の先頭で見分ける
function isExcel(buffer) {
  if (!buffer || buffer.length < 4) return false;
  // xlsx は ZIP（PK..）、古いxlsは D0 CF 11 E0
  return (buffer[0] === 0x50 && buffer[1] === 0x4b) ||
         (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0);
}

// CSVの文字コードを見分けて、文字列にする。
// Excelから保存したCSVは Shift_JIS のことが多く、そのまま読むと文字化けするため。
function textFromBuffer(buffer) {
  // BOM付きUTF-8
  if (buffer.length > 2 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buffer.subarray(3));
  }
  const asUtf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  // 読めない文字（�）が混ざっていたら Shift_JIS として読み直す
  if (asUtf8.includes("\uFFFD")) {
    try { return new TextDecoder("shift_jis").decode(buffer); } catch {}
    try { return new TextDecoder("windows-31j").decode(buffer); } catch {}
  }
  return asUtf8;
}

// アップロードされたファイルを表にする（CSV・Excel・タブ区切り）
export function tableFromFile(buffer, filename = "") {
  const name = String(filename).toLowerCase();

  // CSVやテキストは、文字コードを見分けてから読む
  if (!isExcel(buffer)) {
    const text = textFromBuffer(buffer);
    const r = tableFromText(text);
    return { table: r.table, sheetName: "", sheetCount: 0, kind: r.kind };
  }

  const wb = XLSX.read(buffer, { type: "buffer", raw: false, cellDates: false });
  const first = wb.SheetNames[0];
  if (!first) throw new Error("シートが見つかりません");
  const sheet = wb.Sheets[first];
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
  return { table, sheetName: first, sheetCount: wb.SheetNames.length, kind: "Excel" };
}

// 貼り付けた文字（タブ区切り・カンマ区切り）を表にする
export function tableFromText(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0] && lines[0].includes("\t") ? "\t" : ",";
  return { table: lines.map((l) => l.split(sep)), kind: sep === "\t" ? "タブ区切り" : "CSV" };
}

// ───────── 少しずつ発行する ─────────

// 100件ずつ発行して、進み具合を残す。
// addLinks は「その塊を発行する処理」（呼び出し側から渡す）。
export async function runBulk({ id, docId, items, owner, addLinks, chunk = 100 }) {
  sweepJobs();
  const job = {
    id, docId, owner,
    total: items.length,
    done: 0,
    made: 0,
    failed: 0,
    errors: [],
    state: "running",
    startedAt: Date.now(),
    finishedAt: null,
    cancel: false,
  };
  jobs.set(String(id), job);

  (async () => {
    for (let i = 0; i < items.length; i += chunk) {
      if (job.cancel) { job.state = "canceled"; break; }
      const part = items.slice(i, i + chunk);
      try {
        const made = await addLinks(part);
        job.made += (made || []).length;
      } catch (e) {
        job.failed += part.length;
        if (job.errors.length < 10) job.errors.push(String(e.message || e).slice(0, 200));
        console.error(`[一括発行] ${i + 1}〜${i + part.length}件目で失敗:`, e.message);
      }
      job.done = Math.min(items.length, i + part.length);
      // 少し休んで、ほかの処理を止めないようにする
      await new Promise((r) => setTimeout(r, 60));
    }
    if (job.state === "running") job.state = "done";
    job.finishedAt = Date.now();
    console.log(`[一括発行] ${job.state}：${job.made}件（失敗 ${job.failed}件／${Math.round((job.finishedAt - job.startedAt) / 1000)}秒）`);
  })();

  return job;
}
