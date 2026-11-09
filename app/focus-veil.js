// Focus mode's veil (1.4). The worker injects this file with chrome.scripting.executeScript into
// every tab of every window but the focused one. It reads nothing from the page and sends
// nothing but the lift request: it draws a full-page blur with a pill on top, inside a shadow
// root so the page's own styles cannot reach it. Styles are set through the CSSOM (element.style),
// which a page's Content-Security-Policy does not block, unlike a <style> element.
(() => {
  const ID = "tabvault-focus-veil";
  if (document.getElementById(ID)) return;

  const set = (node, styles) => { for (const [k, v] of Object.entries(styles)) node.style.setProperty(k, v, "important"); };

  const host = document.createElement("div");
  host.id = ID;
  host.dataset.tabvaultVeil = "1";
  set(host, { position: "fixed", inset: "0", "z-index": "2147483647", display: "block", margin: "0", padding: "0", border: "0" });

  const root = host.attachShadow({ mode: "open" });
  const veil = document.createElement("div");
  veil.setAttribute("part", "veil");
  set(veil, {
    position: "absolute", inset: "0",
    "backdrop-filter": "blur(8px)", "-webkit-backdrop-filter": "blur(8px)",
    background: "rgba(0, 0, 0, 0.35)",
  });

  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "pill";
  pill.textContent = "TabVault focus is on this other window. Click to lift.";
  set(pill, {
    position: "absolute", top: "16px", left: "50%", transform: "translateX(-50%)",
    padding: "8px 16px", border: "0", "border-radius": "999px", cursor: "pointer",
    background: "#1f1d1a", color: "#ffffff", "box-shadow": "0 4px 16px rgba(0, 0, 0, 0.35)",
    font: "500 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif",
  });

  const remove = () => { const h = document.getElementById(ID); if (h) h.remove(); };
  pill.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    remove(); // this page's veil goes at once, even when the extension was reloaded meanwhile
    try {
      chrome.runtime.sendMessage({ type: "focusLift" }).catch(() => {});
    } catch {
      /* the extension was updated or reloaded: nothing to tell */
    }
  });

  root.append(veil, pill);
  document.documentElement.append(host);
})();
