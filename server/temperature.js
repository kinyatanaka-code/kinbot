// server/temperature.js — 画面と同じ計算式を使うため public/temperature.js を読み込む
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "public", "temperature.js"), "utf8");
const box = {};
// eslint-disable-next-line no-new-func
new Function(src).call(box);

const KBTemp = box.KBTemp || { score: () => ({ score: 0, curve: [], rise: 0, swing: 0 }) };

export const scoreTranscript = (utterances, repName) => KBTemp.score(utterances, repName);
export default KBTemp;
