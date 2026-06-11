// ============================================================
// 座標変換ステップビジュアライザー用 数学モジュール
// 3×3 行列演算・回転行列・GMST・WGS84 測地変換・ENU 変換
// ============================================================

import type { Vec3 } from '../types';

/** 3×3 行列（行ベクトルの配列、row-major） */
export type Mat3 = [Vec3, Vec3, Vec3];

// ---- WGS84 楕円体定数 -------------------------------------------

export const WGS84 = {
  /** 長半径（赤道半径）[m] */
  A: 6378137.0,
  /** 扁平率 f = 1/298.257223563 */
  F: 1 / 298.257223563,
  /** 第一離心率の2乗 e² = f(2−f) */
  E2: (1 / 298.257223563) * (2 - 1 / 298.257223563),
} as const;

// ---- 行列・ベクトル演算 -----------------------------------------

/** 単位行列を返す */
export function identity(): Mat3 {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

/** 行列 × ベクトル */
export function mulMV(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** 行列 × 行列 */
export function mulMM(a: Mat3, b: Mat3): Mat3 {
  const r = identity();
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}

/** ベクトルの差 a − b */
export function subV(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** 外積 a × b */
export function crossV(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** ノルム ‖v‖ */
export function normV(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

// ---- 回転行列（能動回転：ベクトルを +θ 回転させる） --------------

/**
 * X軸まわりの能動回転行列 Rx(θ)
 * 軌道傾斜角 i の適用（PQW→ECI の第2回転）で使用
 */
export function rotX(theta: number): Mat3 {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

/**
 * Z軸まわりの能動回転行列 Rz(θ)
 * ω・Ω の適用（PQW→ECI の第1・第3回転）で使用
 */
export function rotZ(theta: number): Mat3 {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

/**
 * Z軸まわりの受動回転（座標系回転）行列 R₃(θ) = Rz(−θ)
 * ECI → ECEF 変換（地球自転角の適用）で使用
 */
export function rot3(theta: number): Mat3 {
  return rotZ(-theta);
}

// ---- グリニッジ平均恒星時（GMST, IAU 1982） ----------------------

/**
 * J2000.0 からの経過秒数 t（UT1 ≈ UTC と近似）に対する GMST [rad]
 *
 * IAU 1982 モデル（Vallado, "Fundamentals of Astrodynamics" 式 3-45）:
 *   θ_GMST [deg] = 280.46061837 + 360.98564736629·D
 *                  + 0.000387933·T² − T³/38 710 000
 *   D = JD_UT1 − 2451545.0 [日], T = D/36525 [ユリウス世紀]
 */
export function gmstIAU1982(t: number): number {
  const D = t / 86400.0;
  const T = D / 36525.0;
  const deg =
    280.46061837 +
    360.98564736629 * D +
    0.000387933 * T * T -
    (T * T * T) / 38710000.0;
  const rad = ((deg % 360) + 360) % 360 * (Math.PI / 180);
  return rad;
}

// ---- WGS84 測地座標変換 -----------------------------------------

/** 測地座標（緯度 [rad]・経度 [rad]・楕円体高 [m]） */
export interface Geodetic {
  lat: number;
  lon: number;
  h: number;
}

/**
 * ECEF 直交座標 [m] → WGS84 測地座標（反復法）
 *
 * 反復式:
 *   N(φ) = a / √(1 − e² sin²φ)         （卯酉線曲率半径）
 *   h    = p / cosφ − N
 *   φ    = atan2( z, p·(1 − e²·N/(N+h)) )
 * 初期値 φ₀ = atan2(z, p(1−e²)) から数回で収束する
 */
export function ecefToGeodetic(r: Vec3): Geodetic {
  const [x, y, z] = r;
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);

  let lat = Math.atan2(z, p * (1 - WGS84.E2));
  let h = 0;
  for (let k = 0; k < 10; k++) {
    const sLat = Math.sin(lat);
    const N = WGS84.A / Math.sqrt(1 - WGS84.E2 * sLat * sLat);
    h = p / Math.cos(lat) - N;
    const latNew = Math.atan2(z, p * (1 - WGS84.E2 * N / (N + h)));
    if (Math.abs(latNew - lat) < 1e-12) { lat = latNew; break; }
    lat = latNew;
  }
  return { lat, lon, h };
}

/**
 * WGS84 測地座標 → ECEF 直交座標 [m]
 * 地上局位置の計算で使用
 *
 *   x = (N+h) cosφ cosλ
 *   y = (N+h) cosφ sinλ
 *   z = (N(1−e²)+h) sinφ
 */
export function geodeticToECEF(g: Geodetic): Vec3 {
  const sLat = Math.sin(g.lat), cLat = Math.cos(g.lat);
  const N = WGS84.A / Math.sqrt(1 - WGS84.E2 * sLat * sLat);
  return [
    (N + g.h) * cLat * Math.cos(g.lon),
    (N + g.h) * cLat * Math.sin(g.lon),
    (N * (1 - WGS84.E2) + g.h) * sLat,
  ];
}

// ---- ENU（局所地平座標）変換 ------------------------------------

/**
 * ECEF → ENU 回転行列（地上局の測地緯度 φ・経度 λ から構成）
 *
 *   E（東）  = [−sinλ,        cosλ,       0    ]
 *   N（北）  = [−sinφ cosλ, −sinφ sinλ,  cosφ ]
 *   U（天頂）= [ cosφ cosλ,  cosφ sinλ,  sinφ ]
 */
export function enuMatrix(lat: number, lon: number): Mat3 {
  const sF = Math.sin(lat), cF = Math.cos(lat);
  const sL = Math.sin(lon), cL = Math.cos(lon);
  return [
    [-sL, cL, 0],
    [-sF * cL, -sF * sL, cF],
    [cF * cL, cF * sL, sF],
  ];
}

/** 方位角・仰角・距離 */
export interface AzElRange {
  /** 方位角 [rad]（北=0、東回り 0〜2π） */
  az: number;
  /** 仰角 [rad] */
  el: number;
  /** 距離 [m] */
  range: number;
}

/**
 * ENU 相対位置ベクトルから方位角・仰角・距離を計算する
 *   Az = atan2(E, N),  El = asin(U / ‖ρ‖)
 */
export function enuToAzEl(enu: Vec3): AzElRange {
  const range = normV(enu);
  const az = ((Math.atan2(enu[0], enu[1]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const el = Math.asin(enu[2] / range);
  return { az, el, range };
}
