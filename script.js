import {
  pointIsPossible,
  solveFiveBarIK,
  LEFT_ORIGIN,
  RIGHT_ORIGIN,
  ORIGIN_TO_ELBOW,
  ELBOW_TO_EFFECTOR,
} from "./fiveBar.js";

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { alpha: false });

const DRAW_SIZE = 400;
const EXTRA_WIDTH = 300;
const TOTAL_WIDTH = DRAW_SIZE + EXTRA_WIDTH;

let possiblePixelsCanvas = null;

const canvasToModel = ({ x, y }) => ({
  x: x / (DRAW_SIZE / 2) - 1,
  y: 1 - y / (DRAW_SIZE / 2),
});

const modelToCanvas = ({ x, y }) => ({
  x: (x + 1) * (DRAW_SIZE / 2),
  y: (1 - y) * (DRAW_SIZE / 2),
});

const state = {
  points: [],
  isClosedForInput: false,
  mouse: { x: 0, y: 0 },
  draggingIndex: null,
  dpr: Math.max(1, window.devicePixelRatio || 1),
};

const buildPossiblePixelsCache = () => {
  const off = document.createElement("canvas");
  off.width = DRAW_SIZE;
  off.height = DRAW_SIZE;

  const offCtx = off.getContext("2d");
  const img = offCtx.createImageData(DRAW_SIZE, DRAW_SIZE);
  const data = img.data;

  for (let y = 0; y < DRAW_SIZE; y++) {
    for (let x = 0; x < DRAW_SIZE; x++) {
      const p = canvasToModel({ x, y });

      if (pointIsPossible(p.x, p.y)) {
        const i = (y * DRAW_SIZE + x) * 4;
        data[i] = 25;
        data[i + 1] = 25;
        data[i + 2] = 25;
        data[i + 3] = 255;
      }
    }
  }

  offCtx.putImageData(img, 0, 0);
  possiblePixelsCanvas = off;
};

const resizeCanvas = () => {
  buildPossiblePixelsCache();
  const rect = canvas.getBoundingClientRect();
  state.dpr = Math.max(1, window.devicePixelRatio || 1);

  canvas.width = Math.round(rect.width * state.dpr);
  canvas.height = Math.round(rect.height * state.dpr);

  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  draw();
};

const getMousePos = (e) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
};

const getPointUnderMouse = (p) => {
  const radius = 8;
  for (let i = 0; i < state.points.length; i++) {
    const pt = state.points[i];
    const dx = pt.x - p.x;
    const dy = pt.y - p.y;
    if (dx * dx + dy * dy <= radius * radius) return i;
  }
  return null;
};

const drawGrid = () => {
  const step = 25;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, DRAW_SIZE, DRAW_SIZE);
  ctx.clip();

  ctx.lineWidth = 1;
  ctx.strokeStyle = "hsl(0, 0%, 15%)";

  for (let x = 0; x <= DRAW_SIZE; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, DRAW_SIZE);
    ctx.stroke();
  }

  for (let y = 0; y <= DRAW_SIZE; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(DRAW_SIZE, y);
    ctx.stroke();
  }

  ctx.restore();
};

const drawRedPoints = () => {
  const pts = [
    { x: 1.75, y: 0.25 },
    { x: 1.75, y: -0.25 },
  ];

  ctx.save();
  ctx.fillStyle = "red";

  for (const p of pts) {
    const c = modelToCanvas(p);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
};

const highlightPossiblePixels = () => {
  if (possiblePixelsCanvas) {
    ctx.drawImage(possiblePixelsCanvas, 0, 0);
  }
};

const drawLinkageSolution = (solution, target) => {
  const leftElbow = {
    x: LEFT_ORIGIN.x + Math.cos(solution.left) * ORIGIN_TO_ELBOW,
    y: LEFT_ORIGIN.y + Math.sin(solution.left) * ORIGIN_TO_ELBOW,
  };

  const rightElbow = {
    x: RIGHT_ORIGIN.x + Math.cos(solution.right) * ORIGIN_TO_ELBOW,
    y: RIGHT_ORIGIN.y + Math.sin(solution.right) * ORIGIN_TO_ELBOW,
  };

  const lo = modelToCanvas(LEFT_ORIGIN);
  const ro = modelToCanvas(RIGHT_ORIGIN);
  const le = modelToCanvas(leftElbow);
  const re = modelToCanvas(rightElbow);
  const t = modelToCanvas(target);

  ctx.save();
  ctx.lineWidth = 2;

  // left arm
  ctx.strokeStyle = "#4af";
  ctx.beginPath();
  ctx.moveTo(lo.x, lo.y);
  ctx.lineTo(le.x, le.y);
  ctx.lineTo(t.x, t.y);
  ctx.stroke();

  // right arm
  ctx.strokeStyle = "#fa4";
  ctx.beginPath();
  ctx.moveTo(ro.x, ro.y);
  ctx.lineTo(re.x, re.y);
  ctx.lineTo(t.x, t.y);
  ctx.stroke();

  ctx.fillStyle = "#fff";

  ctx.beginPath();
  ctx.arc(le.x, le.y, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(re.x, re.y, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

const draw = () => {
  ctx.clearRect(0, 0, TOTAL_WIDTH, DRAW_SIZE);

  ctx.fillStyle = "hsl(0, 0%, 4%)";
  ctx.fillRect(0, 0, DRAW_SIZE, DRAW_SIZE);

  ctx.fillStyle = "#000";
  ctx.fillRect(DRAW_SIZE, 0, EXTRA_WIDTH, DRAW_SIZE);

  highlightPossiblePixels();

  drawGrid();

  const pts = state.points;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, DRAW_SIZE, DRAW_SIZE);
  ctx.clip();

  if (pts.length > 0) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#eaeaea";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }

    ctx.stroke();

    ctx.fillStyle = "#eaeaea";

    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (!state.isClosedForInput && pts.length > 0) {
    const last = pts[pts.length - 1];

    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "#888";

    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(state.mouse.x, state.mouse.y);
    ctx.stroke();
  }

  ctx.restore();

  const mouseModel = canvasToModel(state.mouse);
  const solutions = solveFiveBarIK(mouseModel.x, mouseModel.y);

  if (solutions.length > 0) {
    drawLinkageSolution(solutions[0], mouseModel);
  }
  drawRedPoints();

  ctx.save();
  ctx.font =
    "12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  ctx.fillStyle = "#9a9a9a";

  const status = state.isClosedForInput
    ? "editing — drag points"
    : "drawing — right click to end";

  ctx.fillText(`points: ${state.points.length} — ${status}`, 12, 388);
  ctx.restore();
};

const addPoint = (p) => {
  if (state.isClosedForInput) return;
  if (p.x > DRAW_SIZE) return;
  state.points.push({ x: p.x, y: p.y });
  draw();
};

canvas.addEventListener("mousemove", (e) => {
  const p = getMousePos(e);
  state.mouse = p;

  if (state.draggingIndex !== null && p.x <= DRAW_SIZE) {
    state.points[state.draggingIndex].x = p.x;
    state.points[state.draggingIndex].y = p.y;
  }

  draw();
});

canvas.addEventListener("mousedown", (e) => {
  const p = getMousePos(e);

  if (p.x > DRAW_SIZE) return;

  if (state.isClosedForInput) {
    const idx = getPointUnderMouse(p);
    if (idx !== null) state.draggingIndex = idx;
    return;
  }

  if (e.button === 0) addPoint(p);
});

canvas.addEventListener("mouseup", () => {
  state.draggingIndex = null;
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  state.isClosedForInput = true;
  draw();
});

const getEdges = () => {
  const edges = [];

  for (let i = 0; i < state.points.length - 1; i++) {
    const a = canvasToModel(state.points[i]);
    const b = canvasToModel(state.points[i + 1]);

    edges.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    });
  }

  return edges;
};

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    console.log(getEdges());
  }
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
