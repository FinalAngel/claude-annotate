/* Annotate — in-page overlay.
 *
 * Injected into every page of the annotation browser before the page's own scripts
 * run (window.__CLAUDE_ANNOTATE__ carries endpoint + token). Everything lives in a
 * Shadow DOM on a host appended to <html>, so the page's CSS never touches it and ours
 * never leaks out. Document coordinates everywhere, so marks stay put while scrolling.
 *
 * ponytail: marks assume the window is the scroller. A page that scrolls <body> or a wrapper
 * instead of the viewport keeps scrollX/Y at 0 and pins stick to the viewport. Upgrade path:
 * anchor each mark to the nearest scroll container of its element.
 */
(() => {
  if (window.top !== window) return; // never inside iframes
  const CFG = window.__CLAUDE_ANNOTATE__;
  try { delete window.__CLAUDE_ANNOTATE__; } catch { window.__CLAUDE_ANNOTATE__ = undefined; } // the token never stays on the page
  if (!CFG || window.__claudeAnnotate) return;
  // Local development hosts only: a third-party page in this profile must never see the bridge.
  if (!isLocalHost(location.hostname)) return;
  const F = window.fetch.bind(window), ES = window.EventSource; // taken before page scripts can patch them
  const RENDER_ONLY = !!CFG.renderOnly || !!window.__CLAUDE_ANNOTATE_RENDER_ONLY__;

  function isLocalHost(h) {
    return /^(localhost|127(\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/.test(h) || /\.(localhost|test|local|internal)$/.test(h);
  }

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const INKS = [
    { id: "pink", hex: "#FF4D8D", dark: "#2A0A17" },
    { id: "sun", hex: "#FFD23F", dark: "#2B2206" },
    { id: "cyan", hex: "#35D7FF", dark: "#062530" },
    { id: "lime", hex: "#9BFF4D", dark: "#142A05" },
  ];
  const TOOLS = ["pen", "arrow", "rect", "ellipse", "note", "select"];
  const KEYS = { p: "pen", a: "arrow", r: "rect", e: "ellipse", n: "note", s: "select" };
  const ICON = {
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    pen: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    arrow: '<path d="M5 19 19 5"/><path d="M9 5h10v10"/>',
    rect: '<rect x="3" y="5" width="18" height="14" rx="3"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
    note: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/>',
    select: '<path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    send: '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  };
  const svgIcon = (name, size = 18) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const api = { ready: false };
  window.__claudeAnnotate = api;

  const pageUrl = () => location.href;
  let shapes = []; // { id, type, color, ...geometry, ctx, batch }
  let notes = []; // { id, n, x, y, color, text, status, ctx, batch, result }
  let tool = "pen";
  let ink = INKS[0];
  let mode = RENDER_ONLY ? "browse" : "draw"; // draw | browse
  let selected = null;
  let draft = null;
  const undo = [];
  const redo = [];
  let totals = { notes: 0, shapes: 0, pages: 0, unsent: 0, open: 0, batches: 0 };
  let linkState = "connecting"; // connecting | on | off
  let phase = "idle"; // idle | sending | sent | done
  let clearArmed = null;
  let sse = null;
  let quietTimer = null; // fires the "/annotate pull" hint when a Send gets no reaction

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------
  const H = { "Content-Type": "application/json", "X-Annot-Token": CFG.token };
  const req = async (method, p, body) => {
    const r = await F(CFG.endpoint + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  };
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    const url = pageUrl(); // not when the timer fires: an SPA navigation may happen in between
    saveTimer = setTimeout(async () => {
      try {
        const r = await req("PUT", "/state", { url, shapes, notes });
        if (r.totals) { totals = r.totals; renderToolbar(); }
      } catch { setLink("off"); }
    }, 120);
  };

  // ---------------------------------------------------------------------------
  // DOM scaffold
  // ---------------------------------------------------------------------------
  let host, root, docLayer, svg, shapesG, draftG, pinsLayer, chrome, bar, popover, toasts, ticker, rim;

  const CSS = `
:host { all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646; display: block; }
*, *::before, *::after { box-sizing: border-box; }
.doc { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; }
svg.ink { position: absolute; top: 0; left: 0; display: block; overflow: visible; pointer-events: none; touch-action: none; }
:host(.draw) svg.ink { pointer-events: auto; cursor: var(--cursor, crosshair); }
:host(.draw.t-select) svg.ink { cursor: default; }
svg.ink .hit { stroke: transparent; fill: none; stroke-width: 16; pointer-events: none; }
:host(.draw.t-select) svg.ink .hit { pointer-events: stroke; cursor: grab; }
:host(.draw.t-select) svg.ink rect.hit, :host(.draw.t-select) svg.ink ellipse.hit { pointer-events: all; }
:host(.dragging) svg.ink .hit, :host(.dragging) .pin .dot { cursor: grabbing !important; }
:host(.draw.t-select) svg.ink g.shape:hover .halo { stroke: rgba(255,255,255,.55); }
svg.ink g.shape.selected .halo { stroke: #fff; stroke-dasharray: 6 5; stroke-width: 7; }
svg.ink .halo { fill: none; stroke: rgba(10,8,14,.42); stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
svg.ink .line { fill: none; stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; }
svg.ink .head { stroke: rgba(10,8,14,.42); stroke-width: 2; stroke-linejoin: round; }
svg.ink g.draft { opacity: .9; }
:host(.capturing) svg.ink .hit, :host(.capturing) .chrome, :host(.capturing) g.shape.selected .halo { display: none !important; }
:host(.capturing) .pin .tag { white-space: normal; width: max-content; max-width: 260px; border-radius: 12px; }
:host(.capturing) .pin .dot { animation: none; }

.pins { position: absolute; top: 0; left: 0; pointer-events: none; }
.pin { position: absolute; width: 0; height: 0; pointer-events: none; }
.pin .dot {
  pointer-events: auto; position: absolute; left: -15px; top: -15px; width: 30px; height: 30px; border-radius: 999px;
  display: grid; place-items: center; cursor: grab; border: 0; padding: 0; touch-action: none;
  background: var(--ink); color: var(--ink-dark);
  font: 700 13px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 2.5px rgba(20,17,26,.9), 0 8px 22px -8px rgba(0,0,0,.7);
  transition: transform .15s cubic-bezier(.2,.8,.2,1);
  animation: pop .3s cubic-bezier(.34,1.56,.64,1) both;
}
.pin .dot:hover { transform: scale(1.1); }
.pin .dot:active { transform: scale(.94); }
.pin .dot:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.pin .ring { position: absolute; left: -19px; top: -19px; width: 38px; height: 38px; border-radius: 999px; border: 2px solid transparent; border-top-color: var(--ink); opacity: 0; pointer-events: none; }
.pin.working .ring { opacity: 1; animation: spin 1s linear infinite; }
.pin.working .dot { animation: pulse 1.4s ease-in-out infinite; }
.pin.done .dot { background: #4ADE80; color: #06240F; }
.pin.done .dot .n { display: none; }
.pin.done .dot .ic { display: block; }
.pin .dot .ic { display: none; }
.pin.skipped .dot { background: #6B6775; color: #F4F1F7; }
.pin.pending .dot { box-shadow: 0 0 0 2.5px rgba(20,17,26,.9), 0 0 0 5px var(--ink-soft), 0 8px 22px -8px rgba(0,0,0,.7); }
.pin .tag {
  position: absolute; left: 20px; top: -13px; max-width: 220px; padding: 5px 10px 6px; border-radius: 999px;
  background: rgba(20,17,26,.86); color: #F4F1F7; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 0 0 1px rgba(255,255,255,.07), 0 10px 24px -12px rgba(0,0,0,.7);
  font: 500 12.5px/1.25 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: .005em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: auto; cursor: pointer;
  animation: slide .3s cubic-bezier(.2,.8,.2,1) both;
}
.pin.done .tag .txt { text-decoration: line-through; color: rgba(244,241,247,.55); }
.pin.skipped .tag .txt { color: rgba(244,241,247,.6); }
.pin .tag .res { display: block; color: #4ADE80; margin-top: 3px; font-size: 11.5px; }
.pin.skipped .tag .res { color: #C9C4D2; }
.pin .tag .res:empty { display: none; }
.pin:has(.res:not(:empty)) .tag { white-space: normal; width: max-content; max-width: 260px; border-radius: 12px; padding: 7px 11px 8px; top: -15px; }

.chrome { position: fixed; inset: 0; pointer-events: none; color: #F4F1F7; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 13px; }
.chrome > * { pointer-events: auto; }
.rim { pointer-events: none; position: fixed; inset: 0; box-shadow: inset 0 0 0 3px var(--ink); opacity: 0; }
.rim.flash { animation: rimflash .7s cubic-bezier(.2,.8,.2,1) both; }

.bar {
  position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 2px; padding: 6px; border-radius: 999px;
  background: rgba(20,17,26,.84); backdrop-filter: blur(18px) saturate(140%); -webkit-backdrop-filter: blur(18px) saturate(140%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.10), 0 0 0 1px rgba(255,255,255,.07), 0 24px 60px -24px rgba(0,0,0,.7);
  animation: rise .35s cubic-bezier(.2,.8,.2,1) both; user-select: none; -webkit-user-select: none;
}
.bar.dragging { transition: none; }
.bar .grip { color: rgba(244,241,247,.35); cursor: grab; padding: 0 2px 0 4px; display: grid; place-items: center; }
.bar .grip:active { cursor: grabbing; }
.sep { width: 1px; height: 22px; background: rgba(255,255,255,.08); margin: 0 4px; }
.tb {
  position: relative; width: 36px; height: 36px; border-radius: 999px; border: 0; padding: 0; display: grid; place-items: center;
  background: transparent; color: rgba(244,241,247,.72); cursor: pointer;
  transition: background .15s cubic-bezier(.2,.8,.2,1), color .15s, transform .15s, box-shadow .15s;
}
.tb:hover { background: rgba(255,255,255,.08); color: #F4F1F7; }
.tb:active { transform: scale(.94); }
.tb:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
.tb.on { background: color-mix(in srgb, var(--ink) 20%, transparent); color: var(--ink); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 45%, transparent); }
.tb .kbd { position: absolute; left: 50%; bottom: calc(100% + 10px); transform: translate(-50%, 4px); opacity: 0; pointer-events: none;
  padding: 4px 8px; border-radius: 8px; background: rgba(20,17,26,.95); color: #F4F1F7; font-size: 11.5px; font-weight: 600; white-space: nowrap;
  box-shadow: 0 0 0 1px rgba(255,255,255,.08); transition: opacity .15s, transform .15s cubic-bezier(.2,.8,.2,1); }
.tb .kbd b { color: rgba(244,241,247,.5); font-weight: 600; margin-left: 6px; }
.tb:hover .kbd, .tb:focus-visible .kbd { opacity: 1; transform: translate(-50%, 0); transition-delay: .35s; }
.mode { position: relative; }
.mode .st { position: absolute; right: 6px; top: 6px; width: 7px; height: 7px; border-radius: 999px; background: #6B6775; box-shadow: 0 0 0 2px rgba(20,17,26,1); }
.mode.on .st, .mode .st { transition: background .3s; }
:host(.link-on) .mode .st { background: #4ADE80; }
:host(.link-connecting) .mode .st { background: #FFD23F; animation: pulse 1.2s ease-in-out infinite; }
:host(.link-off) .mode .st { background: #FF5C5C; }
:host(.browse) .mode { background: rgba(255,255,255,.12); color: #F4F1F7; }

.inks { display: flex; gap: 9px; padding: 0 8px; }
.inkb { width: 22px; height: 22px; border-radius: 999px; border: 0; padding: 0; cursor: pointer; background: var(--c);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 0 0 2px transparent; transition: transform .15s cubic-bezier(.2,.8,.2,1), box-shadow .15s; }
.inkb:hover { transform: scale(1.12); }
.inkb:active { transform: scale(.94); }
.inkb.on { box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 0 0 2px rgba(20,17,26,1), 0 0 0 3.5px var(--c); }
.inkb:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

.send {
  height: 36px; padding: 0 6px 0 14px; margin-left: 2px; border: 0; border-radius: 999px; display: flex; align-items: center; gap: 8px;
  background: var(--ink); color: var(--ink-dark); cursor: pointer; font: 600 13px/1 inherit; font-family: inherit; letter-spacing: .005em;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.35); transition: transform .15s cubic-bezier(.2,.8,.2,1), filter .15s, background .3s, color .3s;
}
.send:hover { filter: brightness(1.06); }
.send:active { transform: scale(.96); }
.send:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.send:disabled { cursor: default; filter: saturate(.6); opacity: .85; }
.send:has(.cnt) { padding-right: 6px; }
.send .cnt { min-width: 24px; height: 24px; padding: 0 7px; border-radius: 999px; display: grid; place-items: center; background: rgba(20,17,26,.9); color: #F4F1F7; font-weight: 700; font-variant-numeric: tabular-nums; transition: transform .2s cubic-bezier(.34,1.56,.64,1); }
.send .cnt.bump { animation: bump .35s cubic-bezier(.34,1.56,.64,1); }
.send .cnt .ic { display: none; }
.send .live { width: 8px; height: 8px; border-radius: 999px; background: var(--ink-dark); display: none; }
.send.sending .live, .send.sent .live { display: block; animation: pulse 1.2s ease-in-out infinite; }
.send.sending .cnt, .send.sent .cnt { display: none; }
.send.done { background: #4ADE80; color: #06240F; }
.send.done .cnt { background: rgba(6,36,15,.85); }
.send.done .cnt .ic { display: block; }
.send.done .cnt .num { display: none; }
.danger { color: rgba(244,241,247,.55); }
.danger:hover { color: #FF8A8A; background: rgba(255,92,92,.14); }
.danger.armed { width: auto; padding: 0 12px; gap: 6px; display: flex; align-items: center; color: #FF8A8A; background: rgba(255,92,92,.16); box-shadow: inset 0 0 0 1px rgba(255,92,92,.4); font-weight: 600; }
.danger.glow { animation: glow 1.6s ease-in-out infinite; color: #F4F1F7; }

.ticker { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); padding: 6px 12px; border-radius: 999px; white-space: nowrap;
  background: rgba(20,17,26,.78); color: rgba(244,241,247,.8); font-size: 12px; font-weight: 500; letter-spacing: .01em;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 0 0 1px rgba(255,255,255,.06); opacity: 0; transition: opacity .3s; pointer-events: none; }
.ticker.show { opacity: 1; }
.ticker .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: #F4F1F7; }

.toasts { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
.toast { max-width: min(560px, 90vw); padding: 10px 14px 11px; border-radius: 14px; background: rgba(20,17,26,.9); color: #F4F1F7; font-size: 13px; line-height: 1.35; font-weight: 500;
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 0 0 1px rgba(255,255,255,.08), 0 20px 50px -20px rgba(0,0,0,.7);
  animation: drop .35s cubic-bezier(.2,.8,.2,1) both; display: flex; gap: 10px; align-items: flex-start; }
.toast.out { animation: lift .25s cubic-bezier(.2,.8,.2,1) both; }
.toast .ic { flex: none; margin-top: 1px; color: var(--ink); }
.toast.ok .ic { color: #4ADE80; }

.pop { position: fixed; width: 292px; padding: 10px 10px 8px; border-radius: 14px; background: rgba(20,17,26,.92); color: #F4F1F7;
  backdrop-filter: blur(18px) saturate(140%); -webkit-backdrop-filter: blur(18px) saturate(140%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 0 0 1px rgba(255,255,255,.08), 0 24px 60px -20px rgba(0,0,0,.75);
  transform-origin: var(--ox, 0) var(--oy, 0); animation: popin .22s cubic-bezier(.34,1.56,.64,1) both; }
.pop.hidden { display: none; }
.pop .head { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; }
.pop .num { width: 22px; height: 22px; border-radius: 999px; display: grid; place-items: center; background: var(--ink); color: var(--ink-dark); font-weight: 700; font-size: 12px; }
.pop .title { font-weight: 600; font-size: 12.5px; color: rgba(244,241,247,.72); flex: 1; }
.pop .del { width: 26px; height: 26px; }
.pop textarea { width: 100%; min-height: 60px; max-height: 180px; resize: none; border: 0; outline: 0; border-radius: 9px; padding: 9px 10px; margin: 0;
  background: rgba(255,255,255,.06); color: #F4F1F7; font: 500 13.5px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); transition: box-shadow .15s; }
.pop textarea:focus { box-shadow: inset 0 0 0 1.5px var(--ink); }
.pop textarea::placeholder { color: rgba(244,241,247,.4); }
.pop .hint { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; padding: 0 2px; font-size: 10.5px; color: rgba(244,241,247,.45); font-weight: 500; white-space: nowrap; }
.pop .hint kbd { font: inherit; color: rgba(244,241,247,.7); }
.pop .ok { height: 28px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--ink); color: var(--ink-dark); font: 600 12px/1 inherit; font-family: inherit; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: transform .15s, filter .15s; }
.pop .ok:hover { filter: brightness(1.06); }
.pop .ok:active { transform: scale(.96); }

.sel { position: absolute; pointer-events: none; }
.sel .del { position: absolute; right: -14px; top: -14px; width: 28px; height: 28px; border-radius: 999px; border: 0; padding: 0; display: grid; place-items: center; cursor: pointer; pointer-events: auto;
  background: rgba(20,17,26,.92); color: #FF8A8A; box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 0 0 1px rgba(255,255,255,.08), 0 10px 24px -12px rgba(0,0,0,.7); animation: pop .2s cubic-bezier(.34,1.56,.64,1) both; }
.sel .del:hover { background: rgba(255,92,92,.2); }

@keyframes pop { from { transform: scale(.4); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes slide { from { transform: translateX(-6px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes rise { from { transform: translate(-50%, 12px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
@keyframes drop { from { transform: translateY(-10px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes lift { to { transform: translateY(-8px); opacity: 0; } }
@keyframes popin { from { transform: scale(.85); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
@keyframes bump { 0% { transform: scale(1); } 40% { transform: scale(1.35); } 100% { transform: scale(1); } }
@keyframes rimflash { 0% { opacity: 0; } 20% { opacity: .9; } 100% { opacity: 0; } }
@keyframes glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,138,138,0); } 50% { box-shadow: 0 0 0 4px rgba(255,138,138,.35); } }
@keyframes wiggle { 0% { transform: none; } 30% { transform: translateY(-6px) scale(1.12); } 60% { transform: translateY(0) scale(.96); } 100% { transform: none; } }
.pin .dot.wiggle { animation: wiggle .5s cubic-bezier(.34,1.56,.64,1) both; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

  function mount() {
    if (host) return;
    host = document.createElement("claude-annotate");
    host.setAttribute("data-claude-annotate", "");
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);

    docLayer = el("div", "doc");
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ink");
    svg.innerHTML = '<g class="shapes"></g><g class="draftg"></g>';
    shapesG = svg.firstElementChild;
    draftG = svg.lastElementChild;
    docLayer.appendChild(svg);
    pinsLayer = el("div", "pins");
    docLayer.appendChild(pinsLayer);
    root.appendChild(docLayer);

    chrome = el("div", "chrome");
    rim = el("div", "rim");
    chrome.appendChild(rim);
    toasts = el("div", "toasts");
    toasts.setAttribute("aria-live", "polite");
    chrome.appendChild(toasts);
    ticker = el("div", "ticker");
    ticker.setAttribute("aria-live", "polite");
    chrome.appendChild(ticker);
    popover = el("div", "pop hidden");
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Note");
    chrome.appendChild(popover);
    bar = el("div", "bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Annotate");
    chrome.appendChild(bar);
    root.appendChild(chrome);

    document.documentElement.appendChild(host);
    if (RENDER_ONLY) host.classList.add("capturing");
    applyInk();
    setMode(mode);
    renderToolbar();
    sizeDoc();
    bindEvents();
    restoreBarPos();
    hydrate().finally(() => { api.ready = true; }); // the server screenshots temp pages once ready
    connectSse();
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }



  // ---------------------------------------------------------------------------
  // Sizing / coordinates
  // ---------------------------------------------------------------------------
  function docSize() {
    // Body, not <html>: our own layer is a child of <html> and would hold the old size forever.
    const d = document.documentElement, b = document.body;
    return { w: Math.max(b ? b.scrollWidth : 0, d.clientWidth), h: Math.max(b ? b.scrollHeight : 0, d.clientHeight) };
  }
  let lastSize = { w: 0, h: 0 };
  function sizeDoc() {
    const s = docSize();
    if (s.w === lastSize.w && s.h === lastSize.h) return;
    lastSize = s;
    docLayer.style.width = s.w + "px";
    docLayer.style.height = s.h + "px";
    svg.setAttribute("width", s.w);
    svg.setAttribute("height", s.h);
    svg.setAttribute("viewBox", `0 0 ${s.w} ${s.h}`);
  }
  const toDoc = (e) => [Math.round(e.clientX + scrollX), Math.round(e.clientY + scrollY)];

  // ---------------------------------------------------------------------------
  // Element context (what is under a point)
  // ---------------------------------------------------------------------------
  function elementAt(x, y) {
    host.style.visibility = "hidden"; // takes the host out of hit testing
    const e = document.elementFromPoint(clamp(x - scrollX, 0, innerWidth - 1), clamp(y - scrollY, 0, innerHeight - 1));
    host.style.visibility = "";
    return !e || e === document.documentElement ? null : e;
  }
  function shortSel(e) {
    if (!e || e.nodeType !== 1) return "";
    let s = e.tagName.toLowerCase();
    if (e.id) return `${s}#${e.id}`;
    const cls = [...e.classList].filter((c) => !/^(css-|sc-|_)/.test(c) && c.length < 40).slice(0, 2);
    if (cls.length) s += "." + cls.join(".");
    const role = e.getAttribute("role");
    if (role) s += `[role=${role}]`;
    const dt = e.getAttribute("data-testid");
    if (dt) s += `[data-testid=${dt}]`;
    return s;
  }
  function reactInfo(e) {
    const out = { components: [], source: null };
    try {
      let node = e, fiber = null;
      for (let i = 0; i < 6 && node && !fiber; i++) {
        const k = Object.keys(node).find((key) => key.startsWith("__reactFiber$"));
        if (k) fiber = node[k];
        else node = node.parentElement;
      }
      if (!fiber) return out;
      const isLibFile = (file) => /node_modules|\/@(?!fs\/)|react-dom|react-refresh|chunk-|\.vite\//.test(file);
      // ponytail: React 19 line numbers are post-transform (esbuild-shifted under Vite, chunk
      // offsets under Turbopack). The file is right, the line is a hint. React 18 is exact.
      // Where this fiber was created: React <19 keeps _debugSource, React 19 keeps the
      // owner stack. Returns { src, user } with src like "src/App.tsx:12".
      const callSite = (f) => {
        if (f._debugSource && f._debugSource.fileName) {
          const file = f._debugSource.fileName;
          return { src: `${relPath(file)}:${f._debugSource.lineNumber}`, user: !isLibFile(file) };
        }
        const st = f._debugStack;
        const stack = typeof st === "string" ? st : st && st.stack;
        if (!stack) return null;
        const frames = [...stack.matchAll(/\(?((?:https?:\/\/[^\s)]+?)|(?:\/[^\s)]+?)):(\d+):(\d+)\)?/g)].map((x) => ({ file: x[1], line: x[2] }));
        const user = frames.find((fr) => !isLibFile(fr.file));
        if (user) return { src: `${relPath(user.file)}:${user.line}`, user: true };
        return frames.length ? { src: null, user: false } : null;
      };
      const nameOf = (t) => (typeof t === "function" ? (t.displayName || t.name) : t && typeof t === "object" ? (t.displayName || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name))) : null) || null;
      const NOISE = /Slot|Collection|Provider|Consumer|Context|Impl$|^Primitive|Presence|Portal|FocusScope|Dismissable|RovingFocus|^Fragment$|^Suspense$|^StrictMode$|^Profiler$|^Root$/;
      let f = fiber;
      for (let depth = 0; f && depth < 80; depth++, f = f.return) {
        const name = nameOf(f.type);
        const site = callSite(f);
        if (!out.source && site && site.user) out.source = site.src;
        if (name && !name.startsWith("_") && !NOISE.test(name) && out.components.length < 5 && !out.components.includes(name)) {
          // Keep components that appear in the user's own JSX (or whose origin is unknown).
          if (!site || site.user) out.components.push(name);
        }
        if (out.components.length >= 5 && out.source) break;
      }
    } catch { /* not react */ }
    return out;
  }
  function relPath(p) {
    if (!/^https?:/.test(p)) return p.replace(/^\/\.\//, ""); // FS path (React 18) or webpack-internal "/./app/page.tsx"
    try { p = new URL(p).pathname; } catch { return p; } // Vite: drop origin and ?t=
    return p.startsWith("/@fs/") ? p.slice(4) : p.replace(/^\//, ""); // /@fs/abs → /abs, /src/x.tsx → src/x.tsx
  }

  function describe(e) {
    if (!e || e === document.body || e === document.documentElement) return null;
    const r = e.getBoundingClientRect();
    const text = (e.innerText || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 90);
    const chain = [];
    let p = e.parentElement;
    while (p && p !== document.body && chain.length < 3) { chain.unshift(shortSel(p)); p = p.parentElement; }
    return {
      selector: shortSel(e), text,
      rect: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)],
      chain: chain.join(" > "), react: reactInfo(e),
    };
  }
  function ctxAtPoint(x, y) { return describe(elementAt(x, y)); }
  function ctxForBox(x, y, w, h) {
    const c = ctxAtPoint(x + w / 2, y + h / 2);
    const inside = [];
    try {
      const hasOwnText = (n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      const cands = [];
      for (const n of document.body.querySelectorAll("*")) {
        if (n.closest("svg")) continue;
        const interactive = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|IMG|LABEL)$/.test(n.tagName) || n.getAttribute("role") === "button";
        if (!interactive && !hasOwnText(n)) continue;
        const r = n.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const nx = r.left + scrollX, ny = r.top + scrollY;
        if (nx >= x - 4 && ny >= y - 4 && nx + r.width <= x + w + 4 && ny + r.height <= y + h + 4) {
          const t = (n.textContent || n.getAttribute("alt") || n.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40);
          const fs = parseFloat(getComputedStyle(n).fontSize) || 0;
          cands.push({ n, t, fs, area: r.width * r.height });
        }
      }
      cands.sort((a, b) => b.fs - a.fs || b.area - a.area);
      const seen = new Set();
      for (const c of cands) {
        const key = `${shortSel(c.n)}|${c.t}`;
        if (seen.has(key)) continue;
        seen.add(key);
        inside.push(`<${shortSel(c.n)}>${c.t ? ` "${c.t}"` : ""}`);
        if (inside.length >= 6) break;
      }
    } catch { /* ignore */ }
    if (c) c.inside = inside;
    return c;
  }
  function ctxForShape(s) {
    const b = bbox(s);
    if (s.type === "arrow") return ctxAtPoint(s.x2, s.y2);
    if (s.type === "rect" || s.type === "ellipse") return ctxForBox(b.x, b.y, b.w, b.h);
    return ctxForBox(b.x, b.y, b.w, b.h); // pen: usually a circle around something
  }

  // ---------------------------------------------------------------------------
  // Geometry + rendering of marks
  // ---------------------------------------------------------------------------
  function bbox(s) {
    if (s.type === "pen") {
      const xs = s.points.map((p) => p[0]), ys = s.points.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    if (s.type === "arrow") {
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
      return { x, y, w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
    }
    return { x: s.x, y: s.y, w: s.w, h: s.h };
  }
  function penPath(pts) {
    if (pts.length < 2) return `M${pts[0][0]} ${pts[0][1]}`;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
    }
    const l = pts[pts.length - 1];
    d += ` L${l[0]} ${l[1]}`;
    return d;
  }
  function arrowParts(s) {
    const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    const size = 15;
    const bx = s.x2 - Math.cos(a) * size * 0.75, by = s.y2 - Math.sin(a) * size * 0.75;
    const p1 = [s.x2 - size * Math.cos(a - 0.5), s.y2 - size * Math.sin(a - 0.5)];
    const p2 = [s.x2 - size * Math.cos(a + 0.5), s.y2 - size * Math.sin(a + 0.5)];
    return { line: `M${s.x1} ${s.y1} L${bx} ${by}`, head: `${s.x2},${s.y2} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}` };
  }
  function shapeSvg(s, cls = "shape") {
    const hex = (INKS.find((i) => i.id === s.color) || INKS[0]).hex;
    let body = "", hit = "";
    if (s.type === "pen") {
      const d = penPath(s.points);
      body = `<path class="halo" d="${d}"/><path class="line" stroke="${hex}" d="${d}"/>`;
      hit = `<path class="hit" d="${d}"/>`;
    } else if (s.type === "rect") {
      const a = `x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="8"`;
      body = `<rect class="halo" ${a}/><rect class="line" stroke="${hex}" ${a}/>`;
      hit = `<rect class="hit" ${a}/>`;
    } else if (s.type === "ellipse") {
      const a = `cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${s.w / 2}" ry="${s.h / 2}"`;
      body = `<ellipse class="halo" ${a}/><ellipse class="line" stroke="${hex}" ${a}/>`;
      hit = `<ellipse class="hit" ${a}/>`;
    } else if (s.type === "arrow") {
      const { line, head } = arrowParts(s);
      body = `<path class="halo" d="${line}"/><path class="line" stroke="${hex}" d="${line}"/><polygon class="head" fill="${hex}" points="${head}"/>`;
      hit = `<path class="hit" d="M${s.x1} ${s.y1} L${s.x2} ${s.y2}"/>`;
    }
    return `<g class="${cls}${selected === s.id ? " selected" : ""}" data-id="${s.id}">${body}${hit}</g>`;
  }
  function renderInk() {
    shapesG.innerHTML = shapes.map((s) => shapeSvg(s)).join("");
    renderDraft();
    renderSelection();
  }
  function renderDraft() { draftG.innerHTML = draft ? shapeSvg(draft, "draft") : ""; }
  function renderShape(s) { // one committed shape, while it is being moved
    const g = shapesG.querySelector(`g.shape[data-id="${s.id}"]`);
    if (g) g.outerHTML = shapeSvg(s); else renderInk();
    renderSelection();
  }
  let selBox = null;
  function renderSelection() {
    if (selBox) { selBox.remove(); selBox = null; }
    const s = shapes.find((x) => x.id === selected);
    if (!s || mode !== "draw") return;
    const b = bbox(s);
    selBox = el("div", "sel");
    selBox.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
    const del = el("button", "del", svgIcon("x", 15));
    del.title = "Delete (⌫)";
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteSelected(); });
    selBox.appendChild(del);
    pinsLayer.appendChild(selBox);
  }

  // ---------------------------------------------------------------------------
  // Pins
  // ---------------------------------------------------------------------------
  function renderPins() {
    const keep = selBox;
    pinsLayer.innerHTML = "";
    for (const n of notes) {
      const inkDef = INKS.find((i) => i.id === n.color) || INKS[0];
      const p = el("div", `pin ${n.status || "draft"}`);
      p.dataset.id = n.id;
      p.style.cssText = `left:${n.x}px;top:${n.y}px;--ink:${inkDef.hex};--ink-dark:${inkDef.dark};--ink-soft:${inkDef.hex}55`;
      p.innerHTML = `<span class="ring"></span><button class="dot" type="button" aria-label="Note ${n.n}"><span class="n">${n.n}</span>${svgIcon("check", 15)}</button><span class="tag" title="${esc(n.text)}">${tagHtml(n)}</span>`;
      pinsLayer.appendChild(p);
    }
    if (keep) pinsLayer.appendChild(keep);
  }
  function tagHtml(n) { return `<span class="txt">${esc(n.text || "…")}</span>${n.result ? `<span class="res">${esc(n.result)}</span>` : ""}`; }
  function updatePin(n) {
    const p = pinsLayer.querySelector(`.pin[data-id="${n.id}"]`);
    if (!p) return renderPins();
    p.className = `pin ${n.status || "draft"}`;
    p.querySelector(".tag").innerHTML = tagHtml(n);
  }
  function wigglePins(stagger = 50) {
    [...pinsLayer.querySelectorAll(".pin .dot")].forEach((d, i) => {
      setTimeout(() => { d.classList.remove("wiggle"); void d.offsetWidth; d.classList.add("wiggle"); }, i * stagger);
    });
  }

  // ---------------------------------------------------------------------------
  // Popover (note text)
  // ---------------------------------------------------------------------------
  let popNote = null;
  function openPopover(note, isNew = false) {
    popNote = note;
    const inkDef = INKS.find((i) => i.id === note.color) || INKS[0];
    popover.style.setProperty("--ink", inkDef.hex);
    popover.style.setProperty("--ink-dark", inkDef.dark);
    popover.innerHTML = `
      <div class="head"><span class="num">${note.n}</span><span class="title">${isNew ? "What should change here?" : "Note " + note.n}</span>
        <button class="tb del" type="button" title="Delete note">${svgIcon("trash", 15)}</button></div>
      <textarea placeholder="e.g. make this less loud, same style as the card on the left" rows="2" maxlength="600"></textarea>
      <div class="hint"><span><kbd>↵</kbd> save · <kbd>⇧↵</kbd> line · <kbd>esc</kbd> ${isNew ? "discard" : "close"}</span><button class="ok" type="button">${svgIcon("check", 13)} Save</button></div>`;
    const ta = popover.querySelector("textarea");
    ta.value = note.text || "";
    popover.classList.remove("hidden");
    const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(180, ta.scrollHeight) + "px"; };
    ta.addEventListener("input", grow);
    grow();
    placePopover();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitPopover(); }
      if (e.key === "Escape") { e.preventDefault(); cancelPopover(isNew); }
    });
    popover.querySelector(".ok").addEventListener("click", commitPopover);
    popover.querySelector(".del").addEventListener("click", () => { deleteNote(note.id); closePopover(); });
  }
  function placePopover() {
    if (!popNote || popover.classList.contains("hidden")) return;
    const px = popNote.x - scrollX, py = popNote.y - scrollY;
    const w = 292, h = popover.offsetHeight || 150;
    let left = px + 24, top = py - 14;
    let ox = "0", oy = "0";
    if (left + w > innerWidth - 12) { left = px - 24 - w; ox = "100%"; }
    if (top + h > innerHeight - 12) { top = Math.max(12, py - h + 14); oy = "100%"; }
    popover.style.left = clamp(left, 12, innerWidth - w - 12) + "px";
    popover.style.top = clamp(top, 12, innerHeight - h - 12) + "px";
    popover.style.setProperty("--ox", ox);
    popover.style.setProperty("--oy", oy);
  }
  function commitPopover() {
    if (!popNote) return;
    const ta = popover.querySelector("textarea");
    const t = (ta.value || "").trim();
    if (!t) { deleteNote(popNote.id); closePopover(); return; }
    pushUndo();
    popNote.text = t;
    closePopover();
    renderPins();
    save();
  }
  function cancelPopover(isNew) {
    if (isNew && popNote && !popNote.text) deleteNote(popNote.id, true);
    closePopover();
  }
  function closePopover() {
    const was = popNote;
    popover.classList.add("hidden");
    popover.innerHTML = "";
    popNote = null;
    if (was) { const d = pinsLayer.querySelector(`.pin[data-id="${was.id}"] .dot`); if (d) d.focus({ preventScroll: true }); }
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  function snapshot() { return JSON.stringify({ shapes, notes }); }
  function pushUndo() { undo.push(snapshot()); if (undo.length > 60) undo.shift(); redo.length = 0; renderToolbar(); }
  function restore(json) { const s = JSON.parse(json); shapes = s.shapes; notes = s.notes; selected = null; renderInk(); renderPins(); save(); renderToolbar(); }
  function doUndo() { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); }
  function doRedo() { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); }
  function addShape(s) { pushUndo(); s.ctx = ctxForShape(s); shapes.push(s); renderInk(); save(); }
  function translateShape(s, o, dx, dy) {
    if (s.type === "pen") s.points = o.points.map(([x, y]) => [x + dx, y + dy]);
    else if (s.type === "arrow") { s.x1 = o.x1 + dx; s.y1 = o.y1 + dy; s.x2 = o.x2 + dx; s.y2 = o.y2 + dy; }
    else { s.x = o.x + dx; s.y = o.y + dy; }
  }
  function deleteSelected() {
    if (!selected) return;
    pushUndo();
    shapes = shapes.filter((s) => s.id !== selected);
    selected = null;
    renderInk();
    save();
  }
  function deleteNote(id, silent = false) {
    if (!silent) pushUndo();
    notes = notes.filter((n) => n.id !== id);
    renderPins();
    save();
  }
  let creating = false;
  async function createNote(x, y) {
    if (creating) return;
    creating = true;
    try {
      let n;
      try { n = (await req("POST", "/note/next")).n; } catch { n = Math.max(0, ...notes.map((k) => k.n)) + 1; }
      const note = { id: uid(), n, x, y, color: ink.id, text: "", status: "draft", ctx: ctxAtPoint(x, y), batch: null };
      notes.push(note);
      renderPins();
      openPopover(note, true);
    } finally { creating = false; }
  }
  async function clearAll() {
    pushUndo();
    shapes = []; notes = []; selected = null; phase = "idle";
    renderInk(); renderPins(); renderToolbar();
    try { await req("POST", "/clear"); toast("Cleared. Fresh page.", "ok"); } catch (e) { toast(e.message === "busy" ? "Still sending, clear again in a moment." : `Couldn't clear: ${e.message}`); }
  }

  // ---------------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------------
  function applyInk() {
    host.style.setProperty("--ink", ink.hex);
    host.style.setProperty("--ink-dark", ink.dark);
    const cur = `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'><circle cx='11' cy='11' r='6.5' fill='${ink.hex}' stroke='rgba(10,8,14,.75)' stroke-width='2'/></svg>`)}") 11 11, crosshair`;
    host.style.setProperty("--cursor", tool === "note" ? "copy" : cur);
  }
  function setMode(m) {
    mode = m;
    host.classList.toggle("draw", m === "draw");
    host.classList.toggle("browse", m === "browse");
    for (const t of TOOLS) host.classList.toggle("t-" + t, m === "draw" && tool === t);
    if (m === "browse") { selected = null; renderSelection(); }
    renderToolbar();
  }
  function setTool(t) {
    tool = t;
    if (t !== "select") { selected = null; renderSelection(); }
    setMode("draw");
    applyInk();
  }
  function setLink(s) {
    linkState = s;
    host.classList.toggle("link-on", s === "on");
    host.classList.toggle("link-connecting", s === "connecting");
    host.classList.toggle("link-off", s === "off");
  }
  function sendLabel() {
    const unsent = totals.unsent;
    if (phase === "sending") return { label: "Sending…", cls: "sending", disabled: true };
    if (phase === "sent" && totals.open > 0 && unsent === 0) return { label: "Claude is on it", cls: "sent", disabled: true };
    if (phase === "done" && unsent === 0) return { label: "All done", cls: "done", disabled: true };
    if (unsent === 0 && totals.notes + totals.shapes === 0) return { label: "Send to Claude", cls: "", disabled: true };
    if (totals.batches > 0 && unsent > 0) return { label: `Send ${unsent} more`, cls: "", disabled: false, count: unsent };
    return { label: "Send to Claude", cls: "", disabled: false, count: unsent };
  }
  let lastBar = "";
  function renderToolbar() {
    if (!bar) return;
    const s = sendLabel();
    const btn = (name, title, key, extra = "") =>
      `<button class="tb ${extra}" type="button" data-${name.startsWith("act:") ? "act" : "tool"}="${name.replace("act:", "")}" aria-label="${title}">${svgIcon(name.replace("act:", "") === "undo" ? "undo" : name.replace("act:", ""))}<span class="kbd">${title}${key ? `<b>${key}</b>` : ""}</span></button>`;
    const html = `
      <span class="grip" title="Drag">${svgIcon("grip", 16)}</span>
      <button class="tb mode${mode === "browse" ? " on" : ""}" type="button" data-act="mode" aria-label="Browse the page">${svgIcon("hand")}<span class="st"></span><span class="kbd">${mode === "browse" ? "Back to drawing" : "Browse the page"}<b>V · esc</b></span></button>
      <span class="sep"></span>
      ${btn("pen", "Pen", "P", tool === "pen" && mode === "draw" ? "on" : "")}
      ${btn("arrow", "Arrow", "A", tool === "arrow" && mode === "draw" ? "on" : "")}
      ${btn("rect", "Box", "R", tool === "rect" && mode === "draw" ? "on" : "")}
      ${btn("ellipse", "Circle", "E", tool === "ellipse" && mode === "draw" ? "on" : "")}
      ${btn("note", "Note", "N", tool === "note" && mode === "draw" ? "on" : "")}
      ${btn("select", "Select", "S", tool === "select" && mode === "draw" ? "on" : "")}
      <span class="sep"></span>
      <span class="inks">${INKS.map((i, idx) => `<button class="inkb${ink.id === i.id ? " on" : ""}" type="button" data-ink="${i.id}" style="--c:${i.hex}" aria-label="${i.id} ink" title="${i.id} (${idx + 1})"></button>`).join("")}</span>
      <span class="sep"></span>
      <button class="tb" type="button" data-act="undo" aria-label="Undo" ${undo.length ? "" : "disabled style='opacity:.35'"}>${svgIcon("undo")}<span class="kbd">Undo<b>⌘Z</b></span></button>
      <span class="sep"></span>
      <button class="send ${s.cls}" type="button" data-act="send" ${s.disabled ? "disabled" : ""}><span class="live"></span><span class="label">${s.label}</span>${s.count || s.cls === "done" ? `<span class="cnt"><span class="num">${s.count || ""}</span>${svgIcon("check", 13)}</span>` : ""}</button>
      <button class="tb danger${clearArmed ? " armed" : ""}${phase === "done" && !clearArmed ? " glow" : ""}" type="button" data-act="clear" aria-label="Clear everything">${svgIcon("trash")}${clearArmed ? "<span>Sure?</span>" : `<span class="kbd">Clear all pages</span>`}</button>`;
    if (html !== lastBar) { lastBar = html; bar.innerHTML = html; }
  }

  // ---------------------------------------------------------------------------
  // Toolbar position (draggable, remembered per origin)
  // ---------------------------------------------------------------------------
  const POS_KEY = "claude-annotate:bar";
  function restoreBarPos() {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (p && typeof p.x === "number") placeBar(p.x, p.y);
    } catch { /* ignore */ }
  }
  function placeBar(x, y) {
    const w = bar.offsetWidth || 560, h = bar.offsetHeight || 48;
    x = clamp(x, 8, innerWidth - w - 8);
    y = clamp(y, 8, innerHeight - h - 8);
    bar.style.left = x + "px";
    bar.style.top = y + "px";
    bar.style.bottom = "auto";
    bar.style.transform = "none";
  }
  function bindDrag() {
    let start = null;
    bar.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(".grip")) return;
      const r = bar.getBoundingClientRect();
      start = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      bar.classList.add("dragging");
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener("pointermove", (e) => { if (start) placeBar(e.clientX - start.dx, e.clientY - start.dy); });
    const stop = () => {
      if (!start) return;
      start = null;
      bar.classList.remove("dragging");
      const r = bar.getBoundingClientRect();
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch { /* ignore */ }
    };
    bar.addEventListener("pointerup", stop);
    bar.addEventListener("pointercancel", stop);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // Toolbar clicks (delegated; toolbar re-renders often)
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.tool) return setTool(b.dataset.tool);
      if (b.dataset.ink) { ink = INKS.find((i) => i.id === b.dataset.ink); applyInk(); if (mode !== "draw") setMode("draw"); renderToolbar(); return; }
      switch (b.dataset.act) {
        case "mode": return setMode(mode === "draw" ? "browse" : "draw");
        case "undo": return doUndo();
        case "send": return send();
        case "clear": return armClear();
      }
    });
    bindDrag();

    // Drawing
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
    svg.addEventListener("contextmenu", (e) => { if (mode === "draw") e.preventDefault(); });

    // Pins: press opens the note, drag moves it (any mode)
    pinsLayer.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest(".dot, .tag");
      const pin = e.target.closest(".pin");
      if (!handle || !pin || e.button !== 0) return;
      const n = notes.find((k) => k.id === pin.dataset.id);
      if (!n) return;
      e.preventDefault();
      e.stopPropagation();
      const [x, y] = toDoc(e);
      drag = { kind: "pin", n, pin, ox: n.x, oy: n.y, x, y, before: snapshot(), moved: false };
      handle.setPointerCapture(e.pointerId);
    });
    pinsLayer.addEventListener("pointermove", (e) => {
      if (!drag || drag.kind !== "pin") return;
      const [x, y] = toDoc(e);
      const dx = x - drag.x, dy = y - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) { drag.moved = true; host.classList.add("dragging"); closePopover(); }
      drag.n.x = Math.round(drag.ox + dx); drag.n.y = Math.round(drag.oy + dy);
      drag.pin.style.left = drag.n.x + "px"; drag.pin.style.top = drag.n.y + "px";
    });
    const endPinDrag = () => {
      if (!drag || drag.kind !== "pin") return;
      const d = drag; drag = null;
      host.classList.remove("dragging");
      if (d.moved) { undo.push(d.before); if (undo.length > 60) undo.shift(); redo.length = 0; d.n.ctx = ctxAtPoint(d.n.x, d.n.y); renderPins(); save(); renderToolbar(); }
      else openPopover(d.n, false);
    };
    pinsLayer.addEventListener("pointerup", endPinDrag);
    pinsLayer.addEventListener("pointercancel", endPinDrag);

    // Keyboard
    window.addEventListener("keydown", onKey, true);

    // Keep things aligned
    window.addEventListener("scroll", placePopover, { passive: true });
    window.addEventListener("resize", () => { sizeDoc(); placePopover(); }, { passive: true });
    const ro = new ResizeObserver(() => sizeDoc());
    ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
    setInterval(() => {
      if (!host.isConnected) document.documentElement.appendChild(host); // hydration or innerHTML replaced <html>'s children
      ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body); // idempotent; re-arms after a body swap
      sizeDoc();
    }, 1500);

    // SPA navigation: same document, new URL → reload state for the new URL
    const fire = () => setTimeout(onUrlChange, 50);
    for (const m of ["pushState", "replaceState"]) {
      const orig = history[m];
      history[m] = function (...a) { const r = orig.apply(this, a); fire(); return r; };
    }
    window.addEventListener("popstate", fire);
    window.addEventListener("hashchange", fire);
  }
  let currentUrl = location.href;
  function onUrlChange() {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    closePopover();
    selected = null;
    hydrate();
  }

  function onDown(e) {
    if (mode !== "draw" || e.button !== 0) return;
    if (!popover.classList.contains("hidden")) { commitPopover(); }
    const [x, y] = toDoc(e);
    if (tool === "note") { e.preventDefault(); createNote(x, y); return; }
    if (tool === "select") {
      const g = e.composedPath().find((n) => n instanceof Element && n.classList && n.classList.contains("shape"));
      selected = g ? g.dataset.id : null;
      renderInk();
      if (selected) {
        const s = shapes.find((k) => k.id === selected);
        drag = { kind: "shape", s, orig: JSON.parse(JSON.stringify(s)), x, y, before: snapshot(), moved: false };
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
      return;
    }
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    if (tool === "pen") draft = { id: uid(), type: "pen", color: ink.id, points: [[x, y]] };
    else if (tool === "arrow") draft = { id: uid(), type: "arrow", color: ink.id, x1: x, y1: y, x2: x, y2: y };
    else draft = { id: uid(), type: tool, color: ink.id, x, y, w: 0, h: 0, _ox: x, _oy: y };
    sizeDoc();
    renderDraft();
  }
  let drag = null; // { kind: "shape"|"pin", ... } while something is being moved
  function onMove(e) {
    if (drag && drag.kind === "shape") {
      const [x, y] = toDoc(e);
      const dx = x - drag.x, dy = y - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      host.classList.add("dragging");
      translateShape(drag.s, drag.orig, dx, dy);
      renderShape(drag.s);
      return;
    }
    if (!draft) return;
    const [x, y] = toDoc(e);
    if (draft.type === "pen") {
      const l = draft.points[draft.points.length - 1];
      if (Math.hypot(x - l[0], y - l[1]) >= 2.5) draft.points.push([x, y]);
    } else if (draft.type === "arrow") { draft.x2 = x; draft.y2 = y; }
    else {
      draft.x = Math.min(draft._ox, x); draft.y = Math.min(draft._oy, y);
      draft.w = Math.abs(x - draft._ox); draft.h = Math.abs(y - draft._oy);
      if (e.shiftKey) { const m = Math.max(draft.w, draft.h); draft.w = draft.h = m; }
    }
    renderDraft();
  }
  function onUp() {
    if (drag && drag.kind === "shape") {
      const d = drag; drag = null;
      host.classList.remove("dragging");
      if (d.moved) { undo.push(d.before); if (undo.length > 60) undo.shift(); redo.length = 0; d.s.ctx = ctxForShape(d.s); renderInk(); save(); renderToolbar(); }
      return;
    }
    if (!draft) return;
    const d = draft; draft = null;
    let ok = false;
    if (d.type === "pen") ok = d.points.length >= 3;
    else if (d.type === "arrow") ok = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) >= 12;
    else { ok = d.w >= 8 && d.h >= 8; delete d._ox; delete d._oy; }
    if (ok) addShape(d); else renderDraft();
  }
  function onKey(e) {
    if (RENDER_ONLY) return;
    const target = e.composedPath()[0];
    const inOurs = host && (target === host || host.shadowRoot.contains(target));
    const editing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (editing && !inOurs) return; // the page's own inputs
    if (inOurs && editing) return; // our textarea handles itself
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (meta && e.key === "Enter") { e.preventDefault(); send(); return; }
    if (meta || e.altKey) return;
    const k = e.key.toLowerCase();
    if (e.key === "Escape") { if (clearArmed) disarmClear(); else if (mode === "draw") setMode("browse"); return; } // never steals the page's own Escape
    if (mode === "browse" && !(k in KEYS) && k !== "v") return;
    if (k === "v") { setMode(mode === "draw" ? "browse" : "draw"); return; }
    if (k in KEYS) { setTool(KEYS[k]); return; }
    if (/^[1-4]$/.test(k)) { ink = INKS[Number(k) - 1]; applyInk(); renderToolbar(); return; }
    if ((e.key === "Backspace" || e.key === "Delete") && selected) { e.preventDefault(); deleteSelected(); }
  }

  // ---------------------------------------------------------------------------
  // Send / clear
  // ---------------------------------------------------------------------------
  async function send() {
    if (phase === "sending") return;
    if (!popover.classList.contains("hidden")) commitPopover();
    phase = "sending";
    renderToolbar();
    clearTimeout(saveTimer);
    try { await req("PUT", "/state", { url: pageUrl(), shapes, notes }); } catch { /* fallthrough */ }
    try {
      const r = await req("POST", "/send");
      for (const n of notes) if (!n.batch) { n.batch = r.batch; n.status = "pending"; }
      for (const s of shapes) if (!s.batch) s.batch = r.batch;
      totals = r.totals || totals;
      phase = "sent";
      renderPins();
      renderToolbar();
      wigglePins();
      rim.classList.remove("flash"); void rim.offsetWidth; rim.classList.add("flash");
      const where = r.pages > 1 ? ` across ${r.pages} pages` : "";
      toast(`Sent ${r.notes} note${r.notes === 1 ? "" : "s"}${where}. The pins update as Claude works.`, "ok");
      // The server cannot tell whether the channel is on. If nothing comes back, say what to do.
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => { if (phase === "sent") toast("Nothing from Claude yet? In the session, type /annotate pull."); }, 20000);
    } catch (e) {
      phase = "idle";
      renderToolbar();
      toast(e.message === "Nothing to send yet." ? "Draw something or drop a note first." : e.message === "busy" ? "Still sending the last batch, one moment." : `Couldn't send: ${e.message}`);
    }
  }
  function armClear() {
    if (clearArmed) { disarmClear(); clearAll(); return; }
    clearArmed = setTimeout(disarmClear, 2200);
    renderToolbar();
  }
  function disarmClear() { clearTimeout(clearArmed); clearArmed = null; renderToolbar(); }

  // ---------------------------------------------------------------------------
  // Toasts / ticker
  // ---------------------------------------------------------------------------
  function toast(text, kind = "") {
    const t = el("div", `toast ${kind}`, `${svgIcon(kind === "ok" ? "check" : "note", 16)}<span>${esc(text)}</span>`);
    toasts.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 260); }, kind === "ok" ? 3800 : 6000);
  }
  let tickerTimer = null;
  function tick(text, mono) {
    ticker.innerHTML = mono ? `Claude · <span class="mono">${esc(text)}</span>` : esc(text);
    ticker.classList.add("show");
    clearTimeout(tickerTimer);
    tickerTimer = setTimeout(() => ticker.classList.remove("show"), 6000);
  }

  // ---------------------------------------------------------------------------
  // Server link
  // ---------------------------------------------------------------------------
  async function hydrate() {
    try {
      const r = await req("GET", `/state?url=${encodeURIComponent(pageUrl())}`);
      shapes = r.shapes || [];
      notes = r.notes || [];
      totals = r.totals || totals;
      if (totals.open > 0) phase = "sent";
      else if (totals.batches > 0 && totals.unsent === 0) phase = "done";
      renderInk(); renderPins(); renderToolbar();
    } catch { setLink("off"); }
  }
  function connectSse() {
    setLink("connecting");
    sse = new ES(`${CFG.endpoint}/events?t=${CFG.token}`);
    sse.onopen = () => setLink("on");
    sse.onerror = () => setLink("off");
    sse.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === "progress" || m.type === "done" || m.type === "status" || m.type === "toast") clearTimeout(quietTimer);
      switch (m.type) {
        case "hello": setLink("on"); if (m.totals) { totals = m.totals; renderToolbar(); } break;
        case "progress": {
          const n = notes.find((k) => k.n === m.n);
          if (n) { n.status = m.status; if (m.message) n.result = m.message; updatePin(n); }
          tick(m.status === "working" ? `working on note ${m.n}` : m.status === "done" ? `note ${m.n} done${m.message ? " · " + m.message : ""}` : `note ${m.n} skipped${m.message ? " · " + m.message : ""}`);
          if (m.status === "done") { const d = pinsLayer.querySelector(`.pin[data-id="${n ? n.id : ""}"] .dot`); if (d) d.classList.add("wiggle"); }
          break;
        }
        case "status": tick(m.text, true); break;
        case "toast": toast(m.text); break;
        case "sent": if (!draft && !popNote && !drag) hydrate(); break; // another tab sent; don't clobber work in progress
        case "done":
          for (const n of notes) if (n.batch && (!m.batch || n.batch === m.batch) && (n.status === "pending" || n.status === "working")) { n.status = "done"; updatePin(n); }
          phase = "done";
          totals.open = 0;
          renderToolbar();
          toast(m.summary ? `Done. ${m.summary}` : "Done.", "ok");
          wigglePins(70);
          break;
        case "clear":
          shapes = []; notes = []; selected = null; phase = "idle"; undo.length = 0; redo.length = 0;
          totals = { notes: 0, shapes: 0, pages: 0, unsent: 0, open: 0, batches: 0 };
          closePopover(); renderInk(); renderPins(); renderToolbar();
          break;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Public hooks for the server
  // ---------------------------------------------------------------------------
  api.capture = (on) => { if (!host) return; host.classList.toggle("capturing", !!on); if (on) { closePopover(); selected = null; renderSelection(); } };

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
