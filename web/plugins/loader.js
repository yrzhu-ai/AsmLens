/**
 * AsmLens plugin loader
 * ----------------------
 * Drop JS files under /static/plugins/ and list them in MANIFEST.json,
 * or call window.AsmLens.registerPlugin({...}) from your script.
 *
 * Plugin shape:
 * {
 *   id: "my-plugin",
 *   name: "My Plugin",
 *   version: "0.1.0",
 *   feature: {                 // optional — adds a 功能区 toggle
 *     id: "my-panel",
 *     label: "我的功能",
 *     panel: "my-panel",       // dock panel id (or omit if track-only)
 *     defaultOn: false,
 *     renderPanel(el, api) {}  // mount UI into dock when first created
 *   },
 *   contributeTracks(project) { return []; },
 *   onRegister(api) {},
 *   onProjectLoaded(project) {},
 *   onViewRendered({chrom, start, end, genome}) {},
 *   onFeatureToggle(id, on) {},
 *   onSelection(sel) {},
 * }
 *
 * Public API (window.AsmLens):
 *   registerPlugin / registerFeature / isFeatureOn / setFeature
 *   gotoRegion / selectFeature / getSelection / status / refresh / state
 */
(() => {
  async function loadManifest() {
    try {
      const res = await fetch("/static/plugins/MANIFEST.json");
      if (!res.ok) return;
      const list = await res.json();
      for (const name of list) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = `/static/plugins/${name}`;
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        }).catch((e) => console.warn("plugin load failed", name, e));
      }
    } catch (e) {
      /* no manifest — optional */
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadManifest);
  } else {
    loadManifest();
  }
})();
