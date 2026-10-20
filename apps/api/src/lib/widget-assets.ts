/**
 * Website chat widget (Phase 4). Two small, dependency-free assets served by the API:
 * - widget.js: the snippet businesses paste into their site; adds a launcher button and an
 *   isolated iframe (no access to the host page, and the host page has none to the chat).
 * - the chat frame: a minimal chat UI talking to /api/public/chat/:key/*.
 */

export const WIDGET_JS = `(() => {
  const script = document.currentScript;
  if (!script) return;
  const key = script.getAttribute("data-key");
  if (!key || window.__voicedeskWidget) return;
  window.__voicedeskWidget = true;
  const base = new URL(script.src).origin;
  const frameUrl = base + "/api/public/chat/" + encodeURIComponent(key) + "/frame?origin=" + encodeURIComponent(location.origin);
  const side = script.getAttribute("data-position") === "left" ? "left" : "right";
  const color = script.getAttribute("data-color") || "#2563eb";

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", script.getAttribute("data-label") || "Chat with us");
  button.style.cssText = "position:fixed;bottom:20px;" + side + ":20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;z-index:2147483646;box-shadow:0 4px 14px rgba(0,0,0,.25);background:" + color + ";color:#fff;font-size:26px;line-height:56px";
  button.textContent = "\\u{1F4AC}";

  let frame = null;
  button.addEventListener("click", () => {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.src = frameUrl;
      frame.title = button.getAttribute("aria-label");
      frame.allow = "clipboard-write";
      frame.style.cssText = "position:fixed;bottom:88px;" + side + ":20px;width:min(380px,calc(100vw - 40px));height:min(600px,calc(100vh - 120px));border:0;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.3);z-index:2147483647;background:#fff";
      document.body.appendChild(frame);
    } else {
      frame.style.display = frame.style.display === "none" ? "block" : "none";
    }
  });
  document.body.appendChild(button);
})();
`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function chatFrameHtml(params: {
  key: string;
  title: string;
  color: string;
  greeting: string;
  placeholder: string;
  sendLabel: string;
  poweredBy: string;
}): string {
  const config = JSON.stringify({
    key: params.key,
    greeting: params.greeting,
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(params.title)}</title>
<style>
  :root { --brand: ${escapeHtml(params.color)}; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111827; background: #fff; display: flex; flex-direction: column; height: 100vh; }
  header { background: var(--brand); color: #fff; padding: 12px 16px; font-weight: 600; }
  #log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .msg { max-width: 82%; padding: 8px 12px; border-radius: 14px; white-space: pre-wrap; word-wrap: break-word; }
  .agent { align-self: flex-start; background: #f3f4f6; border-bottom-left-radius: 4px; }
  .caller { align-self: flex-end; background: var(--brand); color: #fff; border-bottom-right-radius: 4px; }
  .who { display: block; font-size: 11px; opacity: .7; margin-bottom: 2px; }
  form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e7eb; }
  input[name=text] { flex: 1; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 10px; font: inherit; }
  button { background: var(--brand); color: #fff; border: 0; border-radius: 10px; padding: 0 14px; font: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .hp { position: absolute; left: -9999px; }
  .survey { align-self: stretch; background: transparent; border: 1px dashed #d1d5db; border-radius: 12px; padding: 8px 10px; font-size: 14px; }
  .survey .scale { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .survey .scale button { padding: 6px 10px; min-width: 34px; }
  footer { text-align: center; font-size: 11px; color: #9ca3af; padding: 0 0 6px; }
  @media (prefers-color-scheme: dark) { body { background: #111827; color: #f9fafb; } .agent { background: #1f2937; } input[name=text] { background: #1f2937; color: #f9fafb; border-color: #374151; } form { border-color: #374151; } }
</style>
</head>
<body>
<header>${escapeHtml(params.title)}</header>
<div id="log" role="log" aria-live="polite"></div>
<form id="form" autocomplete="off">
  <input class="hp" name="website" tabindex="-1" aria-hidden="true">
  <input name="text" dir="auto" maxlength="1000" placeholder="${escapeHtml(params.placeholder)}" aria-label="${escapeHtml(params.placeholder)}" required>
  <button type="submit">${escapeHtml(params.sendLabel)}</button>
</form>
<footer>${escapeHtml(params.poweredBy)}</footer>
<script>
(() => {
  const cfg = ${config};
  const origin = new URLSearchParams(location.search).get("origin") || "";
  const api = "/api/public/chat/" + encodeURIComponent(cfg.key);
  const log = document.getElementById("log");
  const form = document.getElementById("form");
  const input = form.elements.text;
  const send = form.querySelector("button");
  const openedAt = Date.now();
  let visitorId = null;
  try { visitorId = localStorage.getItem("vd_visitor_" + cfg.key); } catch (e) {}

  function add(role, text, who) {
    const el = document.createElement("div");
    el.className = "msg " + role;
    el.dir = "auto";
    if (who) { const w = document.createElement("span"); w.className = "who"; w.textContent = who; el.appendChild(w); }
    const body = document.createElement("span");
    body.textContent = text;
    el.appendChild(body);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return body;
  }

  // End of the conversation: one tap to rate it (the answer goes to the business).
  function askSurvey(survey) {
    const box = document.createElement("div");
    box.className = "msg survey";
    const q = document.createElement("div");
    q.textContent = survey.question;
    box.appendChild(q);
    const scale = document.createElement("div");
    scale.className = "scale";
    const from = survey.kind === "nps" ? 0 : 1;
    const to = survey.kind === "nps" ? 10 : 5;
    for (let n = from; n <= to; n++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = String(n);
      b.addEventListener("click", async () => {
        scale.querySelectorAll("button").forEach((x) => (x.disabled = true));
        const res = await fetch("/api/public/feedback/" + encodeURIComponent(survey.token), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ score: n }),
        }).catch(() => null);
        const done = res && res.ok ? await res.json() : null;
        box.replaceChildren(document.createTextNode(done ? done.thanks : "Thanks!"));
      });
      scale.appendChild(b);
    }
    box.appendChild(scale);
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
  }

  async function start() {
    const res = await fetch(api + "/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ visitorId, origin }) });
    if (!res.ok) { add("agent", "Chat is unavailable right now."); input.disabled = send.disabled = true; return; }
    const data = await res.json();
    visitorId = data.visitorId;
    try { localStorage.setItem("vd_visitor_" + cfg.key, visitorId); } catch (e) {}
    if (data.messages.length === 0) add("agent", cfg.greeting);
    for (const m of data.messages) add(m.role, m.text, m.authorName);
    listen();
  }

  function listen() {
    const es = new EventSource(api + "/events?visitorId=" + encodeURIComponent(visitorId));
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === "message" && ev.human) add("agent", ev.text, ev.authorName);
    };
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !visitorId) return;
    input.value = "";
    add("caller", text);
    send.disabled = true;
    try {
      const res = await fetch(api + "/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visitorId, text, origin, website: form.elements.website.value, typedMs: Date.now() - openedAt }),
      });
      if (!res.ok || !res.body) { add("agent", "Sorry, something went wrong. Please try again."); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let bubble = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\\n\\n")) !== -1) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = (block.match(/^event: (.*)$/m) || [])[1];
          const data = JSON.parse((block.match(/^data: (.*)$/m) || [])[1] || "null");
          if (event === "delta") { bubble = bubble || add("agent", ""); bubble.textContent += data.text; log.scrollTop = log.scrollHeight; }
          if (event === "greeting" && data.text) add("agent", data.text);
          if (event === "error") add("agent", data.message);
          if (event === "done" && data && data.survey) askSurvey(data.survey);
        }
      }
    } finally {
      send.disabled = false;
      input.focus();
    }
  });

  start().catch(() => add("agent", "Chat is unavailable right now."));
})();
</script>
</body>
</html>`;
}
