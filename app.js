(() => {
  // ===========================================================================
  // STATE
  // ===========================================================================
  let nodes = [];
  let conns = [];
  let nId = 0;
  let cId = 0;

  let selNode = null;
  let selConn = null;
  let tool = "select";
  let connType = "sequential";

  let dragNid = null;
  let dragOx = 0;
  let dragOy = 0;
  let connecting = null;
  let palType = null;

  let history = [];
  let histIdx = -1;

  // ===========================================================================
  // DOM
  // ===========================================================================
  const els = {
    flowTitle: document.getElementById("flowTitle"),
    templateTabs: [...document.querySelectorAll(".htab")],
    validateBtn: document.getElementById("validateBtn"),
    exportJsonBtn: document.getElementById("exportJsonBtn"),
    exportSvgBtn: document.getElementById("exportSvgBtn"),
    importInput: document.getElementById("importInput"),

    aiPrompt: document.getElementById("aiPrompt"),
    aiSendBtn: document.getElementById("aiSendBtn"),
    aiSpinner: document.getElementById("aiSpinner"),
    aiStatusText: document.getElementById("aiStatusText"),
    aiChips: [...document.querySelectorAll(".ai-chip")],

    paletteCards: [...document.querySelectorAll(".pal-card")],
    connTypeButtons: [...document.querySelectorAll(".ct-btn")],

    valList: document.getElementById("valList"),

    wrap: document.getElementById("canvasWrap"),
    svgL: document.getElementById("svg-layer"),
    ghost: document.getElementById("ghost-line"),
    nodesCt: document.getElementById("canvasNodes"),
    minimap: document.getElementById("minimap"),

    tbSel: document.getElementById("tbSel"),
    tbConn: document.getElementById("tbConn"),
    undoBtn: document.getElementById("undoBtn"),
    deleteBtn: document.getElementById("deleteBtn"),
    clearBtn: document.getElementById("clearBtn"),

    propsEmpty: document.getElementById("propsEmpty"),
    nodeProps: document.getElementById("nodeProps"),
    connProps: document.getElementById("connProps"),
    typePill: document.getElementById("typePill"),
    nodeId: document.getElementById("nodeId"),

    pLabel: document.getElementById("pLabel"),
    pActor: document.getElementById("pActor"),
    pAHT: document.getElementById("pAHT"),
    pVol: document.getElementById("pVol"),
    pSLA: document.getElementById("pSLA"),
    pSystem: document.getElementById("pSystem"),
    pNotes: document.getElementById("pNotes"),
    statusBtns: [...document.querySelectorAll(".spill[data-status]")],
    deleteNodeBtn: document.getElementById("deleteNodeBtn"),

    connId: document.getElementById("connId"),
    cType: document.getElementById("cType"),
    cLabel: document.getElementById("cLabel"),
    condLblSec: document.getElementById("condLblSec"),
    deleteConnBtn: document.getElementById("deleteConnBtn"),

    sbNodes: document.getElementById("sbNodes"),
    sbConns: document.getElementById("sbConns"),
    sbMode: document.getElementById("sbMode"),
  };

  const DEFS = {
    process: { label: "Process Step" },
    decision: { label: "Decision?" },
    terminal: { label: "Start" },
    data: { label: "Data / System" },
    annotation: { label: "Note..." },
  };

  const MARKER_FOR_TYPE = {
    sequential: "mk-seq",
    conditional: "mk-cond",
    parallel: "mk-par",
    fallback: "mk-fall",
  };

  // ===========================================================================
  // UTIL
  // ===========================================================================
  function snap(v, g = 16) {
    return Math.round(v / g) * g;
  }

  function jsonClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function downloadText(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function nextNodeId() {
    nId += 1;
    return `n${nId}`;
  }

  function nextConnId() {
    cId += 1;
    return `c${cId}`;
  }

  function getNodeById(id) {
    return nodes.find((x) => x.id === id);
  }

  function getConnById(id) {
    return conns.find((x) => x.id === id);
  }

  // ===========================================================================
  // NODE CREATION + RENDERING
  // ===========================================================================
  function mkNode(type, x, y, label, aiGenerated = false, forcedId = null) {
    const node = {
      id: forcedId || nextNodeId(),
      type,
      x,
      y,
      label: label || DEFS[type]?.label || "Node",
      actor: "",
      status: "live",
      aht: "",
      volume: "",
      sla: "",
      system: "",
      notes: "",
    };
    nodes.push(node);
    renderNode(node, aiGenerated);
    updateStatus();
    updateMinimap();
    runValidation();
    return node;
  }

  function renderNode(node, aiGenerated = false) {
    const el = document.createElement("div");
    el.className = `fnode${aiGenerated ? " ai-generated" : ""}`;
    el.dataset.type = node.type;
    el.id = `node-${node.id}`;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;

    const body = document.createElement("div");
    body.className = "fnode-body";

    const label = document.createElement("div");
    label.className = "fnode-label";
    label.textContent = node.label;
    body.appendChild(label);

    const meta = document.createElement("div");
    meta.className = "fnode-meta";
    body.appendChild(meta);

    const dot = document.createElement("div");
    dot.className = `fnode-status-dot status-${node.status}`;
    body.appendChild(dot);

    el.appendChild(body);

    [
      ["pz-top", "top"],
      ["pz-right", "right", node.type === "decision" ? "YES ->" : ""],
      ["pz-bottom", "bottom", node.type === "decision" ? "NO v" : ""],
      ["pz-left", "left"],
    ].forEach(([cls, pos, portLabel]) => {
      const z = document.createElement("div");
      z.className = `port-zone ${cls}`;
      const p = document.createElement("div");
      p.className = "port";
      p.dataset.nid = node.id;
      p.dataset.pos = pos;
      p.addEventListener("mousedown", onPortMouseDown);
      p.addEventListener("mouseenter", onPortEnter);
      p.addEventListener("mouseleave", onPortLeave);
      z.appendChild(p);

      if (portLabel) {
        const pl = document.createElement("div");
        pl.className = "port-label";
        pl.textContent = portLabel;
        z.appendChild(pl);
      }

      el.appendChild(z);
    });

    el.addEventListener("mousedown", onNodeMouseDown);
    el.addEventListener("dblclick", onNodeDoubleClick);
    els.nodesCt.appendChild(el);

    refreshNodeEl(node);
  }

  function refreshNodeEl(node) {
    const el = document.getElementById(`node-${node.id}`);
    if (!el) return;

    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    const label = el.querySelector(".fnode-label");
    if (label) label.textContent = node.label;

    const meta = el.querySelector(".fnode-meta");
    if (meta) {
      meta.innerHTML = "";
      if (node.actor) {
        const actor = document.createElement("span");
        actor.className = `fnode-actor actor-${node.actor}`;
        actor.textContent = node.actor.charAt(0).toUpperCase() + node.actor.slice(1);
        meta.appendChild(actor);
      }
      if (node.aht) {
        const time = document.createElement("span");
        time.textContent = `${node.aht}min`;
        meta.appendChild(time);
      }
      if (node.system) {
        const sys = document.createElement("span");
        sys.textContent = node.system;
        meta.appendChild(sys);
      }
    }

    const dot = el.querySelector(".fnode-status-dot");
    if (dot) dot.className = `fnode-status-dot status-${node.status}`;

    const warn = nodeWarning(node);
    let flag = el.querySelector(".fnode-flag");
    if (warn) {
      if (!flag) {
        flag = document.createElement("div");
        flag.className = "fnode-flag";
        el.appendChild(flag);
      }
      flag.textContent = warn;
    } else if (flag) {
      flag.remove();
    }
  }

  function nodeWarning(node) {
    const outgoing = conns.filter((c) => c.from === node.id);
    const incoming = conns.filter((c) => c.to === node.id);
    if (node.type === "decision" && outgoing.length < 2) return "WARN: needs 2+ exits";
    if (node.type !== "terminal" && node.type !== "annotation" && incoming.length === 0 && outgoing.length === 0) {
      return "WARN: isolated";
    }
    return null;
  }

  // ===========================================================================
  // GEOMETRY + CONNECTIONS
  // ===========================================================================
  function getNodeBodyDimensions(nodeId) {
    const body = document.getElementById(`node-${nodeId}`)?.querySelector(".fnode-body");
    return {
      w: body?.offsetWidth || 136,
      h: body?.offsetHeight || 52,
    };
  }

  function getPortXY(nodeId, pos) {
    const node = getNodeById(nodeId);
    if (!node) return { x: 0, y: 0 };
    const { w, h } = getNodeBodyDimensions(nodeId);

    if (node.type === "decision") {
      const cx = node.x + w / 2;
      const cy = node.y + h / 2;
      return {
        top: { x: cx, y: cy - h / 2 },
        right: { x: cx + w / 2, y: cy },
        bottom: { x: cx, y: cy + h / 2 },
        left: { x: cx - w / 2, y: cy },
      }[pos] || { x: cx, y: cy };
    }

    return {
      top: { x: node.x + w / 2, y: node.y },
      right: { x: node.x + w, y: node.y + h / 2 },
      bottom: { x: node.x + w / 2, y: node.y + h },
      left: { x: node.x, y: node.y + h / 2 },
    }[pos] || { x: node.x + w / 2, y: node.y + h / 2 };
  }

  function bestPorts(aId, bId) {
    const a = getNodeById(aId);
    const b = getNodeById(bId);
    if (!a || !b) return ["right", "left"];

    const ad = getNodeBodyDimensions(aId);
    const bd = getNodeBodyDimensions(bId);
    const dx = b.x + bd.w / 2 - (a.x + ad.w / 2);
    const dy = b.y + bd.h / 2 - (a.y + ad.h / 2);

    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ["right", "left"] : ["left", "right"];
    return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
  }

  function getConnCurve(conn) {
    const [fromPort, toPort] = bestPorts(conn.from, conn.to);
    const from = getPortXY(conn.from, fromPort);
    const to = getPortXY(conn.to, toPort);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    const cx1 = fromPort === "left" || fromPort === "right" ? from.x + dx * 0.5 : from.x;
    const cy1 = fromPort === "top" || fromPort === "bottom" ? from.y + dy * 0.5 : from.y;
    const cx2 = toPort === "left" || toPort === "right" ? to.x - dx * 0.5 : to.x;
    const cy2 = toPort === "top" || toPort === "bottom" ? to.y - dy * 0.5 : to.y;
    const d = `M${from.x},${from.y} C${cx1},${cy1} ${cx2},${cy2} ${to.x},${to.y}`;

    return { d, from, to };
  }

  function mkConn(from, to, label = "", type = connType, forcedId = null) {
    if (from === to) return null;
    if (conns.find((c) => c.from === from && c.to === to)) return null;
    const conn = { id: forcedId || nextConnId(), from, to, label, type };
    conns.push(conn);
    renderConn(conn);

    [from, to].forEach((id) => {
      const node = getNodeById(id);
      if (node) refreshNodeEl(node);
    });
    updateStatus();
    updateMinimap();
    runValidation();
    return conn;
  }

  function renderConn(conn) {
    document.getElementById(`conn-${conn.id}`)?.remove();
    const curve = getConnCurve(conn);
    const marker = MARKER_FOR_TYPE[conn.type] || MARKER_FOR_TYPE.sequential;

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.id = `conn-${conn.id}`;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("conn-path", `ct-${conn.type}`);
    path.setAttribute("d", curve.d);
    path.setAttribute("marker-end", `url(#${marker})`);
    path.dataset.cid = conn.id;
    path.style.pointerEvents = "stroke";
    path.addEventListener("click", (event) => {
      event.stopPropagation();
      selectConn(conn.id);
    });
    g.appendChild(path);

    if (conn.label) {
      const mx = (curve.from.x + curve.to.x) / 2;
      const my = (curve.from.y + curve.to.y) / 2;
      const tw = conn.label.length * 5.8 + 10;

      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.classList.add("conn-label-bg");
      bg.setAttribute("x", String(mx - tw / 2));
      bg.setAttribute("y", String(my - 9));
      bg.setAttribute("width", String(tw));
      bg.setAttribute("height", "15");
      bg.setAttribute("rx", "3");
      g.appendChild(bg);

      const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
      txt.classList.add("conn-label-text", `ct-label-${conn.type}`);
      txt.setAttribute("x", String(mx));
      txt.setAttribute("y", String(my - 1));
      txt.textContent = conn.label;
      g.appendChild(txt);
    }

    els.svgL.appendChild(g);
  }

  function refreshAllConns() {
    conns.forEach(renderConn);
  }

  // ===========================================================================
  // SELECTION + PROPERTIES PANEL
  // ===========================================================================
  function deselectAll() {
    selNode = null;
    selConn = null;
    document.querySelectorAll(".fnode.selected").forEach((el) => el.classList.remove("selected"));
    document.querySelectorAll(".conn-path.selected").forEach((el) => el.classList.remove("selected"));

    els.propsEmpty.classList.remove("hidden");
    els.nodeProps.classList.add("hidden");
    els.connProps.classList.add("hidden");
  }

  function selectNode(id) {
    deselectAll();
    selNode = id;
    document.getElementById(`node-${id}`)?.classList.add("selected");
    const node = getNodeById(id);
    if (!node) return;

    els.propsEmpty.classList.add("hidden");
    els.nodeProps.classList.remove("hidden");

    els.typePill.textContent = node.type.charAt(0).toUpperCase() + node.type.slice(1);
    els.typePill.className = `type-pill tp-${node.type}`;
    els.nodeId.textContent = node.id;

    els.pLabel.value = node.label;
    els.pActor.value = node.actor || "";
    els.pAHT.value = node.aht || "";
    els.pVol.value = node.volume || "";
    els.pSLA.value = node.sla || "";
    els.pSystem.value = node.system || "";
    els.pNotes.value = node.notes || "";

    els.statusBtns.forEach((btn) => {
      const st = btn.dataset.status;
      btn.className = `spill${node.status === st ? ` s-${st}` : ""}`;
    });
  }

  function selectConn(id) {
    deselectAll();
    selConn = id;
    document.querySelector(`.conn-path[data-cid="${id}"]`)?.classList.add("selected");
    const conn = getConnById(id);
    if (!conn) return;

    els.propsEmpty.classList.add("hidden");
    els.connProps.classList.remove("hidden");
    els.connId.textContent = conn.id;
    els.cType.value = conn.type;
    els.cLabel.value = conn.label || "";
    els.condLblSec.classList.toggle("show", conn.type === "conditional" || conn.type === "fallback");
  }

  function updateNodeField(field, value) {
    if (!selNode) return;
    const node = getNodeById(selNode);
    if (!node) return;
    node[field] = value;
    refreshNodeEl(node);
    runValidation();
  }

  function updateConnField(field, value) {
    if (!selConn) return;
    const conn = getConnById(selConn);
    if (!conn) return;
    conn[field] = value;
    renderConn(conn);
    const fromNode = getNodeById(conn.from);
    const toNode = getNodeById(conn.to);
    if (fromNode) refreshNodeEl(fromNode);
    if (toNode) refreshNodeEl(toNode);
    if (field === "type") {
      els.condLblSec.classList.toggle("show", value === "conditional" || value === "fallback");
    }
    runValidation();
  }

  // ===========================================================================
  // DRAG + CONNECT
  // ===========================================================================
  function onNodeMouseDown(event) {
    if (event.target.classList.contains("port")) return;
    if (event.button !== 0) return;
    event.stopPropagation();

    const id = event.currentTarget.id.replace("node-", "");
    selectNode(id);

    if (tool === "select") {
      dragNid = id;
      const node = getNodeById(id);
      const r = els.wrap.getBoundingClientRect();
      dragOx = event.clientX - r.left - node.x;
      dragOy = event.clientY - r.top - node.y;
    }
  }

  function onCanvasMouseDown(event) {
    if (event.target === els.wrap || event.target === els.svgL || event.target.id === "canvasNodes") {
      deselectAll();
    }
  }

  function onCanvasMouseMove(event) {
    const r = els.wrap.getBoundingClientRect();
    const mx = event.clientX - r.left;
    const my = event.clientY - r.top;

    if (dragNid) {
      const node = getNodeById(dragNid);
      if (node) {
        node.x = Math.max(0, snap(mx - dragOx));
        node.y = Math.max(0, snap(my - dragOy));
        refreshNodeEl(node);
        refreshAllConns();
        updateMinimap();
      }
    }

    if (connecting) {
      const from = getPortXY(connecting.nodeId, connecting.port);
      els.ghost.setAttribute("d", `M${from.x},${from.y} Q${(from.x + mx) / 2},${from.y} ${mx},${my}`);
      els.ghost.style.opacity = "1";

      document.querySelectorAll(".port").forEach((p) => p.classList.remove("target-ready"));
      if (event.target.classList.contains("port") && event.target.dataset.nid !== connecting.nodeId) {
        event.target.classList.add("target-ready");
      }
    }
  }

  function onCanvasMouseUp(event) {
    if (dragNid) {
      dragNid = null;
      pushHistory();
    }

    if (connecting) {
      els.ghost.style.opacity = "0";
      els.ghost.setAttribute("d", "");
      document.querySelectorAll(".port").forEach((p) => p.classList.remove("target-ready", "connecting"));

      if (event.target.classList.contains("port") && event.target.dataset.nid !== connecting.nodeId) {
        mkConn(connecting.nodeId, event.target.dataset.nid, "", connType);
        pushHistory();
      }

      connecting = null;
    }
  }

  function onPortMouseDown(event) {
    event.stopPropagation();
    event.preventDefault();
    connecting = {
      nodeId: event.currentTarget.dataset.nid,
      port: event.currentTarget.dataset.pos,
    };
    event.currentTarget.classList.add("connecting");
  }

  function onPortEnter(event) {
    if (connecting && connecting.nodeId !== event.currentTarget.dataset.nid) {
      event.currentTarget.classList.add("target-ready");
    }
  }

  function onPortLeave(event) {
    event.currentTarget.classList.remove("target-ready");
  }

  function onNodeDoubleClick(event) {
    const id = event.currentTarget.id.replace("node-", "");
    const node = getNodeById(id);
    if (!node) return;
    const label = prompt("Label:", node.label);
    if (label !== null && label.trim()) {
      node.label = label.trim();
      refreshNodeEl(node);
      if (selNode === id) els.pLabel.value = node.label;
      pushHistory();
    }
  }

  // ===========================================================================
  // TOOLBAR + KEYBOARD
  // ===========================================================================
  function setTool(nextTool) {
    tool = nextTool;
    els.tbSel.classList.toggle("active", nextTool === "select");
    els.tbConn.classList.toggle("active", nextTool === "connect");
    els.sbMode.textContent = nextTool;
    els.wrap.style.cursor = nextTool === "connect" ? "crosshair" : "default";
  }

  function setConnType(type) {
    connType = type;
    els.connTypeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.ct === type));
  }

  function deleteSelected() {
    let changed = false;
    if (selNode) {
      const deleting = selNode;
      nodes = nodes.filter((n) => n.id !== deleting);
      document.getElementById(`node-${deleting}`)?.remove();
      conns = conns.filter((c) => {
        if (c.from === deleting || c.to === deleting) {
          document.getElementById(`conn-${c.id}`)?.remove();
          return false;
        }
        return true;
      });
      changed = true;
    }

    if (selConn) {
      const deleting = selConn;
      conns = conns.filter((c) => c.id !== deleting);
      document.getElementById(`conn-${deleting}`)?.remove();
      changed = true;
    }

    if (changed) {
      deselectAll();
      nodes.forEach(refreshNodeEl);
      updateStatus();
      updateMinimap();
      runValidation();
      pushHistory();
    }
  }

  function clearAll(silent = false) {
    if (!silent && nodes.length && !confirm("Clear canvas?")) return;
    els.nodesCt.innerHTML = "";
    els.svgL.querySelectorAll('g[id^="conn-"]').forEach((el) => el.remove());
    nodes = [];
    conns = [];
    nId = 0;
    cId = 0;
    deselectAll();
    updateStatus();
    updateMinimap();
    runValidation();
  }

  // ===========================================================================
  // VALIDATION
  // ===========================================================================
  function runValidation() {
    const issues = [];
    const flowNodes = nodes.filter((n) => n.type !== "annotation");
    const orphans = flowNodes.filter((n) => !conns.some((c) => c.from === n.id || c.to === n.id));
    if (orphans.length) {
      issues.push({ t: "warn", m: `${orphans.length} isolated node${orphans.length > 1 ? "s" : ""}` });
    }

    const badDecisions = nodes.filter((n) => n.type === "decision" && conns.filter((c) => c.from === n.id).length < 2);
    if (badDecisions.length) {
      issues.push({
        t: "error",
        m: `${badDecisions.length} decision node${badDecisions.length > 1 ? "s" : ""} need >=2 exits`,
      });
    }

    const unlabeledConditional = conns.filter((c) => c.type === "conditional" && !c.label.trim());
    if (unlabeledConditional.length) {
      issues.push({
        t: "warn",
        m: `${unlabeledConditional.length} conditional edge${unlabeledConditional.length > 1 ? "s" : ""} unlabeled`,
      });
    }

    const terminals = nodes.filter((n) => n.type === "terminal");
    if (nodes.length > 0 && terminals.length === 0) {
      issues.push({ t: "warn", m: "No terminal node found" });
    }

    els.valList.innerHTML = "";
    if (!issues.length || nodes.length === 0) {
      els.valList.innerHTML = `<div class="val-row ok"><span class="val-icon">OK</span>${
        nodes.length === 0 ? "Canvas ready" : "Flow looks good"
      }</div>`;
    } else {
      issues.forEach((i) => {
        els.valList.innerHTML += `<div class="val-row ${i.t}"><span class="val-icon">${
          i.t === "error" ? "ERR" : "WARN"
        }</span>${i.m}</div>`;
      });
    }
  }

  // ===========================================================================
  // STATUS + MINIMAP
  // ===========================================================================
  function updateStatus() {
    els.sbNodes.textContent = `${nodes.length} node${nodes.length !== 1 ? "s" : ""}`;
    els.sbConns.textContent = `${conns.length} connection${conns.length !== 1 ? "s" : ""}`;
  }

  function updateMinimap() {
    els.minimap.innerHTML = "";
    if (!nodes.length) return;

    const mmW = 130;
    const mmH = 80;
    const pad = 6;
    const maxX = Math.max(...nodes.map((n) => n.x)) + 160;
    const maxY = Math.max(...nodes.map((n) => n.y)) + 80;
    const scale = Math.min((mmW - pad * 2) / maxX, (mmH - pad * 2) / maxY) * 0.95;
    const color = {
      process: "#2d6ef5",
      decision: "#8b45d4",
      terminal: "#0f9e6e",
      data: "#d4720f",
      annotation: "#c8cdd6",
    };

    nodes.forEach((node) => {
      const d = document.createElement("div");
      d.className = "mm-node";
      d.style.left = `${node.x * scale + pad}px`;
      d.style.top = `${node.y * scale + pad}px`;
      d.style.width = `${Math.max(6, 128 * scale)}px`;
      d.style.height = `${Math.max(4, 50 * scale)}px`;
      d.style.background = color[node.type] || "#c8cdd6";
      els.minimap.appendChild(d);
    });
  }

  // ===========================================================================
  // HISTORY
  // ===========================================================================
  function pushHistory() {
    const state = { nodes: jsonClone(nodes), conns: jsonClone(conns), nId, cId };
    history = history.slice(0, histIdx + 1);
    history.push(state);
    histIdx = history.length - 1;
    if (history.length > 40) {
      history.shift();
      histIdx -= 1;
    }
  }

  function undo() {
    if (histIdx <= 0) return;
    histIdx -= 1;
    const state = history[histIdx];

    els.nodesCt.innerHTML = "";
    els.svgL.querySelectorAll('g[id^="conn-"]').forEach((el) => el.remove());
    nodes = jsonClone(state.nodes);
    conns = jsonClone(state.conns);
    nId = state.nId;
    cId = state.cId;

    deselectAll();
    nodes.forEach((n) => renderNode(n));
    conns.forEach((c) => renderConn(c));
    updateStatus();
    updateMinimap();
    runValidation();
  }

  // ===========================================================================
  // TEMPLATES
  // ===========================================================================
  function setTemplateTab(name) {
    els.templateTabs.forEach((t) => t.classList.toggle("active", t.dataset.template === name));
    if (name === "blank") {
      clearAll();
      pushHistory();
      return;
    }
    loadTemplate(name);
  }

  function loadTemplate(name) {
    clearAll(true);
    if (name === "support") buildSupportTemplate();
    if (name === "onboarding") buildOnboardingTemplate();
    if (name === "sales") buildSalesTemplate();
    pushHistory();
  }

  function buildSupportTemplate() {
    els.flowTitle.value = "Customer Support Journey";
    const n1 = mkNode("terminal", 60, 60, "Customer Contacts");
    const n2 = mkNode("process", 260, 60, "Triage Request");
    const n3 = mkNode("decision", 460, 44, "Issue Type?");
    const n4 = mkNode("process", 330, 200, "Handle Billing");
    const n5 = mkNode("process", 560, 200, "Handle Technical");
    const n6 = mkNode("process", 790, 200, "Handle Account");
    const n7 = mkNode("data", 330, 340, "Verify Identity");
    const n8 = mkNode("decision", 330, 470, "Verified?");
    const n9 = mkNode("process", 170, 590, "Request Proof");
    const n10 = mkNode("process", 490, 590, "Process Resolution");
    const n11 = mkNode("terminal", 490, 710, "Resolved");
    const n12 = mkNode("process", 790, 340, "Escalate Manager");

    n1.actor = "customer";
    n2.actor = "agent";
    n3.actor = "agent";
    n4.actor = "agent";
    n5.actor = "system";
    n6.actor = "agent";
    n7.actor = "system";
    n8.actor = "agent";
    n9.actor = "agent";
    n10.actor = "system";
    n12.actor = "manager";
    n7.system = "CRM";
    n10.system = "Billing API";
    n2.aht = "2";
    n4.aht = "5";
    n10.aht = "3";
    nodes.forEach(refreshNodeEl);

    mkConn(n1.id, n2.id, "", "sequential");
    mkConn(n2.id, n3.id, "", "sequential");
    mkConn(n3.id, n4.id, "Billing", "conditional");
    mkConn(n3.id, n5.id, "Technical", "conditional");
    mkConn(n3.id, n6.id, "Account", "conditional");
    mkConn(n4.id, n7.id, "", "sequential");
    mkConn(n7.id, n8.id, "", "sequential");
    mkConn(n8.id, n10.id, "Yes", "conditional");
    mkConn(n8.id, n9.id, "No", "fallback");
    mkConn(n10.id, n11.id, "", "sequential");
    mkConn(n6.id, n12.id, "", "sequential");
    mkConn(n5.id, n11.id, "", "sequential");
  }

  function buildOnboardingTemplate() {
    els.flowTitle.value = "User Onboarding Flow";
    const n1 = mkNode("terminal", 60, 100, "User Arrives");
    const n2 = mkNode("process", 250, 100, "Show Landing");
    const n3 = mkNode("decision", 450, 84, "Sign Up?");
    const n4 = mkNode("process", 330, 240, "Complete Form");
    const n5 = mkNode("data", 330, 370, "Send Verify Email");
    const n6 = mkNode("decision", 330, 490, "Verified?");
    const n7 = mkNode("process", 510, 490, "Start Tour");
    const n8 = mkNode("terminal", 510, 620, "Activated");
    const n9 = mkNode("process", 150, 490, "Resend Email");
    const n10 = mkNode("terminal", 640, 100, "Exit");

    n1.actor = "customer";
    n2.actor = "system";
    n4.actor = "customer";
    n5.actor = "system";
    n5.system = "Email Provider";
    n7.actor = "system";
    n9.actor = "system";
    nodes.forEach(refreshNodeEl);

    mkConn(n1.id, n2.id, "", "sequential");
    mkConn(n2.id, n3.id, "", "sequential");
    mkConn(n3.id, n4.id, "Yes", "conditional");
    mkConn(n3.id, n10.id, "No", "fallback");
    mkConn(n4.id, n5.id, "", "sequential");
    mkConn(n5.id, n6.id, "", "sequential");
    mkConn(n6.id, n7.id, "Verified", "conditional");
    mkConn(n6.id, n9.id, "Timeout", "fallback");
    mkConn(n7.id, n8.id, "", "sequential");
    mkConn(n9.id, n6.id, "", "sequential");
  }

  function buildSalesTemplate() {
    els.flowTitle.value = "Enterprise Sales Funnel";
    const n1 = mkNode("terminal", 60, 130, "Lead Identified");
    const n2 = mkNode("process", 250, 130, "Qualify Lead");
    const n3 = mkNode("decision", 450, 114, "Qualified?");
    const n4 = mkNode("process", 340, 270, "Discovery Call");
    const n5 = mkNode("process", 540, 270, "Run Demo");
    const n6 = mkNode("process", 740, 270, "Send Proposal");
    const n7 = mkNode("decision", 740, 400, "Budget Approved?");
    const n8 = mkNode("process", 620, 520, "Negotiate Terms");
    const n9 = mkNode("terminal", 620, 640, "Closed Won");
    const n10 = mkNode("terminal", 900, 400, "Closed Lost");
    const n11 = mkNode("data", 250, 270, "Log in CRM");

    n1.actor = "system";
    n2.actor = "agent";
    n4.actor = "agent";
    n5.actor = "agent";
    n6.actor = "agent";
    n8.actor = "manager";
    n11.actor = "system";
    n11.system = "CRM";
    n2.aht = "15";
    n4.aht = "30";
    n5.aht = "45";
    nodes.forEach(refreshNodeEl);

    mkConn(n1.id, n2.id, "", "sequential");
    mkConn(n2.id, n11.id, "", "parallel");
    mkConn(n2.id, n3.id, "", "sequential");
    mkConn(n3.id, n4.id, "Yes", "conditional");
    mkConn(n3.id, n10.id, "No", "fallback");
    mkConn(n4.id, n5.id, "", "sequential");
    mkConn(n5.id, n6.id, "", "sequential");
    mkConn(n6.id, n7.id, "", "sequential");
    mkConn(n7.id, n8.id, "Yes", "conditional");
    mkConn(n7.id, n10.id, "No", "fallback");
    mkConn(n8.id, n9.id, "", "sequential");
  }

  // ===========================================================================
  // AI GENERATION (local fallback + optional remote endpoint)
  // ===========================================================================
  function setAiStatus(text) {
    els.aiStatusText.textContent = text;
  }

  function setAiBusy(busy) {
    els.aiSendBtn.disabled = busy;
    els.aiSpinner.classList.toggle("show", busy);
  }

  async function generateFlow() {
    const prompt = els.aiPrompt.value.trim();
    if (!prompt) return;
    setAiBusy(true);
    setAiStatus("Generating flow...");

    try {
      const flow = await generateFlowData(prompt);
      loadFlowObject(flow, true);
      setAiStatus(`Generated ${flow.nodes.length} nodes - ${(flow.connections || []).length} connections`);
      setTimeout(() => setAiStatus("Local AI fallback enabled (no key required)"), 4000);
    } catch (err) {
      console.error(err);
      setAiStatus("Error: could not generate flow");
      setTimeout(() => setAiStatus("Local AI fallback enabled (no key required)"), 3000);
    } finally {
      setAiBusy(false);
    }
  }

  async function generateFlowData(prompt) {
    const endpoint = window.WORKFLOW_AI_ENDPOINT;
    if (endpoint) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(window.WORKFLOW_AI_KEY ? { Authorization: `Bearer ${window.WORKFLOW_AI_KEY}` } : {}),
          },
          body: JSON.stringify({ prompt }),
        });
        if (res.ok) {
          const data = await res.json();
          if (isFlowShape(data)) return normalizeFlow(data);
        }
      } catch {
        // Fall back silently to local generation.
      }
    }
    return buildLocalAiFlow(prompt);
  }

  function isFlowShape(value) {
    return value && Array.isArray(value.nodes) && Array.isArray(value.connections);
  }

  function normalizeFlow(flow) {
    const out = {
      title: flow.title || "Generated Workflow",
      nodes: flow.nodes.map((n, i) => ({
        id: String(n.id || `n${i + 1}`),
        type: ["terminal", "process", "decision", "data", "annotation"].includes(n.type) ? n.type : "process",
        label: String(n.label || "Step"),
        actor: n.actor || "",
        x: Number.isFinite(n.x) ? n.x : 60 + i * 180,
        y: Number.isFinite(n.y) ? n.y : 120,
        status: n.status || "live",
        aht: n.aht || "",
        volume: n.volume || "",
        sla: n.sla || "",
        system: n.system || "",
        notes: n.notes || "",
      })),
      connections: flow.connections.map((c) => ({
        from: String(c.from),
        to: String(c.to),
        label: c.label || "",
        type: ["sequential", "conditional", "parallel", "fallback"].includes(c.type) ? c.type : "sequential",
      })),
    };
    return out;
  }

  function buildLocalAiFlow(promptRaw) {
    const prompt = promptRaw.toLowerCase();
    if (prompt.includes("refund")) return localRefundFlow();
    if (prompt.includes("auth") || prompt.includes("login") || prompt.includes("password")) return localAuthFlow();
    if (prompt.includes("onboard") || prompt.includes("employee")) return localOnboardingFlow();
    if (prompt.includes("approval") || prompt.includes("approve")) return localApprovalFlow();
    if (prompt.includes("incident") || prompt.includes("escalat")) return localIncidentFlow();
    return localGenericFlow(promptRaw);
  }

  function localRefundFlow() {
    return normalizeFlow({
      title: "Customer Refund Workflow",
      nodes: [
        { id: "n1", type: "terminal", label: "Request Received", actor: "customer", x: 60, y: 120 },
        { id: "n2", type: "process", label: "Validate Request", actor: "agent", x: 260, y: 120 },
        { id: "n3", type: "decision", label: "Eligible?", actor: "agent", x: 460, y: 104 },
        { id: "n4", type: "data", label: "Check Payment", actor: "system", system: "Payment API", x: 650, y: 120 },
        { id: "n5", type: "process", label: "Issue Refund", actor: "system", x: 850, y: 120 },
        { id: "n6", type: "terminal", label: "Refund Complete", actor: "customer", x: 1040, y: 120 },
        { id: "n7", type: "process", label: "Send Rejection", actor: "agent", x: 650, y: 280 },
        { id: "n8", type: "terminal", label: "Request Closed", actor: "customer", x: 850, y: 280 },
      ],
      connections: [
        { from: "n1", to: "n2", type: "sequential" },
        { from: "n2", to: "n3", type: "sequential" },
        { from: "n3", to: "n4", type: "conditional", label: "Yes" },
        { from: "n4", to: "n5", type: "sequential" },
        { from: "n5", to: "n6", type: "sequential" },
        { from: "n3", to: "n7", type: "fallback", label: "No" },
        { from: "n7", to: "n8", type: "sequential" },
      ],
    });
  }

  function localAuthFlow() {
    return normalizeFlow({
      title: "Authentication Flow",
      nodes: [
        { id: "n1", type: "terminal", label: "User Opens App", actor: "customer", x: 70, y: 120 },
        { id: "n2", type: "process", label: "Enter Credentials", actor: "customer", x: 260, y: 120 },
        { id: "n3", type: "data", label: "Verify Identity", actor: "system", system: "Auth Service", x: 450, y: 120 },
        { id: "n4", type: "decision", label: "Credentials Valid?", actor: "system", x: 660, y: 104 },
        { id: "n5", type: "process", label: "Create Session", actor: "system", x: 860, y: 120 },
        { id: "n6", type: "terminal", label: "User Logged In", actor: "customer", x: 1060, y: 120 },
        { id: "n7", type: "process", label: "Show Error", actor: "system", x: 860, y: 280 },
        { id: "n8", type: "terminal", label: "Retry Login", actor: "customer", x: 1060, y: 280 },
      ],
      connections: [
        { from: "n1", to: "n2", type: "sequential" },
        { from: "n2", to: "n3", type: "sequential" },
        { from: "n3", to: "n4", type: "sequential" },
        { from: "n4", to: "n5", type: "conditional", label: "Yes" },
        { from: "n5", to: "n6", type: "sequential" },
        { from: "n4", to: "n7", type: "fallback", label: "No" },
        { from: "n7", to: "n8", type: "sequential" },
      ],
    });
  }

  function localOnboardingFlow() {
    return normalizeFlow({
      title: "Employee Onboarding Process",
      nodes: [
        { id: "n1", type: "terminal", label: "Candidate Accepts", actor: "external", x: 80, y: 110 },
        { id: "n2", type: "process", label: "Create Profile", actor: "manager", x: 280, y: 110 },
        { id: "n3", type: "process", label: "Provision Access", actor: "system", x: 480, y: 110 },
        { id: "n5", type: "process", label: "Schedule Training", actor: "manager", x: 680, y: 60 },
        { id: "n6", type: "data", label: "Prepare Equipment", actor: "system", x: 680, y: 180, system: "ITSM" },
        { id: "n7", type: "decision", label: "All Ready?", actor: "manager", x: 900, y: 104 },
        { id: "n8", type: "terminal", label: "Onboarding Complete", actor: "external", x: 1100, y: 110 },
        { id: "n9", type: "process", label: "Resolve Blockers", actor: "manager", x: 1100, y: 280 },
      ],
      connections: [
        { from: "n1", to: "n2", type: "sequential" },
        { from: "n2", to: "n3", type: "sequential" },
        { from: "n3", to: "n5", type: "parallel" },
        { from: "n3", to: "n6", type: "parallel" },
        { from: "n5", to: "n7", type: "sequential" },
        { from: "n6", to: "n7", type: "sequential" },
        { from: "n7", to: "n8", type: "conditional", label: "Yes" },
        { from: "n7", to: "n9", type: "fallback", label: "No" },
      ],
    });
  }

  function localApprovalFlow() {
    return normalizeFlow({
      title: "Content Approval Workflow",
      nodes: [
        { id: "n1", type: "terminal", label: "Draft Created", actor: "agent", x: 70, y: 130 },
        { id: "n2", type: "process", label: "Run QA Review", actor: "agent", x: 270, y: 130 },
        { id: "n3", type: "decision", label: "Meets Standards?", actor: "manager", x: 470, y: 114 },
        { id: "n4", type: "process", label: "Publish Content", actor: "system", x: 670, y: 130 },
        { id: "n5", type: "terminal", label: "Live", actor: "customer", x: 860, y: 130 },
        { id: "n6", type: "process", label: "Request Revisions", actor: "manager", x: 670, y: 280 },
        { id: "n7", type: "process", label: "Update Draft", actor: "agent", x: 470, y: 280 },
      ],
      connections: [
        { from: "n1", to: "n2", type: "sequential" },
        { from: "n2", to: "n3", type: "sequential" },
        { from: "n3", to: "n4", type: "conditional", label: "Yes" },
        { from: "n4", to: "n5", type: "sequential" },
        { from: "n3", to: "n6", type: "fallback", label: "No" },
        { from: "n6", to: "n7", type: "sequential" },
        { from: "n7", to: "n2", type: "sequential" },
      ],
    });
  }

  function localIncidentFlow() {
    return normalizeFlow({
      title: "Incident Escalation Workflow",
      nodes: [
        { id: "n1", type: "terminal", label: "Incident Reported", actor: "customer", x: 70, y: 140 },
        { id: "n2", type: "process", label: "Triage Severity", actor: "agent", x: 270, y: 140 },
        { id: "n3", type: "decision", label: "Critical?", actor: "agent", x: 470, y: 124 },
        { id: "n4", type: "process", label: "Assign Resolver", actor: "manager", x: 670, y: 80 },
        { id: "n5", type: "data", label: "Update Status Page", actor: "system", x: 670, y: 210, system: "Statuspage" },
        { id: "n6", type: "process", label: "Apply Fix", actor: "agent", x: 880, y: 140 },
        { id: "n7", type: "terminal", label: "Resolved", actor: "customer", x: 1080, y: 140 },
        { id: "n8", type: "process", label: "Standard Queue", actor: "agent", x: 670, y: 320 },
      ],
      connections: [
        { from: "n1", to: "n2", type: "sequential" },
        { from: "n2", to: "n3", type: "sequential" },
        { from: "n3", to: "n4", type: "conditional", label: "Yes" },
        { from: "n3", to: "n8", type: "fallback", label: "No" },
        { from: "n4", to: "n5", type: "parallel" },
        { from: "n4", to: "n6", type: "sequential" },
        { from: "n6", to: "n7", type: "sequential" },
      ],
    });
  }

  function localGenericFlow(prompt) {
    const topic = prompt.length > 50 ? `${prompt.slice(0, 47)}...` : prompt;
    return normalizeFlow({
      title: `Workflow: ${topic || "Generated"}`,
      nodes: [
        { id: "n1", type: "terminal", label: "Start", actor: "customer", x: 70, y: 140 },
        { id: "n2", type: "process", label: "Capture Request", actor: "agent", x: 270, y: 140 },
        { id: "n3", type: "decision", label: "Valid Input?", actor: "agent", x: 470, y: 124 },
        { id: "n4", type: "process", label: "Process Request", actor: "system", x: 670, y: 80 },
        { id: "n5", type: "data", label: "Update System", actor: "system", x: 670, y: 220, system: "Core API" },
        { id: "n6", type: "terminal", label: "Complete", actor: "customer", x: 900, y: 140 },
        { id: "n7", type: "process", label: "Reject Request", actor: "agent", x: 670, y: 340 },
      ],
      connections: [
        { from: "n1", to: "n2", type: "sequential" },
        { from: "n2", to: "n3", type: "sequential" },
        { from: "n3", to: "n4", type: "conditional", label: "Yes" },
        { from: "n4", to: "n5", type: "sequential" },
        { from: "n5", to: "n6", type: "sequential" },
        { from: "n3", to: "n7", type: "fallback", label: "No" },
      ],
    });
  }

  function loadFlowObject(flow, aiGenerated = false) {
    const clean = normalizeFlow(flow);
    clearAll(true);
    if (clean.title) els.flowTitle.value = clean.title;

    const idMap = {};
    clean.nodes.forEach((n) => {
      const created = mkNode(n.type, snap(n.x), snap(n.y), n.label, aiGenerated);
      created.actor = n.actor || "";
      created.status = n.status || "live";
      created.aht = n.aht || "";
      created.volume = n.volume || "";
      created.sla = n.sla || "";
      created.system = n.system || "";
      created.notes = n.notes || "";
      refreshNodeEl(created);
      idMap[n.id] = created.id;
    });

    clean.connections.forEach((c) => {
      const fromId = idMap[c.from];
      const toId = idMap[c.to];
      if (fromId && toId) mkConn(fromId, toId, c.label || "", c.type || "sequential");
    });

    runValidation();
    pushHistory();
  }

  // ===========================================================================
  // IMPORT / EXPORT
  // ===========================================================================
  function exportJson() {
    const payload = {
      title: els.flowTitle.value.trim() || "Untitled Workflow",
      nodes,
      connections: conns,
    };
    downloadText("workflow-designer-export.json", JSON.stringify(payload, null, 2), "application/json");
  }

  function importJsonFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        if (!isFlowShape(parsed)) {
          alert("Invalid file: expected { nodes:[], connections:[] }");
          return;
        }
        loadFlowObject(parsed);
      } catch {
        alert("Could not parse JSON file.");
      }
    };
    reader.readAsText(file);
  }

  function nodeSvgShape(node, x, y, w, h) {
    const common = 'stroke-width="1.5" fill="#fff"';
    if (node.type === "process") {
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ry="8" ${common} stroke="#d5e0fc"/>`;
    }
    if (node.type === "terminal") {
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ry="${h / 2}" ${common} stroke="#c8eee2"/>`;
    }
    if (node.type === "decision") {
      const cx = x + w / 2;
      const cy = y + h / 2;
      return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" ${common} stroke="#ddd0f5"/>`;
    }
    if (node.type === "data") {
      return `<polygon points="${x + 10},${y} ${x + w},${y} ${x + w - 10},${y + h} ${x},${y + h}" ${common} stroke="#f3dfc0"/>`;
    }
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" ry="4" fill="#fffef0" stroke="#d4c87a" stroke-dasharray="4 3"/>`;
  }

  function exportSVG() {
    if (!nodes.length) {
      alert("Nothing to export.");
      return;
    }

    const maxX = Math.max(...nodes.map((n) => n.x)) + 260;
    const maxY = Math.max(...nodes.map((n) => n.y)) + 220;
    const width = Math.max(1200, maxX);
    const height = Math.max(700, maxY);

    const markerDefs = `
      <defs>
        <marker id="mk-seq-export" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L0,7 L7,3.5z" fill="#c1c8d4"/></marker>
        <marker id="mk-cond-export" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L0,7 L7,3.5z" fill="#2d6ef5"/></marker>
        <marker id="mk-par-export" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L0,7 L7,3.5z" fill="#0f9e6e"/></marker>
        <marker id="mk-fall-export" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L0,7 L7,3.5z" fill="#e0443a"/></marker>
      </defs>`;

    const marker = {
      sequential: "mk-seq-export",
      conditional: "mk-cond-export",
      parallel: "mk-par-export",
      fallback: "mk-fall-export",
    };
    const stroke = {
      sequential: "#c1c8d4",
      conditional: "#2d6ef5",
      parallel: "#0f9e6e",
      fallback: "#e0443a",
    };

    const connSvg = conns
      .map((c) => {
        const curve = getConnCurve(c);
        const dashed = c.type === "fallback" ? 'stroke-dasharray="6 3"' : "";
        const label = c.label
          ? `<text x="${(curve.from.x + curve.to.x) / 2}" y="${(curve.from.y + curve.to.y) / 2 - 6}" text-anchor="middle" font-size="10" font-family="DM Sans, sans-serif" fill="${stroke[c.type] || stroke.sequential}">${escapeXml(
              c.label
            )}</text>`
          : "";
        return `<path d="${curve.d}" fill="none" stroke="${stroke[c.type] || stroke.sequential}" stroke-width="1.5" marker-end="url(#${
          marker[c.type] || marker.sequential
        })" ${dashed}/>${label}`;
      })
      .join("");

    const nodeSvg = nodes
      .map((n) => {
        const d = getNodeBodyDimensions(n.id);
        const shape = nodeSvgShape(n, n.x, n.y, d.w, d.h);
        const labelX = n.x + d.w / 2;
        const labelY = n.y + d.h / 2 + 4;
        return `${shape}<text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="11" font-weight="500" font-family="DM Sans, sans-serif" fill="#1a1d23">${escapeXml(
          n.label
        )}</text>`;
      })
      .join("");

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#f8f9fb"/>
  ${markerDefs}
  ${connSvg}
  ${nodeSvg}
</svg>`;

    downloadText("workflow-designer-export.svg", svg, "image/svg+xml");
  }

  function escapeXml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  // ===========================================================================
  // EVENTS
  // ===========================================================================
  function wireEvents() {
    els.paletteCards.forEach((card) => {
      card.addEventListener("dragstart", (event) => {
        palType = card.dataset.type;
        event.dataTransfer.effectAllowed = "copy";
      });
    });

    els.wrap.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!palType) return;
      const r = els.wrap.getBoundingClientRect();
      const x = snap(event.clientX - r.left - 68);
      const y = snap(event.clientY - r.top - 26);
      mkNode(palType, x, y);
      pushHistory();
      palType = null;
    });

    els.wrap.addEventListener("mousedown", onCanvasMouseDown);
    els.wrap.addEventListener("mousemove", onCanvasMouseMove);
    els.wrap.addEventListener("mouseup", onCanvasMouseUp);

    els.connTypeButtons.forEach((btn) => {
      btn.addEventListener("click", () => setConnType(btn.dataset.ct));
    });

    els.tbSel.addEventListener("click", () => setTool("select"));
    els.tbConn.addEventListener("click", () => setTool("connect"));
    els.undoBtn.addEventListener("click", undo);
    els.deleteBtn.addEventListener("click", deleteSelected);
    els.clearBtn.addEventListener("click", () => {
      clearAll();
      pushHistory();
    });

    els.validateBtn.addEventListener("click", runValidation);
    els.exportJsonBtn.addEventListener("click", exportJson);
    els.exportSvgBtn.addEventListener("click", exportSVG);
    els.importInput.addEventListener("change", () => {
      const file = els.importInput.files?.[0];
      if (file) importJsonFile(file);
      els.importInput.value = "";
    });

    els.templateTabs.forEach((tab) => {
      tab.addEventListener("click", () => setTemplateTab(tab.dataset.template));
    });

    els.pLabel.addEventListener("input", (e) => updateNodeField("label", e.target.value));
    els.pActor.addEventListener("change", (e) => updateNodeField("actor", e.target.value));
    els.pAHT.addEventListener("input", (e) => updateNodeField("aht", e.target.value));
    els.pVol.addEventListener("input", (e) => updateNodeField("volume", e.target.value));
    els.pSLA.addEventListener("input", (e) => updateNodeField("sla", e.target.value));
    els.pSystem.addEventListener("input", (e) => updateNodeField("system", e.target.value));
    els.pNotes.addEventListener("input", (e) => updateNodeField("notes", e.target.value));
    els.statusBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        updateNodeField("status", btn.dataset.status);
        els.statusBtns.forEach((other) => {
          const st = other.dataset.status;
          other.className = `spill${btn.dataset.status === st ? ` s-${st}` : ""}`;
        });
      });
    });
    els.deleteNodeBtn.addEventListener("click", deleteSelected);

    els.cType.addEventListener("change", (e) => updateConnField("type", e.target.value));
    els.cLabel.addEventListener("input", (e) => updateConnField("label", e.target.value));
    els.deleteConnBtn.addEventListener("click", deleteSelected);

    els.aiChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        els.aiPrompt.value = chip.dataset.prompt || "";
        generateFlow();
      });
    });
    els.aiSendBtn.addEventListener("click", generateFlow);
    els.aiPrompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        generateFlow();
      }
    });

    document.addEventListener("keydown", (event) => {
      const activeTag = document.activeElement?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)) return;

      if (event.key === "Delete" || event.key === "Backspace") deleteSelected();
      if (event.key === "Escape") {
        deselectAll();
        setTool("select");
      }
      if (event.key === "v" || event.key === "V") setTool("select");
      if (event.key === "c" || event.key === "C") setTool("connect");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
    });

    // Persist edits into history with debounce-like behavior (on blur).
    [
      els.pLabel,
      els.pActor,
      els.pAHT,
      els.pVol,
      els.pSLA,
      els.pSystem,
      els.pNotes,
      els.cType,
      els.cLabel,
    ].forEach((field) => {
      field.addEventListener("blur", pushHistory);
    });
  }

  // ===========================================================================
  // BOOT
  // ===========================================================================
  function init() {
    wireEvents();
    setConnType("sequential");
    setTool("select");
    loadTemplate("support");
    pushHistory();
  }

  init();
})();
