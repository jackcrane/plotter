const LEFT_ORIGIN = { x: 1.75, y: 0.25 };
const RIGHT_ORIGIN = { x: 1.75, y: -0.25 };

const ORIGIN_TO_ELBOW = 0.6;
const ELBOW_TO_EFFECTOR = 1.75;

const normalizeAngle = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

/**
 * Computes the actuator angles for a planar symmetric 5-bar linkage so the
 * end effector reaches a given (x,y) point.
 *
 * Geometry:
 *  - Two motors at fixed origins
 *  - Each motor drives a link to an elbow
 *  - A second link connects the elbow to the end effector
 *
 * This solves the inverse kinematics of each side as a 2-link arm.
 * Multiple valid configurations exist (elbow up/down), so this returns
 * all possible solutions.
 *
 * @param {number} x - Target end effector x coordinate
 * @param {number} y - Target end effector y coordinate
 *
 * @returns {Array<{left:number,right:number}>}
 * Array of valid solutions. Angles are in radians.
 * `left` and `right` correspond to the angles of the two motor joints.
 */
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

      const topValid = l >= 0 && l <= Math.PI; // top motor faces upward
      const bottomValid = r <= 0 && r >= -Math.PI; // bottom motor faces downward

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
