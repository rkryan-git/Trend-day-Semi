/* Notifications: the block in Settings that turns push on for this device. Helpers from app.js. */
"use strict";

const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function b64ToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4), raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function pushReg() { return navigator.serviceWorker.register("/sw.js", { scope: "/" }); }

async function pushState() {
  if (!pushSupported()) return { on: false };
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return { on: false };
  const st = await api("/api/push/status?endpoint=" + encodeURIComponent(sub.endpoint));
  return { on: st.this_device, sub };
}

async function renderPushBlock() {
  const el = $("#pushBlock");
  if (!el) return;
  const msg = (t, err) => { const m = $("#pushMsg"); if (m) m.innerHTML = err ? `<span class="err">${esc(t)}</span>` : esc(t); };
  if (!pushSupported()) {
    el.innerHTML = `<span class="label">Notifications</span><p class="sub">${isIOS() && !isStandalone()
      ? "On iPhone, open the app from its <b>home-screen icon</b> first (Share → Add to Home Screen), then turn notifications on here."
      : "This browser can't receive push notifications."}</p>`;
    return;
  }
  let st = { on: false };
  try { st = await pushState(); } catch (e) { /* show off */ }
  el.innerHTML = `<span class="label">Notifications</span>
    <p class="sub" style="margin:4px 0 10px">TAKE signals, breaking high-impact news on your semis, rule E switching a stock IN or OUT, and after each close what your recent sells missed or avoided. Sent from your PC, so it has to be on.</p>
    <div class="form-row">${st.on
      ? `<button class="btn btn-ghost btn-sm" type="button" id="pushTest">Send a test</button><button class="btn btn-ghost btn-sm" type="button" id="pushOff">Turn off on this device</button>`
      : `<button class="btn btn-primary btn-sm" type="button" id="pushOn">Turn on for this device</button>`}</div>
    <p class="toast" id="pushMsg" aria-live="polite">${st.on ? "On for this device." : ""}</p>`;
  const on = $("#pushOn"), off = $("#pushOff"), tst = $("#pushTest");
  if (on) on.onclick = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return msg("Notifications were not allowed. Turn them on in your phone's Settings → Notifications → Radar.", true);
      const reg = await pushReg();
      await navigator.serviceWorker.ready;
      const { key } = await api("/api/push/key");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      await api("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub: sub.toJSON(), qs: qs() }) });
      await renderPushBlock();
      msg("On. Sending a test…");
      await api("/api/push/test", { method: "POST" });
      msg("On. A test notification is on its way.");
    } catch (e) { msg(e.message || String(e), true); }
  };
  if (tst) tst.onclick = async () => { try { const r = await api("/api/push/test", { method: "POST" }); msg(r.sent ? "Sent." : "Couldn't reach any device.", !r.sent); } catch (e) { msg(e.message, true); } };
  if (off) off.onclick = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/"), sub = reg && (await reg.pushManager.getSubscription());
      if (sub) { await api("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      await renderPushBlock(); msg("Off for this device.");
    } catch (e) { msg(e.message, true); }
  };
}
