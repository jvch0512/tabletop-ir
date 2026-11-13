import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyChoice, newSession } from "../src/engine.js";
import { optimalPath } from "../src/analysis.js";
import { loadScenarios } from "../src/scenario.js";
import { Scenario, Session } from "../src/types.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const scenarios = loadScenarios(path.join(ROOT, "scenarios"));
export const get = (id: string): Scenario => scenarios.find((s) => s.id === id)!;

export function play(sc: Scenario, ids: string[]): Session {
  let s = newSession(sc, "t", 0);
  for (const id of ids) s = applyChoice(sc, s, id, { now: 0 });
  return s;
}

export function playBest(sc: Scenario): Session { return play(sc, optimalPath(sc).choices); }

/** Always pick the first option: usually a legitimate but unremarkable play. */
export function playFirst(sc: Scenario): Session {
  let s = newSession(sc, "t", 0);
  while (s.nodeId !== null) {
    const node = sc.nodes.find((n) => n.id === s.nodeId)!;
    s = applyChoice(sc, s, node.choices[node.choices.length - 1]!.id, { now: 0 });
  }
  return s;
}
