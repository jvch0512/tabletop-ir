"use strict";
const app = document.getElementById("app");
const homeBtn = document.getElementById("home");
const HDR = { "content-type": "application/json", "x-tabletop-request": "1" };
let timerId = null;

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  const add = (k) => {
    if (k === null || k === undefined || k === false) return;
    if (Array.isArray(k)) { for (const x of k) add(x); return; }
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  for (const k of kids) add(k);
  return el;
}

const DEMO = document.documentElement.dataset.demo === "1";
async function api(path, body) {
  if (DEMO) {
    if (!globalThis.tabletopApi) await (await import("./lib/browser-api.js")).install("./scenarios.json");
    try { return globalThis.tabletopApi(path, body); } catch (e) { throw new Error(e.message); }
  }
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: HDR, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "request failed");
  return data;
}

function clock(m) {
  const d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = Math.round(m % 60);
  return (d > 0 ? d + "d " : "") + String(hh).padStart(2, "0") + "h " + String(mm).padStart(2, "0") + "m";
}
const eur = (n) => "EUR " + n.toLocaleString("en-GB");
function stop() { if (timerId) { clearInterval(timerId); timerId = null; } }

async function showHome() {
  stop();
  homeBtn.hidden = true;
  const list = await api("/api/scenarios");
  app.replaceChildren(
    h("h1", null, "Choose an exercise"),
    h("p", { class: "lead" }, "Run an incident from the first alert to the board debrief. Time passes with every decision, regulatory clocks keep running and the report compares your choices with the best possible path."),
    h("div", { class: "cards" }, list.map((s) =>
      h("div", { class: "card" },
        h("h3", null, s.title),
        h("div", null, h("span", { class: "badge" }, s.difficulty), h("span", { class: "badge" }, s.scenes + " scenes"), h("span", { class: "badge" }, s.deadlines + " deadlines")),
        h("p", { class: "lead" }, s.summary),
        h("div", { class: "lead" }, s.organisation),
        h("button", { class: "primary", onclick: () => start(s.id) }, "Start exercise")))));
}

async function start(id) {
  try { render(await api("/api/sessions", { scenario: id })); } catch (e) { app.replaceChildren(h("p", { class: "err" }, e.message)); }
}

// CSSOM assignment is allowed under a strict style-src; a style="" attribute is not.
function fill(value) {
  const i = document.createElement("i");
  i.style.width = Math.max(0, Math.min(100, value)) + "%";
  return i;
}

function gauge(label, value, invert, text) {
  const cls = invert ? (value > 60 ? "bad" : value < 25 ? "good" : "") : (value < 35 ? "bad" : value > 70 ? "good" : "");
  return h("div", { class: "gauge" },
    h("div", { class: "lab" }, h("span", null, label), h("span", null, text !== undefined ? text : String(value))),
    h("div", { class: "bar " + cls }, fill(value)));
}

function sidebar(v) {
  const x = v.vars;
  const dl = h("div", { class: "panel" }, h("h2", null, "Regulatory clock"));
  for (const d of v.deadlines) {
    const left = d.dueMinutes - v.minutes;
    let state;
    if (d.state === "met") state = h("span", { class: "badge good" }, "met");
    else if (d.state === "late") state = h("span", { class: "badge poor" }, "late");
    else if (d.state === "missed") state = h("span", { class: "badge poor" }, "missed");
    else state = h("span", { class: "badge " + (left < 240 ? "poor" : "ok") }, clock(Math.max(0, left)) + " left");
    dl.appendChild(h("div", { class: "dl" }, h("div", null, d.label, h("div", { class: "ref" }, d.reference + ", due at " + clock(d.dueMinutes))), state));
  }
  return h("aside", null,
    h("div", { class: "panel" }, h("h2", null, "Situation"),
      gauge("Containment", x.containment, false), gauge("Operations", x.operations, false), gauge("Stakeholder trust", x.trust, false),
      gauge("Evidence preserved", x.evidence, false), gauge("Legal exposure", x.legal, true), gauge("Cost so far", Math.min(100, (100 * x.cost) / 2000000), true, eur(x.cost))),
    v.deadlines.length ? dl : null);
}

function logView(v) {
  const log = h("div", { class: "log" });
  for (const e of [...v.log].reverse()) {
    log.appendChild(h("div", { class: "entry " + e.quality },
      h("div", { class: "t" }, "T+" + clock(e.atMinutes) + " · " + e.scene + (e.timedOut ? " · decided by the timer" : "")),
      h("div", { class: "c" }, e.choice),
      h("div", { class: "i" }, e.insight),
      e.notes.map((n) => h("div", { class: "n" }, n))));
  }
  return log;
}

function render(v) {
  stop();
  homeBtn.hidden = false;
  if (v.finished) return renderEnd(v);
  const sc = v.scene;
  const timer = h("span", { class: "timer" }, "");
  const note = h("textarea", { rows: "2", maxlength: "500", placeholder: "Optional note for the after-action report (who decided, why)" });
  const buttons = [];
  let busy = false;
  const choose = async (body) => {
    if (busy) return;
    busy = true;
    for (const b of buttons) b.disabled = true;
    stop();
    try { render(await api("/api/sessions/" + v.id + "/choose", { ...body, note: note.value })); }
    catch (e) { busy = false; for (const b of buttons) b.disabled = false; app.appendChild(h("p", { class: "err" }, e.message)); }
  };
  const choices = h("div", { class: "choices" });
  for (const c of sc.choices) {
    const b = h("button", { class: "choice", onclick: () => choose({ choice: c.id }) }, c.label);
    buttons.push(b);
    choices.appendChild(b);
  }
  if (sc.timeLimitSeconds) {
    let left = sc.timeLimitSeconds;
    const tick = () => {
      timer.textContent = "Decision timer " + left + "s";
      timer.className = "timer" + (left <= 15 ? " low" : "");
      if (left-- <= 0) choose({ timedOut: true });
    };
    tick();
    timerId = setInterval(tick, 1000);
  }
  app.replaceChildren(h("div", { class: "game" },
    h("div", null,
      h("div", { class: "panel scene" },
        h("div", { class: "clockrow" }, h("div", { class: "clock" }, "T+" + clock(v.minutes)), timer),
        h("h2", null, sc.title), h("p", null, sc.body), choices, note),
      v.log.length ? h("div", { class: "panel" }, h("h2", null, "What has happened"), logView(v)) : null),
    sidebar(v)));
}

async function renderEnd(v) {
  const r = await api("/api/sessions/" + v.id + "/report");
  const parts = h("table", null, h("tr", null, h("th", null, "Area"), h("th", { class: "num" }, "Value"), h("th", { class: "num" }, "Weight"), h("th", { class: "num" }, "Points")));
  for (const p of r.score.parts) parts.appendChild(h("tr", null, h("td", null, p.name), h("td", { class: "num" }, p.value), h("td", { class: "num" }, p.weight), h("td", { class: "num" }, p.points.toFixed(1))));
  const rev = h("table", null, h("tr", null, h("th", null, "Decision"), h("th", null, "You chose"), h("th", null, "Best option"), h("th", { class: "num" }, "Points lost")));
  for (const d of r.review) rev.appendChild(h("tr", null, h("td", null, d.nodeTitle), h("td", null, d.chosenLabel), h("td", null, d.chosenId === d.bestChoiceId ? "same" : d.bestChoiceLabel), h("td", { class: "num" }, d.cost.toFixed(1))));
  const dls = h("table", null, h("tr", null, h("th", null, "Obligation"), h("th", null, "Due"), h("th", null, "Result")));
  for (const d of r.deadlines) dls.appendChild(h("tr", null, h("td", null, d.label + " (" + d.reference + ")"), h("td", null, clock(d.dueMinutes)),
    h("td", null, h("span", { class: "badge " + (d.state === "met" ? "good" : "poor") }, d.state === "met" ? "met" : d.state === "late" ? "late" : "missed"))));
  app.replaceChildren(h("div", { class: "game" },
    h("div", null,
      h("div", { class: "panel" },
        h("div", { class: "score" }, h("div", { class: "grade" }, r.score.grade),
          h("div", null, h("h1", null, r.score.total + " / 100"), h("div", { class: "lead" }, "Best achievable: " + r.optimal.score + ". Gap: " + r.gap + ". Simulated duration " + clock(r.elapsedMinutes) + "."))),
        h("a", { class: "dl-link", href: "/api/sessions/" + v.id + "/report.md", onclick: DEMO ? async (ev) => {
          ev.preventDefault();
          const md = await api("/api/sessions/" + v.id + "/report.md");
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
          a.download = "after-action-" + v.scenario.id + ".md";
          a.click();
          URL.revokeObjectURL(a.href);
        } : null }, "Download the after-action report (Markdown)")),
      h("div", { class: "panel" }, h("h2", null, "Where points were lost"), rev),
      h("div", { class: "panel" }, h("h2", null, "Timeline"), logView(v))),
    h("aside", null,
      h("div", { class: "panel" }, h("h2", null, "Score breakdown"), parts),
      v.deadlines.length ? h("div", { class: "panel" }, h("h2", null, "Regulatory clock"), dls) : null,
      r.controls.length ? h("div", { class: "panel" }, h("h2", null, "Controls to review"), h("p", null, r.controls.map((c) => c.id + " (" + c.count + ")").join(", "))) : null)));
}

homeBtn.addEventListener("click", () => { showHome().catch((e) => app.replaceChildren(h("p", { class: "err" }, e.message))); });
showHome().catch((e) => app.replaceChildren(h("p", { class: "err" }, e.message)));
