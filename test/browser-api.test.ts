import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalApi } from "../src/browser-api.js";
import { loadScenarios } from "../src/scenario.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scenarios = loadScenarios(path.join(ROOT, "scenarios"));

type V = { id: string; finished: boolean; scene: { choices: { id: string }[] } | null; scenario: { id: string } };

test("local api lists scenarios and plays a full exercise to a report", () => {
  const api = createLocalApi(scenarios);
  const list = api("/api/scenarios") as { id: string }[];
  assert.equal(list.length, scenarios.length);
  for (const sc of list) {
    let v = api("/api/sessions", { scenario: sc.id }) as V;
    let guard = 0;
    while (!v.finished && guard++ < 60) v = api("/api/sessions/" + v.id + "/choose", { choice: v.scene!.choices[0]!.id }) as V;
    assert.ok(v.finished);
    const r = api("/api/sessions/" + v.id + "/report") as { score: { total: number } };
    assert.ok(r.score.total >= 0 && r.score.total <= 100);
    const md = api("/api/sessions/" + v.id + "/report.md") as string;
    assert.match(md, /^# /m);
  }
});

test("local api rejects unknown scenario, early report and unknown session", () => {
  const api = createLocalApi(scenarios);
  assert.throws(() => api("/api/sessions", { scenario: "nope" }), /unknown scenario/);
  const v = api("/api/sessions", { scenario: scenarios[0]!.id }) as V;
  assert.throws(() => api("/api/sessions/" + v.id + "/report"), /not finished/);
  assert.throws(() => api("/api/sessions/00000000-0000-0000-0000-000000000000/choose", { choice: "x" }), /unknown session/);
});
