import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";
import { ROOT } from "./helpers.js";

let server: http.Server;
let base = "";
let port = 0;
before(async () => {
  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});
after(() => { server.closeAllConnections(); server.close(); });

const H = { "content-type": "application/json", "x-tabletop-request": "1" };
async function post(url: string, body: unknown, headers: Record<string, string> = H) {
  const r = await fetch(base + url, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}
async function getJson(url: string) {
  const r = await fetch(base + url);
  return { status: r.status, body: (await r.json()) as any, headers: r.headers };
}

test("lists the bundled scenarios", async () => {
  const r = await getJson("/api/scenarios");
  assert.equal(r.status, 200);
  assert.ok(r.body.some((s: { id: string }) => s.id === "ransomware-friday"));
});

test("a full session runs to a report", async () => {
  const s = await post("/api/sessions", { scenario: "wire-fraud" });
  assert.equal(s.status, 200);
  assert.equal(s.body.scene.id, "request");
  assert.equal(s.body.scene.choices.length, 3);
  for (const c of s.body.scene.choices) assert.deepEqual(Object.keys(c).sort(), ["id", "label"], "the player sees no quality hints");
  const id = s.body.id as string;
  assert.equal((await getJson(`/api/sessions/${id}/report`)).status, 409);
  let v = await post(`/api/sessions/${id}/choose`, { choice: "callback", note: "Finance lead decided" });
  assert.equal(v.body.log[0].quality, "good");
  v = await post(`/api/sessions/${id}/choose`, { choice: "investigate" });
  v = await post(`/api/sessions/${id}/choose`, { choice: "process" });
  assert.equal(v.body.finished, true);
  assert.equal(v.body.scene, null);
  assert.equal(v.body.score.grade, "A");
  const rep = await getJson(`/api/sessions/${id}/report`);
  assert.equal(rep.body.gap, 0);
  const md = await fetch(`${base}/api/sessions/${id}/report.md`);
  assert.match(md.headers.get("content-disposition") ?? "", /attachment/);
  assert.ok((await md.text()).includes("Finance lead decided"));
  const again = await post(`/api/sessions/${id}/choose`, { choice: "process" });
  assert.equal(again.status, 409);
});

test("the timer picks the scene's default option", async () => {
  const s = await post("/api/sessions", { scenario: "wire-fraud" });
  const v = await post(`/api/sessions/${s.body.id}/choose`, { timedOut: true });
  assert.equal(v.status, 200);
  assert.equal(v.body.log[0].choice.startsWith("Process the payment"), true);
  assert.equal(v.body.log[0].timedOut, true);
});

test("invalid input is rejected with clear statuses", async () => {
  assert.equal((await post("/api/sessions", { scenario: "nope" })).status, 404);
  const s = await post("/api/sessions", { scenario: "wire-fraud" });
  assert.equal((await post(`/api/sessions/${s.body.id}/choose`, { choice: "zzz" })).status, 422);
  assert.equal((await post(`/api/sessions/${s.body.id}/choose`, {})).status, 422);
  assert.equal((await getJson("/api/sessions/00000000-0000-0000-0000-000000000000")).status, 404);
  const big = await post(`/api/sessions/${s.body.id}/choose`, { choice: "callback", note: "x".repeat(20000) }).catch(() => ({ status: 0 }));
  assert.ok([0, 413].includes(big.status));
});

test("POSTs need the custom header, JSON and a same-origin Origin", async () => {
  assert.equal((await post("/api/sessions", { scenario: "wire-fraud" }, { "content-type": "application/json" })).status, 403);
  assert.equal((await post("/api/sessions", { scenario: "wire-fraud" }, { "x-tabletop-request": "1", "content-type": "text/plain" })).status, 403);
  assert.equal((await post("/api/sessions", { scenario: "wire-fraud" }, { ...H, origin: "http://evil.example" })).status, 403);
});

test("a foreign Host header is refused (DNS rebinding)", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/scenarios", headers: { host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("error", reject); req.end();
  });
  assert.equal(status, 403);
});

test("static files carry a strict CSP and no path traversal is possible", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy") ?? "", /script-src 'self'/);
  assert.doesNotMatch(r.headers.get("content-security-policy") ?? "", /unsafe-inline/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await fetch(base + "/..%2Fpackage.json")).status, 404);
  assert.equal((await fetch(base + "/package.json")).status, 404);
});

test("the front end uses textContent rendering and no remote URLs", () => {
  const dir = path.join(ROOT, "public");
  for (const f of ["index.html", "app.js", "style.css"]) {
    const src = readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/, f);
    assert.doesNotMatch(src, /https?:\/\//, f);
  }
  assert.doesNotMatch(readFileSync(path.join(dir, "index.html"), "utf8"), /<script>|style=/);
});
