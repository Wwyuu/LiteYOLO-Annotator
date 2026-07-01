(() => {
  "use strict";

  const HANDLE_SIZE = 8;
  const MIN_BOX_PX = 6;

  const state = {
    items: [],
    filteredItems: [],
    currentIndex: -1,
    stem: "",
    imageNatural: { w: 0, h: 0 },
    boxes: [],
    selectedIndex: -1,
    mode: "select",
    classNames: ["weed"],
    dirty: false,
    saving: false,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    drag: null,
    spacePressed: false,
    editedCount: 0,
  };

  const els = {
    dirs: document.getElementById("dirs"),
    editSummary: document.getElementById("edit-summary"),
    search: document.getElementById("search"),
    filter: document.getElementById("filter"),
    imageList: document.getElementById("image-list"),
    canvasWrap: document.getElementById("canvas-wrap"),
    bgImage: document.getElementById("bg-image"),
    canvas: document.getElementById("editor-canvas"),
    status: document.getElementById("status"),
    classSelect: document.getElementById("class-select"),
    toast: document.getElementById("toast"),
    btnPrev: document.getElementById("btn-prev"),
    btnNext: document.getElementById("btn-next"),
    btnModeSelect: document.getElementById("btn-mode-select"),
    btnModeDraw: document.getElementById("btn-mode-draw"),
    btnDelete: document.getElementById("btn-delete"),
    btnSave: document.getElementById("btn-save"),
    btnFit: document.getElementById("btn-fit"),
    btnZoomIn: document.getElementById("btn-zoom-in"),
    btnZoomOut: document.getElementById("btn-zoom-out"),
  };

  const ctx = els.canvas.getContext("2d");

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function setStatus(text, kind = "") {
    els.status.textContent = text;
    els.status.className = kind;
  }

  function markDirty() {
    state.dirty = true;
    setStatus("未保存", "unsaved");
  }

  function markClean(msg = "已保存") {
    state.dirty = false;
    setStatus(msg, "ok");
  }

  function boxToPixels(box) {
    const { w, h } = state.imageNatural;
    const bw = box.width * w;
    const bh = box.height * h;
    const x1 = (box.x_center - box.width / 2) * w;
    const y1 = (box.y_center - box.height / 2) * h;
    return { x1, y1, x2: x1 + bw, y2: y1 + bh, w: bw, h: bh };
  }

  function pixelsToBox(x1, y1, x2, y2, classId = 0) {
    const { w, h } = state.imageNatural;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const right = Math.max(x1, x2);
    const bottom = Math.max(y1, y2);
    const width = (right - left) / w;
    const height = (bottom - top) / h;
    return {
      class_id: classId,
      x_center: (left + right) / 2 / w,
      y_center: (top + bottom) / 2 / h,
      width,
      height,
    };
  }

  function clampBox(box) {
    let { x_center, y_center, width, height, class_id } = box;
    width = Math.max(1e-6, Math.min(1, width));
    height = Math.max(1e-6, Math.min(1, height));
    x_center = Math.min(Math.max(x_center, width / 2), 1 - width / 2);
    y_center = Math.min(Math.max(y_center, height / 2), 1 - height / 2);
    return { class_id, x_center, y_center, width, height };
  }

  function imageToScreen(x, y) {
    return {
      x: x * state.scale + state.offsetX,
      y: y * state.scale + state.offsetY,
    };
  }

  function screenToImage(x, y) {
    return {
      x: (x - state.offsetX) / state.scale,
      y: (y - state.offsetY) / state.scale,
    };
  }

  function getCanvasPoint(evt) {
    const rect = els.canvas.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
    };
  }

  function getWrapSize() {
    const width = els.canvasWrap.clientWidth;
    const height = els.canvasWrap.clientHeight;
    return { width, height };
  }

  function applyViewTransform() {
    const { w, h } = state.imageNatural;
    if (!w || !h) {
      els.bgImage.style.display = "none";
      return;
    }
    els.bgImage.style.display = "block";
    els.bgImage.style.width = `${w}px`;
    els.bgImage.style.height = `${h}px`;
    els.bgImage.style.transform = `translate(${state.offsetX}px, ${state.offsetY}px) scale(${state.scale})`;
  }

  function fitToView() {
    const wrap = getWrapSize();
    const { w, h } = state.imageNatural;
    if (!w || !h || wrap.width < 2 || wrap.height < 2) return false;

    const padding = 24;
    const availW = Math.max(1, wrap.width - padding);
    const availH = Math.max(1, wrap.height - padding);
    state.scale = Math.max(0.01, Math.min(availW / w, availH / h, 4));
    state.offsetX = (wrap.width - w * state.scale) / 2;
    state.offsetY = (wrap.height - h * state.scale) / 2;
    applyViewTransform();
    draw();
    return true;
  }

  function scheduleRender(attempt = 0) {
    resizeCanvas();
    if (fitToView()) return;
    if (attempt < 60) {
      requestAnimationFrame(() => scheduleRender(attempt + 1));
    }
  }

  function resizeCanvas() {
    const wrap = getWrapSize();
    if (wrap.width < 2 || wrap.height < 2) return false;
    const dpr = window.devicePixelRatio || 1;
    els.canvas.width = Math.max(1, Math.floor(wrap.width * dpr));
    els.canvas.height = Math.max(1, Math.floor(wrap.height * dpr));
    els.canvas.style.width = `${wrap.width}px`;
    els.canvas.style.height = `${wrap.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
    return true;
  }

  function getHandles(rect) {
    const cx = (rect.x1 + rect.x2) / 2;
    const cy = (rect.y1 + rect.y2) / 2;
    return [
      { id: "nw", x: rect.x1, y: rect.y1 },
      { id: "n", x: cx, y: rect.y1 },
      { id: "ne", x: rect.x2, y: rect.y1 },
      { id: "e", x: rect.x2, y: cy },
      { id: "se", x: rect.x2, y: rect.y2 },
      { id: "s", x: cx, y: rect.y2 },
      { id: "sw", x: rect.x1, y: rect.y2 },
      { id: "w", x: rect.x1, y: cy },
    ];
  }

  function draw() {
    const wrap = getWrapSize();
    ctx.clearRect(0, 0, wrap.width, wrap.height);
    if (!state.imageNatural.w || !state.imageNatural.h) return;

    state.boxes.forEach((box, index) => {
      const rect = boxToPixels(box);
      const p1 = imageToScreen(rect.x1, rect.y1);
      const p2 = imageToScreen(rect.x2, rect.y2);
      const selected = index === state.selectedIndex;
      const color = selected ? "#fbbf24" : "#ef4444";
      ctx.lineWidth = selected ? 2.5 : 2;
      ctx.strokeStyle = color;
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

      const label = state.classNames[box.class_id] || `cls${box.class_id}`;
      ctx.font = "12px Segoe UI, Microsoft YaHei, sans-serif";
      const textW = ctx.measureText(label).width + 8;
      ctx.fillStyle = color;
      ctx.fillRect(p1.x, Math.max(0, p1.y - 18), textW, 18);
      ctx.fillStyle = "#111827";
      ctx.fillText(label, p1.x + 4, Math.max(12, p1.y - 5));

      if (selected) {
        getHandles(rect).forEach((handle) => {
          const hp = imageToScreen(handle.x, handle.y);
          ctx.fillStyle = "#fbbf24";
          ctx.fillRect(
            hp.x - HANDLE_SIZE / 2,
            hp.y - HANDLE_SIZE / 2,
            HANDLE_SIZE,
            HANDLE_SIZE
          );
        });
      }
    });

    if (state.drag && state.drag.type === "draw") {
      const { start, current } = state.drag;
      const x1 = Math.min(start.x, current.x);
      const y1 = Math.min(start.y, current.y);
      const x2 = Math.max(start.x, current.x);
      const y2 = Math.max(start.y, current.y);
      const p1 = imageToScreen(x1, y1);
      const p2 = imageToScreen(x2, y2);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 2;
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.setLineDash([]);
    }
  }

  function hitTestBox(px, py) {
    for (let i = state.boxes.length - 1; i >= 0; i -= 1) {
      const rect = boxToPixels(state.boxes[i]);
      if (px >= rect.x1 && px <= rect.x2 && py >= rect.y1 && py <= rect.y2) {
        return i;
      }
    }
    return -1;
  }

  function hitTestHandle(px, py) {
    if (state.selectedIndex < 0) return null;
    const rect = boxToPixels(state.boxes[state.selectedIndex]);
    const threshold = HANDLE_SIZE / state.scale;
    for (const handle of getHandles(rect)) {
      if (Math.abs(px - handle.x) <= threshold && Math.abs(py - handle.y) <= threshold) {
        return handle.id;
      }
    }
    return null;
  }

  function applyResize(box, handle, px, py) {
    const rect = boxToPixels(box);
    let { x1, y1, x2, y2 } = rect;
    if (handle.includes("w")) x1 = px;
    if (handle.includes("e")) x2 = px;
    if (handle.includes("n")) y1 = py;
    if (handle.includes("s")) y2 = py;
    if (Math.abs(x2 - x1) < MIN_BOX_PX || Math.abs(y2 - y1) < MIN_BOX_PX) {
      return box;
    }
    return clampBox(pixelsToBox(x1, y1, x2, y2, box.class_id));
  }

  function renderClassSelect() {
    els.classSelect.innerHTML = "";
    state.classNames.forEach((name, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `${idx}: ${name}`;
      els.classSelect.appendChild(opt);
    });
  }

  function formatStatus(stem, boxCount, editInfo) {
    let text = `${stem} | ${boxCount} 框`;
    if (editInfo && editInfo.edited_at) {
      text += ` | 已编辑 ${editInfo.edited_at}`;
    }
    return text;
  }

  function getEditInfo(stem) {
    const item = state.items.find((x) => x.stem === stem);
    if (!item || !item.edited) return null;
    return {
      edited_at: item.edited_at,
      edit_count: item.edit_count,
    };
  }

  function renderEditSummary() {
    if (!els.editSummary) return;
    els.editSummary.textContent = `已手动编辑: ${state.editedCount} 个`;
  }

  function renderImageList() {
    const keyword = els.search.value.trim().toLowerCase();
    const filter = els.filter.value;
    state.filteredItems = state.items.filter((item) => {
      if (keyword && !item.stem.toLowerCase().includes(keyword)) return false;
      if (filter === "labeled" && item.box_count === 0) return false;
      if (filter === "empty" && item.box_count > 0) return false;
      if (filter === "edited" && !item.edited) return false;
      return item.has_image;
    });

    els.imageList.innerHTML = "";
    state.filteredItems.forEach((item, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "image-item";
      if (item.stem === state.stem) btn.classList.add("active");
      if (item.edited) btn.classList.add("edited-item");
      const editedLine = item.edited
        ? `<span class="edited">已编辑 ${item.edited_at} · 第${item.edit_count}次</span>`
        : "";
      btn.innerHTML = `<span class="name">${item.stem}</span><span class="count">${item.box_count} 框</span>${editedLine}`;
      btn.addEventListener("click", () => gotoIndex(index));
      els.imageList.appendChild(btn);
    });
    renderEditSummary();
  }

  async function loadConfig() {
    const res = await fetch("/api/config");
    const data = await res.json();
    state.classNames = data.class_names || ["weed"];
    state.editedCount = data.edited_count || 0;
    els.dirs.textContent = [
      `图片: ${data.images_dir}`,
      `标注: ${data.labels_dir}`,
      `记录: ${data.edit_log_txt || data.edit_log_json || ""}`,
    ].join("\n");
    renderClassSelect();
    renderEditSummary();
  }

  async function loadItems() {
    const res = await fetch("/api/images");
    const data = await res.json();
    state.items = data.items || [];
    renderImageList();
  }

  async function loadCurrentStem(stem) {
    const imageUrl = `/api/image/${encodeURIComponent(stem)}?t=${Date.now()}`;
    els.bgImage.src = imageUrl;
    await new Promise((resolve, reject) => {
      els.bgImage.onload = () => resolve();
      els.bgImage.onerror = () => reject(new Error("图片加载失败"));
    });

    const labelRes = await fetch(`/api/labels/${encodeURIComponent(stem)}`);
    const labelData = await labelRes.json();

    state.stem = stem;
    state.imageNatural = {
      w: els.bgImage.naturalWidth,
      h: els.bgImage.naturalHeight,
    };
    state.boxes = (labelData.boxes || []).map(clampBox);
    state.selectedIndex = state.boxes.length ? 0 : -1;
    state.dirty = false;
    const item = state.items.find((x) => x.stem === stem);
    setStatus(formatStatus(stem, state.boxes.length, item));
    scheduleRender();
    renderImageList();
    updateNavButtons();
  }

  function updateNavButtons() {
    els.btnPrev.disabled = state.currentIndex <= 0;
    els.btnNext.disabled = state.currentIndex >= state.filteredItems.length - 1;
  }

  async function gotoIndex(index) {
    if (index < 0 || index >= state.filteredItems.length) return;
    if (state.dirty) {
      const ok = window.confirm("当前图片有未保存修改，是否放弃？");
      if (!ok) return;
    }
    state.currentIndex = index;
    const stem = state.filteredItems[index].stem;
    try {
      await loadCurrentStem(stem);
    } catch (err) {
      setStatus(err.message || "加载失败", "error");
      toast("加载失败");
    }
  }

  async function saveCurrent() {
    if (!state.stem || state.saving) return;
    state.saving = true;
    els.btnSave.disabled = true;
    setStatus("保存中...", "unsaved");
    try {
      const res = await fetch(`/api/labels/${encodeURIComponent(state.stem)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boxes: state.boxes.map(clampBox) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      markClean(`已保存 (${data.box_count} 框) · ${data.edited_at}`);
      toast(`保存成功，第 ${data.edit_count} 次编辑`);

      const item = state.items.find((x) => x.stem === state.stem);
      if (item) {
        item.box_count = data.box_count;
        item.has_label = data.box_count > 0;
        item.edited = true;
        item.edited_at = data.edited_at;
        item.edit_count = data.edit_count;
      }
      state.editedCount = state.items.filter((x) => x.edited).length;
      setStatus(formatStatus(state.stem, data.box_count, item));
      renderImageList();
    } catch (err) {
      setStatus(err.message || "保存失败", "error");
      toast("保存失败，请重试");
    } finally {
      state.saving = false;
      els.btnSave.disabled = false;
    }
  }

  function setMode(mode) {
    state.mode = mode;
    els.btnModeSelect.classList.toggle("active", mode === "select");
    els.btnModeDraw.classList.toggle("active", mode === "draw");
    els.canvasWrap.style.cursor = mode === "draw" ? "crosshair" : "default";
  }

  function deleteSelected() {
    if (state.selectedIndex < 0) return;
    state.boxes.splice(state.selectedIndex, 1);
    state.selectedIndex = Math.min(state.selectedIndex, state.boxes.length - 1);
    markDirty();
    draw();
  }

  function onPointerDown(evt) {
    if (!state.imageNatural.w) return;
    const point = getCanvasPoint(evt);
    const imgPt = screenToImage(point.x, point.y);

    if (state.spacePressed || evt.button === 1) {
      state.drag = { type: "pan", start: point, originX: state.offsetX, originY: state.offsetY };
      els.canvasWrap.classList.add("panning", "dragging");
      evt.preventDefault();
      return;
    }

    if (state.mode === "draw" && evt.button === 0) {
      state.drag = { type: "draw", start: imgPt, current: imgPt };
      return;
    }

    const handle = hitTestHandle(imgPt.x, imgPt.y);
    if (handle) {
      state.drag = {
        type: "resize",
        handle,
        index: state.selectedIndex,
        startBox: { ...state.boxes[state.selectedIndex] },
      };
      return;
    }

    const hit = hitTestBox(imgPt.x, imgPt.y);
    if (hit >= 0) {
      state.selectedIndex = hit;
      state.drag = {
        type: "move",
        index: hit,
        start: imgPt,
        startBox: { ...state.boxes[hit] },
      };
      draw();
      return;
    }

    state.selectedIndex = -1;
    draw();
  }

  function onPointerMove(evt) {
    if (!state.drag) return;
    const point = getCanvasPoint(evt);

    if (state.drag.type === "pan") {
      state.offsetX = state.drag.originX + (point.x - state.drag.start.x);
      state.offsetY = state.drag.originY + (point.y - state.drag.start.y);
      applyViewTransform();
      draw();
      return;
    }

    const imgPt = screenToImage(point.x, point.y);

    if (state.drag.type === "draw") {
      state.drag.current = imgPt;
      draw();
      return;
    }

    if (state.drag.type === "move") {
      const dx = imgPt.x - state.drag.start.x;
      const dy = imgPt.y - state.drag.start.y;
      const rect = boxToPixels(state.drag.startBox);
      const moved = pixelsToBox(
        rect.x1 + dx,
        rect.y1 + dy,
        rect.x2 + dx,
        rect.y2 + dy,
        state.drag.startBox.class_id
      );
      state.boxes[state.drag.index] = clampBox(moved);
      markDirty();
      draw();
      return;
    }

    if (state.drag.type === "resize") {
      state.boxes[state.drag.index] = applyResize(
        state.drag.startBox,
        state.drag.handle,
        imgPt.x,
        imgPt.y
      );
      markDirty();
      draw();
    }
  }

  function onPointerUp() {
    if (!state.drag) return;

    if (state.drag.type === "draw") {
      const { start, current } = state.drag;
      const rectW = Math.abs(current.x - start.x);
      const rectH = Math.abs(current.y - start.y);
      if (rectW >= MIN_BOX_PX && rectH >= MIN_BOX_PX) {
        const classId = Number(els.classSelect.value) || 0;
        const box = clampBox(pixelsToBox(start.x, start.y, current.x, current.y, classId));
        state.boxes.push(box);
        state.selectedIndex = state.boxes.length - 1;
        markDirty();
      }
    }

    state.drag = null;
    els.canvasWrap.classList.remove("dragging");
    draw();
  }

  function onWheel(evt) {
    if (!state.imageNatural.w) return;
    evt.preventDefault();
    const point = getCanvasPoint(evt);
    const before = screenToImage(point.x, point.y);
    const factor = evt.deltaY < 0 ? 1.1 : 0.9;
    state.scale = Math.min(8, Math.max(0.05, state.scale * factor));
    const after = screenToImage(point.x, point.y);
    state.offsetX += (after.x - before.x) * state.scale;
    state.offsetY += (after.y - before.y) * state.scale;
    applyViewTransform();
    draw();
  }

  function bindEvents() {
    els.search.addEventListener("input", () => {
      const prevStem = state.stem;
      renderImageList();
      const idx = state.filteredItems.findIndex((x) => x.stem === prevStem);
      state.currentIndex = idx;
      updateNavButtons();
    });
    els.filter.addEventListener("change", () => {
      const prevStem = state.stem;
      renderImageList();
      const idx = state.filteredItems.findIndex((x) => x.stem === prevStem);
      state.currentIndex = idx;
      updateNavButtons();
    });

    els.btnPrev.addEventListener("click", () => gotoIndex(state.currentIndex - 1));
    els.btnNext.addEventListener("click", () => gotoIndex(state.currentIndex + 1));
    els.btnModeSelect.addEventListener("click", () => setMode("select"));
    els.btnModeDraw.addEventListener("click", () => setMode("draw"));
    els.btnDelete.addEventListener("click", deleteSelected);
    els.btnSave.addEventListener("click", saveCurrent);
    els.btnFit.addEventListener("click", fitToView);
    els.btnZoomIn.addEventListener("click", () => {
      state.scale = Math.min(8, state.scale * 1.15);
      applyViewTransform();
      draw();
    });
    els.btnZoomOut.addEventListener("click", () => {
      state.scale = Math.max(0.05, state.scale / 1.15);
      applyViewTransform();
      draw();
    });

    els.classSelect.addEventListener("change", () => {
      if (state.selectedIndex >= 0) {
        state.boxes[state.selectedIndex].class_id = Number(els.classSelect.value) || 0;
        markDirty();
        draw();
      }
    });

    els.canvas.addEventListener("mousedown", onPointerDown);
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    els.canvas.addEventListener("wheel", onWheel, { passive: false });
    els.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    window.addEventListener("keydown", (evt) => {
      if (evt.target === els.search) return;
      if (evt.code === "Space") {
        state.spacePressed = true;
        els.canvasWrap.classList.add("panning");
        evt.preventDefault();
      }
      if (evt.ctrlKey && evt.key.toLowerCase() === "s") {
        evt.preventDefault();
        saveCurrent();
      }
      if (evt.key === "Delete" || evt.key === "Backspace") {
        evt.preventDefault();
        deleteSelected();
      }
      if (evt.key.toLowerCase() === "v") setMode("select");
      if (evt.key.toLowerCase() === "r") setMode("draw");
      if (evt.key.toLowerCase() === "f") fitToView();
      if (evt.key === "ArrowLeft") gotoIndex(state.currentIndex - 1);
      if (evt.key === "ArrowRight") gotoIndex(state.currentIndex + 1);
    });

    window.addEventListener("keyup", (evt) => {
      if (evt.code === "Space") {
        state.spacePressed = false;
        els.canvasWrap.classList.remove("panning", "dragging");
      }
    });

    window.addEventListener("beforeunload", (evt) => {
      if (state.dirty) {
        evt.preventDefault();
        evt.returnValue = "";
      }
    });

    window.addEventListener("resize", () => {
      resizeCanvas();
      fitToView();
    });

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        if (state.imageNatural.w) {
          resizeCanvas();
          fitToView();
        }
      });
      observer.observe(els.canvasWrap);
    }
  }

  async function boot() {
    bindEvents();
    await loadConfig();
    await loadItems();
    if (state.filteredItems.length > 0) {
      await gotoIndex(0);
    } else {
      setStatus("没有可编辑的图片", "error");
    }
  }

  boot().catch((err) => {
    setStatus(err.message || "启动失败", "error");
    toast("启动失败");
  });
})();
