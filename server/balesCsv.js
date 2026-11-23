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
