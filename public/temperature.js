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

  // つなぎ言葉（フィラー）。少ないほど聞き取りやすい商談。
  // 文字起こしに句読点が無いことがあるので、句読点に頼らない書き方にしている。
  const FILLER_PATTERNS = [
    { w: "えーと",   re: /え[ーえ〜]*っ?と/g },
    { w: "あのー",   re: /あの[ーぅう〜]/g },
    { w: "そのー",   re: /その[ーぅう〜]/g },
    { w: "うーん",   re: /[うふ][ーん〜]ん|うーん/g },
    { w: "えー",     re: /(^|[^かでさすねよいうくつるをんー])え[ー〜]+/g },
    { w: "あー",     re: /(^|[^ゃゅょっーな])あ[ー〜]+/g },
    { w: "なんか",   re: /なんか/g },
    { w: "まあ",     re: /ま[あぁ][ー〜]?/g },
    { w: "ちょっと", re: /ちょっと/g },
    { w: "やっぱり", re: /やっぱ[りし]?/g },
  ];
  // 次回の打ち合わせを決める話
  const NEXT_TALK = /次回|次の打ち合わせ|次のお時間|日程|候補日|ご都合|空いて|カレンダー|来週|再来週|来月|お時間いただ|アポ|お打ち合わせ|次は/;
  const NEXT_DATE = /[0-9０-９]{1,2}\s*月\s*[0-9０-９]{1,2}\s*日|[0-9０-９]{1,2}\/[0-9０-９]{1,2}|[月火水木金土日]曜|来週の[月火水木金土日]|午前|午後|[0-9０-９]{1,2}時/;
  const NEXT_OK = /大丈夫|空いて|お願いします|承知|了解|問題ない|いいですよ|そうしましょう|お待ちして|ありがとうございます/;

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
    const repTexts = [];
    let custChars = 0, allChars = 0, repChars = 0, repQuestions = 0, repLines = 0;
    for (const u of tr) {
      const text = String(u.text || "");
      allChars += text.length;
      if (isRep(u)) {
        repLines++;
        repChars += text.length;
        repTexts.push(text);
        if (QUESTION.test(text)) repQuestions++;
      } else if (text.trim()) {
        cust.push({ who: labelOf(u.speaker), text, t: tally(text) });
        custChars += text.length;
      }
    }

    const out = {
      known: !!(rep && repLines > 0),
      repChars: 0, filler: null, next: null, skill: 0,
      custTurns: cust.length, repQuestions,
      strong: 0, mild: 0, signal: 0, negative: 0, custQuestions: 0,
      custRatio: allChars ? Math.round((custChars / allChars) * 100) : 0,
      quotesPos: [], quotesNeg: [], curve: [], rise: 0, swing: 0, score: 0, level: "—", levelNote: "",
    };
    out.repChars = repChars;
    out.filler = countFiller(repTexts, repChars);
    out.next = findNextMeeting(tr, isRep);
    if (!cust.length) { out.skill = skillScore(out, 0); return out; }

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
    out.skill = skillScore(out, out.custRatio);
    return out;
  }

  // フィラー（つなぎ言葉）の回数。どの言葉が何回出たかも返す。
  function countFiller(repTexts, repChars) {
    const tally = {};
    const examples = [];
    let count = 0;
    for (const src of repTexts) {
      let rest = src;
      let hitHere = 0;
      // 前のパターンで数えた部分は消してから次を見る（「えーと」を「えー」で二重に数えないため）
      for (const pat of FILLER_PATTERNS) {
        pat.re.lastIndex = 0;
        rest = rest.replace(pat.re, (mm, pre) => {
          tally[pat.w] = (tally[pat.w] || 0) + 1;
          count++; hitHere++;
          return (pre || "") + "\u0000";
        });
      }
      if (hitHere && examples.length < 3) examples.push(src.length > 70 ? src.slice(0, 70) + "…" : src);
    }
    const breakdown = Object.keys(tally).map((w) => ({ w, n: tally[w] })).sort((a, b) => b.n - a.n);
    const per100 = repChars ? Math.round((count / repChars) * 100 * 10) / 10 : 0;
    const rating = !repChars ? "—"
      : count === 0 ? "文字起こしに見当たりません"
      : per100 <= 0.5 ? "少ない（聞き取りやすい）"
      : per100 <= 1.0 ? "ふつう"
      : per100 <= 2.0 ? "やや多い"
      : "多い";
    return { count, per100, rating, detected: count > 0, breakdown, examples, repChars };
  }

  // 次回商談の設定がスムーズだったか
  function findNextMeeting(tr, isRep) {
    let talked = false, dated = false, agreed = false, turns = 0, quote = "", startIdx = -1;
    for (let i = 0; i < tr.length; i++) {
      const text = String(tr[i].text || "");
      if (!text.trim()) continue;
      if (NEXT_TALK.test(text)) {
        if (!talked) { talked = true; startIdx = i; }
        turns++;
        if (NEXT_DATE.test(text)) { dated = true; if (!quote) quote = text; }
      }
      // 日程の話が出たあとの、お客様の同意
      if (talked && !isRep(tr[i]) && i >= startIdx && NEXT_OK.test(text) && (dated || NEXT_TALK.test(text))) {
        agreed = true;
        if (!quote) quote = text;
      }
    }
    const level = !talked ? "話が出ていない"
      : dated && agreed && turns <= 6 ? "スムーズに設定"
      : dated && agreed ? "設定できた（やり取り多め）"
      : dated ? "日程は出たが同意まで至らず"
      : "打診のみ";
    return { talked, dated, agreed, turns, level, quote: quote.length > 90 ? quote.slice(0, 90) + "…" : quote };
  }

  // 営業の進め方スコア（0〜100）
  function skillScore(o, custRatio) {
    const n = o.next || {};
    const pNext = n.level === "スムーズに設定" ? 40
      : n.level === "設定できた（やり取り多め）" ? 32
      : n.level === "日程は出たが同意まで至らず" ? 20
      : n.talked ? 14 : 0;
    const f = o.filler || {};
    const pFill = !f.repChars ? 12
      : f.count === 0 ? 22
      : f.per100 <= 0.5 ? 25
      : f.per100 <= 1.0 ? 18
      : f.per100 <= 2.0 ? 10
      : 3;
    const repRatio = 100 - custRatio;
    const pRatio = !custRatio ? 8
      : (repRatio >= 40 && repRatio <= 55) ? 20
      : (repRatio >= 30 && repRatio <= 65) ? 12
      : 5;
    const pQ = Math.min(15, Math.round((o.repQuestions || 0) * 1.5));
    return Math.max(0, Math.min(100, pNext + pFill + pRatio + pQ));
  }

  return { score, labelOf, WORDS };
});
