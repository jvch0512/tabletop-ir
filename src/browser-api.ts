// Client-side twin of server.ts for the static GitHub Pages demo. Same routes, same view(), no server.
import { applyChoice, newSession, nodeOf } from "./engine.js";
import { buildReport, markdown } from "./report.js";
import { view } from "./view.js";
import { Scenario, Session } from "./types.js";

const MAX_SESSIONS = 100;

export function createLocalApi(scenarios: Scenario[]) {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const sessions = new Map<string, Session>();

  return function handle(path: string, body?: { scenario?: unknown; choice?: unknown; note?: unknown; timedOut?: unknown }): unknown {
    if (path === "/api/scenarios") {
      return scenarios.map((s) => ({ id: s.id, title: s.title, summary: s.summary, difficulty: s.difficulty, organisation: s.organisation, scenes: s.nodes.length, deadlines: s.deadlines.length }));
    }
    if (path === "/api/sessions") {
      const sc = typeof body?.scenario === "string" ? byId.get(body.scenario) : undefined;
      if (!sc) throw new Error("unknown scenario");
      const s = newSession(sc, crypto.randomUUID());
      sessions.set(s.id, s);
      if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string);
      return view(sc, s);
    }
    const m = /^\/api\/sessions\/([0-9a-f-]{36})\/(choose|report|report\.md)$/.exec(path);
    if (!m) throw new Error("not found");
    const s = sessions.get(m[1]!);
    if (!s) throw new Error("unknown session");
    const sc = byId.get(s.scenarioId)!;
    if (m[2] === "choose") {
      if (s.nodeId === null) throw new Error("the exercise is over");
      const node = nodeOf(sc, s.nodeId);
      const timedOut = body?.timedOut === true && node.onTimeout !== undefined;
      const choiceId = timedOut ? node.onTimeout! : body?.choice;
      if (typeof choiceId !== "string") throw new Error("choice is required");
      const note = typeof body?.note === "string" ? body.note.slice(0, 500) : "";
      const next = applyChoice(sc, s, choiceId, { note, timedOut });
      sessions.set(s.id, next);
      return view(sc, next);
    }
    if (s.nodeId !== null) throw new Error("the exercise is not finished");
    const rep = buildReport(sc, s);
    return m[2] === "report" ? rep : markdown(sc, rep);
  };
}

export async function install(url: string): Promise<void> {
  const scenarios = (await (await fetch(url)).json()) as Scenario[];
  (globalThis as unknown as { tabletopApi: unknown }).tabletopApi = createLocalApi(scenarios);
}
