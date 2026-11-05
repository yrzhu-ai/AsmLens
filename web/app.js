(() => {
  const state = {
    project: null,
    chrom: null,
    start: 0,
    end: 0,
    problems: [],
    activeProblem: null,
    drag: null,
  };

  const $ = (id) => document.getElementById(id);
  const status = (msg) => { $("status").textContent = msg || ""; };

  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }

  function fmt(n) {
    return Number(n).toLocaleString("en-US");
  }

  function chromLength(id) {
    const c = state.project.chromosomes.find((x) => x.id === id);
    return c ? c.length : 0;
  }

  function clampView() {
    const L = chromLength(state.chrom);
    state.start = Math.max(0, Math.floor(state.start));
    state.end = Math.min(L, Math.ceil(state.end));
    if (state.end - state.start < 50) {
      state.end = Math.min(L, state.start + 50);
    }
  }

  function setLocusBox() {
    $("locusInput").value = `${state.chrom}:${state.start + 1}-${state.end}`;
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
    const f = flank ?? (state.project.defaults?.flank_bp || 50000);
    let s = Math.max(0, start0 - f);
    let e = Math.min(L, end0 + f);
    if (e <= s) e = Math.min(L, s + Math.max(1000, end0 - start0 + 2 * f));
    state.chrom = chrom;
    state.start = s;
    state.end = e;
    $("chromSelect").value = chrom;
    setLocusBox();
    renderAll();
  }

  async function loadProject() {
    status("Loading project…");
    state.project = await api("/api/project");
    document.title = `AsmLens — ${state.project.name || "project"}`;
    const sel = $("chromSelect");
    sel.innerHTML = "";
    state.project.chromosomes.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.id} (${fmt(c.length)} bp)`;
      sel.appendChild(opt);
    });
    state.chrom = state.project.chromosomes[0]?.id;
    state.start = 0;
    state.end = Math.min(chromLength(state.chrom), 500000);
    setLocusBox();

    state.problems = await api("/api/problems?limit=20000");
    const types = [...new Set(state.problems.map((p) => p.type))].sort();
    const tf = $("typeFilter");
    tf.innerHTML = '<option value="">All types</option>';
    types.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      tf.appendChild(opt);
    });
    renderProblemList();
    await renderAll();
    status(`${state.project.problem_count || state.problems.length} problem regions`);
  }

  function renderProblemList() {
    const type = $("typeFilter").value;
    const box = $("problemList");
    box.innerHTML = "";
    const rows = state.problems.filter((p) => !type || p.type === type).slice(0, 3000);
    rows.forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "problem-item" + (state.activeProblem === p.label ? " active" : "");
      btn.innerHTML = `<div class="t">${p.type}</div>
        <div class="c">${p.chrom}:${fmt(p.start)}-${fmt(p.end)}</div>
        <div class="m">${fmt(p.length)} bp</div>`;
      btn.addEventListener("click", () => {
        state.activeProblem = p.label;
        // problems.tsv uses 1-based closed
        gotoRegion(p.chrom, p.start - 1, p.end);
        renderProblemList();
      });
      box.appendChild(btn);
    });
    if (!rows.length) {
      box.innerHTML = '<div class="m" style="padding:0.5rem">No regions</div>';
    }
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
    ctx.fillText(state.chrom, 6, 14);
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

  async function renderAll() {
    clampView();
    setLocusBox();
    drawRuler();
    const host = $("tracks");
    host.innerHTML = "";
    const tracks = state.project.tracks || [];
    for (const tr of tracks) {
      const row = document.createElement("div");
      row.className = "track-row";
      row.innerHTML = `<div class="track-label"><strong>${tr.name}</strong>${tr.kind || tr.type}</div>`;
      const canvas = document.createElement("canvas");
      canvas.className = "track-canvas";
      const h = tr.height || 36;
      row.appendChild(canvas);
      host.appendChild(row);
      await drawTrack(canvas, tr, h);
      bindPanZoom(canvas);
    }
  }

  async function drawTrack(canvas, tr, height) {
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

    const q = `/api/tracks/${encodeURIComponent(tr.id)}?chrom=${encodeURIComponent(state.chrom)}&start=${state.start}&end=${state.end}`;
    let data;
    try {
      data = await api(q);
    } catch (e) {
      ctx.fillStyle = "#c0392b";
      ctx.fillText(String(e.message || e), 8, 18);
      return;
    }
    const span = Math.max(1, state.end - state.start);
    const color = tr.color || "#0b6e99";

    if (tr.type === "bedgraph") {
      const vals = data.features || [];
      let vmax = 1;
      vals.forEach((f) => { vmax = Math.max(vmax, f.value || 0); });
      vals.forEach((f) => {
        const x1 = ((f.start - state.start) / span) * w;
        const x2 = ((f.end - state.start) / span) * w;
        const barH = ((f.value || 0) / vmax) * (height - 4);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x1, height - barH - 2, Math.max(1, x2 - x1), barH);
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#5c6b7a";
      ctx.font = "10px sans-serif";
      ctx.fillText(`max ${vmax.toFixed(1)}×`, 6, 12);
      return;
    }

    (data.features || []).forEach((f) => {
      const x1 = ((f.start - state.start) / span) * w;
      const x2 = ((f.end - state.start) / span) * w;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x1, 6, Math.max(2, x2 - x1), height - 12);
    });
    ctx.globalAlpha = 1;
  }

  function bindPanZoom(canvas) {
    canvas.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const span = state.end - state.start;
      const factor = ev.deltaY < 0 ? 0.8 : 1.25;
      const rect = canvas.getBoundingClientRect();
      const frac = (ev.clientX - rect.left) / rect.width;
      const center = state.start + span * frac;
      const newSpan = Math.max(50, Math.min(chromLength(state.chrom), span * factor));
      state.start = center - newSpan * frac;
      state.end = state.start + newSpan;
      clampView();
      renderAll();
    }, { passive: false });

    canvas.addEventListener("pointerdown", (ev) => {
      canvas.setPointerCapture(ev.pointerId);
      state.drag = { x: ev.clientX, start: state.start, end: state.end, w: canvas.clientWidth };
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!state.drag) return;
      const dx = ev.clientX - state.drag.x;
      const span = state.drag.end - state.drag.start;
      const shift = (-dx / state.drag.w) * span;
      state.start = state.drag.start + shift;
      state.end = state.drag.end + shift;
      clampView();
      drawRuler();
    });
    canvas.addEventListener("pointerup", () => {
      if (!state.drag) return;
      state.drag = null;
      renderAll();
    });
  }

  function zoom(factor) {
    const span = state.end - state.start;
    const mid = (state.start + state.end) / 2;
    const newSpan = Math.max(50, Math.min(chromLength(state.chrom), span * factor));
    state.start = mid - newSpan / 2;
    state.end = mid + newSpan / 2;
    clampView();
    renderAll();
  }

  $("btnGo").addEventListener("click", () => {
    const loc = parseLocus($("locusInput").value);
    if (!loc) {
      status("Locus format: Chr:start-end");
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
  $("chromSelect").addEventListener("change", () => {
    state.chrom = $("chromSelect").value;
    state.start = 0;
    state.end = Math.min(chromLength(state.chrom), 500000);
    renderAll();
  });
  $("btnZoomIn").addEventListener("click", () => zoom(0.5));
  $("btnZoomOut").addEventListener("click", () => zoom(2));
  $("btnFit").addEventListener("click", () => {
    state.start = 0;
    state.end = chromLength(state.chrom);
    renderAll();
  });
  $("typeFilter").addEventListener("change", renderProblemList);
  window.addEventListener("resize", () => renderAll());

  loadProject().catch((e) => {
    status(String(e.message || e));
    console.error(e);
  });
})();
