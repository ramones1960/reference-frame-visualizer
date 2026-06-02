// ============================================================
// 描画モジュール
// Plotly.js による3D軌道表示と Leaflet による地上トラック表示を担当
// ============================================================

import Plotly from 'plotly.js-dist-min';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { C } from './constants';
import { propagate, orbitTrace } from './keplerian';
import { eciToECEF, ecefToLatLon, transformPoint } from './frames';
import type { Satellite, Vec3, FrameType } from './types';

// ---- 定数 -------------------------------------------------------

/** 衛星ごとに割り当てるカラーパレット（最大8機分） */
export const SAT_COLORS: readonly string[] = [
  '#00d4ff', '#ff6b35', '#7bc67e', '#ffd700',
  '#c77dff', '#ff85c8', '#4ecdc4', '#ff9f1c',
];

/** 座標系ごとの表示ラベル（パネルタイトルに使用） */
const FRAME_LABELS: Record<FrameType, string> = {
  eci:         'ECI  地心慣性座標系',
  ecef:        'ECEF  地球固定座標系',
  rtn:         'RTN / LVLH',
  groundtrack: '地上トラック',
  lci:         '月慣性座標系 (LCI)',
  lcf:         '月固定座標系 (LCF)',
};

// ---- 状態管理 ---------------------------------------------------

/** Plotly が初期化済みのパネルを管理（初回は newPlot、以降は react を使用） */
const _plotInited: Record<string, boolean> = {};

/** Leaflet マップインスタンスをパネルごとに保持 */
const _leafletMaps: Record<number, any> = {};

/** Leaflet のトラック・マーカーレイヤーをパネルごとに保持 */
const _leafletLayers: Record<number, { tracks: any[]; markers: any[] }> = {};

// ---- 球面サーフェス（Plotly）-------------------------------------

/**
 * Plotly の surface トレースとして天体球面を生成する
 * 緯度・経度のグリッドから xyz を計算してメッシュを作成
 *
 * @param radius - 球半径 [m]
 * @param color  - 球の色（16進数カラーコード）
 * @param nLat   - 緯度方向の分割数
 * @param nLon   - 経度方向の分割数
 */
function _sphereTrace(
  radius: number,
  color: string,
  nLat = 18,
  nLon = 24,
): object {
  const x: number[][] = [], y: number[][] = [], z: number[][] = [];
  for (let a = 0; a <= nLat; a++) {
    const lat = -Math.PI / 2 + Math.PI * a / nLat;
    const row = { x: [] as number[], y: [] as number[], z: [] as number[] };
    for (let b = 0; b <= nLon; b++) {
      const lon = 2 * Math.PI * b / nLon;
      const r = radius / 1000; // m → km に変換（プロット単位）
      row.x.push(r * Math.cos(lat) * Math.cos(lon));
      row.y.push(r * Math.cos(lat) * Math.sin(lon));
      row.z.push(r * Math.sin(lat));
    }
    x.push(row.x); y.push(row.y); z.push(row.z);
  }
  return {
    type: 'surface', x, y, z,
    colorscale: [[0, color], [1, color]],
    showscale: false, opacity: 0.55,
    lighting: { ambient: 0.9, diffuse: 0.5 },
    hoverinfo: 'skip',
  };
}

// ---- 3D Plotly パネル描画 ----------------------------------------

/**
 * 指定パネルに3D軌道を描画する
 * 天体球面・軌跡ライン・現在位置マーカーを Plotly で描画
 *
 * @param panelIdx  - パネルインデックス（0 or 1）
 * @param frame     - 表示する座標系
 * @param satellites - 衛星リスト
 * @param frac      - アニメーション進捗率 [0, 1]
 */
export function render3D(
  panelIdx: number,
  frame: FrameType,
  satellites: Satellite[],
  frac: number,
): void {
  const plotId = `plotly-${panelIdx}`;
  const leafId = `leaflet-${panelIdx}`;

  // 3D表示：Plotly を表示し Leaflet を非表示にする
  document.getElementById(plotId)!.style.display = '';
  document.getElementById(leafId)!.style.display = 'none';

  // 月系かどうかで天体・色を切り替える
  const isLunar   = frame === 'lci' || frame === 'lcf';
  const isRTN     = frame === 'rtn';
  const R_body    = isLunar ? C.R_MOON : C.R_EARTH;
  const bodyColor = isLunar ? '#9a9a9a' : '#1a5f8a';

  // 表示する衛星を中心天体でフィルタリング
  const sats = isLunar
    ? satellites.filter(s => s.body === 'moon')
    : satellites.filter(s => s.body === 'earth');

  if (sats.length === 0) {
    const msg = isLunar
      ? '月衛星が登録されていません。\n「軌道要素」タブで中心天体＝月を選択してください。'
      : '地球衛星が登録されていません。';
    _showMessage(plotId, msg);
    return;
  }
  _clearMessage(plotId);

  // 基準衛星のエポックを時刻軸の原点とする
  const refSat = sats[0];
  const t0   = refSat.epochJ2000;
  const tCur = t0 + frac * refSat.period;  // 現在時刻

  const traces: object[] = [];
  // 天体（地球 or 月）の球面を最初に追加
  traces.push(_sphereTrace(R_body, bodyColor));

  // ---- 各衛星の軌跡と現在位置マーカーを追加 ----
  sats.forEach((sat, idx) => {
    const color = SAT_COLORS[idx % SAT_COLORS.length];
    const { positions, velocities, times } = orbitTrace(sat, t0);

    // RTN座標では各時刻における基準衛星の状態も必要
    const refStates = isRTN
      ? times.map(t => propagate(refSat, t))
      : null;

    const xs: number[] = [], ys: number[] = [], zs: number[] = [];
    positions.forEach((pos, i) => {
      const refSt = isRTN ? refStates![i] : null;
      // 座標変換（RTN以外では refSt は実際には使われない）
      const p = transformPoint(
        pos, velocities[i], frame, times[i],
        refSt ?? { pos, vel: velocities[i] },
      );
      // m → km に変換してプロット
      xs.push(p[0] / 1000); ys.push(p[1] / 1000); zs.push(p[2] / 1000);
    });

    // 軌跡ラインを追加
    traces.push({
      type: 'scatter3d', mode: 'lines',
      x: xs, y: ys, z: zs,
      line: { color, width: 2 },
      name: sat.name,
    });

    // 現在位置マーカーを追加
    const { pos: cp, vel: cv } = propagate(sat, tCur);
    const refCur = isRTN ? propagate(refSat, tCur) : { pos: cp, vel: cv };
    const mp = transformPoint(cp, cv, frame, tCur, refCur);
    traces.push({
      type: 'scatter3d', mode: 'markers',
      x: [mp[0]/1000], y: [mp[1]/1000], z: [mp[2]/1000],
      marker: { color, size: 7, symbol: 'circle', line: { color: '#fff', width: 1 } },
      name: sat.name + '（現在）',
      showlegend: false,
    });
  });

  // RTN座標では基準衛星を原点（ダイヤモンドマーカー）で明示
  if (isRTN) {
    traces.push({
      type: 'scatter3d', mode: 'markers',
      x: [0], y: [0], z: [0],
      marker: { color: SAT_COLORS[0], size: 10, symbol: 'diamond',
                line: { color: '#fff', width: 1 } },
      name: refSat.name + '（基準）',
      showlegend: false,
    });
  }

  // ---- レイアウト設定（ダークテーマ）----
  const axisOpts = {
    color: '#aaa', gridcolor: '#333', zerolinecolor: '#666',
    tickfont: { color: '#aaa', size: 10 },
  };
  const layout = {
    paper_bgcolor: '#0a0a14',
    title: { text: FRAME_LABELS[frame], font: { color: '#e0e0e0', size: 12 } },
    scene: {
      xaxis: { ...axisOpts, title: { text: 'X (km)', font: { color: '#aaa', size: 10 } } },
      yaxis: { ...axisOpts, title: { text: 'Y (km)', font: { color: '#aaa', size: 10 } } },
      zaxis: { ...axisOpts, title: { text: 'Z (km)', font: { color: '#aaa', size: 10 } } },
      bgcolor: '#0d0d1a',
      aspectmode: 'cube',
    },
    legend: { font: { color: '#ccc', size: 10 }, bgcolor: 'rgba(0,0,0,0.55)', x: 0, y: 1 },
    margin: { l: 0, r: 0, t: 30, b: 0 },
  };

  // 初回は newPlot、以降は react（差分更新）でパフォーマンスを確保
  if (_plotInited[plotId]) {
    Plotly.react(plotId, traces, layout);
  } else {
    Plotly.newPlot(plotId, traces, layout, { responsive: true, displaylogo: false });
    _plotInited[plotId] = true;
  }
}

// ---- Leaflet 地上トラックパネル描画 -------------------------------

/**
 * 指定パネルに地上トラックを Leaflet で描画する
 * CartoDB ダークタイルを背景に軌跡ポリラインと現在位置マーカーを描画
 *
 * @param panelIdx  - パネルインデックス（0 or 1）
 * @param satellites - 衛星リスト（地球周回衛星のみ対象）
 * @param frac      - アニメーション進捗率 [0, 1]
 */
export function renderGroundTrack(
  panelIdx: number,
  satellites: Satellite[],
  frac: number,
): void {
  const plotId = `plotly-${panelIdx}`;
  const leafId = `leaflet-${panelIdx}`;

  // 地上トラック表示：Leaflet を表示し Plotly を非表示にする
  document.getElementById(plotId)!.style.display = 'none';
  document.getElementById(leafId)!.style.display = '';

  // 地球周回衛星のみを表示対象とする
  const earthSats = satellites.filter(s => s.body === 'earth');

  // Leaflet マップを初回のみ生成する
  if (!_leafletMaps[panelIdx]) {
    const map = L.map(leafId, { center: [0, 0], zoom: 1, worldCopyJump: true });
    // CartoDB ダークテーマのタイルを使用
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);
    _leafletMaps[panelIdx] = map;
    _leafletLayers[panelIdx] = { tracks: [], markers: [] };
    // コンテナサイズ確定後に再計算させる
    setTimeout(() => map.invalidateSize(), 50);
  }

  const map = _leafletMaps[panelIdx];

  // 前フレームのレイヤーを削除して再描画
  const lyr = _leafletLayers[panelIdx];
  lyr.tracks.forEach((l: any)  => map.removeLayer(l));
  lyr.markers.forEach((l: any) => map.removeLayer(l));
  lyr.tracks = []; lyr.markers = [];

  if (earthSats.length === 0) return;

  const refSat = earthSats[0];
  const t0   = refSat.epochJ2000;
  const tCur = t0 + frac * refSat.period;

  earthSats.forEach((sat, idx) => {
    const color = SAT_COLORS[idx % SAT_COLORS.length];
    // 地上トラックは360点で描画（滑らかな曲線にするため）
    const { positions, times } = orbitTrace(sat, t0, 360);

    // ---- 経度の日付変更線を考慮してポリラインをセグメント分割 ----
    let seg: [number, number][] = [];
    const segments: [number, number][][] = [seg];
    let prevLon: number | null = null;

    positions.forEach((pos, i) => {
      const ecef = eciToECEF(pos as Vec3, times[i]);
      const { lat, lon } = ecefToLatLon(ecef);
      // 経度が180°以上跳んだら新しいセグメントを開始（日付変更線越え）
      if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
        seg = [];
        segments.push(seg);
      }
      seg.push([lat, lon]);
      prevLon = lon;
    });

    // 各セグメントをポリラインとして追加
    segments.forEach(s => {
      if (s.length < 2) return;
      const polyline = L.polyline(s, { color, weight: 2, opacity: 0.8 });
      polyline.addTo(map);
      lyr.tracks.push(polyline);
    });

    // 現在位置マーカーをECEFに変換して緯度経度を取得
    const { pos: cp } = propagate(sat, tCur);
    const ecefCur = eciToECEF(cp as Vec3, tCur);
    const { lat, lon } = ecefToLatLon(ecefCur);
    const marker = L.circleMarker([lat, lon], {
      radius: 6, color: '#fff', weight: 1.5,
      fillColor: color, fillOpacity: 1,
    }).bindTooltip(sat.name, { permanent: false });
    marker.addTo(map);
    lyr.markers.push(marker);
  });
}

// ---- 公開エントリーポイント -------------------------------------

/**
 * 座標系に応じて3Dプロットまたは地上トラックを描画する
 *
 * @param panelIdx  - パネルインデックス（0 or 1）
 * @param frame     - 表示する座標系
 * @param satellites - 衛星リスト
 * @param frac      - アニメーション進捗率 [0, 1]
 */
export function renderPanel(
  panelIdx: number,
  frame: FrameType,
  satellites: Satellite[],
  frac: number,
): void {
  if (frame === 'groundtrack') {
    renderGroundTrack(panelIdx, satellites, frac);
  } else {
    render3D(panelIdx, frame, satellites, frac);
  }
}

/**
 * Leaflet マップのサイズを再計算させる
 * パネル表示切り替えや画面リサイズ後に呼び出す
 */
export function invalidateLeaflet(panelIdx: number): void {
  if (_leafletMaps[panelIdx]) _leafletMaps[panelIdx].invalidateSize();
}

// ---- ユーティリティ ----------------------------------------------

/** Plotly コンテナにメッセージを表示し、既存プロットを破棄する */
function _showMessage(plotId: string, msg: string): void {
  const el = document.getElementById(plotId)!;
  el.innerHTML = `<div class="plot-msg">${msg.replace(/\n/g, '<br>')}</div>`;
  _plotInited[plotId] = false;
}

/** Plotly コンテナのメッセージ表示を解除する */
function _clearMessage(plotId: string): void {
  const el = document.getElementById(plotId)!;
  if (el.querySelector('.plot-msg')) {
    el.innerHTML = '';
    _plotInited[plotId] = false;
  }
}
