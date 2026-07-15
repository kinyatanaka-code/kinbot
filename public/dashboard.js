// ===== ダッシュボードビルダー V4 =====
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const PIE_COLORS = ["#0d5b47","#1d9e75","#5DCAA5","#9FE1CB","#BA7517","#378ADD","#D85A30","#534AB7","#D4537E","#E1F5EE"];
let allTags=[], userMap={};
const ownerName = e => userMap[String(e||"").toLowerCase()]||e||"不明";
const ARR = new Set(["appeal_points_used","talk_patterns","discovery_items_covered","key_pain_points","objections_raised","meeting_stages","target_job_type"]);

const AXES = [
  {v:"owner",l:"担当者",g:"基本"},
  {v:"customer_employee_size",l:"従業員規模",g:"売り先"},{v:"customer_industry",l:"業界",g:"売り先"},
  {v:"customer_hq_region",l:"地域",g:"売り先"},{v:"hiring_type_need",l:"新卒/中途",g:"売り先"},
  {v:"target_hire_count",l:"採用人数",g:"売り先"},{v:"target_job_type",l:"職種",g:"売り先"},
  {v:"appeal_points_used",l:"訴求内容",g:"売り方"},{v:"talk_patterns",l:"話法の型",g:"売り方"},
  {v:"objection_handling_style",l:"懸念対応",g:"売り方"},{v:"discovery_items_covered",l:"ヒアリング深度",g:"売り方"},
  {v:"meeting_stages",l:"ステップ構成",g:"売り方"},{v:"key_pain_points",l:"顧客の課題",g:"商談状況"},
  {v:"customer_response_status",l:"顧客反応",g:"商談状況"},{v:"result",l:"受注結果",g:"商談状況"},
];
const METRICS = [{v:"count",l:"件数"},{v:"pct",l:"構成比"},{v:"response_rate",l:"案件化率"},{v:"re_meeting_rate",l:"再商談実施率"},{v:"won_rate",l:"受注率"}];
const CHARTS = [{v:"kpi",l:"KPIカード",i:"🔢"},{v:"bar",l:"棒グラフ",i:"📊"},{v:"hbar",l:"ランキング",i:"🏅"},{v:"pie",l:"円グラフ",i:"🍩"},{v:"table",l:"テーブル",i:"📋"},{v:"crosstab",l:"クロス集計",i:"🗺"}];

// ウィジェット内プルダウンとして追加できるフィルタ
const FILTER_OPTIONS = [
  {v:"owner",l:"担当者"},{v:"customer_employee_size",l:"従業員規模"},{v:"customer_industry",l:"業界"},
  {v:"customer_hq_region",l:"地域"},{v:"hiring_type_need",l:"新卒/中途"},{v:"result",l:"受注結果"},
  {v:"customer_response_status",l:"顧客反応"},
];

let widgets=[];
const SK="kinbot_db_v4";
let wid=Date.now();
function save(){try{localStorage.setItem(SK,JSON.stringify(widgets))}catch{}}
function load(){try{const s=JSON.parse(localStorage.getItem(SK));if(Array.isArray(s)&&s.length&&s[0].chart)return s}catch{}return[]}

// ===== Init =====
window.addEventListener("DOMContentLoaded", async()=>{
  const now=new Date(),from=new Date(now);from.setDate(from.getDate()-90);
  $("dbFrom").value=from.toISOString().slice(0,10);$("dbTo").value=now.toISOString().slice(0,10);
  $("dbFrom").onchange=$("dbTo").onchange=$("dbOwner").onchange=reload;
  $("addWidgetBtn").onclick=()=>openCreator();
  $("closeModal").onclick=()=>$("addModal").hidden=true;
  $("addModal").onclick=e=>{if(e.target===$("addModal"))$("addModal").hidden=true};
  try{const u=await(await fetch("/api/users")).json();for(const x of u||[])if(x.email)userMap[x.email.toLowerCase()]=x.name||x.email}catch{}
  widgets=load(); await reload();
});

async function reload(){
  const qs=new URLSearchParams();
  if($("dbFrom").value)qs.set("from",$("dbFrom").value);
  if($("dbTo").value)qs.set("to",$("dbTo").value);
  if($("dbOwner").value)qs.set("owner",$("dbOwner").value);
  try{allTags=(await(await fetch("/api/feature-c/tags?"+qs)).json()).tags||[]}catch{allTags=[]}
  const sel=$("dbOwner"),cv=sel.value;
  const ow=[...new Set(allTags.map(t=>t.owner).filter(Boolean))].sort();
  sel.innerHTML='<option value="">全員</option>'+ow.map(o=>`<option value="${esc(o)}">${esc(ownerName(o))}</option>`).join("");
  sel.value=cv; renderGrid();
}

// ===== Data helpers =====
function axVals(t,a){
  if(ARR.has(a)){const arr=Array.isArray(t[a])?t[a]:[];return a==="meeting_stages"?arr.filter(s=>s?.step).map(s=>s.step):arr.filter(Boolean)}
  let v=t[a];if(a==="owner")v=ownerName(v);return[v||"不明"];
}
function isHit(t,m){
  if(m==="response_rate")return t.customer_response_status==="担当者合意"||t.customer_response_status==="案件化";
  if(m==="won_rate")return t.result==="受注";
  if(m==="re_meeting_rate")return t.result==="受注"||t.customer_response_status==="担当者合意";
  return false;
}
function agg(tags,axis,metric){
  const g={};
  tags.forEach(t=>{axVals(t,axis).forEach(k=>{if(!g[k])g[k]={n:0,h:0};g[k].n++;if(isHit(t,metric))g[k].h++})});
  const e=Object.entries(g);
  if(metric==="count")return e.map(([k,v])=>({k,val:v.n})).sort((a,b)=>b.val-a.val);
  if(metric==="pct"){const tot=tags.length||1;return e.map(([k,v])=>({k,val:Math.round(v.n/tot*100),n:v.n,d:tot})).sort((a,b)=>b.val-a.val)}
  return e.map(([k,v])=>({k,val:v.n?Math.round(v.h/v.n*100):0,n:v.h,d:v.n})).sort((a,b)=>b.val-a.val);
}

// ===== ウィジェット内フィルタ適用 =====
function applyWidgetFilters(tags, w) {
  if (!w.filters || !w.filters.length) return tags;
  let filtered = tags;
  for (const f of w.filters) {
    const sel = document.querySelector(`#wf_${w.id}_${f.field}`);
    const val = sel ? sel.value : "";
    if (!val) continue;
    filtered = filtered.filter(t => {
      if (ARR.has(f.field)) return (Array.isArray(t[f.field]) ? t[f.field] : []).includes(val);
      let tv = t[f.field]; if (f.field === "owner") tv = ownerName(tv);
      return tv === val;
    });
  }
  return filtered;
}

// ===== Grid =====
function renderGrid(){
  const grid=$("dbGrid");
  if(!widgets.length){grid.innerHTML='<div class="db-grid-empty"><div style="font-size:40px;margin-bottom:12px">📊</div>ウィジェットがありません<br>「＋ ウィジェットを追加」で作成</div>';return}
  grid.innerHTML="";
  widgets.forEach(w=>{
    const el=document.createElement("div");
    el.className="db-widget";
    el.dataset.id=w.id;
    el.draggable=true;
    // 保存されたサイズを復元
    if (w.width) el.style.width = w.width;
    if (w.height) el.style.height = w.height;

    // フィルタプルダウンHTML
    let filterHtml = "";
    if (w.filters && w.filters.length) {
      filterHtml = '<div class="db-widget-filters">' + w.filters.map(f => {
        const fl = FILTER_OPTIONS.find(x=>x.v===f.field)?.l || f.field;
        const vals = [...new Set(allTags.flatMap(t => {
          if (ARR.has(f.field)) return Array.isArray(t[f.field]) ? t[f.field] : [];
          let v = t[f.field]; if (f.field === "owner") v = ownerName(v);
          return [v || "不明"];
        }))].sort();
        return `<select class="db-wf-select" id="wf_${w.id}_${f.field}" title="${esc(fl)}"><option value="">${esc(fl)}:すべて</option>${vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select>`;
      }).join("") + '</div>';
    }

    el.innerHTML=`<div class="db-widget-head">
      <div class="db-widget-drag" title="ドラッグで移動">⠿</div>
      <span class="db-widget-title">${esc(w.title)}</span>
      <div class="db-widget-actions">
        <button class="db-widget-btn" data-a="edit" title="編集">✎</button>
        <button class="db-widget-btn" data-a="del" title="削除">✕</button>
      </div>
    </div>${filterHtml}<div class="db-widget-body" id="wb_${w.id}"></div>`;

    el.querySelector('[data-a="del"]').onclick=()=>{widgets=widgets.filter(x=>x.id!==w.id);save();renderGrid()};
    el.querySelector('[data-a="edit"]').onclick=()=>openCreator(w);

    // フィルタプルダウン変更時にウィジェット再描画
    el.querySelectorAll(".db-wf-select").forEach(sel => {
      sel.addEventListener("change", () => drawWidget(w, $("wb_"+w.id)));
    });

    // D&D
    el.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/plain",w.id);el.classList.add("dragging")});
    el.addEventListener("dragend",()=>el.classList.remove("dragging"));
    el.addEventListener("dragover",e=>{e.preventDefault();el.classList.add("drag-over")});
    el.addEventListener("dragleave",()=>el.classList.remove("drag-over"));
    el.addEventListener("drop",e=>{
      e.preventDefault();el.classList.remove("drag-over");
      const did=e.dataTransfer.getData("text/plain");if(did===w.id)return;
      const fi=widgets.findIndex(x=>x.id===did),ti=widgets.findIndex(x=>x.id===w.id);
      if(fi<0||ti<0)return;const[mv]=widgets.splice(fi,1);widgets.splice(ti,0,mv);save();renderGrid();
    });
    grid.appendChild(el);
    // リサイズ監視：ユーザーがドラッグでサイズ変更したら保存
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(el);
      const newW = el.style.width;
      const newH = el.style.height;
      if (newW && newW !== w.width) { w.width = newW; save(); }
      if (newH && newH !== w.height) { w.height = newH; save(); }
    });
    ro.observe(el);
    drawWidget(w,$("wb_"+w.id));
  });
}

// ===== Draw =====
function drawWidget(w,el){
  if(!el)return;
  try{
    const tags = applyWidgetFilters(allTags, w);
    const fn = {kpi:drawKpi,bar:drawBar,hbar:drawHbar,pie:drawPie,table:drawTable,crosstab:drawCross}[w.chart];
    if (fn) fn(el,tags,w);
    else el.innerHTML='<div class="db-empty">未対応のグラフ種類です</div>';
  }catch(e){el.innerHTML=`<div class="db-empty">エラー: ${esc(e.message)}</div>`}
}

function drawKpi(el,tags,w){
  const t=tags.length;let val="0",sub="データなし";
  if(t){if(w.metric==="count"){val=String(t);sub="対象期間"}else{const h=tags.filter(x=>isHit(x,w.metric)).length;val=Math.round(h/t*100)+"%";sub=`${h}/${t}件`}}
  el.innerHTML=`<div class="db-kpi"><div class="db-kpi-value">${esc(val)}</div><div class="db-kpi-sub">${esc(sub)}</div></div>`;
}
function drawBar(el,tags,w){
  const d=agg(tags,w.axis,w.metric).slice(0,15);if(!d.length){el.innerHTML='<div class="db-empty">データなし</div>';return}
  const mx=Math.max(...d.map(x=>x.val))||1,isR=w.metric!=="count";
  el.innerHTML=d.map(r=>{const p=Math.round(r.val/mx*100),s=isR?"%":"件",dt=r.d!=null?` <span style="color:#8a938c;font-size:10px">(${r.n}/${r.d})</span>`:"";
    return`<div class="db-bar-row"><div class="db-bar-label" title="${esc(r.k)}">${esc(r.k)}</div><div class="db-bar-track"><div class="db-bar-fill" style="width:${p}%;background:#1d9e75">${p>12?r.val+s:""}</div></div><div class="db-bar-val">${r.val}${s}${dt}</div></div>`}).join("");
}
function drawHbar(el,tags,w){
  const d=agg(tags,w.axis,"count").slice(0,10);if(!d.length){el.innerHTML='<div class="db-empty">データなし</div>';return}
  const mx=d[0].val||1;
  el.innerHTML=d.map((r,i)=>{const p=Math.round(r.val/mx*100);return`<div class="db-bar-row"><div style="width:20px;text-align:center;font-weight:700;color:#0d5b47;font-size:13px">${i+1}</div><div class="db-bar-label" title="${esc(r.k)}">${esc(r.k)}</div><div class="db-bar-track"><div class="db-bar-fill" style="width:${p}%;background:#0d5b47">${p>15?r.val+"件":""}</div></div><div class="db-bar-val">${r.val}件</div></div>`}).join("");
}
function drawPie(el,tags,w){
  const d=agg(tags,w.axis,"count").slice(0,8);if(!d.length){el.innerHTML='<div class="db-empty">データなし</div>';return}
  const tot=d.reduce((s,r)=>s+r.val,0)||1;let cum=0;
  const xy=(a,r)=>[60+r*Math.cos((a-90)*Math.PI/180),60+r*Math.sin((a-90)*Math.PI/180)];
  let svg='<svg viewBox="0 0 120 120" class="db-pie-svg">';
  const segs=d.map((r,i)=>{const p=r.val/tot,s=cum*360;cum+=p;return{s,e:cum*360,c:PIE_COLORS[i%PIE_COLORS.length],k:r.k,n:r.val}});
  segs.forEach(seg=>{if(seg.e-seg.s>=359.9){svg+=`<circle cx="60" cy="60" r="50" fill="${seg.c}"/>`;return}const[x1,y1]=xy(seg.s,50),[x2,y2]=xy(seg.e,50),l=seg.e-seg.s>180?1:0;svg+=`<path d="M60,60 L${x1},${y1} A50,50 0 ${l},1 ${x2},${y2} Z" fill="${seg.c}"/>`});
  svg+='</svg>';const leg=segs.map(s=>`<div class="db-pie-leg-item"><div class="db-pie-leg-dot" style="background:${s.c}"></div>${esc(s.k)} (${s.n})</div>`).join("");
  el.innerHTML=`<div class="db-pie-wrap">${svg}<div class="db-pie-legend">${leg}</div></div>`;
}
function drawTable(el,tags,w){
  const d=agg(tags,w.axis,w.metric).slice(0,20);if(!d.length){el.innerHTML='<div class="db-empty">データなし</div>';return}
  const al=AXES.find(a=>a.v===w.axis)?.l||w.axis,ml=METRICS.find(m=>m.v===w.metric)?.l||w.metric,isR=w.metric!=="count",s=isR?"%":"件";
  let h=`<table class="db-table"><thead><tr><th>${esc(al)}</th><th style="text-align:right">${esc(ml)}</th>${d[0].d!=null?'<th style="text-align:right">内訳</th>':''}</tr></thead><tbody>`;
  d.forEach(r=>{h+=`<tr><td>${esc(r.k)}</td><td style="text-align:right;font-weight:600">${r.val}${s}</td>${r.d!=null?`<td style="text-align:right;color:#8a938c">${r.n}/${r.d}</td>`:''}</tr>`});
  el.innerHTML=h+'</tbody></table>';
}
function drawCross(el,tags,w){
  const ra=w.axis,ca=w.axis2||"owner",isR=w.metric!=="count"&&w.metric!=="pct";
  const rS=new Set(),cS=new Set(),cells={};
  tags.forEach(t=>{const rk=axVals(t,ra),ck=axVals(t,ca),hit=isHit(t,w.metric);
    rk.forEach(r=>{rS.add(r);ck.forEach(c=>{cS.add(c);const k=r+"|||"+c;if(!cells[k])cells[k]={n:0,h:0};cells[k].n++;if(hit)cells[k].h++})})});
  const rows=[...rS].sort(),cols=[...cS].sort();
  if(!rows.length||!cols.length){el.innerHTML='<div class="db-empty">データなし</div>';return}
  let h='<div style="overflow-x:auto"><table class="db-table"><thead><tr><th></th>';
  cols.forEach(c=>h+=`<th style="text-align:center;font-size:10.5px">${esc(c)}</th>`);h+='</tr></thead><tbody>';
  rows.forEach(r=>{h+=`<tr><td style="font-weight:500;white-space:nowrap">${esc(r)}</td>`;
    cols.forEach(c=>{const cell=cells[r+"|||"+c];if(!cell||!cell.n){h+='<td style="text-align:center;color:#ccc">—</td>';return}
      const val=isR?Math.round(cell.h/cell.n*100):cell.n,rate=isR?cell.h/cell.n:cell.n/(tags.length||1);
      const bg=rate>0.5?"#1d9e75":rate>0.25?"#BA7517":rate>0?"#D85A30":"#f2f0eb",fc=rate>0?"#fff":"#ccc";
      h+=`<td style="text-align:center;background:${bg};color:${fc};border-radius:4px;font-weight:600;font-size:11px;padding:6px 4px">${val}${isR?"%":""}<div style="font-size:9px;opacity:0.8">${cell.h}/${cell.n}</div></td>`});
    h+='</tr>'});
  el.innerHTML=h+'</tbody></table></div>';
}

// ===== Creator Modal =====
function openCreator(edit){
  const isE=!!edit;
  const d=edit||{chart:"bar",axis:"owner",axis2:"customer_employee_size",metric:"response_rate",title:"",size:"1",filters:[]};
  const modal=$("addModal"),body=$("widgetCatalog");
  const axChips=(sel)=>{let h="",lg="";AXES.forEach(a=>{if(a.g!==lg){if(lg)h+='<div style="width:100%;height:0"></div>';h+=`<span class="db-chip-group">${a.g}</span>`;lg=a.g}h+=`<button class="db-chip${a.v===sel?" active":""}" data-value="${a.v}">${a.l}</button>`});return h};

  // フィルタ選択チェックボックス
  const filterChecks = FILTER_OPTIONS.map(f => {
    const checked = (d.filters||[]).some(x=>x.field===f.v);
    return `<label class="db-filter-check"><input type="checkbox" value="${f.v}" ${checked?"checked":""}> ${f.l}</label>`;
  }).join("");

  body.innerHTML=`<div class="db-creator">
    <div class="db-creator-section"><label class="db-creator-label">タイトル</label><input type="text" id="wcTitle" class="db-creator-input" value="${esc(d.title)}" placeholder="（自動生成）"/></div>
    <div class="db-creator-section"><label class="db-creator-label">グラフの種類</label><div class="db-creator-chips" id="wcChart">${CHARTS.map(c=>`<button class="db-chip${c.v===d.chart?" active":""}" data-value="${c.v}">${c.i} ${c.l}</button>`).join("")}</div></div>
    <div class="db-creator-section" id="wcAxisSec"><label class="db-creator-label">集計軸</label><div class="db-creator-chips" id="wcAxis">${axChips(d.axis)}</div></div>
    <div class="db-creator-section" id="wcAxis2Sec" style="display:none"><label class="db-creator-label">列軸</label><div class="db-creator-chips" id="wcAxis2">${axChips(d.axis2)}</div></div>
    <div class="db-creator-section" id="wcMetricSec"><label class="db-creator-label">指標</label><div class="db-creator-chips" id="wcMetric">${METRICS.map(m=>`<button class="db-chip${m.v===d.metric?" active":""}" data-value="${m.v}">${m.l}</button>`).join("")}</div></div>
    <div class="db-creator-section"><label class="db-creator-label">プルダウンフィルタを追加</label><div class="db-filter-checks" id="wcFilters">${filterChecks}</div></div>
    <div class="db-creator-preview"><label class="db-creator-label">プレビュー</label><div class="db-widget" style="cursor:default"><div class="db-widget-head"><span class="db-widget-title" id="wcPT">...</span></div><div class="db-widget-body" id="wcPB"></div></div></div>
    <div class="db-creator-actions"><button class="db-creator-cancel" id="wcCancel">キャンセル</button><button class="db-creator-save" id="wcSave">${isE?"更新":"追加"}</button></div>
  </div>`;
  let st={chart:d.chart,axis:d.axis,axis2:d.axis2||"customer_employee_size",metric:d.metric};
  function upd(){
    const t=$("wcTitle").value||autoTitle(st);$("wcPT").textContent=t;
    $("wcAxisSec").style.display=st.chart==="kpi"?"none":"";
    $("wcAxis2Sec").style.display=st.chart==="crosstab"?"":"none";
    $("wcMetricSec").style.display=st.chart==="hbar"?"none":"";
    drawWidget({...st,title:t,filters:[]},$(  "wcPB"));
  }
  function bind(id,key){const c=$(id);if(!c)return;c.querySelectorAll(".db-chip").forEach(b=>b.addEventListener("click",()=>{c.querySelectorAll(".db-chip").forEach(x=>x.classList.remove("active"));b.classList.add("active");st[key]=b.dataset.value;upd()}))}
  bind("wcChart","chart");bind("wcAxis","axis");bind("wcAxis2","axis2");bind("wcMetric","metric");
  $("wcTitle").addEventListener("input",upd);
  $("wcCancel").onclick=()=>modal.hidden=true;
  $("wcSave").onclick=()=>{
    const t=$("wcTitle").value||autoTitle(st);
    // フィルタ収集
    const filters = [];
    $("wcFilters").querySelectorAll("input:checked").forEach(cb => filters.push({field:cb.value}));
    if(isE){const w=widgets.find(x=>x.id===edit.id);if(w){Object.assign(w,st);w.title=t;w.filters=filters}}
    else widgets.push({id:"w"+(++wid),...st,title:t,filters});
    save();modal.hidden=true;renderGrid();
  };
  upd();modal.hidden=false;
}
function autoTitle(s){
  const al=AXES.find(a=>a.v===s.axis)?.l||s.axis,ml=METRICS.find(m=>m.v===s.metric)?.l||s.metric;
  if(s.chart==="kpi")return ml;if(s.chart==="hbar")return`${al} ランキング`;
  if(s.chart==="crosstab"){const cl=AXES.find(a=>a.v===s.axis2)?.l||s.axis2;return`${al} × ${cl} ${ml}`}
  return`${al}別 ${ml}`;
}
