import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyChoice, newSession, nodeOf, score, visibleChoices } from "./engine.js";
import { buildReport, markdown } from "./report.js";
import { loadScenarios } from "./scenario.js";
import { Scenario, Session } from "./types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const MAX_BODY = 8 * 1024;
const MAX_SESSIONS = 100;
export const CSRF_HEADER = "x-tabletop-request";

const headers = (extra: Record<string, string> = {}) => ({ "content-security-policy": CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store", ...extra });

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, headers({ "content-type": "application/json; charset=utf-8" }));
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on("data", (c: Buffer) => { n += c.length; if (n > MAX_BODY) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

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

export interface ServerOptions { scenariosDir?: string; publicDir?: string }

export function createServer(opts: ServerOptions = {}): http.Server {
  const scenarios = loadScenarios(opts.scenariosDir ?? path.join(ROOT, "scenarios"));
  const publicDir = opts.publicDir ?? path.join(ROOT, "public");
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const sessions = new Map<string, Session>();
  let port = 0;

  const guard = (req: http.IncomingMessage): string | null => {
    const host = (req.headers.host ?? "").toLowerCase();
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return "bad host";
    if (req.method === "POST") {
      if (req.headers[CSRF_HEADER] !== "1") return "missing request header";
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return "content type must be application/json";
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== `http://${req.headers.host}`) return "cross-origin request";
    }
    void port;
    return null;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const bad = guard(req);
      if (bad) return send(res, 403, { error: bad });
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname;

      if (req.method === "GET" && p === "/api/scenarios") {
        return send(res, 200, scenarios.map((s) => ({ id: s.id, title: s.title, summary: s.summary, difficulty: s.difficulty, organisation: s.organisation, scenes: s.nodes.length, deadlines: s.deadlines.length })));
      }
      if (req.method === "POST" && p === "/api/sessions") {
        let body: { scenario?: unknown };
        try { body = JSON.parse((await readBody(req)).toString("utf8")) as { scenario?: unknown }; } catch { return send(res, 400, { error: "invalid JSON" }); }
        const sc = typeof body.scenario === "string" ? byId.get(body.scenario) : undefined;
        if (!sc) return send(res, 404, { error: "unknown scenario" });
        const s = newSession(sc, randomUUID());
        sessions.set(s.id, s);
        if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string);
        return send(res, 200, view(sc, s));
      }
      const m = /^\/api\/sessions\/([0-9a-f-]{36})(?:\/(choose|report|report\.md))?$/.exec(p);
      if (m) {
        const s = sessions.get(m[1]!);
        if (!s) return send(res, 404, { error: "unknown session" });
        const sc = byId.get(s.scenarioId)!;
        if (req.method === "GET" && !m[2]) return send(res, 200, view(sc, s));
        if (req.method === "GET" && m[2] === "report") {
          if (s.nodeId !== null) return send(res, 409, { error: "the exercise is not finished" });
          return send(res, 200, buildReport(sc, s));
        }
        if (req.method === "GET" && m[2] === "report.md") {
          if (s.nodeId !== null) return send(res, 409, { error: "the exercise is not finished" });
          res.writeHead(200, headers({ "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="after-action-${sc.id}.md"` }));
          return void res.end(markdown(sc, buildReport(sc, s)));
        }
        if (req.method === "POST" && m[2] === "choose") {
          let body: { choice?: unknown; note?: unknown; timedOut?: unknown };
          try { body = JSON.parse((await readBody(req)).toString("utf8")) as typeof body; } catch (e) {
            return send(res, e instanceof Error && e.message === "too large" ? 413 : 400, { error: "invalid or oversized JSON" });
          }
          if (s.nodeId === null) return send(res, 409, { error: "the exercise is over" });
          const node = nodeOf(sc, s.nodeId);
          const timedOut = body.timedOut === true && node.onTimeout !== undefined;
          const choiceId = timedOut ? node.onTimeout! : body.choice;
          if (typeof choiceId !== "string") return send(res, 422, { error: "choice is required" });
          const note = typeof body.note === "string" ? body.note.slice(0, 500) : "";
          let next: Session;
          try { next = applyChoice(sc, s, choiceId, { note, timedOut }); } catch (e) { return send(res, 422, { error: (e as Error).message }); }
          sessions.set(s.id, next);
          return send(res, 200, view(sc, next));
        }
        return send(res, 405, { error: "method not allowed" });
      }
      if (req.method === "GET") {
        const rel = p === "/" ? "index.html" : p.slice(1);
        if (!/^[\w.-]+$/.test(rel) || !TYPES[path.extname(rel)]) return send(res, 404, { error: "not found" });
        try {
          const data = readFileSync(path.join(publicDir, rel));
          res.writeHead(200, headers({ "content-type": TYPES[path.extname(rel)]! }));
          return void res.end(data);
        } catch { return send(res, 404, { error: "not found" }); }
      }
      return send(res, 405, { error: "method not allowed" });
    } catch (e) {
      return send(res, 500, { error: e instanceof Error ? e.message : "server error" });
    }
  });
  server.on("listening", () => { const a = server.address(); if (a && typeof a === "object") port = a.port; });
  return server;
}
