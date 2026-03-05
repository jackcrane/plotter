export const LEFT_ORIGIN = { x: 1.75, y: 0.25 };
export const RIGHT_ORIGIN = { x: 1.75, y: -0.25 };

export const ORIGIN_TO_ELBOW = 0.7;
export const ELBOW_TO_EFFECTOR = 1.75;

export const MAX_MOTOR_ANGLE = 80;

const normalizeAngle = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export const solveFiveBarIK = (x, y) => {
  const solveSide = (origin) => {
    const dx = x - origin.x;
    const dy = y - origin.y;

    const r = Math.hypot(dx, dy);

    const L1 = ORIGIN_TO_ELBOW;
    const L2 = ELBOW_TO_EFFECTOR;

    if (r > L1 + L2 || r < Math.abs(L1 - L2)) return [];

    const phi = Math.atan2(dy, dx);
    const alpha = Math.acos((L1 * L1 + r * r - L2 * L2) / (2 * L1 * r));

    return [phi + alpha, phi - alpha];
  };

  const leftAngles = solveSide(LEFT_ORIGIN);
  const rightAngles = solveSide(RIGHT_ORIGIN);

  const solutions = [];

  for (const lRaw of leftAngles) {
    for (const rRaw of rightAngles) {
      const l = normalizeAngle(lRaw);
      const r = normalizeAngle(rRaw);

      const LIMIT = (MAX_MOTOR_ANGLE * Math.PI) / 180;

      const TOP_CENTER = Math.PI / 2;
      const BOTTOM_CENTER = -Math.PI / 2;

      const topValid = l >= TOP_CENTER - LIMIT && l <= TOP_CENTER + LIMIT;

      const bottomValid =
        r >= BOTTOM_CENTER - LIMIT && r <= BOTTOM_CENTER + LIMIT;

      if (topValid && bottomValid) {
        solutions.push({ left: l, right: r });
      }
    }
  }

  return solutions;
};

export const pointIsPossible = (x, y) => {
  const positions = solveFiveBarIK(x, y);
  return positions.length > 0;
};
