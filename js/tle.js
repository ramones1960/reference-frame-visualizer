// Parse TLE two-line element set into a satellite object
function parseTLE(name, line1, line2) {
  const epochStr = line1.substring(18, 32).trim();
  const year2d    = parseInt(epochStr.substring(0, 2));
  const year      = year2d >= 57 ? 1900 + year2d : 2000 + year2d;
  const dayFrac   = parseFloat(epochStr.substring(2));
  const jd        = _julianDate(year, 1, 1.0) + dayFrac - 1.0;
  const epochJ2000 = (jd - C.J2000) * 86400.0;

  const i    = parseFloat(line2.substring(8,  16)) * C.DEG2RAD;
  const raan = parseFloat(line2.substring(17, 25)) * C.DEG2RAD;
  const e    = parseFloat('0.' + line2.substring(26, 33).trim());
  const argp = parseFloat(line2.substring(34, 42)) * C.DEG2RAD;
  const M0   = parseFloat(line2.substring(43, 51)) * C.DEG2RAD;
  const n    = parseFloat(line2.substring(52, 63)) * 2 * Math.PI / 86400; // rad/s
  const a    = Math.cbrt(C.MU_EARTH / (n * n)); // m

  return {
    name: (name || '').trim() || 'Satellite',
    body: 'earth',
    mu: C.MU_EARTH,
    a, e, i, raan, argp, M0, n,
    epochJ2000,
    period: 2 * Math.PI / n,
  };
}

// Build a satellite object from raw orbital elements
function parseElements({ name, body, a, e, i, raan, argp, M0 }) {
  const b  = (body || 'earth').toLowerCase();
  const mu = b === 'moon' ? C.MU_MOON : C.MU_EARTH;
  const aM = parseFloat(a) * 1000;       // km → m
  const eV = parseFloat(e);
  const iV = parseFloat(i)    * C.DEG2RAD;
  const rV = parseFloat(raan) * C.DEG2RAD;
  const wV = parseFloat(argp) * C.DEG2RAD;
  const mV = parseFloat(M0)   * C.DEG2RAD;
  const n  = Math.sqrt(mu / (aM * aM * aM));

  return {
    name: (name || '').trim() || 'Satellite',
    body: b,
    mu,
    a: aM, e: eV, i: iV, raan: rV, argp: wV, M0: mV,
    n,
    epochJ2000: 0,
    period: 2 * Math.PI / n,
  };
}

function _julianDate(year, month, day) {
  if (month <= 2) { year--; month += 12; }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (year + 4716))
       + Math.floor(30.6001 * (month + 1))
       + day + B - 1524.5;
}
