// DOC の AI（次面談話）の管理画面の中で動く部分（ページと同じ側・2026-11-18 田中さん「拡張機能でなんとか連続でよみとりたい」）。
//   管理画面は、最初に見たチャットの「session_id=…&company=…」を覚えていて、画面が動くたびにそれをサーバーへ送り直すので、
//   左で会社を変えても、チャットを選んだ瞬間に前の会社にもどる（管理画面そのものの動き）。
//   取り込みの間だけ、サーバーへ送る中の「company=前の会社」を「company=いま読む会社」に差しかえる。ページは読み込み直さない（ログインはそのまま）
(function () {
  if (window.__kbDocAiHook) return; window.__kbDocAiHook = true;
  let target = "";   // 取り込み中に読む会社（空なら何もしない）
  window.addEventListener("message", (e) => { const d = e.data; if (e.source === window && d && d.__kbDocAiTarget !== undefined) target = String(d.__kbDocAiTarget || ""); });
  const say = (msg) => { try { window.postMessage({ __kbDocAiHookLog: msg }, "*"); } catch {} };
  const te = new TextEncoder(), td = new TextDecoder("utf-8", { fatal: true });
  // ── protobuf をほどく・組み直す（形は決め打ちしない。文字の中身で探す）──
  function readVarint(b, p) { let v = 0, s = 0, c; do { if (p >= b.length) return null; c = b[p++]; v += (c & 0x7f) * Math.pow(2, s); s += 7; } while (c & 0x80 && s < 64); return [v, p]; }
  function varint(n) { const o = []; do { let c = n % 128; n = Math.floor(n / 128); if (n > 0) c |= 0x80; o.push(c); } while (n > 0); return o; }
  function parse(b) {
    const out = []; let p = 0;
    while (p < b.length) {
      const st = p; const t = readVarint(b, p); if (!t) return null; const key = t[0]; p = t[1]; const wire = key % 8; const field = Math.floor(key / 8); if (field < 1) return null;
      if (wire === 0) { const v = readVarint(b, p); if (!v) return null; out.push({ field, wire, raw: b.subarray(st, v[1]) }); p = v[1]; }
      else if (wire === 1) { if (p + 8 > b.length) return null; out.push({ field, wire, raw: b.subarray(st, p + 8) }); p += 8; }
      else if (wire === 5) { if (p + 4 > b.length) return null; out.push({ field, wire, raw: b.subarray(st, p + 4) }); p += 4; }
      else if (wire === 2) { const l = readVarint(b, p); if (!l) return null; p = l[1]; if (p + l[0] > b.length) return null; out.push({ field, wire, key, raw: b.subarray(st, p + l[0]), val: b.subarray(p, p + l[0]) }); p += l[0]; }
      else return null;
    }
    return out;
  }
  // 「company=」を含む文字を見つけたら、company をいまの会社にして、前のチャット（session_id）は外す
  function fixQs(s) {
    const q = new URLSearchParams(s); const co = q.get("company");
    if (!target || co === null || co === target) return null;
    return `company=${encodeURIComponent(target)}`;
  }
  function rewrite(b, depth) {
    if (depth > 6) return null;
    const fs = parse(b); if (!fs || !fs.length) return null;
    let changed = false; const parts = [];
    for (const f of fs) {
      if (f.wire !== 2) { parts.push(f.raw); continue; }
      let nv = null;
      let str = null; try { str = td.decode(f.val); } catch {}
      if (str !== null && /(^|&)company=/.test(str) && !/[\u0000-\u0008]/.test(str) && str.length < 2000) {
        const fixed = fixQs(str); if (fixed !== null) { nv = te.encode(fixed); say(`送る中身の「${str.slice(0, 80)}」を「${fixed}」に差しかえ`); }
      } else if (f.val.length > 1) {
        nv = rewrite(f.val, depth + 1);
      }
      if (nv) { changed = true; parts.push(Uint8Array.from([...varint(f.key), ...varint(nv.length)])); parts.push(nv); }
      else parts.push(f.raw);
    }
    if (!changed) return null;
    const n = parts.reduce((a, x) => a + x.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of parts) { o.set(x, p); p += x.length; } return o;
  }
  const _send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (target && (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) {
        const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const nb = rewrite(u8, 0);
        if (nb) return _send.call(this, nb);
      }
    } catch (e) { say(`差しかえに失敗：${e && e.message}`); }
    return _send.call(this, data);
  };
})();
