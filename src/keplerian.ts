// ============================================================
// ケプラー軌道伝播エンジン
// 摂動なしの二体問題解析解を使用
// ============================================================

import type { Satellite, State, OrbitTraceResult, Vec3 } from './types';

/**
 * ケプラー方程式  M = E − e·sin(E)  をニュートン・ラフソン法で解く
 *
 * @param M - 平均近点角 [rad]（任意の実数、内部で正規化）
 * @param e - 離心率
 * @returns 離心近点角 E [rad]
 */
export function solveKepler(M: number, e: number): number {
  // M を [0, 2π) の範囲に正規化
  M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = M;  // 初期推定値（M ≈ E は e が小さいとき良好）
  for (let k = 0; k < 60; k++) {
    // f(E) = E − e·sin(E) − M、f'(E) = 1 − e·cos(E) でニュートン更新
    const dE = (M - E + e * Math.sin(E)) / (1.0 - e * Math.cos(E));
    E += dE;
    // 収束判定：更新量が十分小さければ終了
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/**
 * J2000からの絶対時刻 t [s] における衛星の位置・速度を計算する
 * 慣性座標系（地球→ECI、月→LCI）で位置 [m]・速度 [m/s] を返す
 *
 * @param sat - 衛星オブジェクト
 * @param t   - J2000からの経過秒数 [s]
 * @returns 位置・速度状態ベクトル
 */
export function propagate(sat: Satellite, t: number): State {
  // ---- 平均近点角の計算 ----
  // エポックからの経過時間 × 平均運動 でM を進める
  const M  = sat.M0 + sat.n * (t - sat.epochJ2000);
  const E  = solveKepler(M, sat.e);
  const cE = Math.cos(E), sE = Math.sin(E);
  const sq = Math.sqrt(1.0 - sat.e * sat.e);  // 焦点距離比 √(1−e²)

  // ---- 真近点角 ν の計算 ----
  const nu  = Math.atan2(sq * sE, cE - sat.e);
  const cNu = Math.cos(nu), sNu = Math.sin(nu);

  // ---- 近点座標系（ペリフォーカル座標）での位置・速度 ----
  const r  = sat.a * (1.0 - sat.e * cE);                     // 動径 [m]
  const h  = Math.sqrt(sat.mu * sat.a * (1.0 - sat.e * sat.e)); // 比角運動量 [m²/s]
  const px = r * cNu,               py = r * sNu;             // ペリフォーカル位置
  const vx = -(sat.mu / h) * sNu,   vy = (sat.mu / h) * (sat.e + cNu); // 速度

  // ---- ペリフォーカル → 慣性系への回転行列 R = Rz(Ω)·Rx(i)·Rz(ω) ----
  const cO = Math.cos(sat.raan), sO = Math.sin(sat.raan); // Ω（昇交点赤経）
  const ci = Math.cos(sat.i),    si = Math.sin(sat.i);    // i（傾斜角）
  const cw = Math.cos(sat.argp), sw = Math.sin(sat.argp); // ω（近点引数）

  // 回転行列の P列（近点方向）と Q列（90°先方向）
  const Px = cO*cw - sO*sw*ci,  Py = sO*cw + cO*sw*ci,  Pz = sw*si;
  const Qx = -cO*sw - sO*cw*ci, Qy = -sO*sw + cO*cw*ci, Qz = cw*si;

  return {
    pos: [Px*px + Qx*py, Py*px + Qy*py, Pz*px + Qz*py] as Vec3,
    vel: [Px*vx + Qx*vy, Py*vx + Qy*vy, Pz*vx + Qz*vy] as Vec3,
  };
}

/**
 * 軌道1周分の等時間間隔の状態ベクトル列を生成する
 *
 * @param sat - 衛星オブジェクト
 * @param t0  - 開始時刻（J2000からの秒数）[s]
 * @param N   - 分割数（N+1 点を生成）
 * @returns 位置・速度・時刻の配列
 */
export function orbitTrace(sat: Satellite, t0: number, N = 240): OrbitTraceResult {
  const positions: Vec3[]   = [];
  const velocities: Vec3[]  = [];
  const times: number[]     = [];

  // 0 〜 N の各ステップで均等に時刻を刻む（始点と終点が重なって閉じた軌道になる）
  for (let i = 0; i <= N; i++) {
    const t = t0 + (i / N) * sat.period;
    const { pos, vel } = propagate(sat, t);
    positions.push(pos);
    velocities.push(vel);
    times.push(t);
  }
  return { positions, velocities, times };
}
