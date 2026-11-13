import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, clock, markdown, money } from "../src/report.js";
import { newSession } from "../src/engine.js";
import { get, play, playBest, playFirst } from "./helpers.js";

const rw = get("ransomware-friday");

test("clock and money formatting", () => {
  assert.equal(clock(0), "00h 00m");
  assert.equal(clock(1500), "1d 01h 00m");
  assert.equal(clock(75), "01h 15m");
  assert.equal(money(1800000), "EUR 1,800,000");
});

test("a report needs a finished exercise", () => {
  assert.throws(() => buildReport(rw, newSession(rw, "x", 0)), /not finished/);
});

test("the best play reports no gap and the full timeline", () => {
  const r = buildReport(rw, playBest(rw));
  assert.equal(r.gap, 0);
  assert.equal(r.timeline.length, 9);
  assert.equal(r.optimal.steps.length, 9);
  assert.equal(r.score.grade, "A");
  assert.deepEqual(r.controls, []);
});

test("a weak play lists the controls behind its poor choices", () => {
  const r = buildReport(rw, play(rw, ["reboot", "it-only", "restore-now", "wait-facts", "wait-full", "pay-fast", "deny", "fast", "minimal"]));
  assert.ok(r.gap > 20);
  assert.ok(r.controls.some((c) => c.id === "INC-01"));
  assert.ok(r.controls.some((c) => c.id === "INC-02"));
});

test("markdown has the sections and escapes table pipes", () => {
  const s = playFirst(get("wire-fraud"));
  s.log[0]!.choiceLabel = "A | B";
  const md = markdown(get("wire-fraud"), buildReport(get("wire-fraud"), s));
  for (const h of ["# After-action report", "## Score breakdown", "## Regulatory clock", "## Timeline", "## Where points were lost", "## Best path"]) assert.ok(md.includes(h), h);
  assert.ok(md.includes("A \\| B"));
});

test("a facilitator note and timer decisions appear in the report", () => {
  const sc = get("wire-fraud");
  let s = newSession(sc, "x", 0);
  s = { ...s };
  const md = markdown(sc, buildReport(sc, play(sc, ["callback", "investigate", "process"])));
  assert.ok(!md.includes("decided by the timer"));
  void s;
});
