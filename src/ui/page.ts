/**
 * The local UI as one self-contained page. No fonts, scripts or styles are fetched
 * from anywhere: the binary must work offline, and a page that loaded a CDN asset
 * would be a phone-home by another name. All data is rendered with textContent —
 * file contents and model output never reach innerHTML.
 */
export function renderPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ADDGP-Lite</title>
<style>${CSS}</style>
</head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="4" y="10.5" width="16" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15.6" r="1.5" class="dot"/></svg>
      <span>ADDGP&#8209;Lite</span>
    </div>
    <div class="proj" id="proj">…</div>
    <nav id="nav">
      <a href="#overview" data-view="overview">Overview</a>
      <a href="#gaps" data-view="gaps">Gaps <span class="count" id="n-gaps"></span></a>
      <a href="#findings" data-view="findings">Local findings <span class="count" id="n-findings"></span></a>
      <a href="#leaves" data-view="leaves">What leaves</a>
      <a href="#ledger" data-view="ledger">Egress ledger <span class="count" id="n-ledger"></span></a>
    </nav>
    <div class="side-foot">
      <div class="local"><span class="pulse"></span>Running locally on 127.0.0.1</div>
      <div class="muted">No account · no telemetry<br>Read-only view of this project</div>
    </div>
  </aside>
  <main id="main"><div class="loading">Loading…</div></main>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script nonce="${nonce}">${JS}</script>
</body>
</html>`;
}

const CSS = `
:root{
  --bg:#F4F5F7; --panel:#FFFFFF; --side:#ECEEF2; --ink:#161A21; --ink2:#4C5463; --ink3:#848C9A;
  --line:#DDE1E7; --line2:#C8CDD5; --accent:#0E6E5A; --accent-ink:#FFFFFF; --accent-tint:#E2F1EC;
  --code:#10141B; --code-ink:#E4E8EF; --code-dim:#7D8799; --code-acc:#4FD8B8;
  --crit:#B42318; --crit-t:#FBE9E7; --high:#C2560C; --high-t:#FCEFE3; --med:#9A6B00; --med-t:#FBF3DC;
  --low:#3A5BA0; --low-t:#E8EEF9; --info:#5E6673; --info-t:#EEF0F3;
  --ok:#0E6E5A;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, "Helvetica Neue", sans-serif;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#0D1015; --panel:#14181F; --side:#10141A; --ink:#E8EBF0; --ink2:#A2AAB7; --ink3:#6E7686;
    --line:#232933; --line2:#2F3642; --accent:#36C8A5; --accent-ink:#06231C; --accent-tint:rgba(54,200,165,.12);
    --code:#080A0E; --code-ink:#E4E8EF; --code-dim:#6F798B; --code-acc:#5FE3C4;
    --crit:#F0705F; --crit-t:rgba(240,112,95,.13); --high:#F0975A; --high-t:rgba(240,151,90,.13);
    --med:#E3B74F; --med-t:rgba(227,183,79,.13); --low:#7FA3E8; --low-t:rgba(127,163,232,.13);
    --info:#9AA2AF; --info-t:rgba(154,162,175,.12); --ok:#36C8A5;
  }
}
:root[data-theme="dark"]{
  --bg:#0D1015; --panel:#14181F; --side:#10141A; --ink:#E8EBF0; --ink2:#A2AAB7; --ink3:#6E7686;
  --line:#232933; --line2:#2F3642; --accent:#36C8A5; --accent-ink:#06231C; --accent-tint:rgba(54,200,165,.12);
  --code:#080A0E; --code-ink:#E4E8EF; --code-dim:#6F798B; --code-acc:#5FE3C4;
  --crit:#F0705F; --crit-t:rgba(240,112,95,.13); --high:#F0975A; --high-t:rgba(240,151,90,.13);
  --med:#E3B74F; --med-t:rgba(227,183,79,.13); --low:#7FA3E8; --low-t:rgba(127,163,232,.13);
  --info:#9AA2AF; --info-t:rgba(154,162,175,.12); --ok:#36C8A5;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:14px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
code,pre,.mono{font-family:var(--mono)}
a{color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.app{display:grid;grid-template-columns:232px 1fr;min-height:100vh}
.side{background:var(--side);border-right:1px solid var(--line);padding:18px 14px;display:flex;flex-direction:column;gap:16px;position:sticky;top:0;height:100vh}
.brand{display:flex;align-items:center;gap:9px;font-weight:650;font-size:15px;letter-spacing:-.01em;padding:0 6px}
.brand .dot{fill:var(--accent)}
.proj{font-family:var(--mono);font-size:12px;color:var(--ink2);padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);line-height:1.55}
.proj b{color:var(--ink);font-weight:600}
nav{display:flex;flex-direction:column;gap:2px}
nav a{display:flex;justify-content:space-between;align-items:center;text-decoration:none;color:var(--ink2);padding:7px 10px;border-radius:6px;font-weight:500}
nav a:hover{background:var(--panel);color:var(--ink)}
nav a.on{background:var(--panel);color:var(--ink);box-shadow:inset 2px 0 0 var(--accent)}
.count{font-family:var(--mono);font-size:11.5px;color:var(--ink3)}
.side-foot{margin-top:auto;font-size:12px;display:grid;gap:6px;padding:0 6px}
.local{display:flex;align-items:center;gap:7px;color:var(--ink2);font-family:var(--mono);font-size:11.5px}
.pulse{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px var(--accent-tint)}
.muted{color:var(--ink3)}
main{padding:26px 32px 60px;min-width:0}
.loading{color:var(--ink3);padding:40px 0}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:20px}
h1{font-size:21px;margin:0;letter-spacing:-.015em;font-weight:650}
h2{font-size:14px;margin:0 0 10px;font-weight:650}
.sub{color:var(--ink2);margin:4px 0 0;max-width:72ch}
.grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px}
.label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3);font-weight:600}
.big{font-family:var(--mono);font-size:24px;font-weight:600;margin-top:4px;font-variant-numeric:tabular-nums}
.small{font-size:12.5px;color:var(--ink2)}
.sevbar{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.chip{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap}
.sev-critical{color:var(--crit);background:var(--crit-t)}
.sev-high{color:var(--high);background:var(--high-t)}
.sev-medium{color:var(--med);background:var(--med-t)}
.sev-low{color:var(--low);background:var(--low-t)}
.sev-info{color:var(--info);background:var(--info-t)}
.chip.neutral{color:var(--ink2);background:var(--bg);border:1px solid var(--line)}
.chip.good{color:var(--ok);background:var(--accent-tint)}
.cmd{display:flex;align-items:center;gap:8px;background:var(--code);color:var(--code-ink);border-radius:6px;padding:8px 10px;font-family:var(--mono);font-size:12.5px;overflow-x:auto}
.cmd::before{content:"$";color:var(--code-dim)}
.cmd span{flex:1;white-space:pre}
.cmd button{flex:none}
.steps{display:grid;gap:8px}
button{font:inherit;cursor:pointer}
.btn{background:var(--accent);color:var(--accent-ink);border:0;border-radius:6px;padding:7px 12px;font-weight:600;font-size:13px}
.btn.ghost{background:transparent;color:var(--ink2);border:1px solid var(--line2)}
.btn.tiny{padding:2px 8px;font-size:11.5px;background:transparent;color:var(--code-dim);border:1px solid #2A313C}
.btn:hover{filter:brightness(1.06)}
.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.toolbar input{flex:1;min-width:180px;background:var(--panel);border:1px solid var(--line2);border-radius:6px;padding:7px 10px;color:var(--ink);font:13px var(--sans)}
.filter{background:var(--panel);border:1px solid var(--line2);color:var(--ink2);border-radius:999px;padding:3px 10px;font-size:12px;font-family:var(--mono)}
.filter.on{border-color:var(--accent);color:var(--ink);box-shadow:inset 0 0 0 1px var(--accent)}
.split{display:grid;grid-template-columns:minmax(260px,360px) minmax(0,1fr);gap:14px;align-items:start}
.list{background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden;max-height:calc(100vh - 170px);overflow-y:auto}
.row{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer;text-align:left;background:none;border-left:0;border-right:0;border-top:0;width:100%;color:inherit}
.row:hover{background:var(--bg)}
.row.on{background:var(--accent-tint)}
.row .id{font-family:var(--mono);font-size:11.5px;color:var(--ink3);grid-column:2}
.row .t{grid-column:2;font-weight:500;line-height:1.4}
.row .chip{grid-row:1/span 2;align-self:start;margin-top:2px}
.detail{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:20px 22px;min-width:0}
.detail h3{font-size:17px;margin:6px 0 12px;line-height:1.35;letter-spacing:-.01em}
.meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--ink2)}
.sec{margin-top:18px}
.sec p{margin:4px 0 0;max-width:78ch}
.howlist{margin:6px 0 0;padding-left:0;list-style:none;display:grid;gap:6px;counter-reset:s}
.howlist li{display:grid;grid-template-columns:24px 1fr;max-width:80ch}
.howlist li::before{counter-increment:s;content:counter(s);font-family:var(--mono);font-size:12px;color:var(--ink3);padding-top:1px}
.cons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:6px}
.cons div{border:1px solid var(--line);border-radius:6px;padding:10px 12px;font-size:13px}
.cons .k{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);font-weight:600;margin-bottom:3px}
.cons .resid{border-color:var(--med);background:var(--med-t)}
.cite{display:grid;gap:6px;margin-top:6px}
.cite a{color:var(--accent);text-decoration:none;word-break:break-word}
.cite a:hover{text-decoration:underline}
.cite .src{font-size:12px;color:var(--ink3)}
.prompt{margin-top:8px;background:var(--code);color:var(--code-ink);border-radius:8px;overflow:hidden}
.prompt .bar{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #222A35;font-family:var(--mono);font-size:11.5px;color:var(--code-dim)}
.prompt pre{margin:0;padding:12px 14px;max-height:260px;overflow:auto;font-size:12px;line-height:1.6;white-space:pre-wrap}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3);font-weight:600;padding:9px 12px;border-bottom:1px solid var(--line2);background:var(--panel);position:sticky;top:0}
td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
.tablewrap{background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:auto;max-height:calc(100vh - 190px)}
.loc{font-family:var(--mono);font-size:12px;color:var(--ink2);white-space:nowrap}
.dim{color:var(--ink3)}
.files{display:grid;gap:8px}
details.file{background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
details.file summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:4px 16px;padding:10px 14px;align-items:center}
details.file summary::-webkit-details-marker{display:none}
details.file summary .p{font-family:var(--mono);font-size:12.5px;font-weight:600}
details.file summary .s{font-family:var(--mono);font-size:11.5px;color:var(--ink3);grid-column:1}
details.file summary .stats{grid-row:1/span 2;grid-column:2;display:flex;gap:6px}
details.file pre{margin:0;background:var(--code);color:var(--code-ink);padding:12px 14px;font-size:12px;line-height:1.6;overflow:auto;max-height:420px}
.denied{display:grid;gap:6px}
.denied div{display:grid;grid-template-columns:18px minmax(0,280px) 1fr;gap:10px;font-size:12.5px;align-items:baseline}
.denied .x{color:var(--crit);font-weight:700}
.empty{border:1px dashed var(--line2);border-radius:8px;padding:28px;text-align:center;color:var(--ink2)}
.empty h2{margin-bottom:6px}
.empty .steps{max-width:440px;margin:14px auto 0;text-align:left}
.banner{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-left:3px solid var(--med);background:var(--panel);border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--ink2)}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);opacity:0;background:var(--ink);color:var(--bg);padding:8px 14px;border-radius:6px;font-size:13px;transition:.18s;pointer-events:none}
.toast.show{opacity:1;transform:translateX(-50%)}
kbd{font-family:var(--mono);font-size:11px;border:1px solid var(--line2);border-bottom-width:2px;border-radius:4px;padding:0 5px;color:var(--ink2);background:var(--panel)}
@media (max-width:900px){
  .app{grid-template-columns:1fr}
  .side{position:static;height:auto}
  .grid4{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid2,.split,.cons{grid-template-columns:1fr}
  main{padding:20px 16px}
}
@media (prefers-reduced-motion: reduce){ .toast{transition:none} }
`;

const JS = `
"use strict";
(function(){
  var KEY = "addgp-ui-token";
  var m = location.hash.match(/t=([0-9a-f]+)/);
  if (m) { try { sessionStorage.setItem(KEY, m[1]); } catch(e){} history.replaceState(null, "", location.pathname + "#overview"); }
  var token = (m && m[1]) || (function(){ try { return sessionStorage.getItem(KEY); } catch(e){ return null; } })();

  var main = document.getElementById("main");
  var cache = {};

  function h(tag, attrs){
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0,2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c){
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function(x){ add(el, x); }); return; }
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  function api(path){
    if (cache[path]) return Promise.resolve(cache[path]);
    return fetch("/api/" + path, { headers: { "x-addgp-token": token || "" } }).then(function(r){
      if (r.status === 401) throw new Error("This page needs the link printed by \`addgp-lite ui\`. Run it again and open the new link.");
      return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || r.statusText); cache[path] = j; return j; });
    });
  }
  function toast(msg){
    var t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function(){ t.classList.remove("show"); }, 1700);
  }
  function copy(text, what){
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      function(){ toast("Copied " + what); },
      function(){ toast("Copy failed — select the text instead"); });
  }
  function sev(s){ return h("span", { class: "chip sev-" + s, text: s }); }
  function cmd(text){
    return h("div", { class: "cmd" }, h("span", { text: text }),
      h("button", { class: "btn tiny", onclick: function(){ copy(text, "command"); }, text: "copy" }));
  }
  function plural(n, one, many){ return n + " " + (n === 1 ? one : (many || one + "s")); }
  function bytes(n){ return n < 1024 ? n + " B" : n < 1048576 ? (n/1024).toFixed(1) + " KB" : (n/1048576).toFixed(1) + " MB"; }
  function when(iso){ if (!iso) return "—"; var d = new Date(iso); return d.toLocaleString(); }
  function money(o){ var t = 0; for (var k in (o||{})) t += o[k]; return "$" + t.toFixed(2); }
  function head(title, sub, right){
    return h("div", { class: "head" }, h("div", null, h("h1", { text: title }), sub ? h("p", { class: "sub", text: sub }) : null), right || null);
  }
  function fail(e){ main.replaceChildren(h("div", { class: "empty" }, h("h2", { text: "Could not load" }), h("p", { text: e.message }))); }

  /* ── overview ───────────────────────────────────── */
  function overview(){
    return api("overview").then(function(o){
      var run = o.run, s = o.gaps.by_severity;
      var hero = run ? null : h("div", { class: "empty", style: "margin-bottom:16px" },
        h("h2", { text: "No full scan yet" }),
        h("p", { text: "Local findings and the redaction preview already work without a key. A full audit — retrieving the law and judging your code against it — needs an OpenRouter key." }),
        h("div", { class: "steps" },
          cmd("addgp-lite scan --dry-run"),
          cmd("addgp-lite scan"),
          h("p", { class: "small dim", text: "The first shows projected spend and makes no calls. Refresh this page when the scan finishes." })));

      return [
        head(o.project, "Regions " + o.regions.join(", ").toUpperCase() + (o.frameworks.length ? " · " + o.frameworks.join(", ") : "") + " · profile " + o.profile),
        hero,
        h("div", { class: "grid4" },
          h("div", { class: "panel" }, h("div", { class: "label", text: "Open gaps" }),
            h("div", { class: "big", text: run ? String(o.gaps.total) : "—" }),
            h("div", { class: "sevbar" }, ["critical","high","medium","low"].map(function(k){ return s[k] ? h("span", { class: "chip sev-" + k, text: s[k] + " " + k }) : null; }),
              run && !o.gaps.total ? h("span", { class: "chip good", text: "none found" }) : null)),
          h("div", { class: "panel" }, h("div", { class: "label", text: "Last scan" }),
            h("div", { class: "big", style: "font-size:15px;margin-top:8px", text: run ? when(run.finished_at) : "Never" }),
            run ? h("div", { class: "sevbar" },
              run.incomplete ? h("span", { class: "chip sev-medium", text: "incomplete" }) : h("span", { class: "chip good", text: "complete" }),
              run.corpus_stale ? h("span", { class: "chip sev-medium", text: "law cache stale" }) : null,
              h("span", { class: "chip neutral", text: run.obligations + " obligations" })) : null),
          h("div", { class: "panel" }, h("div", { class: "label", text: "Spend, last scan" }),
            h("div", { class: "big", text: run ? money(run.cost_usd) : "$0.00" }),
            h("div", { class: "small", text: "Cap per run: " + money(o.budget) + " · paid to OpenRouter" })),
          h("div", { class: "panel" }, h("div", { class: "label", text: "Ever sent off this machine" }),
            h("div", { class: "big", text: bytes(o.egress.bytes) }),
            h("div", { class: "small", text: o.egress.calls + " call" + (o.egress.calls === 1 ? "" : "s") + " · only to " + o.pinned_hosts.join(", ") }))),
        run && run.phases_skipped.length ? h("div", { class: "banner", style: "margin-top:14px" },
          h("div", null, h("b", { text: "Not everything was checked. " }),
            run.phases_skipped.map(function(p){ return "Phase " + p.phase + ": " + p.reason + ". "; }).join(""),
            "Absence of a finding there is not evidence of compliance.")) : null,
        h("div", { class: "grid2", style: "margin-top:14px" },
          h("div", { class: "panel" }, h("h2", { text: "Sovereignty level " + o.sovereignty_level }),
            h("p", { class: "small", style: "margin:0 0 10px", text: ["Shape only — declarations and signatures leave, no logic and no names.", "Structure and logic leave with every name, comment and string replaced. Default.", "Verbatim for allowlisted paths only."][o.sovereignty_level] }),
            h("a", { href: "#leaves", class: "btn ghost", style: "text-decoration:none;display:inline-block", text: "See exactly what would leave →" })),
          h("div", { class: "panel" }, h("h2", { text: "Models (via your OpenRouter key)" }),
            h("table", null, h("tbody", null, ["research","security","architect"].map(function(k){
              return h("tr", null, h("td", { class: "dim", style: "padding:5px 0;width:90px", text: k }), h("td", { class: "loc", style: "padding:5px 0", text: o.models[k].id }));
            }))))),
        h("p", { class: "small dim", style: "margin-top:22px", text: o.tool.name + " " + o.tool.version + " · maintained by " + o.tool.steward + " · " + o.tool.disclaimer })
      ];
    });
  }

  /* ── gaps ───────────────────────────────────────── */
  var gapState = { sel: null, sev: "all", q: "" };
  function gaps(){
    return api("gaps").then(function(d){
      if (!d.run) return [head("Gaps", "Each gap is a provision your code currently fails, with the change that fixes it."),
        h("div", { class: "empty" }, h("h2", { text: "No scan results yet" }),
          h("p", { text: "Gaps come from a full scan, which needs an OpenRouter key. Free local findings are already available." }),
          h("div", { class: "steps" }, cmd("addgp-lite scan"), h("a", { href: "#findings", class: "btn ghost", style: "text-decoration:none;text-align:center", text: "Open local findings" })))];

      var listEl = h("div", { class: "list", role: "listbox", "aria-label": "Gaps" });
      var detailEl = h("div", { class: "detail" });
      var search = h("input", { type: "search", placeholder: "Filter by title, id or region   ( / )", value: gapState.q, oninput: function(e){ gapState.q = e.target.value; draw(); } });
      var filters = h("div", { class: "toolbar" }, search, ["all","critical","high","medium","low"].map(function(k){
        return h("button", { class: "filter" + (gapState.sev === k ? " on" : ""), onclick: function(){ gapState.sev = k; Array.prototype.forEach.call(filters.querySelectorAll(".filter"), function(b){ b.classList.toggle("on", b.textContent === k); }); draw(); }, text: k });
      }));
      gaps._search = search;

      function visible(){
        var q = gapState.q.toLowerCase();
        return d.gaps.filter(function(g){
          return (gapState.sev === "all" || g.severity === gapState.sev) &&
            (!q || (g.id + " " + g.title + " " + g.regions.join(" ")).toLowerCase().indexOf(q) !== -1);
        });
      }
      function draw(){
        var v = visible();
        if (!v.some(function(g){ return g.id === gapState.sel; })) gapState.sel = v[0] ? v[0].id : null;
        listEl.replaceChildren.apply(listEl, v.length ? v.map(function(g){
          return h("button", { class: "row" + (g.id === gapState.sel ? " on" : ""), role: "option", "aria-selected": String(g.id === gapState.sel),
            onclick: function(){ gapState.sel = g.id; draw(); } }, sev(g.severity), h("div", { class: "t", text: g.title }), h("div", { class: "id", text: g.id + " · " + g.regions.join(", ") }));
        }) : [h("div", { class: "dim", style: "padding:20px", text: "No gaps match." })]);
        var g = d.gaps.find(function(x){ return x.id === gapState.sel; });
        detailEl.replaceChildren.apply(detailEl, g ? detail(g, d.obligations) : [h("div", { class: "dim", text: "Select a gap." })]);
      }
      gaps._move = function(dir){
        var v = visible(), i = v.findIndex(function(g){ return g.id === gapState.sel; });
        var n = v[Math.max(0, Math.min(v.length - 1, i + dir))]; if (n) { gapState.sel = n.id; draw(); var on = listEl.querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" }); }
      };
      gaps._copy = function(){ var g = d.gaps.find(function(x){ return x.id === gapState.sel; }); if (g) copy(g.agent_prompt, g.id + " agent prompt"); };
      draw();
      return [head("Gaps", d.gaps.length + " open · run " + d.run, h("div", { class: "small dim" }, h("kbd", { text: "j" }), " ", h("kbd", { text: "k" }), " move · ", h("kbd", { text: "c" }), " copy prompt · ", h("kbd", { text: "/" }), " filter")),
        filters, h("div", { class: "split" }, listEl, detailEl)];
    });
  }
  function detail(g, obl){
    var f = g.manual_fix;
    var cites = [];
    g.obligations.forEach(function(id){
      var o = obl[id]; if (!o) { cites.push(h("div", { class: "src", text: id })); return; }
      cites.push(h("div", null, h("div", { style: "font-weight:500", text: o.instrument + " — " + o.provision + ": " + o.title }),
        o.citations.map(function(c){
          return h("div", null, h("a", { href: c.url, target: "_blank", rel: "noopener noreferrer", text: c.title }),
            h("span", { class: "src", text: "  " + (c.primary ? "primary source" : "secondary source") + " · " + o.verification.replace("_", "-") }));
        })));
    });
    return [
      h("div", { class: "meta" }, sev(g.severity), h("span", { class: "mono", text: g.id }), h("span", { text: "· " + g.regions.join(", ").toUpperCase() }),
        h("span", { text: "· confidence " + Math.round(g.confidence * 100) + "%" }), g.owner_hint ? h("span", { text: "· owner: " + g.owner_hint }) : null),
      h("h3", { text: g.title }),
      h("div", { class: "sec" }, h("div", { class: "label", text: "What to change" }), h("p", { style: "font-weight:500", text: f.what })),
      h("div", { class: "sec grid2" },
        h("div", null, h("div", { class: "label", text: "Why — legal" }), h("p", { class: "small", text: f.why.legal })),
        h("div", null, h("div", { class: "label", text: "Why — engineering" }), h("p", { class: "small", text: f.why.engineering }),
          f.why.file_refs.length ? h("p", { class: "loc", text: f.why.file_refs.join("  ") }) : null)),
      h("div", { class: "sec" }, h("div", { class: "label", text: "How" }), h("ol", { class: "howlist" }, f.how.map(function(s){ return h("li", null, h("span", { text: s.replace(/^\\d+\\.\\s*/, "") })); }))),
      h("div", { class: "sec" }, h("div", { class: "label", text: "Consequence" }),
        h("div", { class: "cons" },
          h("div", null, h("div", { class: "k", text: "If unfixed" }), f.consequence.if_unfixed),
          h("div", null, h("div", { class: "k", text: "If fixed" }), f.consequence.if_fixed),
          h("div", { class: "resid" }, h("div", { class: "k", text: "Risk that remains" }), f.consequence.residual_risk))),
      h("div", { class: "sec" }, h("div", { class: "label", text: "Agent prompt — paste into your coding agent" }),
        h("div", { class: "prompt" }, h("div", { class: "bar" }, h("span", { text: g.id + ".md" }), h("button", { class: "btn tiny", onclick: function(){ copy(g.agent_prompt, g.id + " agent prompt"); }, text: "copy  c" })),
          h("pre", { text: g.agent_prompt }))),
      h("div", { class: "sec" }, h("div", { class: "label", text: "Verify" }), h("div", { class: "steps", style: "margin-top:6px" }, f.verify.map(cmd))),
      h("div", { class: "sec" }, h("div", { class: "label", text: "Citations — check these yourself" }), h("div", { class: "cite" }, cites)),
      h("div", { class: "sec meta" }, h("span", { class: "chip neutral", text: "~" + f.effort.engineering_days + " engineering day" + (f.effort.engineering_days === 1 ? "" : "s") }),
        f.effort.legal_review ? h("span", { class: "chip sev-medium", text: "needs legal review" }) : null,
        f.effort.vendor_action ? h("span", { class: "chip neutral", text: "needs vendor action" }) : null)
    ];
  }

  /* ── local findings ─────────────────────────────── */
  var findState = { sev: "all", q: "" };
  function findings(){
    return api("evidence").then(function(d){
      var b = d.bundle, rows = h("tbody");
      var order = { critical:0, high:1, medium:2, low:3, info:4 };
      var all = b.findings.slice().sort(function(a, c){ return order[a.severity] - order[c.severity] || a.file.localeCompare(c.file); });
      var search = h("input", { type: "search", placeholder: "Filter by file, rule or text   ( / )", value: findState.q, oninput: function(e){ findState.q = e.target.value; draw(); } });
      findings._search = search;
      var counts = {}; all.forEach(function(f){ counts[f.severity] = (counts[f.severity] || 0) + 1; });
      var bar = h("div", { class: "toolbar" }, search, ["all","critical","high","medium","low","info"].map(function(k){
        if (k !== "all" && !counts[k]) return null;
        return h("button", { class: "filter" + (findState.sev === k ? " on" : ""), "data-k": k, onclick: function(){ findState.sev = k; Array.prototype.forEach.call(bar.querySelectorAll(".filter"), function(x){ x.classList.toggle("on", x.getAttribute("data-k") === k); }); draw(); }, text: k + (k === "all" ? "" : " " + counts[k]) });
      }));
      function draw(){
        var q = findState.q.toLowerCase();
        var v = all.filter(function(f){ return (findState.sev === "all" || f.severity === findState.sev) && (!q || (f.file + " " + f.rule_id + " " + f.title + " " + f.conclusion).toLowerCase().indexOf(q) !== -1); });
        rows.replaceChildren.apply(rows, v.length ? v.map(function(f){
          return h("tr", null, h("td", null, sev(f.severity)), h("td", null, h("div", { style: "font-weight:500", text: f.title }), h("div", { class: "small", text: f.conclusion })),
            h("td", { class: "loc", text: f.file + (f.line ? ":" + f.line : "") }), h("td", { class: "loc dim", text: f.rule_id }));
        }) : [h("tr", null, h("td", { colspan: "4", class: "dim", text: "No findings match." }))]);
      }
      draw();
      return [head("Local findings", (d.source === "live" ? "Computed just now on this machine" : "From scan " + d.run) + " · " + b.findings.length + " findings across " + b.file_count + " files · no key, no network, no cost"),
        d.source === "live" ? h("div", { class: "banner" }, h("div", null, "These come from the free local engine. They are code facts, not legal conclusions — a full scan maps them onto the law that applies to you.")) : null,
        bar, h("div", { class: "tablewrap" }, h("table", null, h("thead", null, h("tr", null, h("th", { text: "Severity" }), h("th", { text: "Finding" }), h("th", { text: "Where" }), h("th", { text: "Rule" }))), rows))];
    });
  }

  /* ── what leaves ────────────────────────────────── */
  function leaves(){
    return api("sovereignty").then(function(d){
      var sent = d.entries.filter(function(e){ return e.status === "sent"; });
      var denied = d.entries.filter(function(e){ return e.status !== "sent"; });
      var inB = sent.reduce(function(n, e){ return n + e.original_bytes; }, 0), outB = sent.reduce(function(n, e){ return n + e.sealed_bytes; }, 0);
      return [head("What would leave this machine", "Level " + d.level + ". Nothing has been sent — this is the redactor's output, rendered locally before any call is made."),
        h("div", { class: "grid4", style: "margin-bottom:14px" },
          h("div", { class: "panel" }, h("div", { class: "label", text: "Files that would be sent" }), h("div", { class: "big", text: String(sent.length) })),
          h("div", { class: "panel" }, h("div", { class: "label", text: "Refused outright" }), h("div", { class: "big", style: "color:var(--crit)", text: String(denied.length) })),
          h("div", { class: "panel" }, h("div", { class: "label", text: "Size, before → after" }), h("div", { class: "big", style: "font-size:18px;margin-top:8px", text: bytes(inB) + " → " + bytes(outB) })),
          h("div", { class: "panel" }, h("div", { class: "label", text: "Reverse map stays at" }), h("div", { class: "loc", style: "margin-top:8px;white-space:normal;word-break:break-all", text: d.map_path }))),
        h("div", { class: "files" }, sent.map(function(e, i){
          return h("details", { class: "file", open: i === 0 ? true : null },
            h("summary", null, h("span", { class: "p", text: e.path }), h("span", { class: "s", text: "sent as " + e.sealed_path + " · " + bytes(e.original_bytes) + " → " + bytes(e.sealed_bytes) }),
              h("span", { class: "stats" }, h("span", { class: "chip neutral", text: plural(e.identifiers_mapped || 0, "name") }), h("span", { class: "chip neutral", text: plural(e.literals_placeheld || 0, "string") }),
                h("span", { class: "chip neutral", text: plural(e.comments_stripped || 0, "comment") }), e.literals_dropped ? h("span", { class: "chip sev-critical", text: plural(e.literals_dropped, "secret") + " dropped" }) : null)),
            h("pre", { text: e.preview || "" }));
        })),
        denied.length ? h("div", { class: "panel", style: "margin-top:14px" }, h("h2", { text: "Never sent" }),
          h("div", { class: "denied" }, denied.map(function(e){ return h("div", null, h("span", { class: "x", text: "✕" }), h("span", { class: "loc", style: "white-space:normal;word-break:break-all", text: e.path }), h("span", { class: "small", text: e.reason || e.status })); }))) : null];
    });
  }

  /* ── egress ledger ──────────────────────────────── */
  function ledger(){
    return api("egress").then(function(d){
      if (!d.total) return [head("Egress ledger", "Every outbound call this tool has made from this project, recorded locally."),
        h("div", { class: "empty" }, h("h2", { text: "Nothing has ever left this machine" }), h("p", { text: "The ledger fills in as a full scan runs. Each entry records the destination, byte count, payload hash and which real files it covered." }))];
      return [head("Egress ledger", d.total + " outbound call" + (d.total === 1 ? "" : "s") + ", newest first. Recorded locally; never transmitted."),
        h("div", { class: "tablewrap" }, h("table", null,
          h("thead", null, h("tr", null, ["When","Phase","Destination","Bytes","Payload SHA-256","Purpose","Files covered"].map(function(t){ return h("th", { text: t }); }))),
          h("tbody", null, d.records.map(function(r){
            return h("tr", null, h("td", { class: "loc", text: when(r.ts) }), h("td", { class: "loc", text: String(r.phase) }), h("td", { class: "loc", text: r.destination }),
              h("td", { class: "loc", text: bytes(r.bytes) }), h("td", { class: "loc dim", title: r.payload_sha256, text: r.payload_sha256.slice(0, 12) + "…" }),
              h("td", { class: "small", text: r.purpose }), h("td", { class: "small", title: r.files_represented.join("\\n"), text: r.files_represented.length + " file" + (r.files_represented.length === 1 ? "" : "s") }));
          }))))];
    });
  }

  /* ── shell ──────────────────────────────────────── */
  var views = { overview: overview, gaps: gaps, findings: findings, leaves: leaves, ledger: ledger };
  var current = null;
  function route(){
    var v = (location.hash.replace("#", "") || "overview").split("&")[0];
    if (!views[v]) v = "overview";
    current = v;
    Array.prototype.forEach.call(document.querySelectorAll("nav a"), function(a){ a.classList.toggle("on", a.getAttribute("data-view") === v); });
    views[v]().then(function(nodes){ if (current === v) { main.replaceChildren(); add(main, nodes); main.focus(); } }, fail);
  }
  window.addEventListener("hashchange", route);
  document.addEventListener("keydown", function(e){
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) { if (e.key === "Escape") e.target.blur(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/" && views[current]._search) { e.preventDefault(); views[current]._search.focus(); }
    else if (current === "gaps" && (e.key === "j" || e.key === "ArrowDown") && gaps._move) { e.preventDefault(); gaps._move(1); }
    else if (current === "gaps" && (e.key === "k" || e.key === "ArrowUp") && gaps._move) { e.preventDefault(); gaps._move(-1); }
    else if (current === "gaps" && e.key === "c" && gaps._copy) gaps._copy();
    else if (/^[1-5]$/.test(e.key)) location.hash = ["overview","gaps","findings","leaves","ledger"][+e.key - 1];
  });
  main.setAttribute("tabindex", "-1");

  if (!token) { fail(new Error("This page needs the link printed by \`addgp-lite ui\`. Run it again and open the new link.")); return; }
  api("overview").then(function(o){
    var p = document.getElementById("proj");
    p.replaceChildren(h("b", { text: o.project }), h("br"), "level " + o.sovereignty_level + " · " + o.regions.join(" ").toUpperCase());
    document.title = o.project + " · ADDGP-Lite";
    document.getElementById("n-gaps").textContent = o.run ? String(o.gaps.total) : "";
    document.getElementById("n-ledger").textContent = o.egress.calls ? String(o.egress.calls) : "";
    api("evidence").then(function(d){ document.getElementById("n-findings").textContent = String(d.bundle.findings.length); }, function(){});
  }, function(){});
  route();
})();
`;
