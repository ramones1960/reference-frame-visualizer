// ============================================================
// アプリケーションメインモジュール
// UIイベントのハンドリング・状態管理・描画ループを担当
// ============================================================

import { parseTLE, parseElements } from './tle';
import { renderPanel, invalidateLeaflet, SAT_COLORS, setSyncEnabled, syncPanels } from './plot';
import type { Satellite, FrameType } from './types';

// ---- アプリケーション状態 ---------------------------------------

/** 登録済み衛星の配列 */
let satellites: Satellite[] = [];

/** アニメーション進捗率 [0, 1]（基準衛星の1周期に対する割合）*/
let animFrac   = 0;

/** アニメーション再生中フラグ */
let isPlaying  = false;

/** setInterval の戻り値（停止時にクリアする）*/
let animTimer: ReturnType<typeof setInterval> | null = null;

/** アニメーションの前フレームのタイムスタンプ [ms] */
let lastAnimMs: number | null = null;

/** 表示パネル数（1 または 2）*/
let viewMode   = 1;

// ---- 起動時デフォルト TLE（ISS）---------------------------------

const EXAMPLE_TLE_NAME = 'ISS (ZARYA)';
const EXAMPLE_TLE_L1   = '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9993';
const EXAMPLE_TLE_L2   = '2 25544  51.6400 337.6182 0004534  44.7272  48.3982 15.50000000408539';

// ---- 初期化 -----------------------------------------------------

/** DOM 読み込み完了後に実行される初期化処理 */
window.addEventListener('DOMContentLoaded', () => {
  _initTabs();
  _initTimeControls();

  // TLEフォームにISSのサンプルデータを事前入力
  (document.getElementById('tle-name')  as HTMLInputElement).value  = EXAMPLE_TLE_NAME;
  (document.getElementById('tle-line1') as HTMLTextAreaElement).value = EXAMPLE_TLE_L1;
  (document.getElementById('tle-line2') as HTMLTextAreaElement).value = EXAMPLE_TLE_L2;

  // 起動直後にISSを自動登録して表示する
  _addSatFromTLE();

  setViewMode(1);
  _renderAll();
});

// ---- タブ切り替え -----------------------------------------------

/**
 * 入力タブ（TLE / 軌道要素）の切り替えイベントを設定する
 * 「衛星を追加」ボタンのイベントも登録する
 */
function _initTabs(): void {
  // 各タブボタンにクリックイベントを登録
  document.querySelectorAll<HTMLButtonElement>('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.tabs')!;
      // アクティブクラスを切り替える
      group.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // 対応するタブパネルを表示し、他を隠す
      const panel = btn.dataset.tab!;
      document.getElementById('tab-tle')!.classList.add('hidden');
      document.getElementById('tab-elements')!.classList.add('hidden');
      document.getElementById(`tab-${panel}`)!.classList.remove('hidden');
    });
  });

  // 「衛星を追加」ボタン：現在アクティブなタブに応じた入力処理を呼び出す
  document.getElementById('add-sat-btn')!.addEventListener('click', () => {
    const activeTab =
      document.querySelector<HTMLButtonElement>('.tab-btn[data-tab].active')
        ?.dataset.tab ?? 'tle';
    if (activeTab === 'tle') _addSatFromTLE();
    else _addSatFromElements();
  });
}

// ---- 衛星管理 ---------------------------------------------------

/** TLE フォームの入力値を解析して衛星を登録する */
function _addSatFromTLE(): void {
  const name  = (document.getElementById('tle-name')  as HTMLInputElement).value.trim();
  const line1 = (document.getElementById('tle-line1') as HTMLTextAreaElement).value.trim();
  const line2 = (document.getElementById('tle-line2') as HTMLTextAreaElement).value.trim();
  if (!line1 || !line2) {
    alert('TLEの Line 1 と Line 2 を入力してください。');
    return;
  }
  try {
    const sat = parseTLE(name, line1, line2);
    _registerSat(sat);
  } catch (e) {
    alert('TLE解析エラー: ' + (e as Error).message);
  }
}

/** 軌道要素フォームの入力値から衛星オブジェクトを生成して登録する */
function _addSatFromElements(): void {
  const get = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
  const params = {
    name: get('el-name'), body: get('el-body'),
    a:    get('el-a'),    e:    get('el-e'),   i: get('el-i'),
    raan: get('el-raan'), argp: get('el-argp'), M0: get('el-M'),
  };
  if (!params.a || !params.e) {
    alert('少なくとも a (半長径) と e (離心率) を入力してください。');
    return;
  }
  try {
    const sat = parseElements(params);
    _registerSat(sat);
  } catch (e) {
    alert('軌道要素エラー: ' + (e as Error).message);
  }
}

/**
 * 衛星をリストに追加し、UIを更新する
 * 同名の衛星が既に存在する場合は連番サフィックスを付与する
 */
function _registerSat(sat: Satellite): void {
  const base = sat.name;
  let name = base, k = 2;
  while (satellites.some(s => s.name === name)) name = `${base} (${k++})`;
  sat.name = name;
  satellites.push(sat);
  _updateSatList();
  _resetAnim();
  _renderAll();
}

/** 指定インデックスの衛星をリストから削除する */
function _removeSat(idx: number): void {
  satellites.splice(idx, 1);
  _updateSatList();
  _resetAnim();
  _renderAll();
}

/** 衛星リスト UI（サイドバー）を最新状態に更新する */
function _updateSatList(): void {
  const ul = document.getElementById('sat-list')!;
  ul.innerHTML = '';
  satellites.forEach((sat, idx) => {
    const color = SAT_COLORS[idx % SAT_COLORS.length];
    const div = document.createElement('div');
    // 最初の衛星は RTN の基準衛星として強調表示する
    div.className = 'sat-item' + (idx === 0 ? ' sat-ref' : '');
    div.innerHTML = `
      <span class="sat-color" style="background:${color}"></span>
      <span class="sat-name">${sat.name}</span>
      <span class="sat-badge">${sat.body === 'moon' ? '月' : '地球'}</span>
      ${idx === 0 ? '<span class="sat-ref-label">REF</span>' : ''}
      <button class="sat-remove" data-idx="${idx}">×</button>
    `;
    ul.appendChild(div);
  });

  // 削除ボタンのイベントを登録（innerHTML の onclick は CSP に抵触する可能性があるため）
  ul.querySelectorAll<HTMLButtonElement>('.sat-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      _removeSat(Number(btn.dataset.idx));
    });
  });
}

// ---- 時刻コントロール -------------------------------------------

/**
 * 時刻スライダー・再生/停止ボタン・リセットボタンのイベントを設定する
 */
function _initTimeControls(): void {
  const slider = document.getElementById('time-slider') as HTMLInputElement;

  // スライダー操作でアニメーション進捗を手動更新
  slider.addEventListener('input', () => {
    animFrac = parseInt(slider.value) / 1000;
    _updateTimeDisplay();
    _renderAll();
  });

  // 再生/一時停止ボタン
  document.getElementById('btn-play')!.addEventListener('click', () => {
    if (isPlaying) _stopAnim();
    else _startAnim();
  });

  // リセットボタン：アニメーションを停止して先頭に戻す
  document.getElementById('btn-reset')!.addEventListener('click', () => {
    _stopAnim();
    animFrac = 0;
    slider.value = '0';
    _updateTimeDisplay();
    _renderAll();
  });
}

/**
 * アニメーションを開始する
 * 衛星が0機の場合は何もしない
 */
function _startAnim(): void {
  if (isPlaying || satellites.length === 0) return;
  isPlaying = true;
  lastAnimMs = null;
  document.getElementById('btn-play')!.textContent = '⏸ 一時停止';
  animTimer = setInterval(_animStep, 80); // 約12fps でアニメーション
}

/** アニメーションを停止する */
function _stopAnim(): void {
  isPlaying = false;
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
  document.getElementById('btn-play')!.textContent = '▶ 再生';
}

/**
 * アニメーションの1ステップを処理する（setInterval から呼ばれる）
 * 実経過時間に速度倍率と軌道周期を掛けて進捗率を更新する
 */
function _animStep(): void {
  const now   = Date.now();
  // 前フレームからの経過時間（初回フレームは80msとみなす）
  const dtMs  = lastAnimMs ? now - lastAnimMs : 80;
  lastAnimMs  = now;
  const speed = parseFloat(
    (document.getElementById('speed-select') as HTMLSelectElement).value
  ) || 1000;
  // 基準衛星の周期でフレーム進捗を正規化
  const T_ref = satellites[0]?.period ?? 5400;
  animFrac = (animFrac + (dtMs / 1000) * speed / T_ref) % 1;
  (document.getElementById('time-slider') as HTMLInputElement).value =
    String(Math.round(animFrac * 1000));
  _updateTimeDisplay();
  _renderAll();
}

/** アニメーションを停止して先頭にリセットする */
function _resetAnim(): void {
  _stopAnim();
  animFrac = 0;
  (document.getElementById('time-slider') as HTMLInputElement).value = '0';
  _updateTimeDisplay();
}

/** 時刻表示ラベルを現在の animFrac に合わせて更新する */
function _updateTimeDisplay(): void {
  if (satellites.length === 0) {
    document.getElementById('time-display')!.textContent = '—';
    return;
  }
  const T = satellites[0].period;
  const t = animFrac * T;
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  const pct = (animFrac * 100).toFixed(1);
  document.getElementById('time-display')!.textContent =
    `${m}分 ${String(s).padStart(2, '0')}秒  (${pct}%)`;
}

// ---- 表示モード切り替え -----------------------------------------

/**
 * 1画面 / 2画面 表示モードを切り替える
 * @param n - パネル数（1 または 2）
 */
export function setViewMode(n: number): void {
  viewMode = n;
  document.getElementById('view-1')!.classList.toggle('active', n === 1);
  document.getElementById('view-2')!.classList.toggle('active', n === 2);
  document.getElementById('panel-1')!.classList.toggle('hidden', n === 1);
  document.getElementById('panels-wrap')!.classList.toggle('two-up', n === 2);

  // パネルサイズが変わるため Leaflet のサイズを再計算させる
  setTimeout(() => { invalidateLeaflet(0); invalidateLeaflet(1); }, 100);
  // 2画面時のみパネル間の表示範囲・角度を連動させる
  setSyncEnabled(n === 2);
  _renderAll();
}

// ---- 座標系変更 -------------------------------------------------

/**
 * フレームセレクタの変更時に対象パネルを再描画する
 * @param idx - パネルインデックス（0 or 1）
 */
export function onFrameChange(idx: number): void {
  _renderPanel(idx);
  // 地上トラック表示時は Leaflet サイズを再計算させる
  setTimeout(() => invalidateLeaflet(idx), 100);
  // 2画面モードでは座標系変更時にも表示範囲・カメラを再同期
  if (viewMode === 2) setTimeout(syncPanels, 0);
}

// ---- 描画 -------------------------------------------------------

/** 全表示パネルを再描画する */
function _renderAll(): void {
  _renderPanel(0);
  if (viewMode === 2) {
    _renderPanel(1);
    // 両パネル描画後に表示範囲・カメラを同期させる
    // Plotly の newPlot/react 完了を待つため次フレームに遅延
    setTimeout(syncPanels, 0);
  }
}

/**
 * 指定パネルを現在の座標系・衛星データで再描画する
 * @param idx - パネルインデックス（0 or 1）
 */
function _renderPanel(idx: number): void {
  const frame = (document.getElementById(`frame-${idx}`) as HTMLSelectElement | null)?.value;
  if (!frame) return;
  renderPanel(idx, frame as FrameType, satellites, animFrac);
}

// ---- グローバル公開（HTML の onclick から呼び出せるようにする）----

// Vite でバンドルした場合も window に露出して HTML のインライン属性から使えるようにする
(window as any).setViewMode  = setViewMode;
(window as any).onFrameChange = onFrameChange;
