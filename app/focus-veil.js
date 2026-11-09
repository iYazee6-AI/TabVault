// Focus mode's veil (1.4). The worker injects this file with chrome.scripting.executeScript into
// every tab of every normal window but the focused one, right after setting
// globalThis.tabvaultVeilTag (in this isolated world, which the page cannot see) to the install's
// random custom-element name. It reads nothing from the page and sends nothing but the lift
// request: it draws a full-page blur with a pill on top, inside a closed shadow root, so the
// page's own scripts and styles cannot reach the pill. The only thing a page can see is one
// element with a random name and no id, class or data attribute. Styles are set through the
// CSSOM (element.style), which a page's Content-Security-Policy does not block.
(() => {
  const TAG = globalThis.tabvaultVeilTag;
  if (typeof TAG !== "string" || !TAG.startsWith("x-")) return;
  if (document.querySelector(TAG)) return;

  const set = (node, styles) => { for (const [k, v] of Object.entries(styles)) node.style.setProperty(k, v, "important"); };

  const host = document.createElement(TAG);
  set(host, { position: "fixed", inset: "0", "z-index": "2147483647", display: "block", margin: "0", padding: "0", border: "0" });

  const root = host.attachShadow({ mode: "closed" });
  const veil = document.createElement("div");
  set(veil, {
    position: "absolute", inset: "0",
    "backdrop-filter": "blur(8px)", "-webkit-backdrop-filter": "blur(8px)",
    background: "rgba(0, 0, 0, 0.35)",
  });

  const pill = document.createElement("button");
  pill.type = "button";
  pill.textContent = "TabVault focus is on this other window. Click to lift.";
  set(pill, {
    position: "absolute", top: "16px", left: "50%", transform: "translateX(-50%)",
    padding: "8px 16px", border: "0", "border-radius": "999px", cursor: "pointer",
    background: "#1f1d1a", color: "#ffffff", "box-shadow": "0 4px 16px rgba(0, 0, 0, 0.35)",
    font: "500 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif",
  });

  const remove = () => { host.remove(); if (globalThis.tabvaultVeil && globalThis.tabvaultVeil.host === host) globalThis.tabvaultVeil = null; };
  // Only a real activation lifts the focus: a trusted click, from the mouse or from Enter or
  // Space on the focused pill. A page script cannot reach the pill (closed shadow root), and a
  // synthetic event (isTrusted false) is ignored.
  pill.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.isTrusted) return;
    remove(); // this page's veil goes at once, even when the extension was reloaded meanwhile
    try {
      chrome.runtime.sendMessage({ type: "focusLift" }).catch(() => {});
    } catch {
      /* the extension was updated or reloaded: nothing to tell */
    }
  });

  root.append(veil, pill);
  document.documentElement.append(host);
  // Kept in this isolated world only (the page cannot see it): the worker's unveil and the e2e
  // harness read the veil through it.
  globalThis.tabvaultVeil = { host, veil, pill };
})();
