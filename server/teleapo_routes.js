// テレアポ科学モデル v1 の API（2026-11-16）
//
// DOC の kincall と MOCHICA の架電（mccall）のどちらからでも使えるように、表や画面には結びつけず、
// 「文字起こしを渡すと診断が返る」「診断を集めると問題の場所が返る」だけの入口にしてある。
// 画面への組み込みは、それぞれの架電画面の作業が落ち着いてから足す。
//
//   GET  /api/teleapo/model      … モデルの定義（数字の出どころ・減点しない項目）
//   POST /api/teleapo/diagnose   … { transcript, callType, durationSec, reach, callerName, product } → 注釈・保留・診断
//                                   annotation を渡せば AI を呼ばずに診断だけ（過去の注釈の再計算用）
//   POST /api/teleapo/aggregate  … { items: [{ annotation, meta }] } → 指標 K1〜K6・問題の場所・てこ
import { MODEL, POINTS, diagnoseCall, verifyAnnotation, aggregate } from "./teleapo_science.js";
import { annotateCall, transcriptToLines } from "./teleapo_annotate.js";

export function registerTeleapoScience(app) {
  const guard = (fn) => async (req, res) => {
    try { if (!req.user) return res.status(401).json({ error: "ログインしてください" }); await fn(req, res); }
    catch (e) { console.error("[teleapo]", req.path, e.message); res.status(500).json({ error: `診断できませんでした：${e.message}` }); }
  };

  app.get("/api/teleapo/model", guard(async (req, res) => res.json({ model: MODEL, points: POINTS })));

  app.post("/api/teleapo/diagnose", guard(async (req, res) => {
    const b = req.body || {};
    let ann = b.annotation && typeof b.annotation === "object" ? b.annotation : null;
    let text = b.transcript ? transcriptToLines(b.transcript) : "";
    if (!ann) {
      if (!text) return res.status(400).json({ error: "文字起こし（transcript）か注釈（annotation）を送ってください" });
      const r = await annotateCall({ transcript: b.transcript, product: b.product, callerName: b.callerName });
      ann = r.annotation; text = r.transcriptText;
    }
    const v = verifyAnnotation(ann, text);
    const meta = {
      callType: b.callType || ann.call_type_guess,
      durationSec: b.durationSec ?? ann.duration_sec,
      reach: ["none", "gate", "person"].includes(b.reach) ? b.reach : undefined,
    };
    res.json({ model: `${MODEL.name} v${MODEL.version}`, annotation: v.annotation, hold: v.hold, verified: v.verified, meta, diagnosis: diagnoseCall(v.annotation, meta) });
  }));

  app.post("/api/teleapo/aggregate", guard(async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 5000) : [];
    if (!items.length) return res.status(400).json({ error: "items（[{ annotation, meta }] の配列）を送ってください" });
    res.json(aggregate(items));
  }));
}
