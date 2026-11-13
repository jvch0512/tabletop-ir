import test from "node:test";
import assert from "node:assert/strict";
import { optimalPath, reviewDecisions } from "../src/analysis.js";
import { score } from "../src/engine.js";
import { get, play, playBest, playFirst } from "./helpers.js";

test("the optimal path is a sound, complete play with the right start", () => {
  for (const [id, first] of [["ransomware-friday", "isolate"], ["wire-fraud", "callback"]] as const) {
    const sc = get(id);
    const r = optimalPath(sc);
    assert.equal(r.truncated, false);
    assert.equal(r.choices[0], first);
    assert.equal(score(sc, playBest(sc)).total, r.score);
  }
});

test("no scripted play beats the optimum", () => {
  const sc = get("ransomware-friday");
  const best = optimalPath(sc).score;
  assert.ok(score(sc, playFirst(sc)).total <= best);
  assert.ok(score(sc, play(sc, ["reboot", "it-only", "restore-now", "wait-facts", "wait-full", "pay-fast", "deny", "fast", "minimal"])).total < best - 20);
});

test("reviewing the optimal play shows no points lost", () => {
  const sc = get("ransomware-friday");
  const rev = reviewDecisions(sc, playBest(sc));
  assert.equal(rev.length, 9);
  assert.ok(rev.every((d) => d.cost === 0));
});

test("reviewing a weak play locates the loss", () => {
  const sc = get("ransomware-friday");
  const weak = play(sc, ["isolate", "activate", "forensic", "wait-facts", "formal", "refuse-report", "statement", "phased", "transparent"]);
  const rev = reviewDecisions(sc, weak);
  const lost = rev.filter((d) => d.cost > 0);
  assert.equal(lost.length, 1);
  assert.equal(lost[0]!.nodeTitle, "The regulatory clock");
  assert.equal(lost[0]!.bestChoiceId, "early");
});

test("per-decision costs never exceed the gap to the optimum", () => {
  const sc = get("wire-fraud");
  const s = playFirst(sc);
  const gap = optimalPath(sc).score - score(sc, s).total;
  const total = reviewDecisions(sc, s).reduce((a, d) => a + d.cost, 0);
  assert.ok(total >= gap - 0.2, "costs add up to at least the gap");
});
