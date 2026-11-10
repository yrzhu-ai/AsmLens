/**
 * Example AsmLens plugin — demonstrates feature toggle + hooks.
 * Enable via 功能区 after load; set window.__ASMLENS_PLUGIN_DEBUG__ = true for view logs.
 */
window.AsmLens.registerPlugin({
  id: "example",
  name: "Example",
  version: "0.1.0",
  onRegister(api) {
    console.info("[AsmLens plugin:example] registered — hooks ready");
  },
  onProjectLoaded(project) {
    console.info(
      "[AsmLens plugin:example] project:",
      project && project.name,
      "tracks:",
      ((project && project.tracks) || []).length
    );
  },
  onViewRendered(view) {
    if (window.__ASMLENS_PLUGIN_DEBUG__) {
      console.debug("[AsmLens plugin:example] view", view);
    }
  },
  onFeatureToggle(id, on) {
    if (window.__ASMLENS_PLUGIN_DEBUG__) {
      console.debug("[AsmLens plugin:example] feature", id, on);
    }
  },
  onSelection(sel) {
    if (window.__ASMLENS_PLUGIN_DEBUG__ && sel) {
      console.debug("[AsmLens plugin:example] selection", sel);
    }
  },
});
