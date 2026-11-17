// Claude のスキル（kinbot につなぐ）を zip にする（2026-11-18 田中さん「コネクタを使わずに kinbot とつなぎたい。マネージャーの Claude はカスタムコネクタが制限されている」）。
//   新しいライブラリを足さないため、zip は「圧縮しない形（store）」で自分で組み立てる。中身は数KBなので圧縮しなくて困らない
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// files: [{ name: "kinbot/SKILL.md", data: Buffer|string }]
export function makeZip(files) {
  const locals = [], centrals = []; let off = 0;
  const now = new Date(); const dtime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const ddate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8"); const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), "utf8"); const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(dtime, 10); lh.writeUInt16LE(ddate, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(dtime, 12); ch.writeUInt16LE(ddate, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(off, 42);
    centrals.push(ch, name);
    off += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}

// その人専用の合言葉を入れたスキルの zip を作る
export function buildKinbotSkillZip({ base, token, who }) {
  const skill = fs.readFileSync(path.join(HERE, "skill", "SKILL.md"), "utf8");
  const py = fs.readFileSync(path.join(HERE, "skill", "kinbot.py"), "utf8");
  const cfg = JSON.stringify({ base, token, who, note: "この合言葉はあなた専用です。人に渡さないでください。無効にするときは kinbot の設定 → 連携 → Claude から" }, null, 2);
  return makeZip([
    { name: "kinbot/SKILL.md", data: skill },
    { name: "kinbot/config.json", data: cfg },
    { name: "kinbot/scripts/kinbot.py", data: py },
  ]);
}
