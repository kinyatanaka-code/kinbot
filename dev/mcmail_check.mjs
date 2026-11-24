// MOCHICALL のメールの集め方（server/mcmail.js）の確かめ。使い方：node dev/mcmail_check.mjs
//   2026-11-24 浦田空調工業：SF のリードにメールがあるのに、画面に出ていなかった（左の欄は MOCHICALL で直した値しか見ていなかった）。
//   同じことが起きないよう「SF・BALES・DOC・CSV のメールが出る」「うちの人のメールは出さない」「画面ごとに別の探し方をしない」を見る
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leadMails, dataMails, sfLeadIdOf, isLeadMail } from "../server/mcmail.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const addrs = (ms) => ms.map((m) => m.addr);

t("浦田空調工業の形：MOCHICALL で直していなくても、SF のリードの Email が出る", () => {
  const ms = leadMails({ lead: { src: "bales", info: null, hearing: null }, data: { companyName: "浦田空調工業株式会社", targetName: "浦田" }, sf: { lead: { id: "00Q5h00000AbCdEFGH", company: "浦田空調工業株式会社" } }, sfEmail: "urata@example.co.jp" });
  assert.deepEqual(addrs(ms), ["urata@example.co.jp"]); assert.equal(ms[0].src, "sf");
});
t("見る順：ヒアリング → MOCHICALL で直した値 → 足した担当者 → SF → 元のデータ", () => {
  const ms = leadMails({ lead: { src: "doc", hearing: { mail: "a@x.jp" }, info: { email: "b@x.jp", contacts: [{ name: "佐藤", email: "c@x.jp" }] } }, data: { email: "e@x.jp" }, sfEmail: "d@x.jp" });
  assert.deepEqual(addrs(ms), ["a@x.jp", "b@x.jp", "c@x.jp", "d@x.jp", "e@x.jp"]);
  assert.deepEqual(ms.map((m) => m.src), ["hear", "edit", "contact", "sf", "data"]);
  assert.equal(ms[4].label, "DOC");
});
t("同じアドレスは1つだけ（大文字小文字・前後の空白・mailto: は同じとみなす）", () => {
  assert.deepEqual(addrs(leadMails({ lead: { info: { email: " Urata@Example.co.jp " } }, sfEmail: "mailto:urata@example.co.jp", data: { email: "URATA@example.co.jp" } })), ["Urata@Example.co.jp"]);
});
t("うちの人のメール（社内のドメイン・所有者や作成者の項目）は出さない", () => {
  assert.deepEqual(addrs(leadMails({ data: { operatorEmail: "someone@other.jp", ownerMail: "boss@other.jp", note: "fukui@neo-career.co.jp" }, sfEmail: "x@c-career.co.jp" })), []);
  assert.equal(isLeadMail("a@mail.neo-career.co.jp"), false);
});
t("元のデータは mail・メールの付く項目を先に、なければ値の形で拾う。_ で始まる中の項目は見ない", () => {
  assert.deepEqual(dataMails({ memo: "x@y.jp", "メールアドレス": "m@y.jp", _sf: "z@y.jp" }), ["m@y.jp", "x@y.jp", "m@y.jp"].slice(0, 3));
  assert.deepEqual(addrs(leadMails({ lead: { src: "csv" }, data: { memo: "x@y.jp", "メールアドレス": "m@y.jp" } })), ["m@y.jp", "x@y.jp"]);
});
t("SF のリードの Id：MOCHICALL の列が空なら BALES の行の SF の結びつきを使う。形の違うものは使わない", () => {
  assert.equal(sfLeadIdOf({ sf_lead_id: null }, { lead: { id: "00Q5h00000AbCdEFGH" } }), "00Q5h00000AbCdEFGH");
  assert.equal(sfLeadIdOf({ sf_lead_id: "00Q5h00000AbCdE" }, null), "00Q5h00000AbCdE");
  assert.equal(sfLeadIdOf({ sf_lead_id: "003xx" }, null), "");
});
t("画面ごとに別の探し方をしていない（サーバーは leadMails、画面は d.mails を使う）", () => {
  const sv = readFileSync(new URL("../server/mccall.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../public/mccall.js", import.meta.url), "utf8");
  assert.ok(!/emailOf\(data/.test(sv), "mccall.js に古いメールの探し方（emailOf）が残っています");
  assert.ok(/mails: leadMails\(/.test(sv), "1社の中身（/api/mccall/leads/:id）が mails を返していません");
  assert.equal((sv.match(/withMails: true/g) || []).length, 2, "資料送付・ヒアリングのメールの宛先が leadMails を使っていません");
  assert.ok(/contactsHtml\(L\.info, d\)/.test(ui), "左の欄が d.mails を見ていません");
});
console.log(`メールの集め方：${n}件すべてOK`);
