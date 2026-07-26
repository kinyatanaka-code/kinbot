// temperature.js — 顧客の温度感を文字起こしから計算する（画面・サーバー共通）
// AIを使わずキーワードで数えるので、過去の商談にもすぐ反映されます。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KBTemp = api;
})(typeof self !== "undefined" ? self : this, function () {
  const WORDS = {
    // 前向きの強いことば（購買の意思に近い）
    strong: ["導入したい", "導入して", "進めたい", "進めましょう", "やりたい", "お願いしたい", "お願いします", "使いたい", "使ってみたい", "申し込", "契約", "前向き", "ぜひ", "やってみたい", "始めたい", "乗り換え"],
    // やわらかい好意的なことば
    mild: ["いいですね", "良いですね", "いいと思い", "良いと思い", "便利", "助かり", "面白", "おもしろ", "興味", "魅力", "期待", "ありがたい", "わかりやすい", "分かりやすい", "すごい", "すばらしい", "素晴らしい", "楽しみ", "ちょうど探して", "気になって"],
    // 買う話に入っているサイン
    signal: ["見積", "お見積", "料金", "費用", "価格", "値段", "予算", "稟議", "決裁", "社内で共有", "上に相談", "上長", "導入時期", "いつから", "いつ頃", "スケジュール", "トライアル", "無料期間", "事例", "導入実績", "サポート体制", "契約期間", "初期費用", "比較", "他社"],
    // 懸念・後ろ向きのことば
    negative: ["高すぎ", "ちょっと高", "少し高", "高いです", "高いな", "高いね", "値段が高", "価格が高", "費用が高", "厳しい", "難しい", "むずかしい", "見送", "不要", "必要ない", "間に合って", "足りて", "まだ早い", "予算が厳", "予算が取れ", "時間がない", "忙しく", "不安", "心配", "リスク", "他社で", "すでに導入", "もう入れて", "うちには合わ", "ピンとこ", "微妙"],
  };

  const QUESTION = /[?？]|ですか|ますか|でしょうか/;

  function labelOf(sp) {
    return sp ? (sp.name || "話者" + (sp.id != null ? sp.id : "")) : "話者";
  }

  function hits(text, list) {
    const found = [];
    for (const w of list) if (text.indexOf(w) >= 0) found.push(w);
    return found;
  }

  // 1発話ぶんの点数の材料を数える
  function tally(text) {
    return {
      strong: hits(text, WORDS.strong),
      mild: hits(text, WORDS.mild),
      signal: hits(text, WORDS.signal),
      negative: hits(text, WORDS.negative),
      question: QUESTION.test(text) ? 1 : 0,
    };
  }

  // 区間ごとの温度（50を普通として上下する）
  function segmentScore(agg) {
    const raw = agg.strong * 10 + agg.signal * 7 + agg.mild * 4 + agg.question * 4 - agg.negative * 9;
    return Math.max(0, Math.min(100, Math.round(50 + raw)));
  }

  // utterances: [{ speaker:{name}, text }]、repName: 自社担当の名前
  function score(utterances, repName) {
    const tr = Array.isArray(utterances) ? utterances : [];
    const rep = String(repName || "").replace(/\s+/g, "");
    const isRep = (u) => !!(rep && labelOf(u.speaker).replace(/\s+/g, "").indexOf(rep) >= 0);

    const cust = [];
    let custChars = 0, allChars = 0, repQuestions = 0, repLines = 0;
    for (const u of tr) {
      const text = String(u.text || "");
      allChars += text.length;
      if (isRep(u)) {
        repLines++;
        if (QUESTION.test(text)) repQuestions++;
      } else if (text.trim()) {
        cust.push({ who: labelOf(u.speaker), text, t: tally(text) });
        custChars += text.length;
      }
    }

    const out = {
      known: !!(rep && repLines > 0),
      custTurns: cust.length, repQuestions,
      strong: 0, mild: 0, signal: 0, negative: 0, custQuestions: 0,
      custRatio: allChars ? Math.round((custChars / allChars) * 100) : 0,
      quotesPos: [], quotesNeg: [], curve: [], rise: 0, swing: 0, score: 0, level: "—", levelNote: "",
    };
    if (!cust.length) return out;

    for (const c of cust) {
      out.strong += c.t.strong.length;
      out.mild += c.t.mild.length;
      out.signal += c.t.signal.length;
      out.negative += c.t.negative.length;
      out.custQuestions += c.t.question;
      // 懸念の言葉が混ざっている発言は「前向き」に出さない
      if ((c.t.strong.length || c.t.mild.length || c.t.signal.length) && !c.t.negative.length && out.quotesPos.length < 5) {
        out.quotesPos.push({ who: c.who, text: c.text, words: c.t.strong.concat(c.t.signal, c.t.mild).slice(0, 3) });
      }
      if (c.t.negative.length && out.quotesNeg.length < 5) {
        out.quotesNeg.push({ who: c.who, text: c.text, words: c.t.negative.slice(0, 3) });
      }
    }

    // 全体スコア（0〜100）。項目ごとに上限を設けて、長い商談ほど高くなりすぎないようにする。
    const pPos = Math.min(30, out.strong * 6 + out.mild * 2);
    const pQ = Math.min(20, out.custQuestions * 3);
    const pSig = Math.min(30, out.signal * 5);
    const pRat = Math.min(20, Math.round((out.custRatio / 55) * 20));
    const pNeg = Math.min(20, out.negative * 3);
    out.score = Math.max(0, Math.min(100, pPos + pQ + pSig + pRat - pNeg));
    out.level = out.score >= 70 ? "高い" : out.score >= 45 ? "ふつう" : "低い";
    out.levelNote = out.score >= 70 ? "前向きなサインが多い商談です"
      : out.score >= 45 ? "関心はありそうですが、決め手がまだ弱い商談です"
      : "反応が控えめな商談です。次回のヒアリングで課題を掘り下げましょう";

    // 温度の推移（商談を最大5つの区間に分けて、区間ごとの温度を出す）
    const segs = Math.max(2, Math.min(5, Math.floor(cust.length / 2)));
    if (cust.length >= 4) {
      const per = Math.ceil(cust.length / segs);
      for (let i = 0; i < segs; i++) {
        const part = cust.slice(i * per, (i + 1) * per);
        if (!part.length) continue;
        const agg = { strong: 0, mild: 0, signal: 0, negative: 0, question: 0 };
        for (const c of part) {
          agg.strong += c.t.strong.length; agg.mild += c.t.mild.length;
          agg.signal += c.t.signal.length; agg.negative += c.t.negative.length;
          agg.question += c.t.question;
        }
        out.curve.push(segmentScore(agg));
      }
      if (out.curve.length >= 2) {
        out.rise = out.curve[out.curve.length - 1] - out.curve[0];
        out.swing = Math.max.apply(null, out.curve) - Math.min.apply(null, out.curve);
      }
    }
    return out;
  }

  return { score, labelOf, WORDS };
});
