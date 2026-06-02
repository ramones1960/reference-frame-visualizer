// ============================================================
// 座標系変換モジュール
// ECI / ECEF / RTN / LCI / LCF 間の変換を提供
// ============================================================

import { C } from './constants';
import type { Vec3, FrameType, State, LatLon } from './types';

// ---- ベクトル演算ヘルパー ----------------------------------------

/** 3次元ベクトルの外積を計算する */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}

/** 3次元ベクトルの内積を計算する */
export function dot(a: Vec3, b: Vec3): number {
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}

/** 3次元ベクトルのノルム（大きさ）を計算する */
export function norm(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

/**
 * Z軸まわりの回転を適用する（右手系、角度 theta [rad]）
 * ECI → ECEF の変換などで使用
 */
function rotZ(v: Vec3, theta: number): Vec3 {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c*v[0] + s*v[1], -s*v[0] + c*v[1], v[2]];
}

// ---- 恒星時・月回転角 -------------------------------------------

/**
 * J2000からの経過秒数 t に対するグリニッジ平均恒星時（GMST）を返す [rad]
 * ECI → ECEF 変換で地球自転角として使用
 */
export function getGMST(t: number): number {
  // 天文学的な簡易式（IAU 1982）。厳密ではなく概算用
  const deg = 280.46061837 + 360.98564736629 * t / 86400.0;
  return ((deg % 360 + 360) % 360) * C.DEG2RAD;
}

/**
 * J2000からの経過秒数 t に対する月の自転角 [rad] を返す
 * 月は地球と同期回転しているため OMEGA_MOON で単純積分
 */
export function getLunarAngle(t: number): number {
  // 月の近地点は地球方向に固定（同期回転）
  // 周期 ≈ 27.32166 日 = 2360591.5 s
  return C.OMEGA_MOON * t;
}

// ---- 座標変換 ---------------------------------------------------

/**
 * ECI（地心慣性座標）→ ECEF（地球固定座標）変換
 * 地球の自転に相当する GMST 分だけ Z軸回転を行う
 */
export function eciToECEF(pos: Vec3, t: number): Vec3 {
  return rotZ(pos, getGMST(t));
}

/**
 * LCI（月慣性座標）→ LCF（月固定座標）変換
 * 月の自転角分だけ Z軸回転を行う
 */
export function lciToLCF(pos: Vec3, t: number): Vec3 {
  return rotZ(pos, getLunarAngle(t));
}

/**
 * ECEF 直交座標 → 地理座標（緯度・経度）変換
 * 地上トラック表示で使用
 */
export function ecefToLatLon(pos: Vec3): LatLon {
  const [x, y, z] = pos;
  return {
    lat: Math.atan2(z, Math.sqrt(x*x + y*y)) * C.RAD2DEG,
    lon: Math.atan2(y, x) * C.RAD2DEG,
  };
}

/**
 * ECI位置を基準衛星を原点とするRTN（Radial-Tangential-Normal）座標に変換する
 * 複数衛星の相対運動を可視化するために使用
 *
 * @param pos     - 変換対象の ECI 位置 [m]
 * @param refPos  - 基準衛星の ECI 位置 [m]
 * @param refVel  - 基準衛星の ECI 速度 [m/s]
 * @returns RTN 座標 [R, T, N] [m]
 */
export function eciToRTN(pos: Vec3, refPos: Vec3, refVel: Vec3): Vec3 {
  // R方向：基準衛星の動径方向（中心天体から外向き）
  const rMag = norm(refPos);
  const rHat = refPos.map(x => x / rMag) as Vec3;

  // N方向：軌道面法線（角運動量 h = r × v の方向）
  const h    = cross(refPos, refVel);
  const hMag = norm(h);
  const nHat = h.map(x => x / hMag) as Vec3;

  // T方向：N × R（速度方向に近い接線方向）
  const tHat = cross(nHat, rHat);

  // 基準衛星との相対位置ベクトルを RTN 基底に射影
  const dr = pos.map((x, i) => x - refPos[i]) as Vec3;
  return [dot(dr, rHat), dot(dr, tHat), dot(dr, nHat)];
}

/**
 * 単一の ECI 位置・速度を指定された座標系に変換する
 *
 * @param pos      - ECI 位置ベクトル [m]
 * @param vel      - ECI 速度ベクトル [m/s]
 * @param frame    - 変換先の座標系
 * @param t        - J2000からの時刻 [s]
 * @param refState - RTN変換で使用する基準衛星の状態（RTN以外では無視）
 * @returns 変換後の位置ベクトル [m]
 */
export function transformPoint(
  pos: Vec3,
  _vel: Vec3,
  frame: FrameType,
  t: number,
  refState: State,
): Vec3 {
  switch (frame) {
    case 'eci':
    case 'lci':
      // 慣性系はそのまま返す
      return pos;
    case 'ecef':
      // 地球自転を考慮した地球固定座標へ変換
      return eciToECEF(pos, t);
    case 'lcf':
      // 月自転を考慮した月固定座標へ変換
      return lciToLCF(pos, t);
    case 'rtn':
      // 基準衛星基準の相対座標へ変換
      return eciToRTN(pos, refState.pos, refState.vel);
    default:
      return pos;
  }
}
