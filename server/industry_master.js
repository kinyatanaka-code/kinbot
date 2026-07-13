// Feature C 4.5: 業界区分マスタ
// 日本標準産業分類の「大分類」レベル（約20区分）に準拠。
// Web検索エンリッチメントの出力を自由記述にせず、このマスタから選ばせることで表記ゆれを防ぐ（依頼書4.5）。
// IDは大分類コード（A〜T）を使う。

export const INDUSTRY_MASTER = [
  { id: "A", name: "農業，林業" },
  { id: "B", name: "漁業" },
  { id: "C", name: "鉱業，採石業，砂利採取業" },
  { id: "D", name: "建設業" },
  { id: "E", name: "製造業" },
  { id: "F", name: "電気・ガス・熱供給・水道業" },
  { id: "G", name: "情報通信業" },
  { id: "H", name: "運輸業，郵便業" },
  { id: "I", name: "卸売業，小売業" },
  { id: "J", name: "金融業，保険業" },
  { id: "K", name: "不動産業，物品賃貸業" },
  { id: "L", name: "学術研究，専門・技術サービス業" },
  { id: "M", name: "宿泊業，飲食サービス業" },
  { id: "N", name: "生活関連サービス業，娯楽業" },
  { id: "O", name: "教育，学習支援業" },
  { id: "P", name: "医療，福祉" },
  { id: "Q", name: "複合サービス事業" },
  { id: "R", name: "サービス業（他に分類されないもの）" },
  { id: "S", name: "公務（他に分類されるものを除く）" },
  { id: "T", name: "分類不能の産業" },
];

export const INDUSTRY_NAMES = INDUSTRY_MASTER.map((m) => m.name);

export function industryNameById(id) {
  const m = INDUSTRY_MASTER.find((x) => x.id === id);
  return m ? m.name : "";
}

export function industryIdByName(name) {
  const m = INDUSTRY_MASTER.find((x) => x.name === String(name || "").trim());
  return m ? m.id : "";
}

// 職種の固定カテゴリ（求人媒体検索の出力を正規化するための語彙）
export const JOB_TYPE_MASTER = [
  "エンジニア", "営業", "事務・管理部門", "マーケティング", "企画",
  "販売・サービス", "医療・介護・福祉", "製造・技能工", "物流・ドライバー",
  "建築・土木", "教育", "クリエイティブ", "専門職（士業等）", "その他",
];
