const INCH_TO_MM = 25.4;
const DISC_DIAMETER_IN = 6;
const DISC_HEIGHT_IN = 4;
const CUT_WIDTH_IN = 0.12;
const CUT_HEIGHT_MM = 3.5;
const CUT_DEPTH_MM = 3;
const SURFACE_OVERCUT_IN = 0.02;
const QUANTIZED_POINT_COUNT = 480;
const WRAP_ANGLE_DEGREES = 355;
const GEAR_THICKNESS_MM = 10;
const GEAR_TOOTH_COUNT = 58;
const GEAR_CIRCULAR_PITCH_MM =
  (DISC_DIAMETER_IN * INCH_TO_MM * Math.PI) / (GEAR_TOOTH_COUNT + 2);
const CENTER_HOLE_DIAMETER_MM = 20.4;

const formatNumber = (value) => Number(value.toFixed(4));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const filterSeriesSamples = (samples, key) =>
  samples
    .filter((sample) => typeof sample[key] === "number")
    .map((sample) => ({ timeSec: sample.timeSec, deg: sample[key] }));

const interpolateSeriesValue = (series, timeSec) => {
  if (series.length === 0) return null;
  if (timeSec <= series[0].timeSec) return series[0].deg;
  if (timeSec >= series[series.length - 1].timeSec) {
    return series[series.length - 1].deg;
  }

  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i];
    const b = series[i + 1];
    if (timeSec < a.timeSec || timeSec > b.timeSec) continue;

    const span = b.timeSec - a.timeSec;
    if (span <= 0) return b.deg;
    const t = (timeSec - a.timeSec) / span;
    return a.deg + (b.deg - a.deg) * t;
  }

  return series[series.length - 1].deg;
};

const quantizeSeries = (samples, key, durationSec, minDeg, maxDeg) => {
  const source = filterSeriesSamples(samples, key);
  if (source.length < 2 || durationSec <= 0) return [];

  const quantized = [];
  const steps = Math.max(2, QUANTIZED_POINT_COUNT);
  for (let i = 0; i < steps; i++) {
    const timeSec = (durationSec * i) / (steps - 1);
    const deg = interpolateSeriesValue(source, timeSec);
    if (deg === null) continue;

    quantized.push({
      timeSec,
      deg: clamp(deg, minDeg, maxDeg),
    });
  }

  return quantized;
};

const mapSeriesToAngularNodes = ({
  series,
  durationSec,
  minDeg,
  maxDeg,
  zMinMm,
  zMaxMm,
}) => {
  const cutHeightMm = CUT_HEIGHT_MM;
  const zMarginMm = cutHeightMm * 0.6;
  const zSpanMm = Math.max(0.001, zMaxMm - zMinMm - zMarginMm * 2);
  const degRange = Math.max(0.001, maxDeg - minDeg);

  return series.map((sample) => {
    const angleDeg = (sample.timeSec / durationSec) * WRAP_ANGLE_DEGREES;
    const t = (sample.deg - minDeg) / degRange;
    const z = zMinMm + zMarginMm + clamp(t, 0, 1) * zSpanMm;
    return [formatNumber(angleDeg), formatNumber(z)];
  });
};

const nodesToScadArray = (nodes) =>
  nodes.map((node) => `  [${node[0]}, ${node[1]}]`).join(",\n");

const buildScad = ({ leftNodes, rightNodes }) => {
  const leftNodesBody = nodesToScadArray(leftNodes);
  const rightNodesBody = nodesToScadArray(rightNodes);

  return `// 6in x 4in disc with stacked wrapped cuts and a bottom gear
$fn = 192;

inch = ${INCH_TO_MM};
disc_diameter = ${DISC_DIAMETER_IN} * inch;
disc_height = ${DISC_HEIGHT_IN} * inch;

cut_width = ${CUT_WIDTH_IN} * inch;
cut_height = ${CUT_HEIGHT_MM};
cut_depth = ${CUT_DEPTH_MM};
surface_overcut = ${SURFACE_OVERCUT_IN} * inch;

gear_thickness = ${GEAR_THICKNESS_MM};
gear_teeth = ${GEAR_TOOTH_COUNT};
gear_circular_pitch = ${formatNumber(GEAR_CIRCULAR_PITCH_MM)};
gear_module = gear_circular_pitch / PI;
gear_addendum = gear_module;
gear_dedendum = 1.25 * gear_module;
gear_outer_radius = disc_diameter / 2;
gear_pitch_radius = gear_outer_radius - gear_addendum;
gear_root_radius = gear_pitch_radius - gear_dedendum;
gear_tooth_depth = gear_outer_radius - gear_root_radius;
gear_tooth_base_width = 0.56 * gear_circular_pitch;
gear_tooth_tip_width = 0.34 * gear_circular_pitch;
center_hole_diameter = ${CENTER_HOLE_DIAMETER_MM};

left_nodes = [
${leftNodesBody}
];

right_nodes = [
${rightNodesBody}
];

module cut_box(node) {
  a = node[0];
  z = node[1];
  rotate([0, 0, a]) {
    translate([disc_diameter / 2 - cut_depth, -cut_width / 2, z - cut_height / 2]) {
      cube([cut_depth + surface_overcut, cut_width, cut_height]);
    }
  }
}

module wrapped_rect_cut(nodes) {
  for (i = [0 : len(nodes) - 2]) {
    hull() {
      cut_box(nodes[i]);
      cut_box(nodes[i + 1]);
    }
  }
}

module bottom_gear() {
  translate([0, 0, -gear_thickness]) {
    union() {
      cylinder(h = gear_thickness, r = gear_root_radius);
      for (i = [0 : gear_teeth - 1]) {
        rotate([0, 0, i * 360 / gear_teeth]) {
          translate([gear_root_radius, 0, 0]) {
            linear_extrude(height = gear_thickness) {
              polygon([
                [0, -gear_tooth_base_width / 2],
                [gear_tooth_depth, -gear_tooth_tip_width / 2],
                [gear_tooth_depth, gear_tooth_tip_width / 2],
                [0, gear_tooth_base_width / 2]
              ]);
            }
          }
        }
      }
    }
  }
}

difference() {
  union() {
    bottom_gear();
    cylinder(h = disc_height, d = disc_diameter);
  }
  wrapped_rect_cut(left_nodes);
  wrapped_rect_cut(right_nodes);
  translate([0, 0, -gear_thickness - 0.5]) {
    cylinder(h = disc_height + gear_thickness + 1, d = center_hole_diameter);
  }
}
`;
};

export const downloadStackedDiscScad = ({
  samples,
  totalDurationSec,
  minDeg,
  maxDeg,
}) => {
  const durationSec =
    totalDurationSec > 0
      ? totalDurationSec
      : Math.max(0, samples[samples.length - 1]?.timeSec ?? 0);

  if (!Array.isArray(samples) || samples.length < 2 || durationSec <= 0) {
    throw new Error("No playback graph data to export.");
  }

  const leftSeries = quantizeSeries(
    samples,
    "leftDeg",
    durationSec,
    minDeg,
    maxDeg,
  );
  const rightSeries = quantizeSeries(
    samples,
    "rightDeg",
    durationSec,
    minDeg,
    maxDeg,
  );

  if (leftSeries.length < 2 || rightSeries.length < 2) {
    throw new Error("Need valid left and right graph data to export.");
  }

  const discHeightMm = DISC_HEIGHT_IN * INCH_TO_MM;
  const halfHeightMm = discHeightMm / 2;

  const leftNodes = mapSeriesToAngularNodes({
    series: leftSeries,
    durationSec,
    minDeg,
    maxDeg,
    zMinMm: 0,
    zMaxMm: halfHeightMm,
  });

  const rightNodes = mapSeriesToAngularNodes({
    series: rightSeries,
    durationSec,
    minDeg,
    maxDeg,
    zMinMm: halfHeightMm,
    zMaxMm: discHeightMm,
  });

  const content = buildScad({ leftNodes, rightNodes });
  const filename = "stacked-disc.scad";

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);

  return { filename, content };
};
