// 理論検証スクリプト（Vallado の例題と照合）
import { computePipeline } from '../src/transform/pipeline';
import {
  gmstIAU1982, ecefToGeodetic, geodeticToECEF, enuMatrix, enuToAzEl, mulMV, subV,
} from '../src/transform/math3';

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;
let fails = 0;
function check(name: string, got: number, want: number, tol: number) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got=${got}, want=${want} (tol ${tol})`);
}

// ---- 1. GMST: Vallado Example 3-5 ----
// 1992-08-20 12:14:00 UT1 → θ_GMST = 152.578787810°
// JD = 2448855.009722222, D = JD − 2451545
{
  const JD = 2448855.009722222;
  const t = (JD - 2451545.0) * 86400;
  check('GMST (Vallado ex 3-5) [deg]', gmstIAU1982(t) * R2D, 152.578787810, 1e-5);
}

// ---- 2. 軌道要素 → ECI: Vallado Example 2-6 (COE2RV) ----
// p=11067.790 km, e=0.83285, i=87.87°, Ω=227.89°, ω=53.38°, ν=92.335°
// → r_ECI = [6525.344, 6861.535, 6449.125] km
//   v_ECI = [4.902276, 5.533124, −1.975709] km/s
{
  const p = 11067.790e3, e = 0.83285;
  const a = p / (1 - e * e);
  const nu = 92.335 * D2R;
  // ν → E → M（テスト入力用の逆変換）
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
  const M0 = E - e * Math.sin(E);
  const res = computePipeline(
    { a, e, i: 87.87 * D2R, raan: 227.89 * D2R, argp: 53.38 * D2R, M0 },
    { lat: 0, lon: 0 },
    0,
  );
  check('nu roundtrip [deg]', res.nu * R2D, 92.335, 1e-6);
  check('r_ECI x [km]', res.rECI[0] / 1000, 6525.368, 1e-3);
  check('r_ECI y [km]', res.rECI[1] / 1000, 6861.532, 1e-3);
  check('r_ECI z [km]', res.rECI[2] / 1000, 6449.119, 1e-3);
  check('v_ECI x [km/s]', res.vECI[0] / 1000, 4.902279, 1e-5);
  check('v_ECI y [km/s]', res.vECI[1] / 1000, 5.533140, 1e-5);
  check('v_ECI z [km/s]', res.vECI[2] / 1000, -1.975710, 1e-5);
}

// ---- 3. ECEF → 測地座標: Vallado Example 3-3 ----
// r = [6524.834, 6862.875, 6448.296] km → φ_gd=34.352496°, λ=46.4464°, h=5085.22 km
{
  const g = ecefToGeodetic([6524.834e3, 6862.875e3, 6448.296e3]);
  check('geodetic lat [deg]', g.lat * R2D, 34.352496, 1e-4);
  check('geodetic lon [deg]', g.lon * R2D, 46.4464, 1e-3);
  check('geodetic h [km]', g.h / 1000, 5085.22, 0.01);
}

// ---- 4. 測地 ⇄ ECEF ラウンドトリップ ----
{
  const g0 = { lat: 35.68 * D2R, lon: 139.77 * D2R, h: 123.4 };
  const r = geodeticToECEF(g0);
  const g1 = ecefToGeodetic(r);
  check('roundtrip lat [deg]', g1.lat * R2D, 35.68, 1e-9);
  check('roundtrip lon [deg]', g1.lon * R2D, 139.77, 1e-9);
  check('roundtrip h [m]', g1.h, 123.4, 1e-4);
}

// ---- 5. ENU: 天頂方向の衛星 → El = 90° ----
{
  const lat = 35.68 * D2R, lon = 139.77 * D2R;
  const stn = geodeticToECEF({ lat, lon, h: 0 });
  const sat = geodeticToECEF({ lat, lon, h: 500e3 });
  const enu = mulMV(enuMatrix(lat, lon), subV(sat, stn));
  const ae = enuToAzEl(enu);
  check('zenith El [deg]', ae.el * R2D, 90, 1e-6);
  check('zenith range [km]', ae.range / 1000, 500, 1e-6);
}

// ---- 6. ENU: 真北水平方向 → Az = 0°, El ≈ 0（短距離） ----
{
  const lat = 0, lon = 0; // 赤道上の局
  const stn = geodeticToECEF({ lat, lon, h: 0 });
  // 北へ z 方向に 1 km（赤道では U=x方向, N=z方向, E=y方向）
  const sat: [number, number, number] = [stn[0], stn[1], stn[2] + 1000];
  const enu = mulMV(enuMatrix(lat, lon), subV(sat, stn));
  const ae = enuToAzEl(enu);
  check('north Az [deg]', ae.az * R2D, 0, 1e-9);
  check('north El [deg]', ae.el * R2D, 0, 1e-9);
}

// ---- 7. ECEF 速度の輸送定理: 静止衛星なら v_ECEF ≈ 0 ----
{
  // 地球自転と同期する円軌道（i=0, e=0, a=42164.17 km）
  const omegaE = 7.2921150e-5;
  const mu = 3.986004418e14;
  const aGeo = Math.cbrt(mu / (omegaE * omegaE));
  // GMST(t=0)=280.46°なので M0 で経度を合わせる必要はない（大きさのみ確認）
  const res = computePipeline(
    { a: aGeo, e: 0, i: 0, raan: 0, argp: 0, M0: 0 },
    { lat: 0, lon: 0 }, 0,
  );
  const vMag = Math.hypot(...res.vECEF);
  check('GEO |v_ECEF| [m/s]', vMag, 0, 0.01);
  // ECI 速度の大きさは軌道速度 √(μ/a)
  const vEciMag = Math.hypot(...res.vECI);
  check('GEO |v_ECI| [m/s]', vEciMag, Math.sqrt(mu / aGeo), 1e-6);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
