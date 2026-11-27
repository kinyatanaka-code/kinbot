// リードの移行（server/mctransfer.js）の持ち主の見立ての試験。node dev/mctransfer_test.mjs
import { judgeOwner, balesOwners } from "../server/mctransfer.js";
import { normCompanyKey } from "../server/db.js";

let ng = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) ng++; console.log(`${ok ? "OK" : "NG"} ${name}${ok ? "" : `：${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`}`); };

const idx = { listKey: "bales:1", row: new Map([["r1", "大沢瑛太"], ["r2", "福井聖"]]),
  co: new Map([[normCompanyKey("親和電機株式会社"), new Set(["大沢瑛太"])], [normCompanyKey("都筑製作所"), new Set(["足立太郎", "福井聖"])]]),
  lid: new Map([["00Q000000000001", new Set(["足立太郎"])]]) };
const names = new Map([["fukui@x.jp", "福井 聖"], ["osawa@x.jp", "大沢 瑛太"], ["adachi@x.jp", "足立 太郎"]]);
const fmap = new Map([["大沢瑛太", "osawa@x.jp"], ["福井聖", "fukui@x.jp"]]);
const c = { u: "fukui@x.jp", myB: "福井聖", idx, fmap, names };

eq("主のリストの行の持ち主（ほかの人）", balesOwners(idx, { src: "bales", src_key: "bales:1|r1" }), new Set(["大沢瑛太"]));
eq("MOCHICALL の担当がほかの人", judgeOwner({ assigned_to: "Adachi@x.jp" }, c), { st: "other", email: "adachi@x.jp", name: "足立 太郎" });
eq("BALES の所有者がほかの人（メールが分かる）", judgeOwner({ src: "bales", src_key: "bales:1|r1" }, c), { st: "other", email: "osawa@x.jp", name: "大沢 瑛太" });
eq("SF リードで当たる持ち主（メールが分からない＝管理者へ）", judgeOwner({ sf_lead_id: "00Q000000000001AAA" }, c), { st: "other", email: "", name: "足立太郎" });
eq("自分の行", judgeOwner({ src: "bales", src_key: "bales:1|r2" }, c), { st: "mine", email: "fukui@x.jp", name: "福井 聖" });
eq("自分の担当", judgeOwner({ assigned_to: "fukui@x.jp", company: "どこにもない会社" }, c), { st: "mine", email: "fukui@x.jp", name: "福井 聖" });
eq("会社に自分が含まれる", judgeOwner({ company: "都筑製作所" }, c), { st: "mine", email: "fukui@x.jp", name: "福井 聖" });
eq("持ち主なし", judgeOwner({ company: "新しい会社" }, c), { st: "none", email: "", name: "" });
eq("BALES の名前が無い人は持ち主のいる会社はほかの人", judgeOwner({ company: "親和電機（株）" }, { ...c, myB: "" }).st, "other");
eq("索引が読めないときは担当だけで見る", judgeOwner({ company: "親和電機" }, { ...c, idx: null }).st, "none");

console.log(ng ? `NG ${ng}件` : "すべて OK");
process.exit(ng ? 1 : 0);
