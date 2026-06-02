// ============================================================
// TLE（Two-Line Element）解析・軌道要素パーサー
// ============================================================

import { C } from './constants';
import type { Satellite, ElementParams } from './types';

/**
 * ユリウス日を計算する
 * グレゴリオ暦の年月日からユリウス日を返す
 */
function _julianDate(year: number, month: number, day: number): number {
  // 1月・2月は前年の13・14月として扱う（ユリウス日算出の慣習）
  if (month <= 2) { year--; month += 12; }
  const A = Math.floor(year / 100);
  // グレゴリオ暦補正係数
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (year + 4716))
       + Math.floor(30.6001 * (month + 1))
       + day + B - 1524.5;
}

/**
 * TLE 2行形式を解析して衛星オブジェクトを生成する
 *
 * @param name - 衛星名（省略可）
 * @param line1 - TLE 1行目
 * @param line2 - TLE 2行目
 * @returns 衛星オブジェクト
 */
export function parseTLE(name: string, line1: string, line2: string): Satellite {
  // ---- エポック解析 ----
  // TLE 1行目の18〜32文字目がエポック文字列（YYDDDddddd 形式）
  const epochStr = line1.substring(18, 32).trim();
  const year2d    = parseInt(epochStr.substring(0, 2));
  // 57以上なら1900年代、未満なら2000年代（TLEの慣習）
  const year      = year2d >= 57 ? 1900 + year2d : 2000 + year2d;
  const dayFrac   = parseFloat(epochStr.substring(2));
  // 年初のユリウス日 + 通日 → エポックのユリウス日
  const jd        = _julianDate(year, 1, 1.0) + dayFrac - 1.0;
  // J2000エポック（JD 2451545.0）からの経過秒数に変換
  const epochJ2000 = (jd - C.J2000) * 86400.0;

  // ---- 軌道要素の読み取り（TLE 2行目から固定幅で取得）----
  const i    = parseFloat(line2.substring(8,  16)) * C.DEG2RAD;  // 軌道傾斜角
  const raan = parseFloat(line2.substring(17, 25)) * C.DEG2RAD;  // 昇交点赤経
  // 離心率フィールドは小数点なしの7桁 → 先頭に "0." を付加
  const e    = parseFloat('0.' + line2.substring(26, 33).trim());
  const argp = parseFloat(line2.substring(34, 42)) * C.DEG2RAD;  // 近点引数
  const M0   = parseFloat(line2.substring(43, 51)) * C.DEG2RAD;  // 平均近点角
  // 平均運動は rev/day 単位 → rad/s に変換
  const n    = parseFloat(line2.substring(52, 63)) * 2 * Math.PI / 86400;
  // ケプラーの第3法則 n² a³ = μ → 半長径 a を逆算 [m]
  const a    = Math.cbrt(C.MU_EARTH / (n * n));

  return {
    name: (name || '').trim() || 'Satellite',
    body: 'earth',
    mu:   C.MU_EARTH,
    a, e, i, raan, argp, M0, n,
    epochJ2000,
    period: 2 * Math.PI / n,
  };
}

/**
 * 手動入力の軌道要素から衛星オブジェクトを生成する
 *
 * @param params - フォームから取得した軌道要素パラメータ
 * @returns 衛星オブジェクト
 */
export function parseElements(params: ElementParams): Satellite {
  const { name, body, a, e, i, raan, argp, M0 } = params;

  // 中心天体に応じた重力定数を選択
  const b  = (body || 'earth').toLowerCase() as 'earth' | 'moon';
  const mu = b === 'moon' ? C.MU_MOON : C.MU_EARTH;

  // 単位変換：km → m、度 → ラジアン
  const aM = parseFloat(a)    * 1000;
  const eV = parseFloat(e);
  const iV = parseFloat(i)    * C.DEG2RAD;
  const rV = parseFloat(raan) * C.DEG2RAD;
  const wV = parseFloat(argp) * C.DEG2RAD;
  const mV = parseFloat(M0)   * C.DEG2RAD;

  // ケプラーの第3法則から平均運動を計算
  const n  = Math.sqrt(mu / (aM * aM * aM));

  return {
    name: (name || '').trim() || 'Satellite',
    body: b,
    mu,
    a: aM, e: eV, i: iV, raan: rV, argp: wV, M0: mV,
    n,
    // 軌道要素入力ではエポックをJ2000とする
    epochJ2000: 0,
    period: 2 * Math.PI / n,
  };
}
