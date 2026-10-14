// 2D supercover traversal for a ray projected onto the X/Z collision grid.
// Y is handled by the exact 3D AABB test for boxes in each visited cell.
export function* rayGridCells(origin, direction, maxDistance, cellSize = 8) {
  if (!Number.isFinite(maxDistance) || maxDistance < 0 || !Number.isFinite(cellSize) || cellSize <= 0) return;
  let gx = Math.floor(origin.x / cellSize);
  let gz = Math.floor(origin.z / cellSize);
  const sx = direction.x > 1e-10 ? 1 : direction.x < -1e-10 ? -1 : 0;
  const sz = direction.z > 1e-10 ? 1 : direction.z < -1e-10 ? -1 : 0;
  const dx = sx === 0 ? Infinity : Math.abs(cellSize / direction.x);
  const dz = sz === 0 ? Infinity : Math.abs(cellSize / direction.z);
  let tx = sx > 0 ? ((gx + 1) * cellSize - origin.x) / direction.x : sx < 0 ? (gx * cellSize - origin.x) / direction.x : Infinity;
  let tz = sz > 0 ? ((gz + 1) * cellSize - origin.z) / direction.z : sz < 0 ? (gz * cellSize - origin.z) / direction.z : Infinity;
  tx = Math.max(0, tx); tz = Math.max(0, tz);
  const emitted = new Set();
  const emit = (x, z) => {
    const key = `${x},${z}`;
    if (emitted.has(key)) return null;
    emitted.add(key);
    return [x, z];
  };
  const first = emit(gx, gz);
  if (first) yield first;
  while (true) {
    const next = Math.min(tx, tz);
    if (!Number.isFinite(next) || next > maxDistance) break;
    // Supercover corners: include both side cells before entering the diagonal cell.
    if (Math.abs(tx - tz) < 1e-9) {
      if (sx) { const sideX = emit(gx + sx, gz); if (sideX) yield sideX; }
      if (sz) { const sideZ = emit(gx, gz + sz); if (sideZ) yield sideZ; }
      gx += sx; gz += sz; tx += dx; tz += dz;
    } else if (tx < tz) {
      gx += sx; tx += dx;
    } else {
      gz += sz; tz += dz;
    }
    const cell = emit(gx, gz);
    if (cell) yield cell;
  }
}
