import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Condition, Effects, Scenario, VAR_NAMES } from "./types.js";

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const FLAG = /^[a-z0-9_]{1,40}$/;
const MAX_NODES = 40;
const MAX_CHOICES = 6;

export class ScenarioError extends Error {}

function fail(msg: string): never { throw new ScenarioError(msg); }
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function text(v: unknown, field: string, max: number): string {
  if (typeof v !== "string" || v.trim() === "" || v.length > max) fail(`${field} must be 1 to ${max} characters`);
  return v;
}

function num(v: unknown, field: string, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) fail(`${field} must be a number from ${lo} to ${hi}`);
  return v;
}

function effects(v: unknown, field: string): Effects {
  if (v === undefined) return {};
  if (!isObj(v)) fail(`${field} must be an object`);
  const out: Effects = {};
  for (const [k, x] of Object.entries(v)) {
    if (!(VAR_NAMES as readonly string[]).includes(k)) fail(`${field}: unknown variable ${k}`);
    out[k as keyof Effects] = num(x, `${field}.${k}`, -5_000_000, 5_000_000);
  }
  return out;
}

function flags(v: unknown, field: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 12) fail(`${field} must be a list of at most 12 flags`);
  return v.map((f, i) => { if (typeof f !== "string" || !FLAG.test(f)) fail(`${field}[${i}] is not a valid flag`); return f; });
}

function condition(v: unknown, field: string): Condition | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) fail(`${field} must be an object`);
  const c: Condition = {};
  if (v.all !== undefined) c.all = flags(v.all, `${field}.all`);
  if (v.none !== undefined) c.none = flags(v.none, `${field}.none`);
  if (v.vars !== undefined) {
    if (!Array.isArray(v.vars) || v.vars.length > 6) fail(`${field}.vars must be a short list`);
    c.vars = v.vars.map((t, i) => {
      if (!isObj(t)) fail(`${field}.vars[${i}] must be an object`);
      if (!(VAR_NAMES as readonly string[]).includes(String(t.name))) fail(`${field}.vars[${i}].name is unknown`);
      if (!["<", "<=", ">", ">="].includes(String(t.op))) fail(`${field}.vars[${i}].op is invalid`);
      return { name: t.name as never, op: t.op as never, value: num(t.value, `${field}.vars[${i}].value`, -5_000_000, 5_000_000) };
    });
  }
  return c;
}

/** Validate untrusted JSON into a Scenario. Rejects dangling references and cycles. */
export function validateScenario(raw: unknown): Scenario {
  if (!isObj(raw)) fail("scenario must be an object");
  const id = text(raw.id, "id", 40);
  if (!ID.test(id)) fail("id may only contain lowercase letters, digits, '-' and '_'");
  const diff = raw.difficulty;
  if (diff !== "intro" && diff !== "standard" && diff !== "hard") fail("difficulty must be intro, standard or hard");
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0 || raw.nodes.length > MAX_NODES) fail(`nodes must be a list of 1 to ${MAX_NODES} scenes`);
  const nodes = raw.nodes.map((n, i) => {
    const f = `nodes[${i}]`;
    if (!isObj(n)) fail(`${f} must be an object`);
    const nid = text(n.id, `${f}.id`, 40);
    if (!ID.test(nid)) fail(`${f}.id is invalid`);
    if (!Array.isArray(n.choices) || n.choices.length < 1 || n.choices.length > MAX_CHOICES) fail(`${f}.choices must have 1 to ${MAX_CHOICES} entries`);
    const choices = n.choices.map((c, j) => {
      const g = `${f}.choices[${j}]`;
      if (!isObj(c)) fail(`${g} must be an object`);
      const ins = c.insight;
      if (!isObj(ins) || !["good", "ok", "poor"].includes(String(ins.quality))) fail(`${g}.insight needs a quality of good, ok or poor`);
      const ctl = ins.controls === undefined ? undefined : (Array.isArray(ins.controls) ? ins.controls.map((x, k) => text(x, `${g}.insight.controls[${k}]`, 20)) : fail(`${g}.insight.controls must be a list`));
      const mods = c.modifiers === undefined ? undefined : (Array.isArray(c.modifiers) ? c.modifiers : fail(`${g}.modifiers must be a list`));
      return {
        id: text(c.id, `${g}.id`, 40), label: text(c.label, `${g}.label`, 300), minutes: num(c.minutes, `${g}.minutes`, 0, 10_000),
        effects: effects(c.effects, `${g}.effects`), set: flags(c.set, `${g}.set`), visibleWhen: condition(c.visibleWhen, `${g}.visibleWhen`),
        modifiers: mods?.map((m, k) => {
          if (!isObj(m)) fail(`${g}.modifiers[${k}] must be an object`);
          return { when: condition(m.when, `${g}.modifiers[${k}].when`) ?? {}, effects: effects(m.effects, `${g}.modifiers[${k}].effects`), set: flags(m.set, `${g}.modifiers[${k}].set`), text: text(m.text, `${g}.modifiers[${k}].text`, 300) };
        }),
        next: c.next === null ? null : text(c.next, `${g}.next`, 40),
        insight: { quality: ins.quality as "good", text: text(ins.text, `${g}.insight.text`, 600), controls: ctl },
      };
    });
    const ids = new Set<string>();
    for (const c of choices) { if (ids.has(c.id)) fail(`${f}: duplicate choice id ${c.id}`); ids.add(c.id); }
    const onTimeout = n.onTimeout === undefined ? undefined : text(n.onTimeout, `${f}.onTimeout`, 40);
    if (onTimeout !== undefined && !ids.has(onTimeout)) fail(`${f}.onTimeout does not name a choice`);
    return {
      id: nid, title: text(n.title, `${f}.title`, 120), body: text(n.body, `${f}.body`, 2000),
      notBefore: n.notBefore === undefined ? undefined : num(n.notBefore, `${f}.notBefore`, 0, 100_000),
      timeLimitSeconds: n.timeLimitSeconds === undefined ? undefined : num(n.timeLimitSeconds, `${f}.timeLimitSeconds`, 10, 900),
      onTimeout, choices,
    };
  });
  const ids = new Set<string>();
  for (const n of nodes) { if (ids.has(n.id)) fail(`duplicate node id ${n.id}`); ids.add(n.id); }
  const startNode = text(raw.startNode, "startNode", 40);
  if (!ids.has(startNode)) fail("startNode does not exist");
  for (const n of nodes) for (const c of n.choices) if (c.next !== null && !ids.has(c.next)) fail(`${n.id}/${c.id}: next "${c.next}" does not exist`);
  const deadlines = (Array.isArray(raw.deadlines) ? raw.deadlines : []).map((d, i) => {
    if (!isObj(d)) fail(`deadlines[${i}] must be an object`);
    return { id: text(d.id, `deadlines[${i}].id`, 40), label: text(d.label, `deadlines[${i}].label`, 120), reference: text(d.reference, `deadlines[${i}].reference`, 80),
      dueMinutes: num(d.dueMinutes, `deadlines[${i}].dueMinutes`, 1, 100_000), flag: text(d.flag, `deadlines[${i}].flag`, 40), penalty: effects(d.penalty, `deadlines[${i}].penalty`) };
  });
  const initial = raw.initial === undefined ? undefined : effects(raw.initial, "initial");
  const sc: Scenario = {
    id, title: text(raw.title, "title", 120), summary: text(raw.summary, "summary", 600), difficulty: diff, organisation: text(raw.organisation, "organisation", 100),
    startLabel: text(raw.startLabel, "startLabel", 60), startNode, initial, deadlines, nodes,
  };
  assertAcyclic(sc);
  return sc;
}

function assertAcyclic(sc: Scenario): void {
  const by = new Map(sc.nodes.map((n) => [n.id, n]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) fail(`scenes form a loop: ${[...trail, id].join(" -> ")}`);
    state.set(id, 1);
    for (const c of by.get(id)!.choices) if (c.next !== null) visit(c.next, [...trail, id]);
    state.set(id, 2);
  };
  visit(sc.startNode, []);
}

export function loadScenarios(dir: string): Scenario[] {
  const out: Scenario[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    try { out.push(validateScenario(JSON.parse(readFileSync(path.join(dir, f), "utf8")))); }
    catch (e) { throw new ScenarioError(`${f}: ${(e as Error).message}`); }
  }
  return out;
}
