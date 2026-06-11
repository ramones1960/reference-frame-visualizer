// ============================================================
// 座標変換ステップビジュアライザー メインモジュール
// UI配線・ステップ遷移アニメーション・時刻再生を担当
// ============================================================

import { TransformScene } from './scene';
import { computePipeline } from './pipeline';
import type { Elements, StationInput, PipelineResult } from './pipeline';
import { STEPS } from './steps';

const D2R = Math.PI / 180;

/** 回転アニメーションを行うステップ（オイラー回転＋フレーム乗り換え） */
const ANIMATED_STEPS = new Set([2, 3, 4, 5]);

/** ステップ遷移アニメーションの長さ [ms] */
const ANIM_MS = 1400;

/** 時刻スライダーの最大値（J2000 から2日分）[s] */
const T_MAX = 172800;

// ---- アプリケーション状態 ---------------------------------------

let els: Elements = {
  a: 8000e3,
  e: 0.15,
  i: 51.6 * D2R,
  raan: 60 * D2R,
  argp: 45 * D2R,
  M0: 30 * D2R,
};
let station: StationInput = { lat: 35.68 * D2R, lon: 139.77 * D2R };

/** J2000 からの経過秒数 */
let t = 0;
/** 現在のステップ番号（0〜7） */
let step = 0;
/** 現在ステップのアニメーション進捗 [0,1] */
let animS = 1;
/** ステップアニメーションの rAF ハンドル */
let animRaf = 0;

/** 時刻再生中フラグ */
let playing = false;
let playRaf = 0;
let lastPlayMs = 0;

let scene: TransformScene;

// ---- DOM ヘルパー ------------------------------------------------

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function inputVal(id: string): number {
  return parseFloat(($(id) as HTMLInputElement).value);
}

// ---- 計算＆描画 --------------------------------------------------

/** 現在の状態でパイプラインを計算する */
function compute(): PipelineResult {
  return computePipeline(els, station, t);
}

/** シーン・ライブ数値・時刻表示をすべて更新する */
function refresh(): void {
  const res = compute();
  scene.update(res, els, step, animS);

  // アクティブステップのライブ数値を更新
  const liveDiv = document.querySelector<HTMLElement>('.step-card.active .step-live');
  if (liveDiv) liveDiv.innerHTML = STEPS[step].live(res, els);

  // 時刻・GMST 表示
  const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = Math.floor(t % 60);
  $('time-display').textContent =
    `t = J2000 + ${hh}h ${String(mm).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s`;
  $('gmst-display').textContent =
    `θ_GMST = ${(res.gmst * 180 / Math.PI).toFixed(3)}°`;

  // HUD（3D画面左上のフレーム表示）
  $('hud-step').textContent = `STEP ${step}/${STEPS.length - 1}`;
  $('hud-frame').innerHTML = STEPS[step].badge;
}

// ---- ステップ遷移 ------------------------------------------------

/**
 * 指定ステップへ移動する
 * @param k       - 移動先ステップ番号
 * @param animate - true なら回転アニメーションを再生する
 */
function goToStep(k: number, animate: boolean): void {
  if (k < 0 || k >= STEPS.length) return;
  cancelAnimationFrame(animRaf);
  step = k;

  // カードのアクティブ状態を更新
  document.querySelectorAll<HTMLElement>('.step-card').forEach((card, idx) => {
    card.classList.toggle('active', idx === k);
  });
  // アクティブカードを表示範囲内へスクロール
  document.querySelector('.step-card.active')
    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  ($('btn-prev') as HTMLButtonElement).disabled = (k === 0);
  ($('btn-next') as HTMLButtonElement).disabled = (k === STEPS.length - 1);

  if (animate && ANIMATED_STEPS.has(k)) {
    playStepAnim();
  } else {
    animS = 1;
    refresh();
  }
}

/** 現在ステップの回転アニメーションを最初から再生する */
function playStepAnim(): void {
  cancelAnimationFrame(animRaf);
  const t0 = performance.now();
  const tick = (now: number) => {
    const u = Math.min((now - t0) / ANIM_MS, 1);
    // easeInOutCubic で滑らかに回転させる
    animS = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    refresh();
    if (u < 1) animRaf = requestAnimationFrame(tick);
  };
  animRaf = requestAnimationFrame(tick);
}

// ---- ステップカードの構築 -----------------------------------------

/** サイドバーのステップカード一覧を生成する */
function buildStepCards(): void {
  const wrap = $('step-list');
  wrap.innerHTML = '';
  STEPS.forEach((def, k) => {
    const card = document.createElement('div');
    card.className = 'step-card' + (k === step ? ' active' : '');
    card.innerHTML = `
      <div class="step-head">
        <span class="step-num">${k}</span>
        <span class="step-title">${def.title}</span>
        <span class="step-badge">${def.badge}</span>
      </div>
      <div class="step-body">
        <p class="step-theory">${def.theory}</p>
        <div class="step-formula mono">${def.formula}</div>
        <div class="step-live"></div>
      </div>
    `;
    // ヘッダクリックでそのステップへジャンプ
    card.querySelector('.step-head')!.addEventListener('click', () => goToStep(k, true));
    wrap.appendChild(card);
  });
}

// ---- 入力フォーム -------------------------------------------------

/** フォームの値を読み取って軌道要素・地上局を更新する */
function applyInputs(): void {
  const a = inputVal('in-a') * 1000;
  const e = inputVal('in-e');
  if (!(a > 6378137)) { alert('半長径 a は地球半径（6378 km）より大きくしてください。'); return; }
  if (!(e >= 0 && e < 1)) { alert('離心率 e は 0 ≤ e < 1 で入力してください。'); return; }
  if (a * (1 - e) < 6378137 + 100e3) {
    alert('近地点高度が 100 km を下回ります。a または e を調整してください。');
    return;
  }
  els = {
    a, e,
    i: inputVal('in-i') * D2R,
    raan: inputVal('in-raan') * D2R,
    argp: inputVal('in-argp') * D2R,
    M0: inputVal('in-m0') * D2R,
  };
  station = { lat: inputVal('in-lat') * D2R, lon: inputVal('in-lon') * D2R };
  refresh();
}

// ---- 時刻コントロール ---------------------------------------------

/** 時刻再生の1フレーム処理 */
function playTick(now: number): void {
  const dt = (now - lastPlayMs) / 1000;
  lastPlayMs = now;
  const speed = parseFloat(($('speed-select') as HTMLSelectElement).value);
  t = (t + dt * speed) % T_MAX;
  ($('time-slider') as HTMLInputElement).value = String(Math.round(t));
  refresh();
  if (playing) playRaf = requestAnimationFrame(playTick);
}

/** 時刻再生の開始/停止を切り替える */
function togglePlay(): void {
  playing = !playing;
  $('btn-play').textContent = playing ? '⏸ 停止' : '▶ 時刻再生';
  if (playing) {
    lastPlayMs = performance.now();
    playRaf = requestAnimationFrame(playTick);
  } else {
    cancelAnimationFrame(playRaf);
  }
}

// ---- 初期化 -------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  scene = new TransformScene($('viewport'));

  buildStepCards();

  // フォーム初期値（状態と一致させる）
  ($('in-a') as HTMLInputElement).value = '8000';
  ($('in-e') as HTMLInputElement).value = '0.15';
  ($('in-i') as HTMLInputElement).value = '51.6';
  ($('in-raan') as HTMLInputElement).value = '60';
  ($('in-argp') as HTMLInputElement).value = '45';
  ($('in-m0') as HTMLInputElement).value = '30';
  ($('in-lat') as HTMLInputElement).value = '35.68';
  ($('in-lon') as HTMLInputElement).value = '139.77';

  $('btn-apply').addEventListener('click', applyInputs);
  $('btn-prev').addEventListener('click', () => goToStep(step - 1, false));
  $('btn-next').addEventListener('click', () => goToStep(step + 1, true));
  $('btn-replay').addEventListener('click', () => {
    if (ANIMATED_STEPS.has(step)) playStepAnim();
  });
  $('btn-camera').addEventListener('click', () => scene.resetCamera());
  $('btn-play').addEventListener('click', togglePlay);

  const slider = $('time-slider') as HTMLInputElement;
  slider.max = String(T_MAX);
  slider.addEventListener('input', () => {
    t = parseFloat(slider.value);
    refresh();
  });

  // ←/→ キーでステップ移動
  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    if (ev.key === 'ArrowRight') goToStep(step + 1, true);
    if (ev.key === 'ArrowLeft') goToStep(step - 1, false);
  });

  goToStep(0, false);
});
