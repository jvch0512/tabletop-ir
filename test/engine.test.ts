import test from "node:test";
import assert from "node:assert/strict";
import { applyChoice, newSession, score, visibleChoices } from "../src/engine.js";
import { get, play, playBest, playFirst } from "./helpers.js";

const rw = get("ransomware-friday");

test("a new session starts at the first scene with full operations", () => {
  const s = newSession(rw, "x", 0);
  assert.equal(s.nodeId, "first-alert");
  assert.equal(s.minutes, 0);
  assert.equal(s.vars.operations, 100);
  assert.equal(s.deadlines.length, 3);
});

test("a choice advances the clock, changes variables and sets flags", () => {
  const s = applyChoice(rw, newSession(rw, "x", 0), "isolate", { now: 0 });
  assert.equal(s.vars.containment, 25);
  assert.equal(s.vars.operations, 90);
  assert.ok("isolated" in s.flags);
  assert.equal(s.nodeId, "scope");
  assert.equal(s.minutes, 120, "notBefore moves the clock to two hours");
});

test("applyChoice does not mutate its input", () => {
  const a = newSession(rw, "x", 0);
  const snapshot = JSON.stringify(a);
  applyChoice(rw, a, "isolate", { now: 0 });
  assert.equal(JSON.stringify(a), snapshot);
});

test("unknown or finished choices throw", () => {
  const a = newSession(rw, "x", 0);
  assert.throws(() => applyChoice(rw, a, "nope"), /not available/);
  assert.throws(() => applyChoice(rw, playBest(rw), "isolate"), /over/);
});

test("deadline met inside the window costs nothing", () => {
  const s = playBest(rw);
  assert.deepEqual(s.deadlines.map((d) => d.state), ["met", "met", "met"]);
});

test("waiting past the early-warning window marks it missed and applies the penalty", () => {
  const s = play(rw, ["isolate", "activate", "forensic", "wait-facts", "formal", "refuse-report", "statement", "phased", "transparent"]);
  const early = s.deadlines.find((d) => d.id === "nis2-early")!;
  assert.equal(early.state, "missed");
  assert.ok(s.events.some((e) => /Deadline missed/.test(e)));
});

test("a late submission is recorded as late, not met", () => {
  const s = play(rw, ["isolate", "activate", "forensic", "early", "wait-full", "refuse-report", "late-notice", "phased", "transparent"]);
  assert.equal(s.deadlines.find((d) => d.id === "nis2-notify")!.state, "late");
});

test("modifiers fire only when their condition holds", () => {
  const good = play(rw, ["isolate", "activate", "forensic", "early", "formal", "refuse-report", "statement", "phased"]);
  const bad = play(rw, ["isolate", "activate", "forensic", "early", "formal", "refuse-report", "statement", "fast"]);
  assert.ok(!good.log.at(-1)!.notes.some((n) => /return/.test(n)));
  assert.ok(bad.log.at(-1)!.notes.some((n) => /return/.test(n)), "fast restore with low containment is reinfected");
  assert.ok(bad.vars.operations < 100);
});

test("visibleWhen hides the late-notice option once the authority has been told", () => {
  const early = play(rw, ["isolate", "activate", "forensic", "early", "formal", "refuse-report"]);
  assert.ok(!visibleChoices(rw, early).some((c) => c.id === "late-notice"));
  const late = play(rw, ["isolate", "activate", "forensic", "wait-facts", "wait-full", "refuse-report"]);
  assert.ok(visibleChoices(rw, late).some((c) => c.id === "late-notice"));
});

test("variables stay clamped to 0..100 and cost never goes negative", () => {
  for (const s of [playBest(rw), playFirst(rw), playFirst(get("wire-fraud"))]) {
    for (const k of ["containment", "operations", "trust", "evidence", "legal"] as const) assert.ok(s.vars[k] >= 0 && s.vars[k] <= 100, k);
    assert.ok(s.vars.cost >= 0);
  }
});

test("score weights add up to 100 and grades follow the total", () => {
  const sc = score(rw, playBest(rw));
  assert.equal(sc.parts.reduce((a, p) => a + p.weight, 0), 100);
  assert.equal(sc.grade, "A");
  assert.ok(score(rw, playFirst(rw)).total < sc.total);
});

test("the log records insight, effects and the clock", () => {
  const s = play(rw, ["reboot"]);
  const e = s.log[0]!;
  assert.equal(e.insight.quality, "poor");
  assert.equal(e.atMinutes, 0);
  assert.equal(e.afterMinutes, 120, "the clock includes the jump to the next scene");
  assert.equal(e.effects.evidence, -25);
});
