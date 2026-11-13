#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { optimalPath } from "./analysis.js";
import { clock } from "./report.js";
import { loadScenarios, validateScenario } from "./scenario.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const USAGE = `tabletop-ir <command>

  list                    list bundled scenarios
  validate <file.json>    check a scenario file you wrote
  optimal <scenario-id>   print the best achievable path and score
  serve [port]            start the web UI on 127.0.0.1 (default 8700)
`;

export async function main(argv: string[], out: (s: string) => void = console.log): Promise<number> {
  const [cmd, arg] = argv;
  const dir = path.join(ROOT, "scenarios");
  try {
    if (cmd === "list") {
      for (const s of loadScenarios(dir)) out(`${s.id.padEnd(20)} ${s.difficulty.padEnd(9)} ${s.nodes.length} scenes, ${s.deadlines.length} deadlines  ${s.title}`);
      return 0;
    }
    if (cmd === "validate" && arg) {
      const sc = validateScenario(JSON.parse(readFileSync(arg, "utf8")));
      out(`ok: ${sc.id}, ${sc.nodes.length} scenes, ${sc.deadlines.length} deadlines`);
      return 0;
    }
    if (cmd === "optimal" && arg) {
      const sc = loadScenarios(dir).find((s) => s.id === arg);
      if (!sc) { out(`unknown scenario ${arg}`); return 2; }
      const r = optimalPath(sc);
      out(`best score ${r.score}${r.truncated ? " (search truncated)" : ""}`);
      let node = sc.nodes.find((n) => n.id === sc.startNode);
      for (const id of r.choices) {
        const c = node?.choices.find((x) => x.id === id);
        if (!node || !c) break;
        out(`  ${node.title}: ${c.label} (+${clock(c.minutes)})`);
        node = c.next === null ? undefined : sc.nodes.find((n) => n.id === c.next);
      }
      return 0;
    }
    if (cmd === "serve") {
      const { createServer } = await import("./server.js");
      const port = Number(arg ?? process.env.PORT ?? 8700);
      createServer().listen(port, "127.0.0.1", () => out(`tabletop-ir listening on http://127.0.0.1:${port}`));
      return -1;
    }
  } catch (e) {
    out(`error: ${(e as Error).message}`);
    return 1;
  }
  out(USAGE);
  return cmd ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => { if (code >= 0) process.exitCode = code; });
}
