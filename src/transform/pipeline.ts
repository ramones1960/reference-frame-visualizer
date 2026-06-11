// ============================================================
// 座標変換パイプライン
// 軌道要素 → PQW → ECI → ECEF → 測地座標 → ENU の
// 全中間値（角度・行列・ベクトル）を一括計算する
// ============================================================

import { C } from '../constants';
import { solveKepler } from '../keplerian';
import type { Vec3 } from '../types';
import {
  Mat3, mulMV, mulMM, subV, crossV,
  rotX, rotZ, rot3, gmstIAU1982,
  ecefToGeodetic, geodeticToECEF, enuMatrix, enuToAzEl,
  Geodetic, AzElRange,
} from './math3';

// ---- 入力 -------------------------------------------------------

/** ケプラー軌道要素（角度はすべて [rad]、長さは [m]） */
export interface Elements {
  /** 半長径 [m] */
  a: number;
  /** 離心率 */
  e: number;
  /** 軌道傾斜角 [rad] */
  i: number;
  /** 昇交点赤経 Ω [rad] */
  raan: number;
  /** 近点引数 ω [rad] */
  argp: number;
  /** エポック（t=0）における平均近点角 M₀ [rad] */
  M0: number;
}

/** 地上局の測地座標（ENU ステップで使用） */
export interface StationInput {
  /** 測地緯度 [rad] */
  lat: number;
  /** 経度 [rad] */
  lon: number;
}

// ---- 出力 -------------------------------------------------------

/** 変換チェーンの全中間結果 */
export interface PipelineResult {
  /** J2000 からの経過秒数 [s] */
  t: number;

  // -- ステップ0: ケプラー方程式 --
  /** 平均運動 n = √(μ/a³) [rad/s] */
  n: number;
  /** 軌道周期 [s] */
  period: number;
  /** 平均近点角 M [rad]（[0,2π) に正規化） */
  M: number;
  /** 離心近点角 E [rad] */
  E: number;
  /** 真近点角 ν [rad] */
  nu: number;
  /** 動径 r = a(1−e cosE) [m] */
  rMag: number;
  /** 半通径 p = a(1−e²) [m] */
  p: number;

  // -- ステップ1: ペリフォーカル座標 --
  rPQW: Vec3;
  vPQW: Vec3;

  // -- ステップ2〜4: PQW → ECI（3回転） --
  /** Rz(ω) */
  Rw: Mat3;
  /** Rx(i) */
  Ri: Mat3;
  /** Rz(Ω) */
  RO: Mat3;
  /** 合成行列 R_PQW→ECI = Rz(Ω)·Rx(i)·Rz(ω) */
  Rpqw2eci: Mat3;
  /** Rz(ω) 適用後の位置 */
  r1: Vec3;
  /** Rx(i) 適用後の位置 */
  r2: Vec3;
  /** ECI 位置 [m] */
  rECI: Vec3;
  /** ECI 速度 [m/s] */
  vECI: Vec3;

  // -- ステップ5: ECI → ECEF --
  /** グリニッジ平均恒星時 θ_GMST [rad] */
  gmst: number;
  /** R₃(θ_GMST)（受動回転） */
  Rgmst: Mat3;
  /** ECEF 位置 [m] */
  rECEF: Vec3;
  /** ECEF 速度（輸送定理込み）[m/s] */
  vECEF: Vec3;

  // -- ステップ6: 測地座標 --
  geo: Geodetic;
  /** 直下点（楕円体面上）の ECEF 座標 [m] */
  subPoint: Vec3;

  // -- ステップ7: ENU --
  /** 地上局の ECEF 位置 [m] */
  rStation: Vec3;
  /** ECEF→ENU 回転行列 */
  Renu: Mat3;
  /** 地上局から見た衛星の ENU 相対位置 [m] */
  rhoENU: Vec3;
  /** 方位角・仰角・距離 */
  azel: AzElRange;
}

// ---- 計算本体 ---------------------------------------------------

/**
 * 時刻 t（J2000 からの秒数）における変換チェーン全体を計算する
 *
 * 理論の流れ:
 *   1. M = M₀ + n·t,  M = E − e sinE（ケプラー方程式）→ ν
 *   2. r_PQW = r[cosν, sinν, 0]ᵀ,  v_PQW = √(μ/p)[−sinν, e+cosν, 0]ᵀ
 *   3. r_ECI = Rz(Ω)·Rx(i)·Rz(ω)·r_PQW（3-1-3 オイラー回転）
 *   4. r_ECEF = R₃(θ_GMST)·r_ECI（歳差・章動・極運動は無視）
 *   5. ECEF → WGS84 測地座標（反復法）
 *   6. ρ_ENU = R_ENU·(r_ECEF − r_station) → 方位角・仰角
 */
export function computePipeline(
  els: Elements,
  station: StationInput,
  t: number,
): PipelineResult {
  const mu = C.MU_EARTH;

  // ---- ステップ0: ケプラー方程式 M → E → ν ----
  const n = Math.sqrt(mu / (els.a ** 3));
  const period = 2 * Math.PI / n;
  const Mraw = els.M0 + n * t;
  const M = ((Mraw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const E = solveKepler(M, els.e);
  const sq = Math.sqrt(1 - els.e * els.e);
  const nu = Math.atan2(sq * Math.sin(E), Math.cos(E) - els.e);
  const rMag = els.a * (1 - els.e * Math.cos(E));
  const p = els.a * (1 - els.e * els.e);

  // ---- ステップ1: ペリフォーカル（PQW）座標 ----
  const rPQW: Vec3 = [rMag * Math.cos(nu), rMag * Math.sin(nu), 0];
  const vCoef = Math.sqrt(mu / p);
  const vPQW: Vec3 = [-vCoef * Math.sin(nu), vCoef * (els.e + Math.cos(nu)), 0];

  // ---- ステップ2〜4: PQW → ECI（Rz(Ω)·Rx(i)·Rz(ω)） ----
  const Rw = rotZ(els.argp);
  const Ri = rotX(els.i);
  const RO = rotZ(els.raan);
  const Rpqw2eci = mulMM(RO, mulMM(Ri, Rw));

  const r1 = mulMV(Rw, rPQW);
  const r2 = mulMV(Ri, r1);
  const rECI = mulMV(RO, r2);
  const vECI = mulMV(Rpqw2eci, vPQW);

  // ---- ステップ5: ECI → ECEF ----
  const gmst = gmstIAU1982(t);
  const Rgmst = rot3(gmst);
  const rECEF = mulMV(Rgmst, rECI);
  // 輸送定理: v_ECEF = R₃(θ)·v_ECI − ω⊕ × r_ECEF
  const omegaE: Vec3 = [0, 0, C.OMEGA_EARTH];
  const vECEF = subV(mulMV(Rgmst, vECI), crossV(omegaE, rECEF));

  // ---- ステップ6: ECEF → WGS84 測地座標 ----
  const geo = ecefToGeodetic(rECEF);
  // 直下点 = 同じ緯度経度で h=0 の楕円体面上の点
  const subPoint = geodeticToECEF({ lat: geo.lat, lon: geo.lon, h: 0 });

  // ---- ステップ7: ENU（地上局基準の局所地平座標） ----
  const rStation = geodeticToECEF({ lat: station.lat, lon: station.lon, h: 0 });
  const Renu = enuMatrix(station.lat, station.lon);
  const rhoENU = mulMV(Renu, subV(rECEF, rStation));
  const azel = enuToAzEl(rhoENU);

  return {
    t, n, period, M, E, nu, rMag, p,
    rPQW, vPQW,
    Rw, Ri, RO, Rpqw2eci, r1, r2, rECI, vECI,
    gmst, Rgmst, rECEF, vECEF,
    geo, subPoint,
    rStation, Renu, rhoENU, azel,
  };
}
