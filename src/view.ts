import { nodeOf, score, visibleChoices } from "./engine.js";
import { Scenario, Session } from "./types.js";

/** What the player may see: current scene and option labels only, never the quality of unchosen options. */
export function view(sc: Scenario, s: Session) {
  const done = s.nodeId === null;
  const node = done ? null : nodeOf(sc, s.nodeId!);
  return {
    id: s.id,
    scenario: { id: sc.id, title: sc.title, organisation: sc.organisation, startLabel: sc.startLabel },
    minutes: s.minutes,
    vars: s.vars,
    deadlines: s.deadlines,
    finished: done,
    scene: node && { id: node.id, title: node.title, body: node.body, timeLimitSeconds: node.timeLimitSeconds ?? null, choices: visibleChoices(sc, s).map((c) => ({ id: c.id, label: c.label })) },
    log: s.log.map((e) => ({ step: e.step, scene: e.nodeTitle, choice: e.choiceLabel, atMinutes: e.atMinutes, timedOut: e.timedOut, quality: e.insight.quality, insight: e.insight.text, notes: e.notes, effects: e.effects })),
    history: s.history,
    score: done ? score(sc, s) : null,
  };
}
