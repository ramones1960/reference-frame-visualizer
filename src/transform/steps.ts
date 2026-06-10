// ============================================================
// 変換ステップの定義（理論解説・数式・ライブ数値の HTML 生成）
// ============================================================

import type { Vec3 } from '../types';
import type { Mat3 } from './math3';
import { WGS84 } from './math3';
import type { Elements, PipelineResult } from './pipeline';

const R2D = 180 / Math.PI;

// ---- 表示フォーマッタ -------------------------------------------

/** ラジアン → 度表示 */
function deg(rad: number, digits = 3): string {
  return (rad * R2D).toFixed(digits) + '°';
}

/** m → km 表示 */
function km(m: number, digits = 3): string {
  return (m / 1000).toFixed(digits);
}

/** ベクトル（m単位）を km の行ベクトルとして表示する */
function vecHTML(label: string, v: Vec3, unit = 'km', scale = 1e-3, digits = 3): string {
  const f = (x: number) => (x * scale).toFixed(digits);
  return `<div class="live-row"><span class="lbl">${label}</span>` +
    `<span class="val mono">[ ${f(v[0])}, ${f(v[1])}, ${f(v[2])} ]<sup>T</sup> ${unit}</span></div>`;
}

/** スカラー値の表示行 */
function valHTML(label: string, value: string): string {
  return `<div class="live-row"><span class="lbl">${label}</span><span class="val mono">${value}</span></div>`;
}

/** 3×3 行列を数値グリッドとして表示する */
function matHTML(label: string, m: Mat3, digits = 4): string {
  const cells = m.flat().map(x => `<span>${x.toFixed(digits)}</span>`).join('');
  return `<div class="live-mat"><span class="lbl">${label}</span>` +
    `<div class="mat-grid mono">${cells}</div></div>`;
}

// ---- ステップ定義 -----------------------------------------------

/** 1ステップ分の表示定義 */
export interface StepDef {
  /** ステップ見出し */
  title: string;
  /** 現在のフレームを示すバッジ文字列 */
  badge: string;
  /** 理論解説（静的 HTML） */
  theory: string;
  /** 数式（静的 HTML） */
  formula: string;
  /** ライブ数値表示（時刻・要素に応じて毎回再生成） */
  live(res: PipelineResult, els: Elements): string;
}

export const STEPS: StepDef[] = [
  // ---- ステップ 0 ----------------------------------------------
  {
    title: '軌道要素 → 真近点角',
    badge: 'ケプラー方程式',
    theory:
      '軌道上の衛星位置は6つの軌道要素 (a, e, i, Ω, ω, M₀) で決まる。' +
      '時刻 t の位置を得るには、まず平均近点角 M を平均運動 n で進め、' +
      '<b>ケプラー方程式</b>をニュートン・ラフソン法で解いて離心近点角 E を求め、' +
      '真近点角 ν に変換する。',
    formula:
      'n = √(μ/a³), M = M₀ + n·t<br>' +
      'M = E − e·sin E （ケプラー方程式）<br>' +
      'ν = atan2( √(1−e²)·sin E, cos E − e )<br>' +
      'r = a(1 − e·cos E)',
    live: (res) =>
      valHTML('n（平均運動）', (res.n * R2D).toExponential(4) + ' °/s') +
      valHTML('周期 T', (res.period / 60).toFixed(2) + ' min') +
      valHTML('M（平均近点角）', deg(res.M)) +
      valHTML('E（離心近点角）', deg(res.E)) +
      valHTML('ν（真近点角）', deg(res.nu)) +
      valHTML('r（動径）', km(res.rMag) + ' km'),
  },

  // ---- ステップ 1 ----------------------------------------------
  {
    title: 'ペリフォーカル座標 (PQW)',
    badge: 'PQW',
    theory:
      '軌道面に固定された<b>ペリフォーカル座標系</b>で位置・速度を表す。' +
      'P軸＝近点方向、Q軸＝軌道面内でPから90°進んだ方向、W軸＝軌道面法線' +
      '（角運動量 h = r×v の方向）。軌道運動は P-Q 平面内の2次元運動になる。',
    formula:
      'r<sub>PQW</sub> = r·[cos ν, sin ν, 0]<sup>T</sup><br>' +
      'v<sub>PQW</sub> = √(μ/p)·[−sin ν, e + cos ν, 0]<sup>T</sup><br>' +
      'p = a(1−e²) （半通径）',
    live: (res) =>
      valHTML('p（半通径）', km(res.p) + ' km') +
      vecHTML('r<sub>PQW</sub>', res.rPQW) +
      vecHTML('v<sub>PQW</sub>', res.vPQW, 'km/s', 1e-3, 4),
  },

  // ---- ステップ 2 ----------------------------------------------
  {
    title: '回転① Rz(ω) — 近点引数',
    badge: 'PQW → ECI 1/3',
    theory:
      'PQW → ECI は <b>3-1-3 オイラー角回転</b>で行う。第1回転は Z軸（軌道面法線W）' +
      'まわりに<b>近点引数 ω</b> だけ回し、近点方向を「昇交点から ω 進んだ位置」に置く。' +
      'これで昇交点方向が X 軸に一致する。',
    formula:
      'Rz(ω) = ' +
      '<table class="ftab"><tr><td>cos ω</td><td>−sin ω</td><td>0</td></tr>' +
      '<tr><td>sin ω</td><td>cos ω</td><td>0</td></tr>' +
      '<tr><td>0</td><td>0</td><td>1</td></tr></table>' +
      'r₁ = Rz(ω)·r<sub>PQW</sub>',
    live: (res, els) =>
      valHTML('ω（近点引数）', deg(els.argp)) +
      matHTML('Rz(ω)', res.Rw) +
      vecHTML('r₁', res.r1),
  },

  // ---- ステップ 3 ----------------------------------------------
  {
    title: '回転② Rx(i) — 軌道傾斜角',
    badge: 'PQW → ECI 2/3',
    theory:
      '第2回転。昇交点方向（いまの X 軸）を回転軸として、軌道面を' +
      '<b>軌道傾斜角 i</b> だけ赤道面から傾ける。回転軸上にある昇交点は動かない' +
      '（破線が昇交点方向）。',
    formula:
      'Rx(i) = ' +
      '<table class="ftab"><tr><td>1</td><td>0</td><td>0</td></tr>' +
      '<tr><td>0</td><td>cos i</td><td>−sin i</td></tr>' +
      '<tr><td>0</td><td>sin i</td><td>cos i</td></tr></table>' +
      'r₂ = Rx(i)·r₁',
    live: (res, els) =>
      valHTML('i（軌道傾斜角）', deg(els.i)) +
      matHTML('Rx(i)', res.Ri) +
      vecHTML('r₂', res.r2),
  },

  // ---- ステップ 4 ----------------------------------------------
  {
    title: '回転③ Rz(Ω) — 昇交点赤経 → ECI 完成',
    badge: 'ECI (J2000)',
    theory:
      '第3回転。Z軸（天の北極方向）まわりに<b>昇交点赤経 Ω</b> だけ回し、' +
      '昇交点を春分点方向（X♈）から Ω の位置に置く。これで' +
      '<b>地心慣性座標系 ECI</b> での位置・速度が得られる。3回転をまとめた合成行列が' +
      'PQW→ECI の方向余弦行列（DCM）になる。',
    formula:
      'r<sub>ECI</sub> = Rz(Ω)·Rx(i)·Rz(ω)·r<sub>PQW</sub><br>' +
      'v<sub>ECI</sub> = Rz(Ω)·Rx(i)·Rz(ω)·v<sub>PQW</sub>',
    live: (res, els) =>
      valHTML('Ω（昇交点赤経）', deg(els.raan)) +
      matHTML('Rz(Ω)', res.RO) +
      matHTML('R<sub>PQW→ECI</sub>（合成）', res.Rpqw2eci) +
      vecHTML('r<sub>ECI</sub>', res.rECI) +
      vecHTML('v<sub>ECI</sub>', res.vECI, 'km/s', 1e-3, 4),
  },

  // ---- ステップ 5 ----------------------------------------------
  {
    title: 'ECI → ECEF — 地球自転 R₃(θ<sub>GMST</sub>)',
    badge: 'ECEF',
    theory:
      '<b>グリニッジ平均恒星時 θ<sub>GMST</sub></b>（IAU 1982 モデル）だけ座標系を' +
      'Z軸まわりに回転（受動回転 R₃）すると、地球に固定された <b>ECEF 座標系</b>になる。' +
      'アニメーションでは「世界全体を −θ 回して地球を静止させる」＝同じ物理ベクトルを' +
      '回転系の基底で測り直すことを表現している。' +
      '速度は単なる回転では足りず、<b>輸送定理</b>による ω⊕×r 項が加わる。' +
      '<br><span class="note">※ 歳差・章動・極運動は無視した簡易モデル' +
      '（厳密には GCRF→ITRF は IAU 2006/2000A 理論による）。' +
      '3D表示の速度矢印は慣性速度のためこのステップでは非表示。</span>',
    formula:
      'θ<sub>GMST</sub> = 280.46061837° + 360.98564736629°·D<br>' +
      '　　　　 + 0.000387933°·T² − T³/38 710 000<br>' +
      '（D = J2000からの経過日数, T = D/36525）<br>' +
      'r<sub>ECEF</sub> = R₃(θ)·r<sub>ECI</sub><br>' +
      'v<sub>ECEF</sub> = R₃(θ)·v<sub>ECI</sub> − ω⊕ × r<sub>ECEF</sub>',
    live: (res) =>
      valHTML('θ<sub>GMST</sub>', deg(res.gmst)) +
      matHTML('R₃(θ<sub>GMST</sub>)', res.Rgmst) +
      vecHTML('r<sub>ECEF</sub>', res.rECEF) +
      vecHTML('v<sub>ECEF</sub>', res.vECEF, 'km/s', 1e-3, 4),
  },

  // ---- ステップ 6 ----------------------------------------------
  {
    title: 'ECEF → 測地座標（WGS84）',
    badge: '緯度・経度・高度',
    theory:
      'ECEF 直交座標を <b>WGS84 回転楕円体</b>基準の測地緯度 φ・経度 λ・楕円体高 h に変換する。' +
      '楕円体のため測地緯度は地心緯度と一致せず、φ は<b>反復法</b>で解く' +
      '（楕円体面への法線が衛星を通る緯度を探す）。赤い点が直下点（sub-satellite point）。',
    formula:
      'λ = atan2(y, x), p = √(x²+y²)<br>' +
      'N(φ) = a / √(1 − e²sin²φ)<br>' +
      'h = p/cos φ − N<br>' +
      'φ ← atan2( z, p·(1 − e²·N/(N+h)) ) （収束まで反復）<br>' +
      `<span class="note">WGS84: a = ${WGS84.A} m, f = 1/298.257223563</span>`,
    live: (res) =>
      valHTML('φ（測地緯度）', deg(res.geo.lat, 5)) +
      valHTML('λ（経度）', deg(res.geo.lon, 5)) +
      valHTML('h（楕円体高）', km(res.geo.h) + ' km') +
      vecHTML('直下点 (ECEF)', res.subPoint),
  },

  // ---- ステップ 7 ----------------------------------------------
  {
    title: 'ENU — 地上局から見た方位・仰角',
    badge: '局所地平 (ENU)',
    theory:
      '地上局の測地座標 (φ₀, λ₀) から<b>局所地平座標系 ENU</b>' +
      '（East-North-Up）を張り、ECEF の相対位置ベクトルを射影する。' +
      'これがアンテナ指向に使う<b>方位角 Az</b>（北から東回り）と<b>仰角 El</b> になる。' +
      '仰角が正なら衛星は地平線の上にあり可視。',
    formula:
      'ρ<sub>ECEF</sub> = r<sub>ECEF</sub> − r<sub>局</sub><br>' +
      'ρ<sub>ENU</sub> = R<sub>ENU</sub>·ρ<sub>ECEF</sub><br>' +
      'R<sub>ENU</sub> 行 = [E; N; U]（E=[−sinλ, cosλ, 0] など）<br>' +
      'Az = atan2(E, N), El = asin(U/‖ρ‖)',
    live: (res) => {
      const visible = res.azel.el > 0;
      return (
        vecHTML('r<sub>局</sub> (ECEF)', res.rStation) +
        matHTML('R<sub>ENU</sub>', res.Renu) +
        vecHTML('ρ<sub>ENU</sub>', res.rhoENU) +
        valHTML('方位角 Az', deg(res.azel.az, 2)) +
        valHTML('仰角 El', deg(res.azel.el, 2)) +
        valHTML('距離 ρ', km(res.azel.range, 1) + ' km') +
        `<div class="live-row"><span class="lbl">可視性</span>` +
        `<span class="val ${visible ? 'vis-ok' : 'vis-ng'}">` +
        `${visible ? '✓ 可視（地平線上）' : '✗ 不可視（地平線下）'}</span></div>`
      );
    },
  },
];
