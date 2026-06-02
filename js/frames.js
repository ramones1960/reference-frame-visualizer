// ---- helpers ----------------------------------------------------------------
function cross(a, b) {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function norm(v)   { return Math.sqrt(dot(v,v)); }

function rotZ(v, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c*v[0]+s*v[1], -s*v[0]+c*v[1], v[2]];
}

// ---- sidereal time ----------------------------------------------------------

// GMST in radians at t seconds from J2000
function getGMST(t) {
  let deg = 280.46061837 + 360.98564736629 * t / 86400.0;
  return ((deg % 360 + 360) % 360) * C.DEG2RAD;
}

// Moon's rotation angle in radians (synchronous rotation, t from J2000)
function getLunarAngle(t) {
  // Reference: Moon's prime meridian (centre of nearside) faces Earth.
  // Period = 27.32166 days = 2360591.5 s
  return C.OMEGA_MOON * t;
}

// ---- coordinate transforms --------------------------------------------------

function eciToECEF(pos, t) {
  return rotZ(pos, getGMST(t));
}

function lciToLCF(pos, t) {
  return rotZ(pos, getLunarAngle(t));
}

// ECEF cartesian → { lat, lon } in degrees
function ecefToLatLon(pos) {
  const [x, y, z] = pos;
  return {
    lat: Math.atan2(z, Math.sqrt(x*x + y*y)) * C.RAD2DEG,
    lon: Math.atan2(y, x) * C.RAD2DEG,
  };
}

// ECI position → RTN coordinates relative to reference satellite.
// refPos/refVel are the reference satellite's ECI state.
function eciToRTN(pos, refPos, refVel) {
  const rMag = norm(refPos);
  const rHat = refPos.map(x => x / rMag);

  const h    = cross(refPos, refVel);
  const hMag = norm(h);
  const nHat = h.map(x => x / hMag);          // orbit-normal

  const tHat = cross(nHat, rHat);              // tangential (= N × R)

  const dr = pos.map((x, i) => x - refPos[i]);
  return [dot(dr, rHat), dot(dr, tHat), dot(dr, nHat)];
}

// Transform a single ECI position/velocity pair into the requested frame.
// refState = { pos, vel } of the reference (first) Earth satellite (for RTN).
function transformPoint(pos, vel, frame, t, refState) {
  switch (frame) {
    case 'eci':
    case 'lci':
      return pos;
    case 'ecef':
      return eciToECEF(pos, t);
    case 'lcf':
      return lciToLCF(pos, t);
    case 'rtn':
      return eciToRTN(pos, refState.pos, refState.vel);
    default:
      return pos;
  }
}
