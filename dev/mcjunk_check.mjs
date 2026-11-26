// 会社名ではないリードの見分け（server/mcjunk.js）の確かめ。使い方：node dev/mcjunk_check.mjs
import assert from "node:assert/strict";
import { isJunkCompany } from "../server/mcjunk.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
t("福井さんが見つけた2件は会社名ではない", () => { assert.equal(isJunkCompany("テスト山田"), true); assert.equal(isJunkCompany("ロープレ練習"), true); });
t("ほかのテスト用の名前も当たる", () => {
  for (const v of ["テスト", "ﾃｽﾄ株", "テスト 太郎", "ロープレ用", "練習用リード", "ダミー会社", "サンプル", "test", "Test Company", "TEST山田", "ｔｅｓｔ"]) assert.equal(isJunkCompany(v), true, v);
});
t("法人格の付いた本物の会社は残す", () => {
  for (const v of ["株式会社テストテック", "テスト工業株式会社", "(株)サンプル百貨", "㈱ダミー", "有限会社練習堂", "医療法人テスト会", "Testing Inc.", "Contest Co., Ltd."]) assert.equal(isJunkCompany(v), false, v);
});
t("ふつうの会社名・空は当たらない", () => {
  for (const v of ["", null, undefined, "株式会社都筑製作所", "親和電機株式会社", "山田商事", "コンテスト企画", "プロテスト研究所", "Attestation"]) assert.equal(isJunkCompany(v), false, String(v));
});
console.log(`すべて通りました（${n}件）`);
