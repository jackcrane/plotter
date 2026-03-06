import {
  pointIsPossible,
  solveFiveBarIK,
  LEFT_ORIGIN,
  RIGHT_ORIGIN,
  ORIGIN_TO_ELBOW,
  ELBOW_TO_EFFECTOR,
  MAX_MOTOR_ANGLE,
} from "./fiveBar.js";
import { downloadStackedDiscScad, parseStackedDiscScad } from "./scad.js";

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { alpha: false });
const uploadScadBtn = document.getElementById("upload-scad-btn");
const uploadScadInput = document.getElementById("upload-scad-input");
const downloadScadBtn = document.getElementById("download-scad-btn");

const DRAW_SIZE = 400;
const EXTRA_WIDTH = 300;
const GRAPH_HEIGHT = 120;
const TOTAL_WIDTH = DRAW_SIZE + EXTRA_WIDTH;
const TOTAL_HEIGHT = DRAW_SIZE + GRAPH_HEIGHT;
const PLAYBACK_SAMPLE_HZ = 60;
const DRAW_DRAG_SPACING_PX = 10;
const DRAW_POINT_MERGE_THRESHOLD_PX = 0.5;

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
  drawingWithMouse: false,
  lastDrawSample: null,
  dpr: Math.max(1, window.devicePixelRatio || 1),
  playback: {
    active: false,
    rafId: null,
    startTime: 0,
    distance: 0,
    totalLength: 0,
    totalDurationSec: 0,
    points: [],
    segments: [],
    samples: [],
    target: null,
  },
};

const PLAYBACK_SPEED_PX_PER_SEC = 120;

const clampToDrawArea = (p) => ({
  x: Math.max(0, Math.min(DRAW_SIZE, p.x)),
  y: Math.max(0, Math.min(DRAW_SIZE, p.y)),
});

const isInDrawArea = (p) =>
  p.x >= 0 && p.x <= DRAW_SIZE && p.y >= 0 && p.y <= DRAW_SIZE;

const degreesToRadians = (deg) => (deg * Math.PI) / 180;
const radiansToDegrees = (rad) => (rad * 180) / Math.PI;
const toGraphDegrees = (deg) => Math.abs(deg) - 80;

const chooseClosestSolution = (solutions, previousSolution) => {
  if (!previousSolution || solutions.length <= 1) return solutions[0];

  let best = solutions[0];
  let bestDistance =
    Math.abs(best.left - previousSolution.left) +
    Math.abs(best.right - previousSolution.right);

  for (let i = 1; i < solutions.length; i++) {
    const candidate = solutions[i];
    const candidateDistance =
      Math.abs(candidate.left - previousSolution.left) +
      Math.abs(candidate.right - previousSolution.right);

    if (candidateDistance < bestDistance) {
      best = candidate;
      bestDistance = candidateDistance;
    }
  }

  return best;
};

const getPlaybackTargetAtDistanceFromPath = (
  distance,
  segments,
  totalLength,
  points
) => {
  const d = Math.max(0, Math.min(distance, totalLength));

  for (const seg of segments) {
    if (d <= seg.endDistance) {
      const segD = d - seg.startDistance;
      const t = seg.length === 0 ? 0 : segD / seg.length;
      return {
        x: seg.a.x + (seg.b.x - seg.a.x) * t,
        y: seg.a.y + (seg.b.y - seg.a.y) * t,
      };
    }
  }

  return points[points.length - 1] || null;
};

const buildPlaybackSamples = (segments, totalLength, points) => {
  if (segments.length === 0 || totalLength <= 0) {
    return { samples: [], totalDurationSec: 0 };
  }

  const totalDurationSec = totalLength / PLAYBACK_SPEED_PX_PER_SEC;
  const stepDistance = PLAYBACK_SPEED_PX_PER_SEC / PLAYBACK_SAMPLE_HZ;

  const distances = [0];
  for (let d = stepDistance; d < totalLength; d += stepDistance) {
    distances.push(d);
  }
  distances.push(totalLength);

  const samples = [];
  let previousSolution = null;

  for (const d of distances) {
    const target = getPlaybackTargetAtDistanceFromPath(
      d,
      segments,
      totalLength,
      points
    );

    if (!target) continue;

    const targetModel = canvasToModel(target);
    const solutions = solveFiveBarIK(targetModel.x, targetModel.y);

    if (solutions.length === 0) {
      samples.push({
        timeSec: d / PLAYBACK_SPEED_PX_PER_SEC,
        leftDeg: null,
        rightDeg: null,
      });
      previousSolution = null;
      continue;
    }

    const selectedSolution = chooseClosestSolution(solutions, previousSolution);
    previousSolution = selectedSolution;

    const leftDeg = radiansToDegrees(selectedSolution.left);
    const rightDeg = radiansToDegrees(selectedSolution.right);

    samples.push({
      timeSec: d / PLAYBACK_SPEED_PX_PER_SEC,
      leftDeg: toGraphDegrees(leftDeg),
      rightDeg: toGraphDegrees(rightDeg),
    });
  }

  return { samples, totalDurationSec };
};

const buildPlaybackDataFromPoints = (inputPoints) => {
  if (inputPoints.length < 2) return null;

  const points = inputPoints.map((p) => ({ x: p.x, y: p.y }));
  const segments = [];
  let totalLength = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);

    if (length === 0) continue;

    const startDistance = totalLength;
    totalLength += length;

    segments.push({
      a,
      b,
      length,
      startDistance,
      endDistance: totalLength,
    });
  }

  if (segments.length === 0) return null;

  const { samples, totalDurationSec } = buildPlaybackSamples(
    segments,
    totalLength,
    points
  );

  return {
    points,
    segments,
    totalLength,
    samples,
    totalDurationSec,
  };
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

const drawMotorLimits = () => {
  const drawLimit = (origin, startAngle, endAngle) => {
    const o = modelToCanvas(origin);

    const R = ORIGIN_TO_ELBOW * (DRAW_SIZE / 2);

    ctx.save();

    ctx.fillStyle = "rgba(120,120,120,0.18)";
    ctx.strokeStyle = "rgba(160,160,160,0.35)";
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.arc(o.x, o.y, R, -startAngle, -endAngle, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  };

  const LIMIT = (MAX_MOTOR_ANGLE * Math.PI) / 180;

  const TOP_CENTER = Math.PI / 2;
  const BOTTOM_CENTER = -Math.PI / 2;

  drawLimit(LEFT_ORIGIN, TOP_CENTER - LIMIT, TOP_CENTER + LIMIT);
  drawLimit(RIGHT_ORIGIN, BOTTOM_CENTER - LIMIT, BOTTOM_CENTER + LIMIT);
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

const getCircleIntersections = (c0, c1, radius) => {
  const dx = c1.x - c0.x;
  const dy = c1.y - c0.y;
  const d = Math.hypot(dx, dy);

  if (d === 0 || d > radius * 2) return [];

  const a = d / 2;
  const hSquared = radius * radius - a * a;

  if (hSquared < 0) return [];

  const h = Math.sqrt(Math.max(0, hSquared));
  const midX = c0.x + (dx * 0.5);
  const midY = c0.y + (dy * 0.5);
  const unitX = dx / d;
  const unitY = dy / d;
  const perpX = -unitY;
  const perpY = unitX;

  const pA = {
    x: midX + perpX * h,
    y: midY + perpY * h,
  };
  const pB = {
    x: midX - perpX * h,
    y: midY - perpY * h,
  };

  if (h === 0) return [pA];
  return [pA, pB];
};

const graphDegToMotorRad = (graphDeg, side) => {
  if (!Number.isFinite(graphDeg)) return null;

  const motorAbsDeg = graphDeg + 80;
  if (!Number.isFinite(motorAbsDeg)) return null;

  const signedDeg = side === "left" ? motorAbsDeg : -motorAbsDeg;
  return degreesToRadians(signedDeg);
};

const chooseImportedTarget = (candidates, previous) => {
  if (candidates.length === 0) return null;
  if (!previous) {
    return candidates.reduce((best, candidate) =>
      candidate.x < best.x ? candidate : best,
    );
  }

  let best = candidates[0];
  let bestDistance = Math.hypot(best.x - previous.x, best.y - previous.y);

  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    const dist = Math.hypot(candidate.x - previous.x, candidate.y - previous.y);
    if (dist < bestDistance) {
      best = candidate;
      bestDistance = dist;
    }
  }

  return best;
};

const buildApproxPointsFromScadSamples = (samples) => {
  const points = [];
  let previousTarget = null;

  for (const sample of samples) {
    const leftRad = graphDegToMotorRad(sample.leftDeg, "left");
    const rightRad = graphDegToMotorRad(sample.rightDeg, "right");
    if (leftRad === null || rightRad === null) continue;

    const leftElbow = {
      x: LEFT_ORIGIN.x + Math.cos(leftRad) * ORIGIN_TO_ELBOW,
      y: LEFT_ORIGIN.y + Math.sin(leftRad) * ORIGIN_TO_ELBOW,
    };
    const rightElbow = {
      x: RIGHT_ORIGIN.x + Math.cos(rightRad) * ORIGIN_TO_ELBOW,
      y: RIGHT_ORIGIN.y + Math.sin(rightRad) * ORIGIN_TO_ELBOW,
    };

    const intersections = getCircleIntersections(
      leftElbow,
      rightElbow,
      ELBOW_TO_EFFECTOR,
    );
    if (intersections.length === 0) continue;

    const chosenTarget = chooseImportedTarget(intersections, previousTarget);
    if (!chosenTarget) continue;
    previousTarget = chosenTarget;

    const canvasPoint = modelToCanvas(chosenTarget);
    if (!isInDrawArea(canvasPoint)) continue;

    const prevCanvasPoint = points[points.length - 1];
    if (
      prevCanvasPoint &&
      Math.hypot(
        prevCanvasPoint.x - canvasPoint.x,
        prevCanvasPoint.y - canvasPoint.y,
      ) < 0.5
    ) {
      continue;
    }

    points.push(canvasPoint);
  }

  return points;
};

const importScadContent = (content) => {
  const { samples, totalDurationSec } = parseStackedDiscScad({
    content,
    minDeg: -MAX_MOTOR_ANGLE,
    maxDeg: MAX_MOTOR_ANGLE,
  });

  const approxPoints = buildApproxPointsFromScadSamples(samples);

  stopPlayback();

  state.points = approxPoints;
  state.isClosedForInput = approxPoints.length > 0;
  state.draggingIndex = null;

  state.playback.distance = 0;
  state.playback.totalLength = 0;
  state.playback.totalDurationSec = totalDurationSec;
  state.playback.points = [];
  state.playback.segments = [];
  state.playback.samples = samples;
  state.playback.target = null;

  draw();
};

const stopPlayback = () => {
  if (state.playback.rafId !== null) {
    cancelAnimationFrame(state.playback.rafId);
  }

  state.playback.active = false;
  state.playback.rafId = null;
};

const getPlaybackTargetAtDistance = (distance) => {
  return getPlaybackTargetAtDistanceFromPath(
    distance,
    state.playback.segments,
    state.playback.totalLength,
    state.playback.points
  );
};

const stepPlayback = (now) => {
  if (!state.playback.active) return;

  const elapsedSec = (now - state.playback.startTime) / 1000;
  const distance = elapsedSec * PLAYBACK_SPEED_PX_PER_SEC;
  const cappedDistance = Math.min(distance, state.playback.totalLength);

  state.playback.distance = cappedDistance;
  state.playback.target = getPlaybackTargetAtDistance(cappedDistance);

  draw();

  if (distance >= state.playback.totalLength) {
    stopPlayback();
    return;
  }

  state.playback.rafId = requestAnimationFrame(stepPlayback);
};

const startPlayback = () => {
  if (state.points.length < 2) return;

  stopPlayback();

  state.isClosedForInput = true;
  state.draggingIndex = null;

  const playbackData = buildPlaybackDataFromPoints(state.points);
  if (!playbackData) return;

  const { points, segments, totalLength, samples, totalDurationSec } =
    playbackData;

  state.playback.active = true;
  state.playback.startTime = performance.now();
  state.playback.distance = 0;
  state.playback.totalLength = totalLength;
  state.playback.totalDurationSec = totalDurationSec;
  state.playback.points = points;
  state.playback.segments = segments;
  state.playback.samples = samples;
  state.playback.target = points[0];

  draw();
  state.playback.rafId = requestAnimationFrame(stepPlayback);
};

const downloadScads = () => {
  const playbackData = buildPlaybackDataFromPoints(state.points);

  if (!playbackData || playbackData.samples.length === 0) {
    window.alert("Draw a valid path first, then export SCAD.");
    return;
  }

  try {
    downloadStackedDiscScad({
      samples: playbackData.samples,
      totalDurationSec: playbackData.totalDurationSec,
      minDeg: -MAX_MOTOR_ANGLE,
      maxDeg: MAX_MOTOR_ANGLE,
    });
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Failed to generate SCAD file.");
  }
};

const drawPlaybackTrace = () => {
  if (!state.playback.active || state.playback.points.length === 0) return;

  let remaining = state.playback.distance;
  const first = state.playback.points[0];

  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#4df";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);

  for (const seg of state.playback.segments) {
    if (remaining >= seg.length) {
      ctx.lineTo(seg.b.x, seg.b.y);
      remaining -= seg.length;
      continue;
    }

    const t = seg.length === 0 ? 0 : remaining / seg.length;
    ctx.lineTo(
      seg.a.x + (seg.b.x - seg.a.x) * t,
      seg.a.y + (seg.b.y - seg.a.y) * t
    );
    break;
  }

  ctx.stroke();
  ctx.restore();
};

const drawPlaybackGraph = () => {
  if (state.playback.samples.length === 0) return;

  const graphX = 0;
  const graphY = DRAW_SIZE;
  const graphWidth = TOTAL_WIDTH;
  const graphHeight = GRAPH_HEIGHT;

  const padding = {
    left: 48,
    right: 16,
    top: 12,
    bottom: 22,
  };

  const plotX = graphX + padding.left;
  const plotY = graphY + padding.top;
  const plotWidth = graphWidth - padding.left - padding.right;
  const plotHeight = graphHeight - padding.top - padding.bottom;

  const minDeg = -MAX_MOTOR_ANGLE;
  const maxDeg = MAX_MOTOR_ANGLE;
  const yRange = maxDeg - minDeg;
  const durationSec = Math.max(0.001, state.playback.totalDurationSec);

  const xForTime = (timeSec) =>
    plotX + (Math.max(0, Math.min(timeSec, durationSec)) / durationSec) * plotWidth;
  const yForDeg = (deg) => plotY + ((maxDeg - deg) / yRange) * plotHeight;

  ctx.save();

  ctx.fillStyle = "#0b0b0b";
  ctx.fillRect(graphX, graphY, graphWidth, graphHeight);

  ctx.strokeStyle = "#1f1f1f";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(graphX, graphY + 0.5);
  ctx.lineTo(graphX + graphWidth, graphY + 0.5);
  ctx.stroke();

  const yTicks = [-80, -40, 0, 40, 80];
  ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  ctx.fillStyle = "#888";
  ctx.strokeStyle = "#2a2a2a";

  for (const tick of yTicks) {
    const y = yForDeg(tick);
    ctx.beginPath();
    ctx.moveTo(plotX, y);
    ctx.lineTo(plotX + plotWidth, y);
    ctx.stroke();
    ctx.fillText(`${tick}`, graphX + 8, y + 4);
  }

  const xTickCount = 6;
  for (let i = 0; i <= xTickCount; i++) {
    const t = (durationSec * i) / xTickCount;
    const x = xForTime(t);
    ctx.beginPath();
    ctx.moveTo(x, plotY);
    ctx.lineTo(x, plotY + plotHeight);
    ctx.stroke();
    ctx.fillText(`${t.toFixed(1)}s`, x - 10, graphY + graphHeight - 6);
  }

  const drawSeries = (key, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    let started = false;
    for (const sample of state.playback.samples) {
      const deg = sample[key];
      if (deg === null) {
        started = false;
        continue;
      }

      const x = xForTime(sample.timeSec);
      const y = yForDeg(deg);

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
  };

  drawSeries("leftDeg", "#4af");
  drawSeries("rightDeg", "#fa4");

  const headTimeSec = state.playback.active
    ? state.playback.distance / PLAYBACK_SPEED_PX_PER_SEC
    : state.playback.totalDurationSec;
  const headX = xForTime(headTimeSec);

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(headX, plotY);
  ctx.lineTo(headX, plotY + plotHeight);
  ctx.stroke();

  ctx.fillStyle = "#9a9a9a";
  ctx.fillText("Motor Position (deg)", graphX + 8, graphY + 10);

  ctx.fillStyle = "#4af";
  ctx.fillText("left", graphWidth - 72, graphY + 14);
  ctx.fillStyle = "#fa4";
  ctx.fillText("right", graphWidth - 40, graphY + 14);

  ctx.restore();
};

const draw = () => {
  ctx.clearRect(0, 0, TOTAL_WIDTH, TOTAL_HEIGHT);

  ctx.fillStyle = "hsl(0, 0%, 4%)";
  ctx.fillRect(0, 0, DRAW_SIZE, DRAW_SIZE);

  ctx.fillStyle = "#000";
  ctx.fillRect(DRAW_SIZE, 0, EXTRA_WIDTH, DRAW_SIZE);

  highlightPossiblePixels();
  drawMotorLimits();

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

    drawPlaybackTrace();
  }

  if (!state.isClosedForInput && pts.length > 0) {
    const last = pts[pts.length - 1];
    const mouseInDrawArea = clampToDrawArea(state.mouse);

    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "#888";

    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(mouseInDrawArea.x, mouseInDrawArea.y);
    ctx.stroke();
  }

  ctx.restore();

  const linkageTargetCanvas =
    state.playback.active && state.playback.target
      ? state.playback.target
      : clampToDrawArea(state.mouse);

  const linkageTargetModel = canvasToModel(linkageTargetCanvas);
  const solutions = solveFiveBarIK(linkageTargetModel.x, linkageTargetModel.y);

  if (solutions.length > 0) {
    drawLinkageSolution(solutions[0], linkageTargetModel);
  }
  drawRedPoints();

  ctx.save();
  ctx.font =
    "12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  ctx.fillStyle = "#9a9a9a";

  const status = state.isClosedForInput
    ? state.playback.active
      ? "playing — tracing edges"
      : "editing — drag points"
    : "drawing — click/drag, right click to end";

  ctx.fillText(`points: ${state.points.length} — ${status}`, 12, 388);
  ctx.restore();

  drawPlaybackGraph();
};

const addPoint = (p) => {
  if (state.isClosedForInput) return;
  if (!isInDrawArea(p)) return;
  const last = state.points[state.points.length - 1];
  if (
    last &&
    Math.hypot(last.x - p.x, last.y - p.y) <= DRAW_POINT_MERGE_THRESHOLD_PX
  ) {
    return;
  }
  state.points.push({ x: p.x, y: p.y });
};

const addPointAndDraw = (p) => {
  addPoint(p);
  draw();
};

const addInterpolatedDragPoints = (mousePoint) => {
  if (state.isClosedForInput || !state.drawingWithMouse) return;
  const target = clampToDrawArea(mousePoint);

  let last = state.lastDrawSample || state.points[state.points.length - 1];
  if (!last) {
    addPoint(target);
    state.lastDrawSample = target;
    return;
  }

  let distance = Math.hypot(target.x - last.x, target.y - last.y);
  while (distance >= DRAW_DRAG_SPACING_PX) {
    const t = DRAW_DRAG_SPACING_PX / distance;
    const next = {
      x: last.x + (target.x - last.x) * t,
      y: last.y + (target.y - last.y) * t,
    };
    addPoint(next);
    last = next;
    state.lastDrawSample = next;
    distance = Math.hypot(target.x - last.x, target.y - last.y);
  }
};

const finishMouseDrawing = (mousePoint) => {
  if (!state.drawingWithMouse) return;
  addPoint(clampToDrawArea(mousePoint));
  state.drawingWithMouse = false;
  state.lastDrawSample = null;
};

canvas.addEventListener("mousemove", (e) => {
  const p = getMousePos(e);
  state.mouse = p;

  if (state.playback.active) return;

  if (state.draggingIndex !== null && isInDrawArea(p)) {
    state.points[state.draggingIndex].x = p.x;
    state.points[state.draggingIndex].y = p.y;
  }

  if (!state.isClosedForInput && state.drawingWithMouse && (e.buttons & 1)) {
    addInterpolatedDragPoints(p);
  }

  if (!state.isClosedForInput && state.drawingWithMouse && !(e.buttons & 1)) {
    state.drawingWithMouse = false;
    state.lastDrawSample = null;
  }

  draw();
});

canvas.addEventListener("mousedown", (e) => {
  if (state.playback.active) return;

  const p = getMousePos(e);

  if (!isInDrawArea(p)) return;

  if (state.isClosedForInput) {
    const idx = getPointUnderMouse(p);
    if (idx !== null) state.draggingIndex = idx;
    return;
  }

  if (e.button === 0) {
    addPointAndDraw(p);
    state.drawingWithMouse = true;
    state.lastDrawSample = p;
  }
});

canvas.addEventListener("mouseup", (e) => {
  if (!state.isClosedForInput && e.button === 0) {
    finishMouseDrawing(getMousePos(e));
  }
  state.draggingIndex = null;
  draw();
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const p = getMousePos(e);
  if (!isInDrawArea(p)) return;
  state.isClosedForInput = true;
  draw();
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    startPlayback();
  }
});

uploadScadBtn?.addEventListener("click", () => {
  uploadScadInput?.click();
});

uploadScadInput?.addEventListener("change", async () => {
  const file = uploadScadInput.files?.[0];
  uploadScadInput.value = "";

  if (!file) return;

  try {
    const content = await file.text();
    importScadContent(content);
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Failed to import SCAD file.");
  }
});

window.addEventListener("resize", resizeCanvas);
downloadScadBtn?.addEventListener("click", downloadScads);

resizeCanvas();
