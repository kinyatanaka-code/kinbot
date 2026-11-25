import { isUtf8 } from "node:buffer";
import { Readable } from "node:stream";
import { parse } from "csv-parse";

const aliases = {
  companyName: "会社情報：会社名", companyTel1: "会社情報：電話", personalTel: "担当者情報：電話",
  numberOfEmployees: "会社情報：従業員規模", industry: "会社情報：業種",
  email: "担当者情報：メール", department: "担当者情報：部署", position: "担当者情報：役職",
  operatorName: "リード関連情報：リード所有者", lastLeadStageName: "リード関連情報：最終リードステージ",
  callTargetId: "システム管理情報：ID", callResult: "コール結果1：結果", lastCalledAt: "コール結果1：開始日時",
  lastActivityComment: "コール結果1：コメント"
};

export class BalesCsvError extends Error {}

export async function* readBalesCsv(bytes) {
  const decoder = new TextDecoder(isUtf8(bytes) ? "utf-8" : "shift_jis", { fatal: true });
  function* chunks() {
    for (let i = 0; i < bytes.length; i += 65536) {
      yield decoder.decode(bytes.subarray(i, i + 65536), { stream: true });
    }
    yield decoder.decode();
  }
  const parser = parse({ bom: true, skip_empty_lines: true });
  const source = Readable.from(chunks());
  source.on("error", (err) => parser.destroy(err));
  source.pipe(parser);
  try {
    let header, tags, sources;
    let count = 0;
    for await (const cells of parser) {
      if (!header) {
        header = cells;
        if (!header.includes(aliases.companyName) || header.some(h => !h) || new Set(header).size !== header.length) {
          throw new BalesCsvError("BALES標準CSVの見出しを確認してください（会社情報：会社名が必須、空欄・重複は不可）。");
        }
        tags = header.filter(key => key.startsWith("タグ："));
        sources = header.filter(key => key.startsWith("リードソース："));
        yield { header };
        continue;
      }
      const data = Object.fromEntries(header.map((key, i) => [key, cells[i]]));
      for (const [key, label] of Object.entries(aliases)) data[key] = data[label] || "";
      // CSV に次回アクション列が含まれている場合も MOCHICALL/リスト管理で同じ形式として読めるように写す
      const seenNx = new Set();
      for (const key of header) {
        const m = /^(?:次回|次の|ネクスト)アクション\s*(\d*)\s*[：:]?\s*(.+)$/.exec(key);
        if (!m) continue;
        const val = String(data[key] || "").trim();
        if (!val) continue;
        const idx = m[1] ? Math.max(0, parseInt(m[1], 10) - 1) : 0;
        const sub = m[2].trim();
        if (/コメント|内容|メモ|備考/.test(sub)) data[`nextActions.${idx}.content`] = val;
        else if (/日時|予定|予約|期限/.test(sub)) data[`nextActions.${idx}.reservedAt`] = val;
        else if (/種別|アクション名|名前|タイプ|タイトル/.test(sub)) data[`nextActions.${idx}.name`] = val;
        else if (/担当|所有/.test(sub)) data[`nextActions.${idx}.owner.name`] = val;
        else if (/完了|ステータス|状態/.test(sub)) data[`nextActions.${idx}.isDone`] = /^(1|true|済|完了)$/i.test(val) ? "true" : "false";
        seenNx.add(idx);
      }
      for (const idx of seenNx) {
        if (data[`nextActions.${idx}.isDone`] == null) data[`nextActions.${idx}.isDone`] = "false";
      }
      tags.filter(key => data[key] === "1").forEach((key, i) => { data[`freeTags.${i}.text`] = key.slice(3); });
      sources.filter(key => data[key] === "1").forEach((key, i) => { data[`leadSources.${i}.name`] = key.slice("リードソース：".length); });
      data.targetName = [data["担当者情報：姓"], data["担当者情報：名"]].filter(Boolean).join(" ");
      yield { k: String(++count), d: data };
    }
    if (!count) throw new BalesCsvError("CSVにデータ行がありません。");
  } catch (err) {
    if (err.code?.startsWith("CSV_")) throw new BalesCsvError(`CSVの形式を確認してください（${err.lines || 1}行目付近）。`);
    if (err.code === "ERR_ENCODING_INVALID_ENCODED_DATA") throw new BalesCsvError("CSVの文字コードを確認してください。");
    throw err;
  } finally {
    source.destroy();
    parser.destroy();
  }
}
