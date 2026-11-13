import test from "node:test";
import assert from "node:assert/strict";
import { ScenarioError, validateScenario } from "../src/scenario.js";
import { scenarios } from "./helpers.js";

const base = () => ({
  id: "t", title: "T", summary: "S", difficulty: "intro", organisation: "O", startLabel: "Mon", startNode: "a", deadlines: [],
  nodes: [
    { id: "a", title: "A", body: "b", choices: [{ id: "x", label: "X", minutes: 5, effects: {}, next: "b", insight: { quality: "good", text: "t" } }] },
    { id: "b", title: "B", body: "b", choices: [{ id: "y", label: "Y", minutes: 5, effects: {}, next: null, insight: { quality: "ok", text: "t" } }] },
  ],
});
const bad = (mutate: (s: ReturnType<typeof base>) => void, re: RegExp) => {
  const s = base(); mutate(s);
  assert.throws(() => validateScenario(s), (e: unknown) => e instanceof ScenarioError && re.test(e.message));
};

test("a minimal scenario validates", () => { assert.equal(validateScenario(base()).nodes.length, 2); });
test("dangling next is rejected", () => bad((s) => { s.nodes[0]!.choices[0]!.next = "zzz"; }, /does not exist/));
test("loops are rejected", () => bad((s) => { s.nodes[1]!.choices[0]!.next = "a" as never; }, /loop/));
test("duplicate scene ids are rejected", () => bad((s) => { s.nodes[1]!.id = "a"; }, /duplicate/));
test("unknown effect variable is rejected", () => bad((s) => { (s.nodes[0]!.choices[0]!.effects as Record<string, number>).mana = 3; }, /unknown variable/));
test("bad quality is rejected", () => bad((s) => { (s.nodes[0]!.choices[0]!.insight as { quality: string }).quality = "great"; }, /quality/));
test("onTimeout must name a choice", () => bad((s) => { (s.nodes[0] as Record<string, unknown>).onTimeout = "nope"; }, /onTimeout/));
test("ids are restricted", () => bad((s) => { s.id = "../x"; }, /id may only/));
test("non-objects are rejected", () => { assert.throws(() => validateScenario(null), ScenarioError); assert.throws(() => validateScenario([]), ScenarioError); });

test("bundled scenarios are structurally sound", () => {
  assert.ok(scenarios.length >= 2);
  for (const sc of scenarios) {
    const reach = new Set<string>();
    const walk = (id: string) => { if (reach.has(id)) return; reach.add(id); for (const c of sc.nodes.find((n) => n.id === id)!.choices) if (c.next) walk(c.next); };
    walk(sc.startNode);
    assert.equal(reach.size, sc.nodes.length, `${sc.id}: every scene is reachable`);
    const setFlags = new Set(sc.nodes.flatMap((n) => n.choices.flatMap((c) => [...(c.set ?? []), ...(c.modifiers ?? []).flatMap((m) => m.set ?? [])])));
    for (const d of sc.deadlines) assert.ok(setFlags.has(d.flag), `${sc.id}: deadline ${d.id} can be met`);
    for (const n of sc.nodes) {
      assert.ok(n.choices.some((c) => c.insight.quality === "good"), `${sc.id}/${n.id} has a good option`);
      assert.ok(n.choices.some((c) => c.insight.quality === "poor"), `${sc.id}/${n.id} has a poor option`);
    }
  }
});
