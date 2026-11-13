import { applyChoice, newSession, score, visibleChoices } from "./engine.js";
import { Scenario, Session } from "./types.js";

const BUDGET = 3_000_000;

export interface PathResult { score: number; choices: string[]; truncated: boolean }

/** Exhaustive search for the highest final score reachable from a session. */
export function bestFrom(sc: Scenario, s: Session): PathResult {
  let visited = 0;
  let truncated = false;
  const walk = (cur: Session): { score: number; path: string[] } => {
    if (cur.nodeId === null) return { score: score(sc, cur).total, path: [] };
    let best = { score: -1, path: [] as string[] };
    for (const c of visibleChoices(sc, cur)) {
      if (++visited > BUDGET) { truncated = true; break; }
      const r = walk(applyChoice(sc, cur, c.id, { now: 0 }));
      if (r.score > best.score) best = { score: r.score, path: [c.id, ...r.path] };
    }
    return best;
  };
  const r = walk(s);
  return { score: r.score, choices: r.path, truncated };
}

export function optimalPath(sc: Scenario): PathResult {
  return bestFrom(sc, newSession(sc, "optimal", 0));
}

export interface DecisionReview {
  step: number;
  nodeTitle: string;
  chosenId: string;
  chosenLabel: string;
  bestChoiceId: string;
  bestChoiceLabel: string;
  /** Best final score still reachable after the player's choice. */
  reachableAfterChosen: number;
  /** Best final score reachable had the best choice been made. */
  reachableAfterBest: number;
  cost: number;
}

/** For each decision, how much of the achievable score was given up. */
export function reviewDecisions(sc: Scenario, played: Session): DecisionReview[] {
  const out: DecisionReview[] = [];
  let s = newSession(sc, "review", 0);
  for (const e of played.log) {
    let best: { id: string; label: string; score: number } | null = null;
    let chosen = -1;
    for (const c of visibleChoices(sc, s)) {
      const r = bestFrom(sc, applyChoice(sc, s, c.id, { now: 0 })).score;
      if (c.id === e.choiceId) chosen = r;
      if (!best || r > best.score) best = { id: c.id, label: c.label, score: r };
    }
    if (!best) break;
    out.push({
      step: e.step, nodeTitle: e.nodeTitle, chosenId: e.choiceId, chosenLabel: e.choiceLabel, bestChoiceId: best.id, bestChoiceLabel: best.label,
      reachableAfterChosen: chosen, reachableAfterBest: best.score, cost: Math.round((best.score - chosen) * 10) / 10,
    });
    s = applyChoice(sc, s, e.choiceId, { now: 0 });
  }
  return out;
}
