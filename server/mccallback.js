// Dates and shift boundaries are Japan local time. One promise is one source call log.
import { rosterHit, foldPersonName } from "./mcname.js";

const WINDOW = 15 * 60_000;
function localSlot(t) {
  const japan = new Date(+new Date(t) + 9 * 3600_000);
  return { day: japan.toISOString().slice(0, 10), minute: japan.getUTCHours() * 60 + japan.getUTCMinutes() };
}

export function callbackBoard(promises, shifts, members, now = Date.now()) {
  const loads = new Map();
  return promises.map(p => {
    const due = +new Date(p.next_at);
    const late = now >= due + WINDOW;
    const when = localSlot(!p.attempt ? Math.max(due,now) : due);
    const identifies = (s,m) => s.email === m.email || (s.email.startsWith("shift:") &&
      (foldPersonName(s.name) === foldPersonName(m.name) || (m.p && (rosterHit(s.name,[m.p]) ||
        foldPersonName(s.name) === foldPersonName(m.p.name)))));
    const candidates = members.filter(m => {
      const matching = shifts.filter(s => s.day === when.day && identifies(s,m) &&
        members.filter(other => identifies(s,other)).length === 1);
      return !matching.some(s => s.absent) && matching.some(s => s.start_min != null && s.end_min != null &&
        s.start_min <= when.minute && when.minute < s.end_min);
    });
    const loadKey = m => when.day + "|" + m.email;
    candidates.sort((a,b) => (loads.get(loadKey(a)) || 0) - (loads.get(loadKey(b)) || 0) ||
      Number(b.email === p.caller) - Number(a.email === p.caller) || a.email.localeCompare(b.email));
    const member = candidates.find(m=>m.email === p.callback_owner) || candidates[0];
    if (member) loads.set(loadKey(member), (loads.get(loadKey(member)) || 0) + 1);
    const owner = p.actual_caller || member?.email || "";
    const actual = p.actual_at && +new Date(p.actual_at);
    const onTime = !!actual && actual >= due && actual < due + WINDOW;
    return { ...p, owner, ownerName: members.find(m => m.email === owner)?.name || owner,
      eligible: late, onTime, status: actual ? (onTime ? "期限内発信" : actual < due ? "指定前発信" : "遅延発信") :
        p.attempt ? "発信照合待ち" : !owner ? "未割当" : late ? "期限超過" : now >= due ? "今かける" : "予定" };
  });
}
