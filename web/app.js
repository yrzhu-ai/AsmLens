(() => {
  const TYPE_ZH = {
    ZERO_COV: "零覆盖",
    LOW_COV: "覆盖偏低",
    CRE: "CRAQ 区域错误",
    CRAQ_LOWCOV: "CRAQ 覆盖异常",
    LOW_QV: "低 QV",
    ATTR_Q: "组装映射问题",
    ATTR_R: "参考映射问题",
    GAP_Q: "组装 Gap",
    GAP_R: "参考 Gap",
    ZERO_Q: "组装零覆盖",
    LOW_Q: "组装覆盖偏低",
    ZERO_R: "参考零覆盖",
    LOW_R: "参考覆盖偏低",
    COV_Q: "Reads 覆盖",
    COV_R: "Reads 覆盖",
    COV: "Reads 覆盖",
    REGION: "区间",
    COLLINEAR: "共线性",
    INV: "倒位",
    TRANS: "易位",
    DUP: "重复",
    NOTAL: "无比对",
    SYRI_SYN: "SyRI 共线",
    SYRI_INV: "SyRI 倒位",
    SYRI_TRANS: "SyRI 易位",
    SYRI_DUP: "SyRI 重复",
    SYRI_NOTAL: "SyRI 无比对",
    SYRI_INVTR: "SyRI 倒位易位",
    SYRI_INVDP: "SyRI 倒位重复",
  };
  const STATUS_ZH = {
    both_lowcov: "组装与参考均覆盖异常",
    mapped_not_lowcov: "组装覆盖异常（参考对应区正常）",
    unmapped: "组装低覆盖区无法映射到参考",
  };
  const STATUS_ZH_REF = {
    both_lowcov: "组装与参考均覆盖异常",
    mapped_not_lowcov: "参考覆盖异常（组装对应区正常）",
    unmapped: "参考低覆盖区无法映射到组装",
  };
  const STATUS_COLOR = {
    both_lowcov: "#c0392b",
    mapped_not_lowcov: "#d68910",
    unmapped: "#7f8c8d",
  };
  const FLAG_COLORS = {
    zero: "#e41a1c",
    low: "#ff7f00",
    attr: "#d68910",
    craq: "#984ea3",
    hover: "#f1c40f",
    select: "#e67e22",
  };
  /** BED kinds that fold into the single coverage track (not shown as separate tracks). */
  const OVERLAY_KINDS = new Set([
    "ZERO_COV", "LOW_COV", "ZERO_Q", "LOW_Q", "ZERO_R", "LOW_R",
    "ATTR_Q", "ATTR_R", "CRAQ_LOWCOV", "GAP_Q", "GAP_R",
  ]);
  const LOWCOV_TYPES = new Set([
    "ZERO_COV", "LOW_COV", "CRAQ_LOWCOV", "ZERO_Q", "LOW_Q", "ZERO_R", "LOW_R",
  ]);
  const CRAQ_TYPES = new Set(["CRE", "CRAQ_LOWCOV", "LOW_QV"]);
  const REFMAP_STATUSES = new Set(["both_lowcov", "mapped_not_lowcov", "unmapped"]);

  const BUILTIN_FEATURES = [
    { id: "coverage", label: "覆盖问题", panel: "coverage", defaultOn: true },
    { id: "craq", label: "CRAQ 错误", panel: "craq", defaultOn: false },
    { id: "refmap", label: "映射问题", panel: "refmap", defaultOn: false },
    { id: "synteny", label: "共线性 / 变异", panel: "synteny", defaultOn: true },
  ];

  /** Keep in sync with server PROBLEM_CATEGORY_TYPES */
  const CATEGORY_TYPES = {
    lowcov: ["ZERO_COV", "LOW_COV", "ZERO_Q", "LOW_Q", "ZERO_R", "LOW_R", "CRAQ_LOWCOV"],
    craq: ["CRE", "CRAQ_LOWCOV", "LOW_QV"],
    refmap: ["ATTR_Q", "ATTR_R"],
    synteny: [
      "COLLINEAR", "INV", "TRANS", "DUP", "NOTAL",
      "SYRI_SYN", "SYRI_INV", "SYRI_TRANS", "SYRI_DUP", "SYRI_NOTAL",
      "SYRI_INVTR", "SYRI_INVDP",
    ],
  };
  const OVERVIEW_MARK_CAP = 600;
  const PROBLEMS_PER_CAT_LIMIT = 8000;

  const state = {
    project: null,
    appInfo: null,
    genome: "query",
    chrom: null,
    start: 0,
    end: 0,
    problems: [],
    /** `${chrom}|${category}` → true after fetch */
    problemLoadKeys: {},
    attribution: {},
    /** chrom → true after attribution rows for that chrom loaded */
    attrLoadKeys: {},
    gaps: [],
    activeProblem: null,
    selection: null,
    /** Linked reference window for dual-coverage (from attribution / click). */
    linkedRef: null,
    hover: null,
    drag: null,
    overviewDrag: null,
    lastTrackData: [],
    updateInfo: null,
    gapCache: {},
    overviewMarkCache: {},
    syntenyLinks: null,
    syntenyLoading: false,
    detailLoading: false,
    /** Overview: pick (highlight only) → 确定 applies filter. */
    overviewPicked: { query: [], ref: [] },
    overviewApplied: { query: [], ref: [] },
    overviewHover: null,
    problemGenomeFilter: "all",
    problemChromFilter: "all",
    /** chromId -> { left: bool, right: bool } */
    telomereInfo: {},
    features: {},
    featureDefs: [],
    /**
     * Dual-coverage peer window scaling:
     *  mapped  — use linked/proportional mapped window (may differ in bp span)
     *  same_bp — force peer window to same base-pair width as primary (equal bp/px)
     *  ratio   — peer_span = primary_span * pairScaleRatio
     */
    pairScaleMode: "mapped",
    pairScaleRatio: 1,
    /** Coverage severity: zero (default) | low | all */
    lowcovLevel: "zero",
    /** Min length (bp) for coverage problems — default 1000 to avoid flooding */
    lowcovMinLen: 1000,
  };

  function loadFeaturePrefs() {
    try {
      return JSON.parse(localStorage.getItem("asmlens.features") || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function saveFeaturePrefs() {
    const out = {};
    state.featureDefs.forEach((f) => { out[f.id] = !!state.features[f.id]; });
    localStorage.setItem("asmlens.features", JSON.stringify(out));
  }

  function emit(hook, ...args) {
    window.AsmLens.plugins.forEach((p) => {
      if (typeof p[hook] === "function") {
        try { p[hook](...args); } catch (e) { console.warn("plugin", p.id || p.name, hook, e); }
      }
    });
  }

  window.AsmLens = {
    state,
    plugins: [],
    features: BUILTIN_FEATURES.slice(),
    /**
     * Plugin contract:
     *   id, name, version?
     *   feature?: { id, label, panel?, defaultOn?, renderPanel?(el, api) }
     *   contributeTracks?(project) -> track metas (optional overlays)
     *   onRegister(api), onProjectLoaded(project), onViewRendered(view),
     *   onFeatureToggle?(id, on), onSelection?(sel)
     */
    registerPlugin(plugin) {
      if (!plugin || typeof plugin !== "object") return;
      this.plugins.push(plugin);
      if (plugin.feature && plugin.feature.id) {
        const exists = this.features.some((f) => f.id === plugin.feature.id);
        if (!exists) this.features.push({ ...plugin.feature, plugin: true });
      }
      if (typeof plugin.onRegister === "function") plugin.onRegister(this);
      if (state.featureDefs.length) initFeatureBar();
    },
    registerFeature(def) {
      if (!def || !def.id) return;
      if (!this.features.some((f) => f.id === def.id)) this.features.push(def);
      if (state.featureDefs.length) initFeatureBar();
    },
    isFeatureOn(id) { return !!state.features[id]; },
    setFeature(id, on) { setFeature(id, on); },
    gotoRegion(chrom, start0, end0, flank) {
      gotoRegion(chrom, start0, end0, flank);
    },
    status(msg) { status(msg); },
    selectFeature(feat) { selectFeature(feat); },
    getSelection() { return state.selection; },
    refresh() { renderAll(); renderProblemLists(); syncDockPanels(); },
  };

  const $ = (id) => document.getElementById(id);
  const status = (msg) => { $("status").textContent = msg || ""; };

  function initFeatureBar() {
    const prefs = loadFeaturePrefs();
    state.featureDefs = window.AsmLens.features.slice();
    state.featureDefs.forEach((f) => {
      if (typeof state.features[f.id] === "boolean") return;
      if (typeof prefs[f.id] === "boolean") state.features[f.id] = prefs[f.id];
      else state.features[f.id] = !!f.defaultOn;
    });
    rebuildSideFeatures();
    syncFeatureMenu();
    updateFeatureStatus();
  }

  function rebuildSideFeatures() {
    const host = $("sideFeatures");
    if (!host) return;
    host.innerHTML = '<div class="side-features-label">功能区</div>';
    state.featureDefs.forEach((f) => {
      const lab = document.createElement("label");
      lab.className = "feat-check";
      lab.innerHTML =
        `<input type="checkbox" data-feature="${f.id}" ${state.features[f.id] ? "checked" : ""} /> ${f.label}`;
      host.appendChild(lab);
    });
  }

  function syncFeatureMenu() {
    document.querySelectorAll(".menu-check[data-feature]").forEach((btn) => {
      const id = btn.dataset.feature;
      btn.classList.toggle("is-on", !!state.features[id]);
    });
    document.querySelectorAll("#sideFeatures input[data-feature]").forEach((el) => {
      el.checked = !!state.features[el.dataset.feature];
    });
  }

  async function setFeature(id, on) {
    state.features[id] = !!on;
    saveFeaturePrefs();
    syncFeatureMenu();
    updateFeatureStatus();
    if (on) status(`正在加载「${labelForFeature(id)}」标注…`);
    await ensureDetailData();
    renderProblemLists();
    await renderAll();
    emit("onFeatureToggle", id, !!on);
    if (on) status(`已加载「${labelForFeature(id)}」`);
  }

  function labelForFeature(id) {
    return state.featureDefs.find((f) => f.id === id)?.label || id;
  }

  function enabledCategories() {
    const cats = [];
    if (state.features.coverage) cats.push("lowcov");
    if (state.features.craq) cats.push("craq");
    if (state.features.refmap) cats.push("refmap");
    if (state.features.synteny) cats.push("synteny");
    return cats;
  }

  /** Chromosomes that may receive annotation payloads (not whole-genome dump). */
  function detailChromScope() {
    if (overviewHasFocus()) {
      return [...new Set([
        ...(state.overviewApplied.query || []),
        ...(state.overviewApplied.ref || []),
      ])];
    }
    // Main view: only the chromosome currently under the cursor/locus
    return state.chrom ? [state.chrom] : [];
  }

  function problemKey(p) {
    return `${p.chrom}:${p.start}-${p.end}:${p.type || ""}:${p.label || ""}`;
  }

  function mergeProblems(rows) {
    if (!rows || !rows.length) return 0;
    const seen = new Set(state.problems.map(problemKey));
    let n = 0;
    rows.forEach((p) => {
      const k = problemKey(p);
      if (seen.has(k)) return;
      seen.add(k);
      state.problems.push(p);
      n += 1;
    });
    return n;
  }

  function problemMatchesCategory(p, cat) {
    const types = CATEGORY_TYPES[cat];
    if (!types) return true;
    if (types.includes(p.type)) return true;
    if (cat === "synteny") {
      const t = p.type || "";
      return t.startsWith("SYN") || t.startsWith("SYRI");
    }
    if (cat === "lowcov" || cat === "refmap") {
      // attribution-backed rows may only appear after table load
      return false;
    }
    return false;
  }

  async function ensureProblemsLoaded(chroms, categories) {
    if (!chroms.length || !categories.length) return;
    const jobs = [];
    const minLen = Math.max(0, state.lowcovMinLen ?? 1000);
    chroms.forEach((chrom) => {
      categories.forEach((cat) => {
        const levelTag = cat === "lowcov" ? `|${state.lowcovLevel || "zero"}|L${minLen}` : "";
        const key = `${chrom}|${cat}${levelTag}`;
        if (state.problemLoadKeys[key]) return;
        jobs.push((async () => {
          try {
            let url = `/api/problems?chrom=${encodeURIComponent(chrom)}`
              + `&category=${encodeURIComponent(cat)}&limit=${PROBLEMS_PER_CAT_LIMIT}`;
            if (cat === "lowcov") {
              const types = lowcovTypesForLevel(state.lowcovLevel).join(",");
              url += `&types=${encodeURIComponent(types)}`;
            }
            const rows = await api(url);
            const all = rows || [];
            let matched = all.filter((p) => problemMatchesCategory(p, cat));
            if (cat === "lowcov") matched = matched.filter(lowcovPasses);
            if (matched.length < all.length && cat !== "lowcov") {
              // Old server ignored category → keep full chrom dump once
              mergeProblems(all);
              Object.keys(CATEGORY_TYPES).forEach((c2) => {
                state.problemLoadKeys[`${chrom}|${c2}`] = true;
              });
            } else {
              mergeProblems(matched);
              state.problemLoadKeys[key] = true;
            }
          } catch (e) {
            console.warn("ensureProblemsLoaded", chrom, cat, e);
          }
        })());
      });
    });
    const batch = 6;
    for (let i = 0; i < jobs.length; i += batch) {
      await Promise.all(jobs.slice(i, i + batch));
    }
  }

  async function ensureAttributionForChroms(chroms) {
    if (!chroms.length) return;
    const tables = state.project?.tables || {};
    const specs = [
      { name: tables.query_lowcov_map_to_ref, genome: "query", keyPrefix: "q" },
      { name: tables.ref_lowcov_map_to_query, genome: "ref", keyPrefix: "r" },
    ].filter((s) => s.name);

    if (!specs.length) {
      chroms.forEach((c) => { state.attrLoadKeys[c] = true; });
      return;
    }

    await Promise.all(specs.map(async (spec) => {
      const need = chroms.filter((c) => !state.attrLoadKeys[`${spec.keyPrefix}:${c}`]);
      if (!need.length) return;
      try {
        const rows = await api(
          `/api/tables/${encodeURIComponent(spec.name)}`
          + `?chroms=${encodeURIComponent(need.join(","))}&limit=50000`
        );
        (rows || []).forEach((r) => {
          const row = { ...r, _genome: spec.genome };
          const k = `${r.chrom}:${r.start}-${r.end}`;
          // Prefer side-specific key; keep region_id lookup
          state.attribution[`${spec.genome}:${k}`] = row;
          state.attribution[k] = row;
          if (r.region_id) state.attribution[r.region_id] = row;
          if (r.chrom) state.attrLoadKeys[`${spec.keyPrefix}:${r.chrom}`] = true;
        });
        $("attrLegend").hidden = false;
      } catch (e) {
        console.warn("attribution lazy load", spec.name, e);
      }
      need.forEach((c) => { state.attrLoadKeys[`${spec.keyPrefix}:${c}`] = true; });
    }));
  }

  /** Overlay BED tracks → problem rows (ref lowcov often only lives here, not in problems.tsv). */
  function trackProblemSpecs(category) {
    if (category === "lowcov") {
      const zero = [
        { match: (t) => t.id === "query_zero_coverage" || t.kind === "ZERO_Q" || t.id === "zero_coverage", type: "ZERO_Q", genome: "query" },
        { match: (t) => t.id === "ref_zero_coverage" || t.kind === "ZERO_R", type: "ZERO_R", genome: "ref" },
      ];
      const low = [
        { match: (t) => t.id === "query_low_coverage" || t.kind === "LOW_Q" || t.id === "low_coverage", type: "LOW_Q", genome: "query" },
        { match: (t) => t.id === "ref_low_coverage" || t.kind === "LOW_R", type: "LOW_R", genome: "ref" },
      ];
      // Default zero-only: do not fetch bulky low-coverage beds until user asks
      if ((state.lowcovLevel || "zero") === "zero") return zero;
      return zero.concat(low);
    }
    if (category === "refmap") {
      return [
        { match: (t) => t.id === "query_lowcov_attribution" || t.kind === "ATTR_Q", type: "ATTR_Q", genome: "query" },
        { match: (t) => t.id === "ref_lowcov_attribution" || t.kind === "ATTR_R", type: "ATTR_R", genome: "ref" },
      ];
    }
    if (category === "craq") {
      return [
        { match: (t) => trackGenome(t) === "query" && (CRAQ_TYPES.has(t.kind) || t.kind === "LOW_QV" || /craq/i.test(t.id || "")), type: null, genome: "query" },
        { match: (t) => trackGenome(t) === "ref" && (CRAQ_TYPES.has(t.kind) || t.kind === "LOW_QV" || /craq/i.test(t.id || "")), type: null, genome: "ref" },
      ];
    }
    return [];
  }

  async function ensureTrackProblemsForChroms(chroms, categories) {
    if (!chroms.length || !categories.length) return;
    const tracks = state.project?.tracks || [];
    const jobs = [];
    const minLen = Math.max(0, state.lowcovMinLen ?? 1000);
    chroms.forEach((chrom) => {
      categories.forEach((cat) => {
        if (cat === "synteny") return;
        const levelTag = cat === "lowcov" ? `|${state.lowcovLevel || "zero"}|L${minLen}` : "";
        const key = `track|${chrom}|${cat}${levelTag}`;
        if (state.problemLoadKeys[key]) return;
        jobs.push((async () => {
          try {
            for (const spec of trackProblemSpecs(cat)) {
              const tr = tracks.find(spec.match);
              if (!tr || tr.type === "bedgraph") continue;
              const L = chromLengthOf(chrom, spec.genome) || chromLengthOf(chrom, "query") || chromLengthOf(chrom, "ref");
              if (!L) continue;
              const data = await api(
                `/api/tracks/${encodeURIComponent(tr.id)}?chrom=${encodeURIComponent(chrom)}&start=0&end=${L}&limit=${PROBLEMS_PER_CAT_LIMIT}`
              );
              const rows = (data.features || []).map((f) => {
                const start1 = (f.start || 0) + 1;
                const end1 = f.end || start1;
                const typ = spec.type || tr.kind || "REGION";
                return {
                  chrom,
                  start: start1,
                  end: end1,
                  length: Math.max(1, end1 - start1 + 1),
                  type: typ,
                  label: f.name || `${typ}:${chrom}:${start1}-${end1}`,
                };
              }).filter((p) => cat !== "lowcov" || lowcovPasses(p));
              mergeProblems(rows);
            }
            state.problemLoadKeys[key] = true;
          } catch (e) {
            console.warn("ensureTrackProblems", chrom, cat, e);
          }
        })());
      });
    });
    const batch = 6;
    for (let i = 0; i < jobs.length; i += batch) {
      await Promise.all(jobs.slice(i, i + batch));
    }
  }

  async function ensureGapsForChroms(chromsByGenome) {
    const jobs = [];
    ["query", "ref"].forEach((genome) => {
      (chromsByGenome[genome] || []).forEach((id) => {
        jobs.push(loadGapsForChrom(id, genome));
      });
    });
    if (jobs.length) await Promise.all(jobs);
  }

  /**
   * Hierarchical detail load: only for focused / current chroms + enabled feature categories.
   * Whole-genome overview stays synteny-only until 确定.
   */
  async function ensureDetailData() {
    const scope = detailChromScope();
    const cats = enabledCategories();
    if (!scope.length || !cats.length) return;
    // Always pull both genomes' overlay BEDs for the scoped chrom names —
    // reference problems often exist only as tracks, not in problems.tsv.
    if (cats.includes("refmap")) await ensureAttributionForChroms(scope);
    await Promise.all([
      ensureProblemsLoaded(scope, cats),
      ensureTrackProblemsForChroms(scope, cats),
    ]);
    if (overviewHasFocus()) {
      await ensureGapsForChroms({
        query: state.overviewApplied.query || [],
        ref: state.overviewApplied.ref || [],
      });
    } else if (state.chrom) {
      // Load gaps for both sides when chrom name exists on both
      const jobs = [];
      if (chromLengthOf(state.chrom, "query")) jobs.push(loadGapsForChrom(state.chrom, "query"));
      if (chromLengthOf(state.chrom, "ref")) jobs.push(loadGapsForChrom(state.chrom, "ref"));
      if (jobs.length) await Promise.all(jobs);
    }
  }

  function syncDockPanels() {
    /* sidebar is a single panel; visibility controlled by View → 显示/隐藏侧栏 */
  }

  function updateFeatureStatus() {
    const on = state.featureDefs.filter((f) => state.features[f.id]).map((f) => f.label);
    const sb = $("sbFeatures");
    if (sb) sb.textContent = `功能：${on.length ? on.join("、") : "无"}`;
  }

  function setFeatureCount(_id, _n) {
    /* counts shown in unified side panel */
  }

  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }

  function fmt(n) {
    return Number(n).toLocaleString("zh-CN");
  }

  function typeLabel(t) {
    return TYPE_ZH[t] || t;
  }

  /** Collapse legacy ZERO_COV/LOW_COV into side-specific types for display/dedup. */
  function normalizeProblemType(p) {
    const t = p.type || "";
    const g = problemGenome(p);
    if (t === "ZERO_COV") return g === "ref" ? "ZERO_R" : "ZERO_Q";
    if (t === "LOW_COV") return g === "ref" ? "LOW_R" : "LOW_Q";
    return t;
  }

  /** Family used to merge duplicate annotations of the same interval. */
  function problemFamily(p) {
    const t = normalizeProblemType(p);
    if (t === "ZERO_Q" || t === "ZERO_R" || t === "ZERO_COV") return "zero";
    if (t === "LOW_Q" || t === "LOW_R" || t === "LOW_COV" || t === "CRAQ_LOWCOV") return "low";
    if (t === "ATTR_Q" || t === "ATTR_R") return "attr";
    if (CRAQ_TYPES.has(t) || t === "LOW_QV") return "craq";
    if (
      t.startsWith("SYN") || t.startsWith("SYRI") || t === "INV" || t === "TRANS"
      || t === "DUP" || t === "NOTAL" || t === "COLLINEAR"
    ) return "syn";
    return t || "other";
  }

  function problemDedupKey(p) {
    return `${problemGenome(p)}|${p.chrom}|${p.start}|${p.end}|${problemFamily(p)}`;
  }

  /** Prefer side-specific labels (组装零覆盖) over generic 零覆盖. */
  function problemSpecificity(p) {
    const t = p.type || "";
    if (t.endsWith("_Q") || t.endsWith("_R")) return 2;
    if (t === "ZERO_COV" || t === "LOW_COV") return 1;
    return 0;
  }

  function dedupeProblemList(list) {
    const best = new Map();
    list.forEach((p) => {
      const k = problemDedupKey(p);
      const prev = best.get(k);
      if (!prev || problemSpecificity(p) > problemSpecificity(prev)) best.set(k, p);
    });
    return [...best.values()];
  }

  function loadPairScalePrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem("asmlens.pairScale") || "{}") || {};
      if (raw.mode === "mapped" || raw.mode === "same_bp" || raw.mode === "ratio") {
        state.pairScaleMode = raw.mode;
      }
      const r = parseFloat(raw.ratio);
      if (Number.isFinite(r) && r > 0) state.pairScaleRatio = r;
    } catch (_) { /* ignore */ }
  }

  function savePairScalePrefs() {
    localStorage.setItem("asmlens.pairScale", JSON.stringify({
      mode: state.pairScaleMode,
      ratio: state.pairScaleRatio,
    }));
  }

  function loadLowcovPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem("asmlens.lowcov") || "{}") || {};
      if (raw.level === "zero" || raw.level === "low" || raw.level === "all") {
        state.lowcovLevel = raw.level;
      }
      const n = parseInt(raw.minLen, 10);
      if (Number.isFinite(n) && n >= 0) state.lowcovMinLen = n;
    } catch (_) { /* ignore */ }
    syncLowcovFilterUI();
  }

  function saveLowcovPrefs() {
    localStorage.setItem("asmlens.lowcov", JSON.stringify({
      level: state.lowcovLevel,
      minLen: state.lowcovMinLen,
    }));
  }

  function syncLowcovFilterUI() {
    const levelEl = $("lowcovLevel");
    const minEl = $("lowcovMinLen");
    const menuMin = $("minLenFilter");
    if (levelEl) levelEl.value = state.lowcovLevel || "zero";
    if (minEl) minEl.value = String(state.lowcovMinLen ?? 1000);
    if (menuMin) menuMin.value = String(state.lowcovMinLen ?? 1000);
  }

  function isZeroCovType(t) {
    return t === "ZERO_COV" || t === "ZERO_Q" || t === "ZERO_R";
  }

  function isLowCovType(t) {
    return t === "LOW_COV" || t === "LOW_Q" || t === "LOW_R" || t === "CRAQ_LOWCOV";
  }

  function lowcovTypesForLevel(level) {
    const lv = level || state.lowcovLevel || "zero";
    if (lv === "zero") return ["ZERO_COV", "ZERO_Q", "ZERO_R"];
    if (lv === "low") {
      return ["ZERO_COV", "ZERO_Q", "ZERO_R", "LOW_COV", "LOW_Q", "LOW_R", "CRAQ_LOWCOV"];
    }
    return CATEGORY_TYPES.lowcov.slice();
  }

  function lowcovPasses(p) {
    const t = normalizeProblemType(p);
    const len = p.length || Math.max(0, (p.end || 0) - (p.start || 0) + 1);
    const minLen = Math.max(0, state.lowcovMinLen ?? 1000);
    if (len < minLen) return false;
    const lv = state.lowcovLevel || "zero";
    if (lv === "zero") return isZeroCovType(t);
    if (lv === "low") return isZeroCovType(t) || isLowCovType(t);
    return isZeroCovType(t) || isLowCovType(t) || LOWCOV_TYPES.has(p.type || "");
  }

  function invalidateLowcovCaches() {
    Object.keys(state.problemLoadKeys).forEach((k) => {
      if (k.includes("|lowcov") || k.includes("|lowcov|") || /\|lowcov$/.test(k) || k.includes("track|") && k.includes("lowcov")) {
        delete state.problemLoadKeys[k];
      }
      // also clear category keys like Chr01|lowcov
      if (k.endsWith("|lowcov") || k.includes("|lowcov|")) delete state.problemLoadKeys[k];
    });
    // Drop cached overview marks so severity change redraws
    state.overviewMarkCache = {};
  }

  async function applyLowcovFiltersFromUI() {
    const levelEl = $("lowcovLevel");
    const minEl = $("lowcovMinLen");
    state.lowcovLevel = levelEl?.value || "zero";
    const n = parseInt(minEl?.value || "1000", 10);
    state.lowcovMinLen = Number.isFinite(n) && n >= 0 ? n : 1000;
    if ($("minLenFilter")) $("minLenFilter").value = String(state.lowcovMinLen);
    saveLowcovPrefs();
    invalidateLowcovCaches();
    status("正在按覆盖筛选重新加载…");
    await ensureDetailData();
    renderProblemLists();
    await renderAll();
    status(
      state.lowcovLevel === "zero"
        ? `覆盖筛选：仅零覆盖 · ≥${fmt(state.lowcovMinLen)} bp`
        : state.lowcovLevel === "low"
          ? `覆盖筛选：零覆盖+偏低 · ≥${fmt(state.lowcovMinLen)} bp`
          : `覆盖筛选：全部 · ≥${fmt(state.lowcovMinLen)} bp`
    );
  }

  function statusLabel(status, genome) {
    if (!status) return "";
    if (genome === "ref") return STATUS_ZH_REF[status] || STATUS_ZH[status] || status;
    return STATUS_ZH[status] || status;
  }

  function problemSideLabel(p) {
    return problemGenome(p) === "ref" ? "参考" : "组装";
  }

  function activeChromList() {
    if (!state.project) return [];
    if (state.genome === "ref") return state.project.ref_chromosomes || [];
    return state.project.chromosomes || [];
  }

  function chromListOf(genome) {
    if (!state.project) return [];
    if (genome === "ref") return state.project.ref_chromosomes || [];
    return state.project.chromosomes || [];
  }

  function chromLengthOf(id, genome) {
    const c = chromListOf(genome).find((x) => x.id === id);
    return c ? c.length : 0;
  }

  function chromLength(id) {
    return chromLengthOf(id, state.genome);
  }

  function problemGenome(p) {
    const t = p.type || "";
    if (t.endsWith("_R") || t === "ATTR_R" || t === "GAP_R") return "ref";
    if (t.endsWith("_Q") || t === "ATTR_Q" || t === "GAP_Q") return "query";
    // CRAQ / QV default to query unless chrom only exists on ref
    if (CRAQ_TYPES.has(t) || t === "LOW_QV") {
      const inQ = chromListOf("query").some((c) => c.id === p.chrom);
      if (inQ) return "query";
      if (chromListOf("ref").some((c) => c.id === p.chrom)) return "ref";
      return "query";
    }
    // ambiguous types: prefer query if chrom exists there
    const inQ = chromListOf("query").some((c) => c.id === p.chrom);
    const inR = chromListOf("ref").some((c) => c.id === p.chrom);
    if (inQ && !inR) return "query";
    if (inR && !inQ) return "ref";
    return "query";
  }

  function problemsForGenome(genome) {
    return (state.problems || []).filter((p) => problemGenome(p) === genome);
  }

  function currentAttribution() {
    if (!state.selection) return null;
    const p = {
      chrom: state.selection.chrom,
      start: state.selection.start1,
      end: state.selection.end1,
      label: state.selection.name,
    };
    return attrFor(p);
  }

  /** Center a window of given span around mid on chrom of genome; clamp to length. */
  function clampWindow(chrom, genome, mid, span) {
    const L = chromLengthOf(chrom, genome) || 1;
    const width = Math.max(50, Math.floor(span));
    let s = Math.floor(mid - width / 2);
    let e = s + width;
    if (s < 0) { s = 0; e = Math.min(L, width); }
    if (e > L) { e = L; s = Math.max(0, e - width); }
    return { chrom, start: s, end: Math.max(s + 50, e), genome };
  }

  /**
   * Natural mapped peer window (before user scale override).
   * Returns { chrom, start, end, genome, linked?, mapKind }.
   */
  function naturalPeerLocus(genome) {
    if (state.linkedRef && state.linkedRef.chrom) {
      const L = chromLengthOf(state.linkedRef.chrom, genome) || 1;
      if (L > 0) {
        let s = state.linkedRef.start || 0;
        let e = state.linkedRef.end || s + 1;
        if (state.linkedRef.mode !== "window") {
          const f = state.project?.defaults?.flank_bp || 50000;
          s = Math.max(0, s - f);
          e = Math.min(L, e + f);
        } else {
          s = Math.max(0, s);
          e = Math.min(L, Math.max(s + 50, e));
        }
        return {
          chrom: state.linkedRef.chrom,
          start: s,
          end: e,
          genome,
          linked: true,
          mapKind: "linked",
        };
      }
    }
    const Lq = chromLengthOf(state.chrom, state.genome) || 1;
    const Lr = chromLengthOf(state.chrom, genome);
    if (!Lr) return null;
    const s = Math.floor((state.start / Lq) * Lr);
    const e = Math.max(s + 50, Math.ceil((state.end / Lq) * Lr));
    return {
      chrom: state.chrom,
      start: s,
      end: Math.min(Lr, e),
      genome,
      linked: false,
      mapKind: "proportional",
    };
  }

  /** Locus shown for a genome strip (main view dual coverage). */
  function viewLocusFor(genome) {
    if (state.genome === genome) {
      return {
        chrom: state.chrom,
        start: state.start,
        end: state.end,
        genome,
        mapKind: "primary",
      };
    }
    const natural = naturalPeerLocus(genome);
    if (!natural) return null;

    const primarySpan = Math.max(50, state.end - state.start);
    const mid = (natural.start + natural.end) / 2;
    const mode = state.pairScaleMode || "mapped";

    if (mode === "same_bp") {
      return {
        ...clampWindow(natural.chrom, genome, mid, primarySpan),
        linked: !!natural.linked,
        mapKind: natural.mapKind,
        scaleMode: "same_bp",
      };
    }
    if (mode === "ratio") {
      const ratio = Math.max(0.05, Math.min(50, Number(state.pairScaleRatio) || 1));
      return {
        ...clampWindow(natural.chrom, genome, mid, primarySpan * ratio),
        linked: !!natural.linked,
        mapKind: natural.mapKind,
        scaleMode: "ratio",
        scaleRatio: ratio,
      };
    }
    // mapped: keep natural window (may differ in bp span / bp/px)
    return { ...natural, scaleMode: "mapped" };
  }

  function formatBpPerPx(span, widthPx) {
    const w = Math.max(1, widthPx || 1);
    const bpp = span / w;
    if (bpp >= 1000) return `${(bpp / 1000).toFixed(1)} kb/px`;
    if (bpp >= 10) return `${bpp.toFixed(0)} bp/px`;
    return `${bpp.toFixed(1)} bp/px`;
  }

  function pairScaleSummary(qLoc, rLoc, widthPx) {
    if (!qLoc || !rLoc) return "";
    const qSpan = Math.max(1, qLoc.end - qLoc.start);
    const rSpan = Math.max(1, rLoc.end - rLoc.start);
    const ratio = rSpan / qSpan;
    const mapTxt = rLoc.linked ? "映射对应区" : (rLoc.mapKind === "proportional" ? "同源比例映射" : "映射");
    return {
      qSpan,
      rSpan,
      ratio,
      qRes: formatBpPerPx(qSpan, widthPx),
      rRes: formatBpPerPx(rSpan, widthPx),
      mapTxt,
      equal: Math.abs(ratio - 1) < 0.02,
    };
  }

  function setLinkedRefFromAttr(a) {
    if (a && a.primary_other_chrom) {
      const s = parseInt(a.primary_other_start, 10);
      const e = parseInt(a.primary_other_end, 10);
      state.linkedRef = {
        chrom: String(a.primary_other_chrom),
        start: (Number.isFinite(s) ? s : 1) - 1,
        end: Number.isFinite(e) ? e : 0,
        mode: "core",
      };
    } else {
      state.linkedRef = null;
    }
  }

  function isEmptyProject() {
    if (!state.project) return true;
    const chroms = state.project.chromosomes;
    return !(Array.isArray(chroms) && chroms.length > 0);
  }

  function setEmptyState(show) {
    const el = $("emptyState");
    if (!el) return;
    el.hidden = !show;
    el.classList.toggle("is-hidden", !show);
  }

  function trackGenome(tr) {
    if (tr.genome === "ref" || tr.genome === "query") return tr.genome;
    const id = String(tr.id || "");
    const kind = String(tr.kind || "");
    if (id.startsWith("ref_") || kind.endsWith("_R") || kind === "ATTR_R") return "ref";
    return "query";
  }

  function clampView() {
    if (!state.chrom) return;
    const L = chromLength(state.chrom);
    state.start = Math.max(0, Math.floor(state.start));
    state.end = Math.min(L, Math.ceil(state.end));
    if (state.end - state.start < 50) {
      state.end = Math.min(L, state.start + 50);
    }
  }

  function setLocusBox() {
    if (!state.chrom) {
      $("locusInput").value = "";
      $("sbLocus").textContent = "区间：—";
      return;
    }
    $("locusInput").value = `${state.chrom}:${state.start + 1}-${state.end}`;
    const g = state.genome === "ref" ? "参考" : "组装";
    $("sbLocus").textContent = `区间：[${g}] ${state.chrom}:${fmt(state.start + 1)}-${fmt(state.end)}`;
  }

  function parseLocus(text) {
    const m = String(text).trim().match(/^([^:]+):([\d,]+)\s*-\s*([\d,]+)$/);
    if (!m) return null;
    return {
      chrom: m[1],
      start: parseInt(m[2].replace(/,/g, ""), 10) - 1,
      end: parseInt(m[3].replace(/,/g, ""), 10),
    };
  }

  function gotoRegion(chrom, start0, end0, flank) {
    const L = chromLength(chrom);
    if (!L) {
      // maybe chrom belongs to other genome
      const inRef = (state.project.ref_chromosomes || []).some((c) => c.id === chrom);
      if (inRef && state.genome !== "ref") {
        state.genome = "ref";
        $("genomeSelect").value = "ref";
        fillChromSelect();
      }
    }
    const len = chromLength(chrom);
    const f = flank ?? (state.project.defaults?.flank_bp || 50000);
    let s = Math.max(0, start0 - f);
    let e = Math.min(len, end0 + f);
    if (e <= s) e = Math.min(len, s + Math.max(1000, end0 - start0 + 2 * f));
    state.chrom = chrom;
    state.start = s;
    state.end = e;
    $("chromSelect").value = chrom;
    setLocusBox();
    renderAll();
  }

  function attrKey(p) {
    return `${p.chrom}:${p.start}-${p.end}`;
  }

  function attrFor(p) {
    const g = problemGenome(p);
    const k = attrKey(p);
    return state.attribution[`${g}:${k}`]
      || state.attribution[k]
      || state.attribution[p.label]
      || null;
  }

  function selectedAttrStatuses() {
    return [...document.querySelectorAll('#attrChecks input[name="attr"]:checked')].map((el) => el.value);
  }

  function baseFilter(p) {
    const statuses = selectedAttrStatuses();
    // Prefer sidebar lowcovMinLen; keep menu minLenFilter in sync as global floor
    const menuMin = Math.max(0, parseInt($("minLenFilter")?.value || "0", 10) || 0);
    const minLen = Math.max(menuMin, Math.max(0, state.lowcovMinLen ?? 0));
    if ((p.length || 0) < minLen) return false;
    if (categorizeProblem(p) === "lowcov" && !lowcovPasses(p)) return false;
    const a = attrFor(p);
    if (a && a.status && statuses.length && !statuses.includes(a.status)) return false;
    return true;
  }

  function categorizeProblem(p) {
    const t = p.type || "";
    const a = attrFor(p);
    if (t.startsWith("SYN") || t.startsWith("SYRI") || t === "INV" || t === "TRANS" || t === "DUP" || t === "NOTAL") {
      return "synteny";
    }
    if (CRAQ_TYPES.has(t) && t !== "CRAQ_LOWCOV") return "craq";
    if (t === "CRAQ_LOWCOV") return "craq";
    if (LOWCOV_TYPES.has(t)) return "lowcov";
    if (a && REFMAP_STATUSES.has(a.status)) return "refmap";
    if (t === "ATTR_Q" || t === "ATTR_R") return "refmap";
    if (t === "LOW_QV") return "craq";
    return "lowcov";
  }

  function featureAllowsCategory(cat) {
    if (cat === "lowcov") return !!state.features.coverage;
    if (cat === "craq") return !!state.features.craq;
    if (cat === "refmap") return !!state.features.refmap;
    if (cat === "synteny") return !!state.features.synteny;
    return true;
  }

  async function loadAttribution() {
    /* Deprecated full-table load — use ensureAttributionForChroms (lazy by chrom). */
    state.attribution = {};
    state.attrLoadKeys = {};
    $("attrLegend").hidden = true;
  }

  async function loadGapsForChrom(chrom, genome = "query") {
    const key = `${genome}:${chrom}`;
    if (state.gapCache[key]) {
      if (genome === "query") state.gaps = state.gapCache[key];
      return state.gapCache[key];
    }
    const gapTrack = (state.project.tracks || []).find((t) => {
      if (genome === "ref") return t.id === "ref_gaps" || t.kind === "GAP_R";
      return t.id === "query_gaps" || t.kind === "GAP_Q";
    });
    if (!gapTrack) {
      state.gapCache[key] = [];
      if (genome === "query") state.gaps = [];
      return [];
    }
    try {
      const L = chromLengthOf(chrom, genome) || 0;
      const data = await api(
        `/api/tracks/${encodeURIComponent(gapTrack.id)}?chrom=${encodeURIComponent(chrom)}&start=0&end=${L || 1}&limit=50000`
      );
      const feats = data.features || [];
      state.gapCache[key] = feats;
      if (genome === "query") state.gaps = feats;
      return feats;
    } catch (e) {
      state.gapCache[key] = [];
      if (genome === "query") state.gaps = [];
      return [];
    }
  }

  function overviewMarkColor(p) {
    const t = p.type || "";
    if (t === "GAP_Q" || t === "GAP_R") return "#2c3e50";
    if (t === "ZERO_COV" || t === "ZERO_Q" || t === "ZERO_R") return FLAG_COLORS.zero;
    if (CRAQ_TYPES.has(t) && t !== "CRAQ_LOWCOV") return FLAG_COLORS.craq;
    if (t === "CRAQ_LOWCOV" || t === "LOW_QV") return FLAG_COLORS.craq;
    if (t === "LOW_COV" || t === "LOW_Q" || t === "LOW_R") return FLAG_COLORS.low;
    if (t === "ATTR_Q" || t === "ATTR_R") return FLAG_COLORS.attr;
    return "#1a1f24";
  }

  function overviewMarkTrackSpecs(genome) {
    if (genome === "ref") {
      return [
        { match: (t) => t.id === "ref_zero_coverage" || t.kind === "ZERO_R", color: FLAG_COLORS.zero },
        { match: (t) => t.id === "ref_low_coverage" || t.kind === "LOW_R", color: FLAG_COLORS.low },
        { match: (t) => trackGenome(t) === "ref" && (CRAQ_TYPES.has(t.kind) || t.kind === "LOW_QV" || /craq/i.test(t.id || "")), color: FLAG_COLORS.craq },
      ];
    }
    return [
      { match: (t) => t.id === "query_zero_coverage" || t.kind === "ZERO_Q" || t.id === "zero_coverage", color: FLAG_COLORS.zero },
      { match: (t) => t.id === "query_low_coverage" || t.kind === "LOW_Q" || t.id === "low_coverage", color: FLAG_COLORS.low },
      { match: (t) => trackGenome(t) === "query" && (CRAQ_TYPES.has(t.kind) || t.kind === "LOW_QV" || /craq/i.test(t.id || "")), color: FLAG_COLORS.craq },
    ];
  }

  function overviewMarkSpecsForFeatures(genome) {
    const all = overviewMarkTrackSpecs(genome);
    const out = [];
    if (state.features.coverage) {
      const lv = state.lowcovLevel || "zero";
      out.push(...all.filter((s) => s.color === FLAG_COLORS.zero));
      if (lv !== "zero") out.push(...all.filter((s) => s.color === FLAG_COLORS.low));
    }
    if (state.features.craq) {
      out.push(...all.filter((s) => s.color === FLAG_COLORS.craq));
    }
    return out;
  }

  async function loadOverviewMarkTracks(genome, chrom, length) {
    const lv = state.lowcovLevel || "zero";
    const minLen = state.lowcovMinLen ?? 1000;
    const featKey = `c${state.features.coverage ? 1 : 0}q${state.features.craq ? 1 : 0}|${lv}|L${minLen}`;
    const key = `${genome}:${chrom}:${featKey}`;
    if (state.overviewMarkCache[key]) return state.overviewMarkCache[key];
    const out = [];
    const tracks = state.project?.tracks || [];
    const specs = overviewMarkSpecsForFeatures(genome);
    if (!specs.length) {
      state.overviewMarkCache[key] = out;
      return out;
    }
    await Promise.all(specs.map(async (spec) => {
      const tr = tracks.find(spec.match);
      if (!tr || tr.type === "bedgraph") return;
      try {
        const data = await api(
          `/api/tracks/${encodeURIComponent(tr.id)}?chrom=${encodeURIComponent(chrom)}&start=0&end=${length || 1}&limit=20000`
        );
        (data.features || []).forEach((f) => {
          const len = Math.max(1, (f.end || 0) - (f.start || 0));
          if (len < minLen) return;
          out.push({ start: f.start, end: f.end, color: spec.color });
        });
      } catch (_) { /* skip */ }
    }));
    state.overviewMarkCache[key] = out;
    return out;
  }

  function overviewHasFocus() {
    return (state.overviewApplied.query.length + state.overviewApplied.ref.length) > 0;
  }

  function overviewVisibleChroms(genome) {
    const all = chromListOf(genome);
    // Only filter AFTER 确定 (applied). While picking, always show all chroms.
    const sel = state.overviewApplied[genome] || [];
    if (!sel.length) return all;
    const set = new Set(sel);
    const picked = all.filter((c) => set.has(c.id));
    return picked.length ? picked : all;
  }

  function inferTelomereInfo() {
    state.telomereInfo = {};
    chromListOf("query").concat(chromListOf("ref")).forEach((c) => {
      const id = String(c.id || "");
      const isScaf = /^scaffold/i.test(id) || /^contig/i.test(id) || /^utg/i.test(id);
      const isChr = /^chr/i.test(id);
      state.telomereInfo[c.id] = {
        left: !isScaf && isChr,
        right: !isScaf && isChr,
      };
    });
  }

  function telomereEnds(chromId) {
    return state.telomereInfo[chromId] || { left: false, right: false };
  }

  async function ensureTelomereInfo(chromIds) {
    inferTelomereInfo();
    const teloTracks = (state.project?.tracks || []).filter(
      (t) => /telo/i.test(t.id || "") || /telo/i.test(t.name || "") || t.kind === "TELO"
    );
    if (!teloTracks.length) return;
    const scope = chromIds && chromIds.length
      ? chromIds
      : detailChromScope();
    if (!scope.length) return; // whole-genome: name heuristic only, no track scan
    const scopeSet = new Set(scope);
    const jobs = [];
    for (const genome of ["query", "ref"]) {
      for (const c of chromListOf(genome)) {
        if (!scopeSet.has(c.id)) continue;
        for (const tr of teloTracks) {
          if (trackGenome(tr) !== genome && teloTracks.length > 1) continue;
          jobs.push((async () => {
            try {
              const data = await api(
                `/api/tracks/${encodeURIComponent(tr.id)}?chrom=${encodeURIComponent(c.id)}&start=0&end=${c.length}&limit=500`
              );
              if ((data.features || []).length) {
                const pad = Math.max(1000, Math.floor(c.length * 0.002));
                let left = false;
                let right = false;
                data.features.forEach((f) => {
                  if (f.start <= pad) left = true;
                  if (f.end >= c.length - pad) right = true;
                });
                state.telomereInfo[c.id] = { left, right };
              }
            } catch (_) { /* skip */ }
          })());
        }
      }
    }
    if (jobs.length) await Promise.all(jobs);
  }

  function toggleOverviewPick(genome, chromId) {
    const list = (state.overviewPicked[genome] || []).slice();
    const i = list.indexOf(chromId);
    if (i >= 0) list.splice(i, 1);
    else list.push(chromId);
    state.overviewPicked[genome] = list;
    updateOverviewSelChips();
  }

  function updateOverviewSelChips() {
    const paint = (elId, genome) => {
      const el = $(elId);
      if (!el) return;
      el.classList.toggle("is-ref", genome === "ref");
      const chips = el.querySelector(".chips");
      if (!chips) return;
      const sel = state.overviewPicked[genome] || [];
      if (!sel.length) {
        chips.textContent = "未选";
        return;
      }
      chips.innerHTML = sel.map((id) => `<span class="chip">${id}</span>`).join("");
    };
    paint("overviewSelQuery", "query");
    paint("overviewSelRef", "ref");
  }

  async function applyOverviewPick() {
    const q = (state.overviewPicked.query || []).slice();
    const r = (state.overviewPicked.ref || []).slice();
    if (!q.length && !r.length) {
      status("请先点击选择染色体，再点确定");
      return;
    }
    state.overviewApplied = { query: q, ref: r };
    updateOverviewSelChips();
    status("已选定染色体，正在按功能区加载标注…");
    await ensureTelomereInfo([...q, ...r]);
    await ensureDetailData();
    renderProblemLists();
    await drawChromOverview();
    status(
      `已应用：组装[${q.join(",") || "—"}] × 参考[${r.join(",") || "—"}] · 勾选功能区可继续加载`
    );
  }

  async function clearOverviewSelection() {
    state.overviewPicked = { query: [], ref: [] };
    state.overviewApplied = { query: [], ref: [] };
    updateOverviewSelChips();
    renderProblemLists();
    await drawChromOverview();
    status("已恢复全基因组概览（仅共线）");
  }

  async function loadAppInfo() {
    try {
      state.appInfo = await api("/api/version");
      const ver = state.appInfo.version || "1.0.0";
      $("sbVersion").textContent = `AsmLens ${ver}`;
      $("aboutVersion").textContent = ver;
      $("aboutMeaning").textContent = state.appInfo.meaning || "";
      if (state.appInfo.github) $("aboutGithub").href = state.appInfo.github;
      document.title = `AsmLens ${ver}`;
    } catch (e) {
      console.warn(e);
    }
  }

  function showUpdateStatus(info) {
    const sb = $("sbUpdate");
    if (!info || info.error || !info.update_available) {
      sb.textContent = info?.update_available === false ? "更新：已是最新" : "更新：—";
      return;
    }
    const url = info.download_url || info.html_url || "#";
    sb.innerHTML = `有新版本 <a href="${url}" target="_blank" rel="noopener">${info.latest}</a>`;
  }

  async function checkUpdates(manual) {
    if (manual) $("sbUpdate").textContent = "更新：检查中…";
    try {
      const info = await api("/api/updates/check");
      state.updateInfo = info;
      showUpdateStatus(info);
      if (manual) {
        if (info.error) status(`检查更新失败：${info.error}`);
        else if (info.update_available) status(`发现新版本 ${info.latest}`);
        else status(`已是最新版本 ${info.current}`);
      }
    } catch (e) {
      $("sbUpdate").textContent = "更新：—";
      if (manual) status(`检查更新失败：${e.message || e}`);
    }
  }

  function fillChromSelect() {
    const sel = $("chromSelect");
    sel.innerHTML = "";
    activeChromList().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.id}（${fmt(c.length)} bp）`;
      sel.appendChild(opt);
    });
    const hasRef = !!(state.project?.has_ref || (state.project?.ref_chromosomes || []).length);
    $("genomeSelect").disabled = !hasRef;
    if (!hasRef) {
      state.genome = "query";
      $("genomeSelect").value = "query";
    }
    $("overviewRefRow").hidden = !hasRef;
  }

  async function loadProject() {
    status("正在加载工程…");
    state.project = await api("/api/project");
    state.gapCache = {};
    state.selection = null;
    updateSelectionBar();
    const empty = isEmptyProject();
    setEmptyState(empty);
    document.title = empty ? "AsmLens" : `AsmLens — ${state.project.name || "工程"}`;
    $("sbProject").textContent = `工程：${empty ? "未打开" : (state.project.name || "—")}`;

    fillChromSelect();
    state.chrom = activeChromList()[0]?.id || null;
    state.start = 0;
    state.end = state.chrom ? Math.min(chromLength(state.chrom), 500000) : 0;
    if (state.chrom) setLocusBox();
    else {
      $("locusInput").value = "";
      $("sbLocus").textContent = "区间：—";
    }

    // Hierarchical load: do NOT pull all problems / gaps / attribution up front.
    state.problems = [];
    state.problemLoadKeys = {};
    state.attribution = {};
    state.attrLoadKeys = {};
    state.syntenyLinks = null;
    state.syntenyLoading = false;
    state.overviewMarkCache = {};
    state.linkedRef = null;
    state.overviewPicked = { query: [], ref: [] };
    state.overviewApplied = { query: [], ref: [] };
    state.overviewHover = null;
    if (!empty) {
      inferTelomereInfo();
      updateOverviewSelChips();
      $("attrLegend").hidden = true;
    } else {
      state.telomereInfo = {};
      $("attrLegend").hidden = true;
    }

    renderProblemLists();
    if (empty) {
      await renderAll();
      status("请通过「文件 → 打开交付包」加载工程");
    } else {
      status("全基因组概览：加载共线关系…");
      await renderAll(); // chrom bars + synteny only (no annotation dump)
      // Warm detail for the initial locus chrom only (main view), not whole genome
      await ensureDetailData();
      renderProblemLists();
      const n = state.project.problem_count || 0;
      status(
        `共约 ${fmt(n)} 个问题 · 概览仅共线 · 选定染色体并勾选功能区后加载标注`
      );
    }
    emit("onProjectLoaded", state.project);
  }

  function fillProblemChromFilter(problems) {
    const sel = $("problemChromFilter");
    if (!sel) return;
    const prev = state.problemChromFilter || sel.value || "all";
    const chroms = [...new Set(problems.map((p) => p.chrom).filter(Boolean))].sort();
    sel.innerHTML = '<option value="all">全部染色体</option>';
    chroms.forEach((id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      sel.appendChild(opt);
    });
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    else sel.value = "all";
    state.problemChromFilter = sel.value;
  }

  function listFilterPass(p) {
    const g = problemGenome(p);
    if (state.problemGenomeFilter === "query" && g !== "query") return false;
    if (state.problemGenomeFilter === "ref" && g !== "ref") return false;
    if (state.problemChromFilter && state.problemChromFilter !== "all" && p.chrom !== state.problemChromFilter) {
      return false;
    }
    return true;
  }

  function makeProblemButton(p, listBox) {
    const a = attrFor(p);
    const g = problemGenome(p);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.problemKey = `${p.chrom}:${p.start}-${p.end}`;
    btn.dataset.problemLabel = p.label || "";
    const selKey = state.selection?.key;
    const isActive = state.activeProblem === p.label
      || selKey === `${p.chrom}:${p.start}-${p.end}`;
    btn.className = "problem-item" + (isActive ? " active" : "") + (g === "ref" ? " is-ref" : " is-query");
    const statusHtml = a && a.status
      ? `<div class="s ${a.status}">${statusLabel(a.status, g)}</div>`
      : "";
    btn.innerHTML = `<div class="t"><span class="side">${problemSideLabel(p)}</span> ${typeLabel(normalizeProblemType(p))}</div>
      <div class="c">${p.chrom}:${fmt(p.start)}-${fmt(p.end)}</div>
      <div class="m">${fmt(p.length)} bp</div>${statusHtml}`;
    btn.addEventListener("click", () => {
      if (state.genome !== g) {
        state.genome = g;
        $("genomeSelect").value = g;
        fillChromSelect();
      }
      state.activeProblem = p.label;
      setLinkedRefFromAttr(a);
      selectFeature({
        chrom: p.chrom,
        start: p.start - 1,
        end: p.end,
        name: p.label,
        type: p.type,
        source: "sidebar",
      });
      gotoRegion(p.chrom, p.start - 1, p.end);
      showDetail(p, a);
      renderProblemLists();
      scrollProblemListToActive();
    });
    listBox.appendChild(btn);
  }

  function scrollProblemListToActive() {
    const box = $("listAll");
    if (!box) return;
    const active = box.querySelector(".problem-item.active");
    if (active) {
      active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function renderProblemLists() {
    const box = $("listAll");
    const count = $("countAll");
    const scope = detailChromScope();
    const cats = enabledCategories();

    if (box && !cats.length) {
      box.innerHTML = '<div class="m" style="padding:0.55rem">请勾选侧栏「功能区」以加载对应标注</div>';
      if (count) count.textContent = "0";
      return;
    }

    if (box && !scope.length) {
      box.innerHTML = '<div class="m" style="padding:0.55rem">请在概览多选染色体并点「确定」，再按功能区加载问题列表</div>';
      if (count) count.textContent = "0";
      return;
    }

    const scopeSet = new Set(scope);
    const buckets = { lowcov: [], craq: [], refmap: [], synteny: [] };
    state.problems.filter(baseFilter).forEach((p) => {
      if (!scopeSet.has(p.chrom)) return;
      const cat = categorizeProblem(p);
      if (!buckets[cat]) buckets[cat] = [];
      buckets[cat].push(p);
    });
    Object.entries(state.attribution).forEach(([key, a]) => {
      // Prefer genome-prefixed cache keys to avoid double-counting bare duplicates
      if (!key.startsWith("query:") && !key.startsWith("ref:")) return;
      if (!a || !a.status || !a.chrom) return;
      if (!scopeSet.has(a.chrom)) return;
      if (!REFMAP_STATUSES.has(a.status)) return;
      const side = (a._genome === "ref" || key.startsWith("ref:")) ? "ATTR_R" : "ATTR_Q";
      const already = buckets.refmap.some(
        (p) => p.chrom === a.chrom && p.start === a.start && p.end === a.end && p.type === side
      );
      if (already) return;
      if (a.region_id && buckets.refmap.some((p) => p.label === a.region_id)) return;
      const fake = {
        chrom: a.chrom,
        start: a.start,
        end: a.end,
        length: a.length || (a.end - a.start + 1),
        type: side,
        label: a.region_id || `${side}:${a.chrom}:${a.start}-${a.end}`,
      };
      if (!baseFilter(fake)) return;
      buckets.refmap.push(fake);
    });

    const mergedAll = [];
    ["lowcov", "craq", "refmap", "synteny"].forEach((key) => {
      if (!featureAllowsCategory(key)) return;
      buckets[key].forEach((p) => mergedAll.push(p));
    });
    fillProblemChromFilter(mergedAll.length ? mergedAll : scope.map((id) => ({ chrom: id })));
    const merged = dedupeProblemList(mergedAll.filter(listFilterPass));

    if (box) {
      box.innerHTML = "";
      const byChrom = new Map();
      merged.slice(0, 3000).forEach((p) => {
        if (!byChrom.has(p.chrom)) byChrom.set(p.chrom, []);
        byChrom.get(p.chrom).push(p);
      });
      if (count) count.textContent = String(merged.length);
      if (!merged.length) {
        const hint = overviewHasFocus()
          ? "当前选定染色体暂无匹配项 · 可切换功能区类型"
          : "当前染色体暂无已加载标注 · 可在概览多选后点「确定」批量加载";
        box.innerHTML = `<div class="m" style="padding:0.55rem">${hint}</div>`;
      } else {
        [...byChrom.keys()].sort().forEach((chrom) => {
          const head = document.createElement("div");
          head.className = "problem-chrom-head";
          head.textContent = chrom;
          box.appendChild(head);
          byChrom.get(chrom).forEach((p) => makeProblemButton(p, box));
        });
        if (merged.length >= 3000) {
          const more = document.createElement("div");
          more.className = "m";
          more.style.padding = "0.45rem";
          more.textContent = `列表已截断显示前 3000 条（共 ${merged.length}）`;
          box.appendChild(more);
        }
      }
      scrollProblemListToActive();
    }
    [["Lowcov", "lowcov"], ["Craq", "craq"], ["Refmap", "refmap"]].forEach(([name, key]) => {
      const c = $(`count${name}`);
      if (c) c.textContent = String(buckets[key].length);
    });
    $("sbFilter").textContent =
      `列表：${merged.length}（覆盖${buckets.lowcov.length} / CRAQ${buckets.craq.length} / 映射${buckets.refmap.length} / 共线${buckets.synteny.length}）`;
  }

  function showDetail(p, a) {
    const panel = $("detailPanel");
    const body = $("detailBody");
    panel.hidden = false;
    const g = problemGenome(p);
    const lines = [
      `来源: ${g === "ref" ? "参考基因组" : "组装基因组"}`,
      `类型: ${typeLabel(p.type)} (${p.type})`,
      `坐标: ${p.chrom}:${p.start}-${p.end}  (1-based)`,
      `BED: ${p.chrom}:${p.start - 1}-${p.end}  (0-based)`,
      `长度: ${fmt(p.length)} bp`,
      `标签: ${p.label || "—"}`,
    ];
    if (a) {
      lines.push(`映射问题类型: ${statusLabel(a.status, g)}`);
      lines.push(`映射比例: ${a.mapped_frac ?? "-"}`);
      if (a.primary_other_chrom) {
        const otherName = g === "ref" ? "组装对应区" : "参考对应区";
        lines.push(
          `${otherName}: ${a.primary_other_chrom}:${a.primary_other_start}-${a.primary_other_end}`
            + ` (${a.primary_strand || ""}, id=${a.primary_identity || "-"})`
        );
      }
    }
    body.textContent = lines.join("\n");
  }

  function selectFeature(feat) {
    if (!feat) {
      state.selection = null;
      updateSelectionBar();
      return;
    }
    const start1 = (feat.start || 0) + 1;
    const end1 = feat.end || 0;
    const p = state.problems.find(
      (x) => x.chrom === feat.chrom && x.start === start1 && x.end === end1
    ) || {
      chrom: feat.chrom,
      start: start1,
      end: end1,
      length: end1 - start1 + 1,
      type: feat.type || "REGION",
      label: feat.name || "",
    };
    state.selection = {
      key: `${feat.chrom}:${start1}-${end1}`,
      chrom: feat.chrom,
      start0: feat.start,
      end: feat.end,
      start1,
      end1,
      name: feat.name || "",
      type: feat.type || "",
      source: feat.source || "track",
      sourceGenome: feat.sourceGenome || problemGenome(p),
    };
    updateSelectionBar();
    const a = attrFor(p);
    if (feat.source === "sidebar" || feat.source === "coverage-overlay" || feat.source === "overview") {
      setLinkedRefFromAttr(a);
    }
    showDetail(p, a);
    emit("onSelection", state.selection);
  }

  function updateSelectionBar() {
    const bar = $("selectionBar");
    if (!state.selection) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const s = state.selection;
    $("selectionText").textContent =
      `${s.chrom}:${fmt(s.start1)}-${fmt(s.end1)}  (${fmt(s.end1 - s.start1 + 1)} bp)`
      + (s.name ? `  · ${s.name}` : "");
  }

  function niceStep(raw) {
    const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    const n = raw / pow;
    let m = 1;
    if (n > 5) m = 10;
    else if (n > 2) m = 5;
    else if (n > 1) m = 2;
    return m * pow;
  }

  function statusFromName(name) {
    if (!name) return null;
    if (name.startsWith("both_lowcov")) return "both_lowcov";
    if (name.startsWith("mapped_not_lowcov")) return "mapped_not_lowcov";
    if (name.startsWith("unmapped")) return "unmapped";
    return null;
  }

  function drawRuler() {
    const canvas = $("ruler");
    const w = canvas.parentElement.clientWidth;
    canvas.width = w * devicePixelRatio;
    canvas.height = 28 * devicePixelRatio;
    canvas.style.width = w + "px";
    canvas.style.height = "28px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, 28);
    ctx.fillStyle = "#1a1f24";
    ctx.font = "12px ui-monospace, Consolas, monospace";
    const span = Math.max(1, state.end - state.start);
    const nice = niceStep(span / 8);
    const first = Math.ceil(state.start / nice) * nice;
    for (let x = first; x <= state.end; x += nice) {
      const px = ((x - state.start) / span) * w;
      ctx.strokeStyle = "#c5d0da";
      ctx.beginPath();
      ctx.moveTo(px, 18);
      ctx.lineTo(px, 28);
      ctx.stroke();
      ctx.fillText(fmt(x + 1), px + 3, 14);
    }
    ctx.fillStyle = "#5c6b7a";
    ctx.fillText(`${state.genome === "ref" ? "ref" : "query"} · ${state.chrom}`, 6, 14);
    // right boundary marker
    ctx.strokeStyle = "#9aabb8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w - 1, 0);
    ctx.lineTo(w - 1, 28);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  function overviewViewportFor(genome) {
    const loc = viewLocusFor(genome);
    if (loc) return loc;
    if (genome === state.genome) {
      return { chrom: state.chrom, start: state.start, end: state.end };
    }
    return null;
  }

  async function drawChromOverview() {
    const hasRef = !!(state.project.has_ref || (state.project.ref_chromosomes || []).length);
    $("overviewRefRow").hidden = !hasRef;
    const synRow = $("overviewSynRow");
    if (synRow) synRow.hidden = !hasRef;
    const tb = $("overviewToolbar");
    if (tb) tb.hidden = !hasRef;
    await drawOverviewCanvas($("overviewQuery"), overviewVisibleChroms("query"), "query");
    if (hasRef) {
      await drawOverviewCanvas($("overviewRef"), overviewVisibleChroms("ref"), "ref");
      await drawOverviewSynteny();
    }
  }

  function buildOverviewLayout(chroms, w) {
    // Keep inside canvas: side pad + wider inter-chrom gaps
    const pad = 8;
    const gap = chroms.length <= 1 ? 0 : 14;
    const inner = Math.max(40, w - pad * 2);
    const total = chroms.reduce((s, c) => s + c.length, 0) || 1;
    const usable = Math.max(20, inner - gap * Math.max(0, chroms.length - 1));
    let x = pad;
    const layout = [];
    for (const c of chroms) {
      const cw = Math.max(6, (c.length / total) * usable);
      layout.push({ chrom: c, x, w: cw });
      x += cw + gap;
    }
    // Clamp last block so we never paint past the right edge
    if (layout.length) {
      const last = layout[layout.length - 1];
      const maxRight = w - pad;
      if (last.x + last.w > maxRight) last.w = Math.max(4, maxRight - last.x);
    }
    return layout;
  }

  /** Path for chromosome body: elliptical ends if telomere, else square. */
  function chromBodyPath(ctx, x, y, w, h, telo) {
    const rr = Math.min(h / 2, w / 2);
    const rl = telo.left ? rr : 0;
    const rrgt = telo.right ? rr : 0;
    ctx.beginPath();
    if (rl <= 0 && rrgt <= 0) {
      ctx.rect(x, y, w, h);
      return;
    }
    if (rl > 0) {
      ctx.moveTo(x + rl, y);
      ctx.arcTo(x, y, x, y + h, rl);
      ctx.arcTo(x, y + h, x + rl, y + h, rl);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + h);
    }
    if (rrgt > 0) {
      ctx.lineTo(x + w - rrgt, y + h);
      ctx.arcTo(x + w, y + h, x + w, y, rrgt);
      ctx.arcTo(x + w, y, x + w - rrgt, y, rrgt);
    } else {
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w, y);
    }
    ctx.closePath();
  }

  function drawChromBody(ctx, x, y, w, h, fill, stroke, telo) {
    chromBodyPath(ctx, x, y, w, h, telo);
    if (fill && fill !== "transparent") {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    // Telomere range: subtle deepen at each end
    if (telo && (telo.left || telo.right) && w > 4) {
      const band = Math.max(2, Math.min(w * 0.04, h * 0.9));
      ctx.save();
      chromBodyPath(ctx, x, y, w, h, telo);
      ctx.clip();
      ctx.fillStyle = "rgba(0,0,0,0.11)";
      if (telo.left) ctx.fillRect(x, y, band, h);
      if (telo.right) ctx.fillRect(x + w - band, y, band, h);
      ctx.restore();
    }
    if (stroke && stroke !== "transparent") {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  async function drawOverviewCanvas(canvas, chroms, genome) {
    if (!canvas) return;
    const parentW = canvas.parentElement?.clientWidth || 400;
    const w = Math.max(80, parentW - 4);
    const h = 44;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.width = "100%";
    canvas.style.maxWidth = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f4f7fa";
    ctx.fillRect(0, 0, w, h);
    if (!chroms.length) {
      canvas._layout = [];
      canvas._genome = genome;
      return;
    }

    const layout = buildOverviewLayout(chroms, w);
    // Highlight picked chroms (before 确定); applied filter already shrunk chroms list
    const selected = new Set(state.overviewPicked[genome] || []);
    const hoverId = state.overviewHover?.genome === genome ? state.overviewHover.id : null;
    const barY = 11;
    const barH = 22;
    const problemHits = [];

    for (const block of layout) {
      const { chrom: c, x, w: cw } = block;
      const telo = telomereEnds(c.id);
      const isSel = selected.has(c.id);
      const isHov = hoverId === c.id;
      let fill = genome === "ref" ? "#c8e6c9" : "#bbdefb";
      let stroke = genome === "ref" ? "#81c784" : "#90caf9";
      if (isSel) {
        fill = genome === "ref" ? "#81c784" : "#64b5f6";
        stroke = genome === "ref" ? "#2e7d32" : "#1565c0";
      }
      if (isHov) {
        // floating highlight
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.28)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;
        drawChromBody(ctx, x - 1, barY - 2, cw + 2, barH + 4, fill, "#fff", telo);
        ctx.restore();
        stroke = "#e67e22";
      }
      drawChromBody(ctx, x, barY, cw, barH, fill, stroke, telo);
      if (isSel) {
        chromBodyPath(ctx, x, barY, cw, barH, telo);
        ctx.strokeStyle = "#e67e22";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      // Whole-genome mode: chrom bodies + synteny only (no annotation flood).
      // After 确定: paint marks for enabled feature categories on focused chroms.
      const showMarks = overviewHasFocus();
      if (showMarks) {
        ctx.save();
        chromBodyPath(ctx, x, barY, cw, barH, telo);
        ctx.clip();

        let gaps = state.gapCache[`${genome}:${c.id}`];
        if (!gaps) gaps = await loadGapsForChrom(c.id, genome);
        (gaps || []).forEach((g) => {
          const gx1 = x + (g.start / c.length) * cw;
          const gx2 = x + (g.end / c.length) * cw;
          ctx.fillStyle = "#2c3e50";
          ctx.fillRect(gx1, barY, Math.max(1.5, gx2 - gx1), barH);
        });

        const paintMark = (s0, e0, color, problem) => {
          const gx1 = x + (s0 / c.length) * cw;
          const gx2 = x + (e0 / c.length) * cw;
          const bw = Math.max(2, gx2 - gx1);
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(gx1, barY, bw, barH);
          ctx.globalAlpha = 1;
          if (problem) {
            problemHits.push({
              x1: gx1, x2: gx1 + bw, y1: barY, y2: barY + barH,
              problem, genome, chrom: c.id,
            });
            const selKey = state.selection?.key;
            const isSelMark = state.activeProblem === problem.label
              || selKey === `${problem.chrom}:${problem.start}-${problem.end}`;
            if (isSelMark) {
              ctx.strokeStyle = FLAG_COLORS.select;
              ctx.lineWidth = 2;
              ctx.strokeRect(gx1 - 1, barY - 2, bw + 2, barH + 4);
              ctx.lineWidth = 1;
            }
          }
        };

        const chromProblems = problemsForGenome(genome).filter((p) => {
          if (p.chrom !== c.id) return false;
          const cat = categorizeProblem(p);
          if (!featureAllowsCategory(cat)) return false;
          if (cat === "lowcov" && !lowcovPasses(p)) return false;
          return true;
        });
        const stepP = chromProblems.length > OVERVIEW_MARK_CAP
          ? Math.ceil(chromProblems.length / OVERVIEW_MARK_CAP) : 1;
        for (let i = 0; i < chromProblems.length; i += stepP) {
          const p = chromProblems[i];
          paintMark((p.start || 1) - 1, p.end || p.start, overviewMarkColor(p), p);
        }

        if (state.features.coverage || state.features.craq) {
          const markFeats = await loadOverviewMarkTracks(genome, c.id, c.length);
          const stepM = markFeats.length > OVERVIEW_MARK_CAP
            ? Math.ceil(markFeats.length / OVERVIEW_MARK_CAP) : 1;
          for (let i = 0; i < markFeats.length; i += stepM) {
            const m = markFeats[i];
            const already = problemHits.some(
              (h) => h.chrom === c.id && h.problem
                && Math.abs(((h.problem.start || 1) - 1) - m.start) < 2
                && Math.abs((h.problem.end || 0) - m.end) < 2
            );
            if (already) {
              paintMark(m.start, m.end, m.color, null);
              continue;
            }
            const stub = {
              chrom: c.id,
              start: (m.start || 0) + 1,
              end: m.end || m.start,
              length: Math.max(1, (m.end || 0) - (m.start || 0)),
              type: genome === "ref" ? "LOW_R" : "LOW_Q",
              label: `${genome === "ref" ? "REF" : "ASM"}:${c.id}:${m.start}-${m.end}`,
            };
            paintMark(m.start, m.end, m.color, stub);
          }
        }
        ctx.restore();
      }

      // orange viewport box
      const vp = overviewViewportFor(genome);
      if (vp && vp.chrom === c.id) {
        const vx1 = x + (vp.start / c.length) * cw;
        const vx2 = x + (vp.end / c.length) * cw;
        ctx.strokeStyle = "#e67e22";
        ctx.fillStyle = "rgba(230, 126, 34, 0.2)";
        ctx.lineWidth = 2;
        const bw = Math.max(3, vx2 - vx1);
        ctx.fillRect(vx1, barY - 3, bw, barH + 6);
        ctx.strokeRect(vx1, barY - 3, bw, barH + 6);
        ctx.lineWidth = 1;
      }

      if (cw > 22) {
        ctx.fillStyle = "#1a1f24";
        ctx.font = "10px sans-serif";
        ctx.fillText(c.id, x + 4, barY + 15);
      }
    }
    canvas._layout = layout;
    canvas._genome = genome;
    canvas._problemHits = problemHits;
  }

  function parseSyntenyName(name) {
    // syn_Chr01:123-456+  or syn_Chr01:123-456-
    const m = String(name || "").match(/^syn_([^:]+):(\d+)-(\d+)([+-])?/);
    if (!m) return null;
    return {
      chrom: m[1],
      start: parseInt(m[2], 10),
      end: parseInt(m[3], 10),
      strand: m[4] || "+",
    };
  }

  async function ensureSyntenyLinks() {
    if (state.syntenyLinks) return state.syntenyLinks;
    if (state.syntenyLoading) {
      // Wait briefly for in-flight load
      for (let i = 0; i < 100 && state.syntenyLoading; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (state.syntenyLinks) return state.syntenyLinks;
    }
    const tr = (state.project.tracks || []).find(
      (t) => t.id === "synteny_query"
        || (t.kind === "COLLINEAR" && trackGenome(t) === "query")
        || ((t.id || "").includes("synteny") && trackGenome(t) === "query")
    );
    const links = [];
    if (!tr) {
      state.syntenyLinks = links;
      return links;
    }
    state.syntenyLoading = true;
    try {
      const chroms = chromListOf("query");
      const batchSize = 8;
      for (let i = 0; i < chroms.length; i += batchSize) {
        const batch = chroms.slice(i, i + batchSize);
        await Promise.all(batch.map(async (c) => {
          try {
            const data = await api(
              `/api/tracks/${encodeURIComponent(tr.id)}?chrom=${encodeURIComponent(c.id)}&start=0&end=${c.length}&limit=8000`
            );
            (data.features || []).forEach((f) => {
              const other = parseSyntenyName(f.name);
              if (!other) return;
              links.push({
                qChrom: c.id,
                qStart: f.start,
                qEnd: f.end,
                rChrom: other.chrom,
                rStart: other.start,
                rEnd: other.end,
                strand: other.strand,
              });
            });
          } catch (_) { /* skip */ }
        }));
      }
      // downsample long lists for overview drawing
      if (links.length > 4000) {
        const step = Math.ceil(links.length / 4000);
        state.syntenyLinks = links.filter((_, i) => i % step === 0);
      } else {
        state.syntenyLinks = links;
      }
    } finally {
      state.syntenyLoading = false;
    }
    return state.syntenyLinks;
  }

  async function drawOverviewSynteny() {
    const canvas = $("overviewSynteny");
    const qCanvas = $("overviewQuery");
    const rCanvas = $("overviewRef");
    if (!canvas || !qCanvas?._layout || !rCanvas?._layout) return;
    const w = Math.max(80, (qCanvas.parentElement?.clientWidth || 400) - 4);
    // taller in "all" mode so GenomeSyn2.figure2-style cross-chrom ribbons are readable
    const h = overviewHasFocus() ? 56 : 72;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fbfcfd";
    ctx.fillRect(0, 0, w, h);

    const qLayout = qCanvas._layout;
    const rLayout = rCanvas._layout;
    const qMap = Object.fromEntries(qLayout.map((b) => [b.chrom.id, b]));
    const rMap = Object.fromEntries(rLayout.map((b) => [b.chrom.id, b]));

    let links = await ensureSyntenyLinks();
    // After 确定: keep ribbons whose ends are in the applied sets (1-to-many OK).
    // Empty set on a side means "any chrom on that side".
    const qSel = state.overviewApplied.query || [];
    const rSel = state.overviewApplied.ref || [];
    if (qSel.length || rSel.length) {
      const qSet = new Set(qSel);
      const rSet = new Set(rSel);
      links = links.filter((lnk) => {
        if (qSel.length && !qSet.has(lnk.qChrom)) return false;
        if (rSel.length && !rSet.has(lnk.rChrom)) return false;
        return true;
      });
    }

    const drawRibbon = (qa, qb, ra, rb, color, alpha) => {
      ctx.beginPath();
      ctx.moveTo(qa, 1);
      ctx.lineTo(qb, 1);
      ctx.bezierCurveTo(qb, h * 0.4, rb, h * 0.6, rb, h - 1);
      ctx.lineTo(ra, h - 1);
      ctx.bezierCurveTo(ra, h * 0.6, qa, h * 0.4, qa, 1);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    // Draw same-chrom first (blue), then cross-chrom on top (orange) — figure2 style
    const same = [];
    const cross = [];
    if (links.length) {
      links.forEach((lnk) => {
        (lnk.qChrom === lnk.rChrom ? same : cross).push(lnk);
      });
    } else {
      Object.keys(qMap).forEach((id) => {
        if (!rMap[id]) return;
        same.push({
          qChrom: id, qStart: 0, qEnd: qMap[id].chrom.length,
          rChrom: id, rStart: 0, rEnd: rMap[id].chrom.length,
          strand: "+",
        });
      });
    }

    const paint = (list, color, alpha) => {
      list.forEach((lnk) => {
        const qb = qMap[lnk.qChrom];
        const rb = rMap[lnk.rChrom];
        if (!qb || !rb) return;
        const qa = qb.x + (lnk.qStart / qb.chrom.length) * qb.w;
        const qe = qb.x + (lnk.qEnd / qb.chrom.length) * qb.w;
        const ra = rb.x + (lnk.rStart / rb.chrom.length) * rb.w;
        const re = rb.x + (lnk.rEnd / rb.chrom.length) * rb.w;
        const inv = lnk.strand === "-";
        drawRibbon(
          Math.min(qa, qe), Math.max(qa, qe),
          inv ? Math.max(ra, re) : Math.min(ra, re),
          inv ? Math.min(ra, re) : Math.max(ra, re),
          color,
          alpha
        );
      });
    };
    paint(same, "#5dade2", 0.2);
    paint(cross, "#e67e22", 0.28);

    if (cross.length && !overviewHasFocus()) {
      ctx.fillStyle = "#a04000";
      ctx.font = "10px sans-serif";
      ctx.fillText(`跨染色体共线 ${cross.length} 段（可能错装）`, 6, h - 6);
    }
  }

  function hitOverviewLayout(canvas, clientX) {
    const layout = canvas._layout;
    if (!layout) return null;
    const rect = canvas.getBoundingClientRect();
    // Map CSS pixels → layout coords (canvas may be scaled by style width 100%)
    const scaleX = (canvas.width / devicePixelRatio) / Math.max(1, rect.width);
    const px = (clientX - rect.left) * scaleX;
    const hit = layout.find((b) => px >= b.x && px <= b.x + b.w);
    if (!hit) return null;
    const frac = (px - hit.x) / hit.w;
    const pos = Math.floor(frac * hit.chrom.length);
    return { block: hit, px, pos: Math.max(0, Math.min(hit.chrom.length - 1, pos)) };
  }

  function bindOverviewInteract(canvas) {
    if (!canvas || canvas._overviewBound) return;
    canvas._overviewBound = true;
    let moved = false;
    let pickPending = null;

    canvas.addEventListener("pointerdown", (ev) => {
      const hit = hitOverviewLayout(canvas, ev.clientX);
      if (!hit) return;
      const genome = canvas._genome;
      const chromId = hit.block.chrom.id;
      moved = false;
      pickPending = null;

      // Click on a problem mark → select it (works for query & ref)
      const scaleX = (canvas.width / devicePixelRatio) / Math.max(1, canvas.getBoundingClientRect().width);
      const px = (ev.clientX - canvas.getBoundingClientRect().left) * scaleX;
      const py = (ev.clientY - canvas.getBoundingClientRect().top)
        * ((canvas.height / devicePixelRatio) / Math.max(1, canvas.getBoundingClientRect().height));
      const hits = canvas._problemHits || [];
      const ph = hits.find((h) => px >= h.x1 && px <= h.x2 && py >= h.y1 && py <= h.y2);
      if (ph && ph.problem) {
        const p = ph.problem;
        const a = attrFor(p);
        if (state.genome !== genome) {
          state.genome = genome;
          $("genomeSelect").value = genome;
          fillChromSelect();
        }
        state.activeProblem = p.label;
        setLinkedRefFromAttr(a);
        selectFeature({
          chrom: p.chrom,
          start: (p.start || 1) - 1,
          end: p.end,
          name: p.label,
          type: p.type,
          source: "overview",
        });
        gotoRegion(p.chrom, (p.start || 1) - 1, p.end);
        showDetail(p, a);
        renderProblemLists();
        scrollProblemListToActive();
        return;
      }

      // Default click = multi-pick highlight only (no filter until 确定).
      // Drag = navigate orange viewport. Alt+click also starts drag immediately.
      pickPending = { genome, chromId };
      canvas.setPointerCapture(ev.pointerId);
      const span = Math.max(50, state.end - state.start);
      state.overviewDrag = {
        genome,
        chrom: chromId,
        length: hit.block.chrom.length,
        span,
        originX: ev.clientX,
        pos0: hit.pos,
        navigate: !!(ev.altKey),
      };
      if (ev.altKey) {
        // Alt+click/drag: jump viewport without changing pick set
        state.genome = genome;
        $("genomeSelect").value = state.genome;
        fillChromSelect();
        state.chrom = chromId;
        const half = Math.floor(span / 2);
        state.start = Math.max(0, hit.pos - half);
        state.end = Math.min(hit.block.chrom.length, state.start + span);
        if (state.end - state.start < span) {
          state.start = Math.max(0, state.end - span);
        }
        $("chromSelect").value = state.chrom;
        setLocusBox();
        drawChromOverview();
      }
    });

    canvas.addEventListener("pointermove", (ev) => {
      if (state.overviewDrag) {
        if (Math.abs(ev.clientX - state.overviewDrag.originX) > 4) {
          moved = true;
          // First drag movement → switch from pick to navigate
          if (!state.overviewDrag.navigate) {
            state.overviewDrag.navigate = true;
            const genome = state.overviewDrag.genome;
            const chromId = state.overviewDrag.chrom;
            state.genome = genome;
            $("genomeSelect").value = state.genome;
            fillChromSelect();
            state.chrom = chromId;
            $("chromSelect").value = state.chrom;
            const half = Math.floor(state.overviewDrag.span / 2);
            state.start = Math.max(0, state.overviewDrag.pos0 - half);
            state.end = Math.min(state.overviewDrag.length, state.start + state.overviewDrag.span);
            if (state.end - state.start < state.overviewDrag.span) {
              state.start = Math.max(0, state.end - state.overviewDrag.span);
            }
            setLocusBox();
          }
        }
        if (!state.overviewDrag.navigate) return;
        const hit = hitOverviewLayout(canvas, ev.clientX);
        if (!hit || hit.block.chrom.id !== state.overviewDrag.chrom) return;
        const span = state.overviewDrag.span;
        const half = Math.floor(span / 2);
        state.start = Math.max(0, hit.pos - half);
        state.end = Math.min(state.overviewDrag.length, state.start + span);
        if (state.end - state.start < span) {
          state.start = Math.max(0, state.end - span);
        }
        setLocusBox();
        drawChromOverview();
        return;
      }
      // hover highlight (floating)
      const hit = hitOverviewLayout(canvas, ev.clientX);
      const next = hit ? { genome: canvas._genome, id: hit.block.chrom.id } : null;
      const same = (!!state.overviewHover === !!next)
        && state.overviewHover?.genome === next?.genome
        && state.overviewHover?.id === next?.id;
      if (!same) {
        state.overviewHover = next;
        drawChromOverview();
      }
    });

    canvas.addEventListener("pointerleave", () => {
      if (state.overviewHover?.genome === canvas._genome) {
        state.overviewHover = null;
        drawChromOverview();
      }
    });

    canvas.addEventListener("pointerup", () => {
      if (!state.overviewDrag) return;
      const drag = state.overviewDrag;
      state.overviewDrag = null;
      if (!moved && pickPending && !drag.navigate) {
        // Click without drag → toggle pick highlight (stay in full-chrom layout)
        toggleOverviewPick(pickPending.genome, pickPending.chromId);
        drawChromOverview();
        const nq = state.overviewPicked.query.length;
        const nr = state.overviewPicked.ref.length;
        status(
          nq || nr
            ? `已高亮 组装[${state.overviewPicked.query.join(",") || "—"}] × 参考[${state.overviewPicked.ref.join(",") || "—"}] · 点「确定」查看共线`
            : "已取消高亮"
        );
        pickPending = null;
        return;
      }
      pickPending = null;
      renderAll();
      if (moved) status(`视图 ${state.chrom}:${fmt(state.start + 1)}-${fmt(state.end)}`);
    });

    canvas.addEventListener("pointercancel", () => {
      state.overviewDrag = null;
      pickPending = null;
    });
  }

  function trackSection(tr) {
    const kind = tr.kind || "";
    const style = tr.style || "";
    const id = String(tr.id || "");
    if (tr.type === "bedgraph" || style === "igv_coverage" || kind.startsWith("COV")) {
      return "coverage";
    }
    if (kind === "GAP_Q" || id === "query_gaps") return "cyto";
    if (OVERLAY_KINDS.has(kind) || tr.ui === "overlay" || tr.hidden) return "overlay";
    if (
      kind.startsWith("SYN") || kind.startsWith("SYRI") || kind === "INV" || kind === "TRANS"
      || kind === "DUP" || kind === "NOTAL" || kind === "COLLINEAR"
      || id.includes("syri") || id.includes("synteny") || id.includes("genomesyn")
    ) {
      return "synteny";
    }
    if (CRAQ_TYPES.has(kind) || kind === "LOW_QV") return "craq";
    return "features";
  }

  function coverageDisplayName(tr) {
    if (state.genome === "ref") return "Reads 覆盖（参考）";
    return "Reads 覆盖（组装）";
  }

  function problemsInView(locus) {
    const loc = locus || { chrom: state.chrom, start: state.start, end: state.end, genome: state.genome };
    const g = loc.genome || state.genome;
    return problemsForGenome(g).filter((p) => {
      if (p.chrom !== loc.chrom) return false;
      const s0 = (p.start || 1) - 1;
      const e0 = p.end || 0;
      return e0 > loc.start && s0 < loc.end;
    });
  }

  function flagKind(p) {
    const t = p.type || "";
    if (t === "ZERO_COV" || t === "ZERO_Q" || t === "ZERO_R") return "zero";
    if (CRAQ_TYPES.has(t) && t !== "CRAQ_LOWCOV") return "craq";
    if (t === "ATTR_Q" || t === "ATTR_R") return "attr";
    return "low";
  }

  function flagColor(p) {
    const a = attrFor(p);
    if (a && a.status && STATUS_COLOR[a.status]) return STATUS_COLOR[a.status];
    return FLAG_COLORS[flagKind(p)] || FLAG_COLORS.low;
  }

  function buildOverlayFeatures(locus) {
    const out = [];
    problemsInView(locus).forEach((p) => {
      const t = p.type || "";
      // CRAQ-only shown as overlay when craq feature on; always fold coverage issues into cov track
      if (CRAQ_TYPES.has(t) && t !== "CRAQ_LOWCOV" && !state.features.craq) return;
      if (!LOWCOV_TYPES.has(t) && t !== "ATTR_Q" && t !== "ATTR_R" && !CRAQ_TYPES.has(t)) return;
      if ((isZeroCovType(t) || isLowCovType(t) || LOWCOV_TYPES.has(t)) && !lowcovPasses(p)) return;
      out.push({
        start: (p.start || 1) - 1,
        end: p.end,
        name: p.label || typeLabel(t),
        type: t,
        color: flagColor(p),
        problem: p,
      });
    });
    return out;
  }

  function findCoverageTrack(genome) {
    const list = (state.project.tracks || []).filter((tr) => {
      if (trackGenome(tr) !== genome) return false;
      return tr.type === "bedgraph" || tr.style === "igv_coverage" || (tr.kind || "").startsWith("COV");
    });
    return list[0] || null;
  }

  async function renderAll() {
    if (!state.project || isEmptyProject() || !state.chrom) {
      setEmptyState(true);
      const host = $("tracks");
      if (host) host.innerHTML = "";
      state.lastTrackData = [];
      hideHoverTip();
      return;
    }
    setEmptyState(false);
    clampView();
    setLocusBox();
    // Lazy: pull annotations only for current / focused chroms + enabled features
    await ensureDetailData();
    await drawChromOverview();
    drawRuler();

    const host = $("tracks");
    host.innerHTML = "";
    state.lastTrackData = [];

    let tracks = (state.project.tracks || []).filter((tr) => trackGenome(tr) === state.genome);
    // plugin-contributed tracks
    window.AsmLens.plugins.forEach((p) => {
      if (typeof p.contributeTracks === "function") {
        try {
          const extra = p.contributeTracks(state.project) || [];
          tracks = tracks.concat(extra.filter((tr) => trackGenome(tr) === state.genome));
        } catch (e) { console.warn(e); }
      }
    });

    const hasRef = !!(state.project.has_ref || (state.project.ref_chromosomes || []).length);
    const groups = [
      { id: "cyto", title: "染色体结构 / Gap" },
      { id: "coverage", title: "Reads 覆盖" },
      { id: "synteny", title: "共线性 / 结构变异" },
      { id: "craq", title: "CRAQ / QV" },
      { id: "features", title: "其他标注" },
    ];
    for (const g of groups) {
      if (g.id === "craq" && !state.features.craq) continue;
      if (g.id === "synteny" && !state.features.synteny) continue;

      // Dual coverage: assembly (top) + reference (bottom) at once
      if (g.id === "coverage" && hasRef) {
        const head = document.createElement("div");
        head.className = "track-section-head";
        head.textContent = "Reads 覆盖（组装 + 参考）";
        host.appendChild(head);
        const legend = document.createElement("div");
        legend.className = "cov-legend";
        legend.innerHTML =
          `<span><i style="background:${FLAG_COLORS.zero}"></i>零覆盖</span>`
          + `<span><i style="background:${FLAG_COLORS.low}"></i>覆盖偏低</span>`
          + `<span><i style="background:${FLAG_COLORS.attr}"></i>映射问题</span>`
          + (state.features.craq ? `<span><i style="background:${FLAG_COLORS.craq}"></i>CRAQ</span>` : "");
        host.appendChild(legend);

        const qLoc = viewLocusFor("query");
        const rLoc = viewLocusFor("ref");
        const approxW = Math.max(100, (host.clientWidth || 800) - 120);
        const scaleInfo = pairScaleSummary(qLoc, rLoc, approxW);

        const scaleBar = document.createElement("div");
        scaleBar.className = "cov-pair-scale";
        scaleBar.innerHTML = `
          <div class="cov-scale-row">
            <label>对侧缩放
              <select id="pairScaleMode">
                <option value="mapped">映射窗口（默认）</option>
                <option value="same_bp">等碱基数（同 bp/px）</option>
                <option value="ratio">自定义跨度比</option>
              </select>
            </label>
            <label class="cov-ratio-field">参考/组装 跨度比
              <input id="pairScaleRatio" type="number" min="0.05" max="50" step="0.01" />
            </label>
            <button type="button" id="btnPairScaleApply" class="linkish">应用</button>
          </div>
          <div class="cov-scale-meta" id="pairScaleMeta"></div>
        `;
        host.appendChild(scaleBar);
        const modeEl = scaleBar.querySelector("#pairScaleMode");
        const ratioEl = scaleBar.querySelector("#pairScaleRatio");
        if (modeEl) modeEl.value = state.pairScaleMode || "mapped";
        if (ratioEl) {
          ratioEl.value = String(state.pairScaleRatio || 1);
          ratioEl.disabled = (state.pairScaleMode || "mapped") !== "ratio";
        }
        modeEl?.addEventListener("change", () => {
          if (ratioEl) ratioEl.disabled = modeEl.value !== "ratio";
        });
        scaleBar.querySelector("#btnPairScaleApply")?.addEventListener("click", () => {
          state.pairScaleMode = modeEl?.value || "mapped";
          const r = parseFloat(ratioEl?.value || "1");
          state.pairScaleRatio = Number.isFinite(r) && r > 0 ? r : 1;
          savePairScalePrefs();
          renderAll();
        });

        const meta = scaleBar.querySelector("#pairScaleMeta");
        if (meta && scaleInfo) {
          const warn = scaleInfo.equal
            ? "上下分辨率一致，框宽可直接对比"
            : "上下 bp/px 不同：实线/虚线框像素宽度不可直接当长度比；可改用「等碱基数」";
          meta.innerHTML =
            `组装窗口 ${qLoc ? `${qLoc.chrom}:${fmt(qLoc.start + 1)}-${fmt(qLoc.end)}` : "—"}`
            + ` · ${fmt(scaleInfo.qSpan)} bp · ${scaleInfo.qRes}<br/>`
            + (rLoc
              ? `参考窗口 ${rLoc.chrom}:${fmt(rLoc.start + 1)}-${fmt(rLoc.end)}`
                + ` · ${fmt(scaleInfo.rSpan)} bp · ${scaleInfo.rRes}`
                + ` · 跨度比 ${scaleInfo.ratio.toFixed(3)}×（${scaleInfo.mapTxt}）`
              : "参考窗口：无对应染色体")
            + `<br/><span class="cov-scale-hint">${warn}</span>`;
        } else if (meta) {
          meta.textContent = "参考窗口：无对应染色体";
        }

        for (const genome of ["query", "ref"]) {
          const tr = findCoverageTrack(genome);
          const loc = viewLocusFor(genome);
          if (!tr || !loc) continue;
          const overlays = buildOverlayFeatures(loc);
          const row = document.createElement("div");
          row.className = "track-row " + (genome === "ref" ? "is-paired-ref" : "is-paired-query");
          const span = Math.max(1, loc.end - loc.start);
          const label = genome === "ref" ? "Reads 覆盖（参考）" : "Reads 覆盖（组装）";
          row.innerHTML =
            `<div class="track-label"><strong>${label}</strong>`
            + `${loc.chrom}:${fmt(loc.start + 1)}-${fmt(loc.end)}`
            + `<span class="track-res">${fmt(span)} bp</span></div>`;
          const canvas = document.createElement("canvas");
          canvas.className = "track-canvas cov-track";
          const h = Math.max(tr.height || 0, 140);
          row.appendChild(canvas);
          host.appendChild(row);
          const drawn = await drawTrack(canvas, tr, h, overlays, loc);
          const wpx = canvas.clientWidth || approxW;
          const resEl = row.querySelector(".track-res");
          if (resEl) resEl.textContent = `${fmt(span)} bp · ${formatBpPerPx(span, wpx)}`;
          state.lastTrackData.push({ track: tr, height: h, width: wpx, data: drawn, locus: loc });
          bindTrackInteract(canvas, tr, drawn, h, loc);
        }
        continue;
      }

      let list = tracks.filter((tr) => trackSection(tr) === g.id);
      if (g.id === "coverage") {
        list = list.filter((tr) => tr.type === "bedgraph" || tr.style === "igv_coverage" || (tr.kind || "").startsWith("COV"));
        if (list.length > 1) list = [list[0]];
      }
      if (!list.length) continue;
      const head = document.createElement("div");
      head.className = "track-section-head";
      head.textContent = g.title;
      host.appendChild(head);
      if (g.id === "coverage") {
        const legend = document.createElement("div");
        legend.className = "cov-legend";
        legend.innerHTML =
          `<span><i style="background:${FLAG_COLORS.zero}"></i>零覆盖</span>`
          + `<span><i style="background:${FLAG_COLORS.low}"></i>覆盖偏低</span>`
          + `<span><i style="background:${FLAG_COLORS.attr}"></i>映射问题</span>`
          + (state.features.craq ? `<span><i style="background:${FLAG_COLORS.craq}"></i>CRAQ</span>` : "");
        host.appendChild(legend);
      }
      const overlays = buildOverlayFeatures();
      for (const tr of list) {
        const row = document.createElement("div");
        row.className = "track-row";
        const label = g.id === "coverage" ? coverageDisplayName(tr) : tr.name;
        const kindZh = g.id === "coverage" ? "HiFi / 其它测序深度" : (typeLabel(tr.kind) || tr.kind || tr.type || "");
        row.innerHTML = `<div class="track-label"><strong>${label}</strong>${kindZh}</div>`;
        const canvas = document.createElement("canvas");
        canvas.className = "track-canvas" + (g.id === "coverage" ? " cov-track" : "");
        const h = g.id === "coverage" ? Math.max(tr.height || 0, 168) : (tr.height || 36);
        row.appendChild(canvas);
        host.appendChild(row);
        const drawn = await drawTrack(canvas, tr, h, g.id === "coverage" ? overlays : null);
        state.lastTrackData.push({ track: tr, height: h, width: canvas.clientWidth, data: drawn });
        bindTrackInteract(canvas, tr, drawn, h);
      }
    }
    emit("onViewRendered", { chrom: state.chrom, start: state.start, end: state.end, genome: state.genome });
  }

  async function drawTrack(canvas, tr, height, overlays, locus) {
    const loc = locus || { chrom: state.chrom, start: state.start, end: state.end };
    const w = canvas.parentElement.clientWidth - 4;
    canvas.width = Math.max(100, w) * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.width = Math.max(100, w) + "px";
    canvas.style.height = height + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = "#fafcfd";
    ctx.fillRect(0, 0, w, height);

    const q = `/api/tracks/${encodeURIComponent(tr.id)}?chrom=${encodeURIComponent(loc.chrom)}&start=${loc.start}&end=${loc.end}&limit=20000`;
    let data;
    try {
      data = await api(q);
    } catch (e) {
      ctx.fillStyle = "#c0392b";
      ctx.fillText(String(e.message || e), 8, 18);
      return { features: [], overlays: [], type: tr.type, error: String(e.message || e), locus: loc };
    }
    const span = Math.max(1, loc.end - loc.start);
    const color = tr.color || "#0b6e99";
    const feats = data.features || [];

    if (tr.type === "bedgraph" || tr.style === "igv_coverage") {
      // temporarily align drawIgvCoverage selection math to this locus via state snapshot
      const snap = { chrom: state.chrom, start: state.start, end: state.end };
      state.chrom = loc.chrom;
      state.start = loc.start;
      state.end = loc.end;
      const drawn = drawIgvCoverage(ctx, feats, w, height, span, color, overlays || [], loc);
      state.chrom = snap.chrom;
      state.start = snap.start;
      state.end = snap.end;
      drawn.locus = loc;
      return drawn;
    }

    const isAttr = (tr.kind || "").startsWith("ATTR") || (tr.id || "").includes("attribution");
    const isGap = tr.kind === "GAP_Q" || tr.id === "query_gaps";
    feats.forEach((f) => {
      const x1 = ((f.start - loc.start) / span) * w;
      const x2 = ((f.end - loc.start) / span) * w;
      let fill = color;
      if (isAttr) {
        const st = statusFromName(f.name);
        if (st) fill = STATUS_COLOR[st];
      }
      if (isGap) fill = "#2c3e50";
      paintRegion(ctx, f, x1, x2, height, fill, isGap, loc);
    });
    paintSelectionOwnBox(ctx, w, height, span, loc);
    paintMappedRefBox(ctx, w, height, span, loc);
    return { features: feats, overlays: [], type: "bed", color, attribution: isAttr, gap: isGap, locus: loc };
  }

  function paintRegion(ctx, f, x1, x2, height, fill, isGap, loc) {
    const chrom = loc?.chrom || state.chrom;
    const locG = loc?.genome || state.genome;
    const selG = state.selection?.sourceGenome || state.genome;
    const sel = state.selection
      && state.selection.chrom === chrom
      && selG === locG
      && f.start === state.selection.start0
      && f.end === state.selection.end;
    const hov = state.hover
      && state.hover.chrom === chrom
      && f.start === state.hover.start
      && f.end === state.hover.end;
    const y = isGap ? 4 : 6;
    const bh = isGap ? height - 8 : height - 12;
    ctx.fillStyle = fill;
    ctx.globalAlpha = hov ? 1 : 0.88;
    ctx.fillRect(x1, y, Math.max(2, x2 - x1), bh);
    if (hov) {
      ctx.strokeStyle = FLAG_COLORS.hover;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x1 - 1, y - 1, Math.max(2, x2 - x1) + 2, bh + 2);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = FLAG_COLORS.hover;
      ctx.fillRect(x1, 0, Math.max(2, x2 - x1), height);
      ctx.globalAlpha = 1;
    }
    if (sel) {
      ctx.strokeStyle = FLAG_COLORS.select;
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y, Math.max(2, x2 - x1), bh);
      ctx.lineWidth = 1;
    }
    ctx.globalAlpha = 1;
  }

  function drawIgvCoverage(ctx, feats, w, height, span, color, overlays, loc) {
    // Layout: peak histogram (top) + IGV-like read lanes (middle) + problem flags (bottom)
    const flagH = 12;
    const peakH = Math.max(36, Math.floor(height * 0.38));
    const readsH = Math.max(40, height - peakH - flagH - 4);
    const readsTop = peakH + 2;
    let vmax = 1;
    feats.forEach((f) => { vmax = Math.max(vmax, f.value || 0); });

    // --- peak / depth histogram ---
    ctx.fillStyle = "#f7fafc";
    ctx.fillRect(0, 0, w, peakH);
    ctx.beginPath();
    ctx.moveTo(0, peakH - 1);
    let drawn = false;
    feats.forEach((f) => {
      const x1 = ((f.start - state.start) / span) * w;
      const x2 = ((f.end - state.start) / span) * w;
      const barH = ((f.value || 0) / vmax) * (peakH - 8);
      const y = peakH - 1 - barH;
      if (!drawn) { ctx.lineTo(x1, peakH - 1); drawn = true; }
      ctx.lineTo(x1, y);
      ctx.lineTo(x2, y);
    });
    ctx.lineTo(w, peakH - 1);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.globalAlpha = 1;
    // solid bars like IGV coverage track
    feats.forEach((f) => {
      const x1 = ((f.start - state.start) / span) * w;
      const x2 = ((f.end - state.start) / span) * w;
      const barH = ((f.value || 0) / vmax) * (peakH - 8);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x1, peakH - 1 - barH, Math.max(1, x2 - x1), barH);
    });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#c5d0da";
    ctx.beginPath();
    ctx.moveTo(0, peakH);
    ctx.lineTo(w, peakH);
    ctx.stroke();
    ctx.fillStyle = "#5c6b7a";
    ctx.font = "10px sans-serif";
    ctx.fillText(`Coverage  max ${vmax.toFixed(1)}×`, 6, 12);

    // --- reads band: long continuous horizontal ribbons (merge bins; no short ticks) ---
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, readsTop, w, readsH);
    const laneCount = Math.min(8, Math.max(4, Math.floor(readsH / 8)));
    const laneH = Math.max(4, Math.floor((readsH - 8) / laneCount) - 2);
    const laneLevels = feats.map((f) =>
      Math.min(laneCount, Math.max(0, Math.round(((f.value || 0) / vmax) * laneCount)))
    );
    for (let li = 0; li < laneCount; li++) {
      const yy = readsTop + 4 + li * (laneH + 2);
      ctx.fillStyle = li % 2 === 0 ? color : shadeColor(color, 0.14);
      ctx.globalAlpha = 0.5;
      let runStart = null;
      let runEnd = null;
      const flush = () => {
        if (runStart == null) return;
        const x1 = ((runStart - state.start) / span) * w;
        const x2 = ((runEnd - state.start) / span) * w;
        // skip hairline stubs that look like short vertical ticks
        if (x2 - x1 < 4) {
          runStart = null;
          runEnd = null;
          return;
        }
        ctx.fillRect(x1, yy, x2 - x1, laneH);
        runStart = null;
        runEnd = null;
      };
      for (let i = 0; i < feats.length; i++) {
        if (laneLevels[i] > li) {
          if (runStart == null) runStart = feats[i].start;
          runEnd = feats[i].end;
        } else {
          flush();
        }
      }
      flush();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#5c6b7a";
    ctx.font = "10px sans-serif";
    ctx.fillText("Reads", 6, readsTop + 12);
    ctx.strokeStyle = "#d0d8e0";
    ctx.beginPath();
    ctx.moveTo(0, readsTop + readsH);
    ctx.lineTo(w, readsTop + readsH);
    ctx.stroke();

    // --- problem flag strip ---
    const flagTop = readsTop + readsH;
    ctx.fillStyle = "#eef2f6";
    ctx.fillRect(0, flagTop, w, flagH);
    const locG = loc?.genome || state.genome;
    const selG = state.selection?.sourceGenome || state.genome;
    (overlays || []).forEach((f) => {
      const x1 = ((f.start - state.start) / span) * w;
      const x2 = ((f.end - state.start) / span) * w;
      const sel = state.selection
        && state.selection.chrom === state.chrom
        && selG === locG
        && f.start === state.selection.start0
        && f.end === state.selection.end;
      const hov = state.hover
        && state.hover.chrom === state.chrom
        && f.start === state.hover.start
        && f.end === state.hover.end;
      ctx.fillStyle = f.color || FLAG_COLORS.low;
      ctx.globalAlpha = hov ? 1 : 0.9;
      ctx.fillRect(x1, flagTop + 2, Math.max(3, x2 - x1), flagH - 4);
      if (hov || sel) {
        ctx.strokeStyle = hov ? FLAG_COLORS.hover : FLAG_COLORS.select;
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, 1, Math.max(3, x2 - x1), height - 2);
        ctx.lineWidth = 1;
      }
      ctx.globalAlpha = 1;
    });

    const boxLoc = loc || {
      chrom: state.chrom, start: state.start, end: state.end, genome: state.genome,
    };
    paintSelectionOwnBox(ctx, w, height, span, boxLoc);
    paintMappedRefBox(ctx, w, height, span, boxLoc);

    return {
      features: feats,
      overlays: overlays || [],
      type: "bedgraph",
      vmax,
      color,
      plotH: peakH,
      bandH: flagH,
      readsH,
    };
  }

  /**
   * Counterpart interval on the other genome for the current selection.
   * Query selection → mapped region on ref; ref selection → mapped region on query.
   */
  function counterpartInterval(targetGenome) {
    if (!state.selection) return null;
    const selG = state.selection.sourceGenome || "query";
    if (!targetGenome || targetGenome === selG) return null;
    if (state.linkedRef && state.linkedRef.chrom) {
      return {
        chrom: state.linkedRef.chrom,
        start: state.linkedRef.start || 0,
        end: Math.max((state.linkedRef.start || 0) + 1, state.linkedRef.end || 0),
      };
    }
    const srcChrom = state.selection.chrom;
    const Lsrc = chromLengthOf(srcChrom, selG) || 1;
    const Ldst = chromLengthOf(srcChrom, targetGenome);
    if (!Ldst) return null;
    const s0 = state.selection.start0;
    const e0 = state.selection.end;
    return {
      chrom: srcChrom,
      start: Math.floor((s0 / Lsrc) * Ldst),
      end: Math.max(Math.floor((s0 / Lsrc) * Ldst) + 1, Math.ceil((e0 / Lsrc) * Ldst)),
    };
  }

  /** Solid frame on the genome where the selection itself lives. */
  function paintSelectionOwnBox(ctx, w, height, span, loc) {
    if (!loc || !loc.genome || !state.selection) return;
    const selG = state.selection.sourceGenome || "query";
    if (loc.genome !== selG) return;
    if (state.selection.chrom !== loc.chrom) return;
    const x1 = ((state.selection.start0 - loc.start) / span) * w;
    const x2 = ((state.selection.end - loc.start) / span) * w;
    if (x2 < -2 || x1 > w + 2) return;
    const left = Math.max(-1, x1);
    const right = Math.min(w + 1, x2);
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = FLAG_COLORS.select;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(left, 1, Math.max(3, right - left), height - 2);
    ctx.restore();
  }

  /**
   * Dashed frame on the counterpart genome strip.
   * Query selection → dashed on ref; ref selection → dashed on query.
   */
  function paintMappedRefBox(ctx, w, height, span, loc) {
    if (!loc || !loc.genome || !state.selection) return;
    const selG = state.selection.sourceGenome || "query";
    if (loc.genome === selG) return;
    const mapped = counterpartInterval(loc.genome);
    if (!mapped || mapped.chrom !== loc.chrom) return;
    const x1 = ((mapped.start - loc.start) / span) * w;
    const x2 = ((mapped.end - loc.start) / span) * w;
    if (x2 < -2 || x1 > w + 2) return;
    const left = Math.max(-1, x1);
    const right = Math.min(w + 1, x2);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = FLAG_COLORS.select;
    ctx.lineWidth = 2;
    ctx.strokeRect(left, 1, Math.max(3, right - left), height - 2);
    ctx.setLineDash([]);
    ctx.restore();
  }

  function shadeColor(hex, amt) {
    const h = String(hex || "#377eb8").replace("#", "");
    if (h.length !== 6) return hex;
    const num = parseInt(h, 16);
    let r = (num >> 16) + Math.round(255 * amt);
    let g = ((num >> 8) & 0xff) + Math.round(255 * amt);
    let b = (num & 0xff) + Math.round(255 * amt);
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }

  function hitTest(feats, canvas, clientX, locus) {
    const loc = locus || { start: state.start, end: state.end };
    const rect = canvas.getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    const pos = loc.start + frac * (loc.end - loc.start);
    let best = null;
    let bestW = Infinity;
    (feats || []).forEach((f) => {
      if (pos >= f.start && pos < f.end) {
        const ww = f.end - f.start;
        if (ww < bestW) {
          best = f;
          bestW = ww;
        }
      }
    });
    return best;
  }

  function showHoverTip(text, clientX, clientY) {
    const tip = $("hoverTip");
    if (!tip) return;
    tip.hidden = false;
    tip.textContent = text;
    const viewer = $("viewer");
    const rect = viewer.getBoundingClientRect();
    tip.style.left = `${clientX - rect.left}px`;
    tip.style.top = `${clientY - rect.top}px`;
  }

  function hideHoverTip() {
    const tip = $("hoverTip");
    if (tip) tip.hidden = true;
    state.hover = null;
  }

  function bindTrackInteract(canvas, tr, drawn, height, locus) {
    const locOf = () => locus || drawn.locus || { chrom: state.chrom, start: state.start, end: state.end, genome: state.genome };
    const isSecondaryRef = () => {
      const loc = locOf();
      return loc.genome === "ref" && state.genome !== "ref";
    };
    let moved = false;
    canvas.addEventListener("pointerdown", (ev) => {
      moved = false;
      canvas.setPointerCapture(ev.pointerId);
      const loc = locOf();
      state.drag = {
        x: ev.clientX,
        start: loc.start,
        end: loc.end,
        w: canvas.clientWidth,
        secondaryRef: isSecondaryRef(),
        chrom: loc.chrom,
      };
      canvas.classList.add("is-panning");
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (state.drag) {
        if (Math.abs(ev.clientX - state.drag.x) > 3) moved = true;
        if (moved) {
          canvas.classList.remove("is-hot");
          hideHoverTip();
          const dx = ev.clientX - state.drag.x;
          const span = state.drag.end - state.drag.start;
          const shift = (-dx / state.drag.w) * span;
          if (state.drag.secondaryRef) {
            const L = chromLengthOf(state.drag.chrom, "ref") || state.drag.end;
            let s = state.drag.start + shift;
            let e = state.drag.end + shift;
            if (s < 0) { e -= s; s = 0; }
            if (e > L) { s -= (e - L); e = L; }
            state.linkedRef = {
              chrom: state.drag.chrom,
              start: Math.floor(s),
              end: Math.ceil(e),
              mode: "window",
            };
          } else {
            state.start = state.drag.start + shift;
            state.end = state.drag.end + shift;
            clampView();
            drawRuler();
          }
        }
        return;
      }
      const loc = locOf();
      const overlayHit = hitTest(drawn.overlays, canvas, ev.clientX, loc);
      const featHit = !overlayHit && drawn.type === "bed" ? hitTest(drawn.features, canvas, ev.clientX, loc) : null;
      const hit = overlayHit || featHit;
      if (hit) {
        canvas.classList.add("is-hot");
        const next = { chrom: loc.chrom, start: hit.start, end: hit.end, name: hit.name || "" };
        const changed = !state.hover
          || state.hover.start !== next.start
          || state.hover.end !== next.end
          || state.hover.chrom !== next.chrom;
        state.hover = next;
        if (changed) redrawCanvasQuick(canvas, tr, drawn, height, loc);
        const label = hit.problem
          ? `${typeLabel(hit.problem.type)}\n${loc.chrom}:${hit.start + 1}-${hit.end}`
          : `${hit.name || tr.name}\n${loc.chrom}:${hit.start + 1}-${hit.end}`;
        showHoverTip(label, ev.clientX, ev.clientY);
      } else {
        canvas.classList.remove("is-hot");
        if (state.hover) {
          state.hover = null;
          redrawCanvasQuick(canvas, tr, drawn, height, loc);
        }
        hideHoverTip();
      }
    });
    canvas.addEventListener("pointerleave", () => {
      canvas.classList.remove("is-hot", "is-panning");
      if (state.hover) {
        state.hover = null;
        redrawCanvasQuick(canvas, tr, drawn, height, locOf());
      }
      hideHoverTip();
    });
    canvas.addEventListener("pointerup", (ev) => {
      canvas.classList.remove("is-panning");
      if (!state.drag) return;
      const wasDrag = moved;
      const loc = locOf();
      state.drag = null;
      if (wasDrag) {
        renderAll();
        return;
      }
      const overlayHit = hitTest(drawn.overlays, canvas, ev.clientX, loc);
      if (overlayHit) {
        const p = overlayHit.problem;
        // switch primary genome to this strip when selecting its problem
        if (loc.genome && loc.genome !== state.genome) {
          state.genome = loc.genome;
          $("genomeSelect").value = state.genome;
          fillChromSelect();
        }
        selectFeature({
          chrom: loc.chrom,
          start: overlayHit.start,
          end: overlayHit.end,
          name: overlayHit.name,
          type: overlayHit.type || (p && p.type) || "REGION",
          source: "coverage-overlay",
        });
        if (p) setLinkedRefFromAttr(attrFor(p));
        else setLinkedRefFromAttr(currentAttribution());
        state.activeProblem = (p && p.label) || overlayHit.name || null;
        gotoRegion(loc.chrom, overlayHit.start, overlayHit.end);
        renderProblemLists();
        scrollProblemListToActive();
        status(`选中 ${loc.chrom}:${overlayHit.start + 1}-${overlayHit.end}`);
        emit("onSelection", state.selection);
        return;
      }
      if (drawn.type === "bed") {
        const hit = hitTest(drawn.features, canvas, ev.clientX, loc);
        if (hit) {
          selectFeature({
            chrom: loc.chrom,
            start: hit.start,
            end: hit.end,
            name: hit.name || tr.name,
            type: tr.kind || tr.type,
            source: "track",
          });
          state.activeProblem = hit.name || null;
          renderAll();
          renderProblemLists();
          status(`选中 ${loc.chrom}:${hit.start + 1}-${hit.end}`);
          emit("onSelection", state.selection);
        }
      } else if (drawn.type === "bedgraph") {
        const hit = hitTest(drawn.features, canvas, ev.clientX, loc);
        if (hit) {
          status(`覆盖 ${loc.chrom}:${hit.start + 1}-${hit.end} ≈ ${(hit.value || 0).toFixed(2)}×`);
        }
      }
    });
  }

  async function redrawCanvasQuick(canvas, tr, drawn, height, locus) {
    const loc = locus || drawn.locus || { chrom: state.chrom, start: state.start, end: state.end };
    const w = canvas.clientWidth;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = "#fafcfd";
    ctx.fillRect(0, 0, w, height);
    const span = Math.max(1, loc.end - loc.start);
    if (drawn.type === "bedgraph") {
      const snap = { chrom: state.chrom, start: state.start, end: state.end };
      state.chrom = loc.chrom;
      state.start = loc.start;
      state.end = loc.end;
      drawIgvCoverage(ctx, drawn.features || [], w, height, span, drawn.color || "#377eb8", drawn.overlays || []);
      state.chrom = snap.chrom;
      state.start = snap.start;
      state.end = snap.end;
    } else {
      const isGap = !!drawn.gap;
      const isAttr = !!drawn.attribution;
      (drawn.features || []).forEach((f) => {
        const x1 = ((f.start - loc.start) / span) * w;
        const x2 = ((f.end - loc.start) / span) * w;
        let fill = drawn.color || "#0b6e99";
        if (isAttr) {
          const st = statusFromName(f.name);
          if (st) fill = STATUS_COLOR[st];
        }
        if (isGap) fill = "#2c3e50";
        paintRegion(ctx, f, x1, x2, height, fill, isGap);
      });
    }
  }

  function zoomAt(factor, clientX, canvas) {
    if (!state.chrom) return;
    const span = state.end - state.start;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const center = state.start + span * frac;
    const newSpan = Math.max(50, Math.min(chromLength(state.chrom), span * factor));
    state.start = center - newSpan * frac;
    state.end = state.start + newSpan;
    clampView();
    renderAll();
  }

  function zoom(factor) {
    if (!state.chrom) return;
    const span = state.end - state.start;
    const mid = (state.start + state.end) / 2;
    const newSpan = Math.max(50, Math.min(chromLength(state.chrom), span * factor));
    state.start = mid - newSpan / 2;
    state.end = mid + newSpan / 2;
    clampView();
    renderAll();
  }

  // ---- export ----
  function escapeXml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildSvgString() {
    const labelW = 150;
    const trackGap = 8;
    const rulerH = 28;
    const pad = 12;
    const widths = state.lastTrackData.map((t) => (t.width || 600) + labelW + pad * 2);
    const width = Math.max(640, ...(widths.length ? widths : [640]));
    const plotW = width - labelW - pad * 2;
    let y = pad;
    const parts = [];
    const span = Math.max(1, state.end - state.start);
    parts.push(`<g transform="translate(${pad + labelW},${y})">`);
    parts.push(`<rect x="0" y="0" width="${plotW}" height="${rulerH}" fill="#fff" stroke="#d5dde5"/>`);
    parts.push(`<text x="6" y="14" font-size="12" fill="#5c6b7a" font-family="monospace">${escapeXml(state.chrom || "")}</text>`);
    const nice = niceStep(span / 8);
    const first = Math.ceil(state.start / nice) * nice;
    for (let x = first; x <= state.end; x += nice) {
      const px = ((x - state.start) / span) * plotW;
      parts.push(`<line x1="${px}" y1="18" x2="${px}" y2="28" stroke="#c5d0da"/>`);
      parts.push(`<text x="${px + 3}" y="14" font-size="11" fill="#1a1f24" font-family="monospace">${fmt(x + 1)}</text>`);
    }
    parts.push(`</g>`);
    y += rulerH + trackGap;

    state.lastTrackData.forEach((td) => {
      const h = td.height || 36;
      const tr = td.track;
      const data = td.data || {};
      parts.push(`<text x="${pad}" y="${y + 16}" font-size="12" fill="#1a1f24" font-family="sans-serif">${escapeXml(tr.name)}</text>`);
      parts.push(`<g transform="translate(${pad + labelW},${y})">`);
      parts.push(`<rect x="0" y="0" width="${plotW}" height="${h}" fill="#fafcfd" stroke="#d5dde5"/>`);
      const feats = data.features || [];
      if (data.type === "bedgraph") {
        const vmax = data.vmax || 1;
        const color = data.color || "#0b6e99";
        const bandH = data.bandH || 14;
        const plotH = data.plotH || (h - bandH);
        feats.forEach((f) => {
          const x1 = ((f.start - state.start) / span) * plotW;
          const x2 = ((f.end - state.start) / span) * plotW;
          const barH = ((f.value || 0) / vmax) * (plotH - 4);
          parts.push(
            `<rect x="${x1}" y="${plotH - barH}" width="${Math.max(1, x2 - x1)}" height="${barH}" fill="${color}" opacity="0.75"/>`
          );
        });
        (data.overlays || []).forEach((f) => {
          const x1 = ((f.start - state.start) / span) * plotW;
          const x2 = ((f.end - state.start) / span) * plotW;
          parts.push(
            `<rect x="${x1}" y="${plotH + 3}" width="${Math.max(2, x2 - x1)}" height="${bandH - 4}" fill="${f.color || FLAG_COLORS.low}" opacity="0.9"/>`
          );
        });
      } else {
        feats.forEach((f) => {
          const x1 = ((f.start - state.start) / span) * plotW;
          const x2 = ((f.end - state.start) / span) * plotW;
          let fill = data.color || tr.color || "#0b6e99";
          if (data.attribution) {
            const st = statusFromName(f.name);
            if (st) fill = STATUS_COLOR[st];
          }
          if (data.gap) fill = "#2c3e50";
          parts.push(
            `<rect x="${x1}" y="6" width="${Math.max(2, x2 - x1)}" height="${h - 12}" fill="${fill}" opacity="0.9"/>`
          );
        });
      }
      parts.push(`</g>`);
      y += h + trackGap;
    });

    const height = y + pad;
    const title = escapeXml(`${state.project?.name || "AsmLens"} | ${state.chrom}:${state.start + 1}-${state.end}`);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`
      + `<title>${title}</title>\n`
      + `<rect width="100%" height="100%" fill="#ffffff"/>\n`
      + parts.join("\n")
      + `\n</svg>\n`;
    return { svg, width, height };
  }

  function exportBaseName() {
    return `asmlens_${state.genome}_${state.chrom || "view"}_${state.start + 1}_${state.end}`;
  }

  function svgToCanvas(svg, width, height) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(width);
        canvas.height = Math.ceil(height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e || new Error("SVG 渲染失败"));
      };
      img.src = url;
    });
  }

  function jpegToPdf(jpegBytes, width, height) {
    const enc = (s) => new TextEncoder().encode(s);
    const parts = [];
    const offsets = [0];
    const push = (chunk) => {
      if (typeof chunk === "string") chunk = enc(chunk);
      parts.push(chunk);
    };
    const lenSoFar = () => parts.reduce((n, p) => n + p.length, 0);
    push("%PDF-1.4\n");
    offsets[1] = lenSoFar();
    push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    offsets[2] = lenSoFar();
    push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
    offsets[3] = lenSoFar();
    push(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] `
      + `/Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n`
    );
    const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n`;
    offsets[4] = lenSoFar();
    push(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
    offsets[5] = lenSoFar();
    push(
      `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
    );
    push(jpegBytes);
    push("\nendstream\nendobj\n");
    const xrefAt = lenSoFar();
    push(`xref\n0 6\n0000000000 65535 f \n`);
    for (let i = 1; i <= 5; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
    push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
    const total = lenSoFar();
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  async function saveBlobAs(blob, filename, mime) {
    if (window.showSaveFilePicker) {
      const ext = filename.includes(".") ? "." + filename.split(".").pop() : "";
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: "AsmLens export",
          accept: { [mime]: ext ? [ext] : [] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return handle.name || filename;
    }
    // fallback: browser download (user picks folder in save dialog of browser)
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    return filename;
  }

  function openExportDialog() {
    if (isEmptyProject() || !state.chrom) {
      status("请先打开交付包再导出");
      return;
    }
    $("exportDialog").showModal();
  }

  async function exportImage(format) {
    if (isEmptyProject() || !state.chrom) {
      status("请先打开交付包再导出");
      return;
    }
    const { svg, width, height } = buildSvgString();
    const base = exportBaseName();
    try {
      if (format === "svg") {
        const name = await saveBlobAs(
          new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
          `${base}.svg`,
          "image/svg+xml"
        );
        status(`已导出 SVG → ${name}`);
        return;
      }
      const canvas = await svgToCanvas(svg, width, height);
      if (format === "png") {
        const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
        const name = await saveBlobAs(blob, `${base}.png`, "image/png");
        status(`已导出 PNG → ${name}`);
        return;
      }
      if (format === "jpeg") {
        const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
        const name = await saveBlobAs(blob, `${base}.jpg`, "image/jpeg");
        status(`已导出 JPEG → ${name}`);
        return;
      }
      if (format === "pdf") {
        const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
        const buf = new Uint8Array(await blob.arrayBuffer());
        const pdf = jpegToPdf(buf, canvas.width, canvas.height);
        const name = await saveBlobAs(new Blob([pdf], { type: "application/pdf" }), `${base}.pdf`, "application/pdf");
        status(`已导出 PDF → ${name}`);
        return;
      }
      status(`不支持的格式：${format}`);
    } catch (e) {
      if (e && e.name === "AbortError") {
        status("已取消导出");
        return;
      }
      status(`导出失败：${e.message || e}`);
      console.error(e);
    }
  }

  function setAttrOnly(st) {
    document.querySelectorAll('#attrChecks input[name="attr"]').forEach((el) => {
      el.checked = el.value === st;
    });
    renderProblemLists();
  }

  function resetFilters() {
    document.querySelectorAll('#attrChecks input[name="attr"]').forEach((el) => { el.checked = true; });
    $("minLenFilter").value = String(state.lowcovMinLen ?? 1000);
    syncLowcovFilterUI();
    renderProblemLists();
  }

  function runAction(action) {
    switch (action) {
      case "open-bundle":
        $("bundleInput").click();
        break;
      case "export-image":
        openExportDialog();
        break;
      case "reload":
        loadProject().catch((e) => status(String(e.message || e)));
        break;
      case "zoom-in":
        zoom(0.5);
        break;
      case "zoom-out":
        zoom(2);
        break;
      case "fit-chr":
        if (!state.chrom) break;
        state.start = 0;
        state.end = chromLength(state.chrom);
        renderAll();
        break;
      case "toggle-sidebar":
        document.querySelector(".main").classList.toggle("sidebar-collapsed");
        renderAll();
        break;
      case "toggle-feature":
        break;
      case "filter-genome-query":
        state.problemGenomeFilter = "query";
        if ($("problemGenomeFilter")) $("problemGenomeFilter").value = "query";
        ensureDetailData().then(() => { renderProblemLists(); renderAll(); });
        break;
      case "filter-genome-ref":
        state.problemGenomeFilter = "ref";
        if ($("problemGenomeFilter")) $("problemGenomeFilter").value = "ref";
        status("正在加载参考侧问题…");
        ensureDetailData().then(() => {
          renderProblemLists();
          renderAll();
          status("");
        });
        break;
      case "filter-attr-asm":
        setAttrOnly("mapped_not_lowcov");
        break;
      case "filter-attr-both":
        setAttrOnly("both_lowcov");
        break;
      case "filter-attr-unmap":
        setAttrOnly("unmapped");
        break;
      case "filter-reset":
        state.problemGenomeFilter = "all";
        state.problemChromFilter = "all";
        if ($("problemGenomeFilter")) $("problemGenomeFilter").value = "all";
        if ($("problemChromFilter")) $("problemChromFilter").value = "all";
        resetFilters();
        break;
      case "check-update":
        checkUpdates(true);
        break;
      case "about":
        $("aboutDialog").showModal();
        break;
      default:
        break;
    }
  }

  // menus
  document.querySelectorAll(".menu-btn").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const menu = btn.parentElement;
      const open = menu.classList.contains("open");
      document.querySelectorAll(".menu").forEach((m) => m.classList.remove("open"));
      if (!open) menu.classList.add("open");
    });
  });
  document.querySelectorAll(".menu-panel button[data-action]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      if (btn.dataset.action === "toggle-feature" && btn.dataset.feature) {
        ev.stopPropagation();
        setFeature(btn.dataset.feature, !state.features[btn.dataset.feature]);
        return;
      }
      document.querySelectorAll(".menu").forEach((m) => m.classList.remove("open"));
      runAction(btn.dataset.action);
    });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".menu").forEach((m) => m.classList.remove("open"));
  });

  $("btnGo").addEventListener("click", () => {
    const loc = parseLocus($("locusInput").value);
    if (!loc) {
      status("区间格式：Chr:start-end");
      return;
    }
    state.chrom = loc.chrom;
    state.start = loc.start;
    state.end = loc.end;
    $("chromSelect").value = loc.chrom;
    renderAll();
  });
  $("locusInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btnGo").click();
  });
  $("chromSelect").addEventListener("change", async () => {
    state.chrom = $("chromSelect").value;
    state.start = 0;
    state.end = Math.min(chromLength(state.chrom), 500000);
    await renderAll();
    renderProblemLists();
  });
  $("genomeSelect").addEventListener("change", async () => {
    state.genome = $("genomeSelect").value;
    fillChromSelect();
    state.chrom = activeChromList()[0]?.id || null;
    state.start = 0;
    state.end = state.chrom ? Math.min(chromLength(state.chrom), 500000) : 0;
    state.selection = null;
    updateSelectionBar();
    await renderAll();
    renderProblemLists();
  });
  $("btnZoomIn").addEventListener("click", () => zoom(0.5));
  $("btnZoomOut").addEventListener("click", () => zoom(2));
  $("btnFit").addEventListener("click", () => {
    if (!state.chrom) return;
    state.start = 0;
    state.end = chromLength(state.chrom);
    renderAll();
  });
  $("btnExport").addEventListener("click", openExportDialog);
  $("exportDialog").addEventListener("close", () => {
    if ($("exportDialog").returnValue !== "export") return;
    const fmt = document.querySelector('input[name="exportFmt"]:checked')?.value || "png";
    exportImage(fmt);
  });
  $("btnClearSel").addEventListener("click", () => {
    state.selection = null;
    state.activeProblem = null;
    state.linkedRef = null;
    $("detailPanel").hidden = true;
    updateSelectionBar();
    renderAll();
    renderProblemLists();
  });
  $("attrChecks").addEventListener("change", renderProblemLists);
  $("minLenFilter").addEventListener("change", () => {
    const n = parseInt($("minLenFilter").value || "1000", 10);
    state.lowcovMinLen = Number.isFinite(n) && n >= 0 ? n : 1000;
    if ($("lowcovMinLen")) $("lowcovMinLen").value = String(state.lowcovMinLen);
    saveLowcovPrefs();
    invalidateLowcovCaches();
    ensureDetailData().then(() => {
      renderProblemLists();
      renderAll();
    });
  });
  $("lowcovLevel")?.addEventListener("change", () => applyLowcovFiltersFromUI());
  $("lowcovMinLen")?.addEventListener("change", () => applyLowcovFiltersFromUI());
  $("problemGenomeFilter")?.addEventListener("change", async () => {
    state.problemGenomeFilter = $("problemGenomeFilter").value;
    // Switching 来源 to 参考 must pull ref overlay BEDs / attribution
    status(state.problemGenomeFilter === "ref" ? "正在加载参考侧问题…" : "正在刷新问题列表…");
    await ensureDetailData();
    renderProblemLists();
    await renderAll();
    status("");
  });
  $("problemChromFilter")?.addEventListener("change", async () => {
    state.problemChromFilter = $("problemChromFilter").value;
    await ensureDetailData();
    renderProblemLists();
  });
  window.addEventListener("resize", () => renderAll());

  // Wheel zoom ONLY inside diagram area; never zoom the page/chrome
  const viewer = $("viewer");
  viewer.addEventListener("wheel", (ev) => {
    const onDiagram = ev.target.closest("#tracks, #ruler, #chromOverview, .track-canvas, .chrom-overview");
    if (!onDiagram) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (!state.chrom) return;
    const canvas = ev.target.closest("canvas") || $("ruler");
    const factor = ev.deltaY < 0 ? 0.8 : 1.25;
    zoomAt(factor, ev.clientX, canvas);
  }, { passive: false });

  // Block ctrl/meta+wheel page zoom anywhere in the app window
  document.addEventListener("wheel", (ev) => {
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
    }
  }, { passive: false });

  bindOverviewInteract($("overviewQuery"));
  bindOverviewInteract($("overviewRef"));

  $("btnOvApply")?.addEventListener("click", () => applyOverviewPick());
  $("btnOvClearSel")?.addEventListener("click", () => clearOverviewSelection());
  $("btnOvShowAll")?.addEventListener("click", () => clearOverviewSelection());

  $("sideFeatures")?.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement) || !t.dataset.feature) return;
    setFeature(t.dataset.feature, t.checked);
  });

  // Resizable sidebar (width)
  (() => {
    const splitter = $("sidebarSplitter");
    const sidebar = $("sidebar");
    if (!splitter || !sidebar) return;
    const saved = localStorage.getItem("asmlens.sidebarWidth");
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= 180 && w <= 900) sidebar.style.width = `${w}px`;
    }
    let dragging = false;
    splitter.addEventListener("mousedown", (ev) => {
      if (document.querySelector(".main")?.classList.contains("sidebar-collapsed")) return;
      if (document.querySelector(".main")?.classList.contains("no-dock")) return;
      dragging = true;
      splitter.classList.add("dragging");
      ev.preventDefault();
    });
    window.addEventListener("mousemove", (ev) => {
      if (!dragging) return;
      const main = $("mainPane");
      const left = main.getBoundingClientRect().left;
      const w = Math.max(200, Math.min(window.innerWidth * 0.7, ev.clientX - left));
      sidebar.style.width = `${Math.round(w)}px`;
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove("dragging");
      localStorage.setItem("asmlens.sidebarWidth", String(parseInt(sidebar.style.width, 10) || 320));
      renderAll();
    });
  })();

  // Magnetic dock panel height splitters
  (() => {
    let active = null;
    document.querySelectorAll(".dock-splitter").forEach((sp) => {
      sp.addEventListener("mousedown", (ev) => {
        const before = document.querySelector(`.dock-panel[data-panel="${sp.dataset.before}"]`);
        const after = document.querySelector(`.dock-panel[data-panel="${sp.dataset.after}"]`);
        if (!before || !after || before.hidden || after.hidden) return;
        active = {
          sp,
          before,
          after,
          y: ev.clientY,
          bh: before.getBoundingClientRect().height,
          ah: after.getBoundingClientRect().height,
        };
        sp.classList.add("dragging");
        ev.preventDefault();
      });
    });
    window.addEventListener("mousemove", (ev) => {
      if (!active) return;
      const dy = ev.clientY - active.y;
      let nb = active.bh + dy;
      let na = active.ah - dy;
      const minH = 72;
      if (nb < minH) { na -= (minH - nb); nb = minH; }
      if (na < minH) { nb -= (minH - na); na = minH; }
      // magnetic snap near equal / 1:2 / 2:1
      const total = nb + na;
      const ratios = [0.5, 1 / 3, 2 / 3];
      ratios.forEach((r) => {
        const target = total * r;
        if (Math.abs(nb - target) < 14) nb = target;
      });
      na = total - nb;
      active.before.style.flex = `0 0 ${Math.round(nb)}px`;
      active.after.style.flex = `0 0 ${Math.round(na)}px`;
    });
    window.addEventListener("mouseup", () => {
      if (!active) return;
      active.sp.classList.remove("dragging");
      active = null;
    });
  })();

  loadPairScalePrefs();
  loadLowcovPrefs();
  initFeatureBar();

  $("bundleInput").addEventListener("change", async () => {
    const input = $("bundleInput");
    const file = input.files && input.files[0];
    if (!file) return;
    status(`正在加载交付包：${file.name}…`);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const res = await fetch("/api/open_bundle", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `${res.status}`);
      }
      const info = await res.json();
      status(`已加载：${info.name || file.name}`);
      await loadProject();
    } catch (e) {
      status(`打开失败：${e.message || e}`);
      console.error(e);
    } finally {
      input.value = "";
    }
  });

  Promise.all([
    loadAppInfo(),
    loadProject(),
    checkUpdates(false),
  ]).catch((e) => {
    status(String(e.message || e));
    console.error(e);
  });
})();
