import test from "node:test";
import assert from "node:assert/strict";
import { callbackBoard } from "../server/mccallback.js";
import { callbackShiftWindows } from "../server/mcdash.js";

const day = "2026-11-27", due = day+"T15:00:00+09:00", time = Date.parse(due);
const members = ["山田","田中"].map((name,i)=>({email:i+"@example.test",name:name+"太郎",p:{name,sf:name+"太郎"}}));
const promise = {id:1, caller:members[0].email, next_at:due};
const shifts = await callbackShiftWindows(async (_owner,_id,range)=>range.startsWith("shifts!") ?
  [[],["山田",day,"off"],["田中",day,"full"]] : [[],["full","09:00","18:00","12:00","13:00"]]);
test("本人が休みなら勤務者に渡し、休憩・欠勤は未割当に残す",()=>{
  assert.equal(callbackBoard([promise],shifts,members,time)[0].owner,members[1].email);
  const lunch = {...promise,next_at: day+"T12:30:00+09:00"};
  assert.equal(callbackBoard([lunch],shifts,members,Date.parse(lunch.next_at))[0].owner,"");
  assert.equal(callbackBoard([promise],[...shifts,{...shifts[0],absent:true}],members,time)[0].owner,"");
});
test("指定の前・期限境界・発信未照合は期限内に含めない",()=>{
  const late = time+900000;
  for (const [actual,onTime] of [[time-1,false],[time,true],[late-1,true],[late,false],[null,false]]) {
    const p = callbackBoard([{...promise, attempt:2, actual_at:actual && new Date(actual)}],shifts,members,late)[0];
    assert.equal(p.onTime,onTime);
    assert.equal(p.eligible,true);
  }
  const [unassigned] = callbackBoard([promise],[],members,late);
  assert.equal(unassigned.status,"未割当"); assert.equal(unassigned.eligible,true);
});
test("同時刻の複数の約束を勤務者間で分担",()=>{
  const all = [...shifts,...shifts.map(s=>({...s,email:"shift:山田",name:"山田"}))];
  const board = callbackBoard([promise,{...promise,id:2}],all,members,time);
  assert.equal(new Set(board.map(p=>p.owner)).size,2);
});
