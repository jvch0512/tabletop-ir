import { optimalPath, reviewDecisions, DecisionReview, PathResult } from "./analysis.js";
import { Score, score } from "./engine.js";
import { Scenario, Session } from "./types.js";

export function clock(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = Math.round(minutes % 60);
  return `${d > 0 ? `${d}d ` : ""}${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
}

export function money(eur: number): string {
  return `EUR ${eur.toLocaleString("en-GB")}`;
}

export interface Report {
  scenario: { id: string; title: string; organisation: string };
  score: Score;
  optimal: { score: number; truncated: boolean; steps: Array<{ scene: string; choice: string }> };
  gap: number;
  review: DecisionReview[];
  deadlines: Session["deadlines"];
  timeline: Session["log"];
  finalVars: Session["vars"];
  elapsedMinutes: number;
  controls: Array<{ id: string; count: number }>;
}

function describePath(sc: Scenario, p: PathResult): Report["optimal"]["steps"] {
  const steps: Report["optimal"]["steps"] = [];
  let node = sc.nodes.find((n) => n.id === sc.startNode);
  for (const id of p.choices) {
    if (!node) break;
    const c = node.choices.find((x) => x.id === id);
    if (!c) break;
    steps.push({ scene: node.title, choice: c.label });
    node = c.next === null ? undefined : sc.nodes.find((n) => n.id === c.next);
  }
  return steps;
}

export function buildReport(sc: Scenario, s: Session): Report {
  if (s.nodeId !== null) throw new Error("the exercise is not finished");
  const sco = score(sc, s);
  const opt = optimalPath(sc);
  const counts = new Map<string, number>();
  for (const e of s.log) if (e.insight.quality !== "good") for (const c of e.insight.controls ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
  return {
    scenario: { id: sc.id, title: sc.title, organisation: sc.organisation },
    score: sco,
    optimal: { score: opt.score, truncated: opt.truncated, steps: describePath(sc, opt) },
    gap: Math.round((opt.score - sco.total) * 10) / 10,
    review: reviewDecisions(sc, s),
    deadlines: s.deadlines,
    timeline: s.log,
    finalVars: s.vars,
    elapsedMinutes: s.minutes,
    controls: [...counts.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
  };
}

const esc = (t: string) => t.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function markdown(sc: Scenario, r: Report): string {
  const o: string[] = [];
  o.push(`# After-action report: ${r.scenario.title}`, "");
  o.push(`${r.scenario.organisation}. Simulated duration ${clock(r.elapsedMinutes)}.`, "");
  o.push(`**Score ${r.score.total} / 100, grade ${r.score.grade}.** Best achievable on this scenario: ${r.optimal.score}${r.optimal.truncated ? " (search truncated)" : ""}. Gap: ${r.gap}.`, "");
  o.push("## Score breakdown", "", "| Area | Value | Weight | Points |", "|---|---:|---:|---:|");
  for (const p of r.score.parts) o.push(`| ${p.name} | ${p.value} | ${p.weight} | ${p.points.toFixed(1)} |`);
  o.push("", "## Regulatory clock", "", "| Obligation | Reference | Due | Result |", "|---|---|---:|---|");
  for (const d of r.deadlines) {
    const res = d.state === "met" ? `Met at ${clock(d.metAtMinutes ?? 0)}` : d.state === "late" ? `Late, filed at ${clock(d.metAtMinutes ?? 0)}` : "Missed";
    o.push(`| ${esc(d.label)} | ${esc(d.reference)} | ${clock(d.dueMinutes)} | ${res} |`);
  }
  o.push("", "## Timeline", "");
  for (const e of r.timeline) {
    o.push(`${e.step}. **T+${clock(e.atMinutes)}** ${esc(e.nodeTitle)}: ${esc(e.choiceLabel)}${e.timedOut ? " *(decided by the timer)*" : ""}`);
    o.push(`   - ${esc(e.insight.text)}`);
    for (const n of e.notes) o.push(`   - ${esc(n)}`);
    if (e.note) o.push(`   - Facilitator note: ${esc(e.note)}`);
  }
  o.push("", "## Where points were lost", "", "| Decision | You chose | Best option | Points lost |", "|---|---|---|---:|");
  for (const d of r.review) o.push(`| ${esc(d.nodeTitle)} | ${esc(d.chosenLabel)} | ${d.chosenId === d.bestChoiceId ? "same" : esc(d.bestChoiceLabel)} | ${d.cost.toFixed(1)} |`);
  if (r.controls.length) {
    o.push("", "## Controls to review", "");
    o.push(`Controls linked to the weaker decisions (IDs match the compliance-atlas catalogue): ${r.controls.map((c) => `${c.id} (${c.count})`).join(", ")}.`);
  }
  o.push("", "## Best path", "");
  r.optimal.steps.forEach((s, i) => o.push(`${i + 1}. ${esc(s.scene)}: ${esc(s.choice)}`));
  o.push("");
  void sc;
  return o.join("\n");
}
