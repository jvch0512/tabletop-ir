import { Choice, Condition, DeadlineStatus, Effects, LogEntry, SceneNode, Scenario, Session, VAR_NAMES, Vars } from "./types.js";

export const START_VARS: Vars = { containment: 0, operations: 100, trust: 100, evidence: 50, legal: 0, cost: 0 };
export const COST_SCALE = 2_000_000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function normalise(v: Vars): Vars {
  return {
    containment: clamp(v.containment, 0, 100), operations: clamp(v.operations, 0, 100), trust: clamp(v.trust, 0, 100),
    evidence: clamp(v.evidence, 0, 100), legal: clamp(v.legal, 0, 100), cost: Math.max(0, Math.round(v.cost)),
  };
}

function addEffects(v: Vars, e: Effects): Vars {
  const out = { ...v };
  for (const k of VAR_NAMES) if (e[k] !== undefined) out[k] += e[k]!;
  return normalise(out);
}

const has = (s: Session, f: string) => Object.prototype.hasOwnProperty.call(s.flags, f);

export function holds(c: Condition | undefined, s: Session): boolean {
  if (!c) return true;
  if (c.all && !c.all.every((f) => has(s, f))) return false;
  if (c.none && c.none.some((f) => has(s, f))) return false;
  for (const t of c.vars ?? []) {
    const x = s.vars[t.name];
    if (t.op === "<" ? !(x < t.value) : t.op === "<=" ? !(x <= t.value) : t.op === ">" ? !(x > t.value) : !(x >= t.value)) return false;
  }
  return true;
}

export function nodeOf(sc: Scenario, id: string): SceneNode {
  const n = sc.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`unknown scene ${id}`);
  return n;
}

export function newSession(sc: Scenario, id: string, now = Date.now()): Session {
  const vars = normalise({ ...START_VARS, ...(sc.initial ?? {}) });
  const first = nodeOf(sc, sc.startNode);
  const minutes = first.notBefore ?? 0;
  const s: Session = {
    id, scenarioId: sc.id, nodeId: sc.startNode, minutes, vars, flags: {},
    deadlines: sc.deadlines.map((d): DeadlineStatus => ({ id: d.id, label: d.label, reference: d.reference, dueMinutes: d.dueMinutes, state: "pending", metAtMinutes: null })),
    log: [], history: [{ minutes, vars }], events: [], presentedAt: now,
  };
  return s;
}

export function visibleChoices(sc: Scenario, s: Session): Choice[] {
  if (s.nodeId === null) return [];
  return nodeOf(sc, s.nodeId).choices.filter((c) => holds(c.visibleWhen, s));
}

/** Resolve deadline states for the current clock; returns penalties and messages for newly resolved ones. */
function evaluateDeadlines(sc: Scenario, s: Session, final: boolean): { effects: Effects; notes: string[] } {
  const total: Effects = {};
  const notes: string[] = [];
  for (const st of s.deadlines) {
    if (st.state === "late" || st.state === "met") continue;
    const d = sc.deadlines.find((x) => x.id === st.id)!;
    if (st.state === "missed") {
      // Already penalised when the clock passed the due time; a later filing is recorded as late, with no second penalty.
      if (has(s, d.flag)) { st.state = "late"; st.metAtMinutes = s.flags[d.flag]!; notes.push(`Filed late: ${d.label} (${d.reference}).`); }
      continue;
    }
    let next: DeadlineStatus["state"] | null = null;
    if (has(s, d.flag)) {
      st.metAtMinutes = s.flags[d.flag]!;
      next = st.metAtMinutes <= d.dueMinutes ? "met" : "late";
    } else if (s.minutes > d.dueMinutes || final) next = "missed";
    if (!next) continue;
    st.state = next;
    if (next === "met") notes.push(`Deadline met: ${d.label} (${d.reference}).`);
    else {
      notes.push(`Deadline ${next === "late" ? "missed (submitted late)" : "missed"}: ${d.label} (${d.reference}).`);
      for (const k of VAR_NAMES) if (d.penalty[k] !== undefined) total[k] = (total[k] ?? 0) + d.penalty[k]!;
    }
  }
  return { effects: total, notes };
}

function mergeEffects(a: Effects, b: Effects): Effects {
  const out: Effects = { ...a };
  for (const k of VAR_NAMES) if (b[k] !== undefined) out[k] = (out[k] ?? 0) + b[k]!;
  return out;
}

/** Apply a choice. Pure: returns a new session and leaves the input untouched. */
export function applyChoice(sc: Scenario, prev: Session, choiceId: string, opts: { note?: string; timedOut?: boolean; now?: number } = {}): Session {
  if (prev.nodeId === null) throw new Error("the exercise is over");
  const node = nodeOf(sc, prev.nodeId);
  const choice = visibleChoices(sc, prev).find((c) => c.id === choiceId);
  if (!choice) throw new Error("that option is not available");

  const s: Session = JSON.parse(JSON.stringify(prev));
  const atMinutes = s.minutes;
  s.minutes += choice.minutes;
  let delta: Effects = { ...choice.effects };
  s.vars = addEffects(s.vars, choice.effects);
  for (const f of choice.set ?? []) if (!has(s, f)) s.flags[f] = s.minutes;
  const notes: string[] = [];
  for (const m of choice.modifiers ?? []) {
    if (!holds(m.when, s)) continue;
    notes.push(m.text);
    if (m.effects) { s.vars = addEffects(s.vars, m.effects); delta = mergeEffects(delta, m.effects); }
    for (const f of m.set ?? []) if (!has(s, f)) s.flags[f] = s.minutes;
  }
  let pen = evaluateDeadlines(sc, s, false);
  s.vars = addEffects(s.vars, pen.effects);
  delta = mergeEffects(delta, pen.effects);
  notes.push(...pen.notes);

  if (choice.next === null) s.nodeId = null;
  else {
    s.nodeId = choice.next;
    const n2 = nodeOf(sc, choice.next);
    if (n2.notBefore !== undefined && s.minutes < n2.notBefore) s.minutes = n2.notBefore;
    const jump = evaluateDeadlines(sc, s, false);
    s.vars = addEffects(s.vars, jump.effects);
    delta = mergeEffects(delta, jump.effects);
    notes.push(...jump.notes);
  }
  if (s.nodeId === null) {
    const fin = evaluateDeadlines(sc, s, true);
    s.vars = addEffects(s.vars, fin.effects);
    delta = mergeEffects(delta, fin.effects);
    notes.push(...fin.notes);
  }
  const entry: LogEntry = {
    step: prev.log.length + 1, nodeId: node.id, nodeTitle: node.title, choiceId: choice.id, choiceLabel: choice.label,
    atMinutes, afterMinutes: s.minutes, timedOut: opts.timedOut === true, note: (opts.note ?? "").slice(0, 500), effects: delta, notes, insight: choice.insight, vars: s.vars,
  };
  s.log.push(entry);
  s.history.push({ minutes: s.minutes, vars: s.vars });
  s.events.push(...notes);
  s.presentedAt = opts.now ?? Date.now();
  return s;
}

export interface Score {
  total: number;
  grade: "A" | "B" | "C" | "D";
  parts: Array<{ name: string; value: number; weight: number; points: number }>;
}

export function score(sc: Scenario, s: Session): Score {
  const met = s.deadlines.filter((d) => d.state === "met").length;
  const compliance = s.deadlines.length === 0 ? 100 : (100 * met) / s.deadlines.length;
  const raw: Array<[string, number, number]> = [
    ["Containment", s.vars.containment, 20], ["Operations restored", s.vars.operations, 15], ["Stakeholder trust", s.vars.trust, 15],
    ["Evidence preserved", s.vars.evidence, 10], ["Regulatory deadlines", compliance, 25], ["Low legal exposure", 100 - s.vars.legal, 10],
    ["Cost control", 100 - Math.min(100, (100 * s.vars.cost) / COST_SCALE), 5],
  ];
  const parts = raw.map(([name, value, weight]) => ({ name, value: Math.round(value), weight, points: (value * weight) / 100 }));
  const total = Math.round(parts.reduce((a, p) => a + p.points, 0) * 10) / 10;
  void sc;
  return { total, grade: total >= 85 ? "A" : total >= 70 ? "B" : total >= 55 ? "C" : "D", parts };
}
