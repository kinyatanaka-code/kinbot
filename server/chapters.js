// chapters.js — 商談の段階（章）を、動画の位置に変換できる形にまとめる
export function buildChapters(tr, raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  // 同じ段階が続いている場合はまとめる
  const merged = [];
  for (const c of raw) {
    const last = merged[merged.length - 1];
    if (last && last.phase === c.phase) {
      last.to = c.to;
      if (c.note && last.note && !last.note.includes(c.note)) last.note = last.note + " / " + c.note;
      continue;
    }
    merged.push({ ...c });
  }

  // 発言ごとの累積文字数（話した長さの目安）
  const cum = [0];
  for (let i = 0; i < tr.length; i++) cum.push(cum[i] + Math.max(1, String((tr[i] && tr[i].text) || "").length));
  const totalChars = cum[tr.length] || 1;

  const firstTs = (() => { const u = tr.find((x) => x && x.ts); return u ? new Date(u.ts).getTime() : 0; })();
  const secOf = (i) => {
    const u = tr[Math.max(0, Math.min(tr.length - 1, i))] || {};
    if (typeof u.off === "number" && isFinite(u.off)) return Math.max(0, Math.round(u.off));
    if (u.ts && firstTs) return Math.max(0, Math.round((new Date(u.ts).getTime() - firstTs) / 1000));
    return null;
  };
  // 秒が「ちゃんと増えているか」を確かめる（全部0や同じ値なら使わない）
  const secs = merged.map((c) => secOf(c.from));
  const secOk = secs.every((v) => v !== null) && secs[secs.length - 1] > 30 &&
                secs.every((v, i) => i === 0 || v >= secs[i - 1]);

  return merged.slice(0, 9).map((c, i) => ({
    phase: c.phase,
    note: c.note,
    from: c.from,
    to: c.to,
    start: secOk ? secs[i] : null,
    end: secOk ? Math.max(secs[i] + 1, secOf(c.to)) : null,
    ratioStart: Math.min(1, cum[Math.max(0, c.from)] / totalChars),
    ratioEnd: Math.min(1, cum[Math.min(tr.length, c.to + 1)] / totalChars),
  }));
}

