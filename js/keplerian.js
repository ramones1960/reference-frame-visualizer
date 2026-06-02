// Solve Kepler's equation  M = E - e·sin(E)  by Newton-Raphson
function solveKepler(M, e) {
  M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = M;
  for (let k = 0; k < 60; k++) {
    const dE = (M - E + e * Math.sin(E)) / (1.0 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

// Propagate satellite to absolute time t (seconds since J2000).
// Returns { pos:[x,y,z], vel:[vx,vy,vz] } in the body-centric inertial frame
// (ECI for earth, LCI for moon), in metres / m·s⁻¹.
function propagate(sat, t) {
  const M  = sat.M0 + sat.n * (t - sat.epochJ2000);
  const E  = solveKepler(M, sat.e);
  const cE = Math.cos(E), sE = Math.sin(E);
  const sq = Math.sqrt(1.0 - sat.e * sat.e);

  // True anomaly
  const nu  = Math.atan2(sq * sE, cE - sat.e);
  const cNu = Math.cos(nu), sNu = Math.sin(nu);

  // Perifocal coordinates
  const r  = sat.a * (1.0 - sat.e * cE);
  const h  = Math.sqrt(sat.mu * sat.a * (1.0 - sat.e * sat.e));
  const px = r * cNu,                    py = r * sNu;
  const vx = -(sat.mu / h) * sNu,        vy = (sat.mu / h) * (sat.e + cNu);

  // Perifocal → inertial rotation: R = Rz(Ω)·Rx(i)·Rz(ω)
  const cO = Math.cos(sat.raan), sO = Math.sin(sat.raan);
  const ci = Math.cos(sat.i),    si = Math.sin(sat.i);
  const cw = Math.cos(sat.argp), sw = Math.sin(sat.argp);

  // Columns of the rotation matrix
  const Px = cO*cw - sO*sw*ci,  Py = sO*cw + cO*sw*ci,  Pz = sw*si;
  const Qx = -cO*sw - sO*cw*ci, Qy = -sO*sw + cO*cw*ci, Qz = cw*si;

  return {
    pos: [Px*px + Qx*py, Py*px + Qy*py, Pz*px + Qz*py],
    vel: [Px*vx + Qx*vy, Py*vx + Qy*vy, Pz*vx + Qz*vy],
  };
}

// Return N+1 equally time-spaced states over one full period starting at t0.
function orbitTrace(sat, t0, N = 240) {
  const positions = [], velocities = [], times = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + (i / N) * sat.period;
    const { pos, vel } = propagate(sat, t);
    positions.push(pos);
    velocities.push(vel);
    times.push(t);
  }
  return { positions, velocities, times };
}
