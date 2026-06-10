// ============================================================
// Three.js 3Dシーンモジュール
//
// シーングラフ構成:
//   scene
//   └ worldGroup（ECEF表示時に Rz(−θ_GMST) を適用＝座標系の乗り換え）
//     ├ eciTriad（慣性系の軸）
//     ├ orbitGroup（PQW→ECI の累積回転を適用）
//     │   軌道楕円・PQW軸・衛星・位置/速度ベクトル・昇交点線
//     └ earthFixedGroup（常に Rz(θ_GMST)＝地球の実姿勢）
//         地球・経緯度グリッド・ECEF軸・直下点・地上局・ENU軸
//
// この構成により「フレーム変換＝全体を逆回転して見る」という
// 理論の本質（同じ物理ベクトルを別の基底で測る）を視覚化する。
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vec3 } from '../types';
import { WGS84 } from './math3';
import type { Elements, PipelineResult } from './pipeline';

/** シーンの長さスケール：1 [scene unit] = WGS84 長半径 [m] */
const SCALE = 1 / WGS84.A;

/** m単位の Vec3 をシーン座標の THREE.Vector3 に変換 */
function toScene(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0] * SCALE, v[1] * SCALE, v[2] * SCALE);
}

// ---- テキストスプライト -----------------------------------------

/** ラベル用のテキストスプライトを生成する（常に手前に表示） */
function makeLabel(text: string, color: string, scale = 0.16): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 72px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scale * 2, scale, 1);
  sprite.renderOrder = 999;
  return sprite;
}

// ---- 座標軸トライアド -------------------------------------------

interface Triad {
  group: THREE.Group;
  arrows: [THREE.ArrowHelper, THREE.ArrowHelper, THREE.ArrowHelper];
  labels: [THREE.Sprite, THREE.Sprite, THREE.Sprite];
}

/** 3軸の矢印＋ラベルのセットを生成する */
function makeTriad(
  len: number,
  colors: [number, number, number],
  names: [string, string, string],
  labelScale = 0.16,
): Triad {
  const group = new THREE.Group();
  const dirs = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];
  const arrows = [] as unknown as Triad['arrows'];
  const labels = [] as unknown as Triad['labels'];
  for (let k = 0; k < 3; k++) {
    const arrow = new THREE.ArrowHelper(
      dirs[k], new THREE.Vector3(0, 0, 0), len, colors[k], len * 0.07, len * 0.035,
    );
    const label = makeLabel(names[k], '#' + colors[k].toString(16).padStart(6, '0'), labelScale);
    label.position.copy(dirs[k]).multiplyScalar(len + 0.13);
    group.add(arrow, label);
    arrows.push(arrow);
    labels.push(label);
  }
  return { group, arrows, labels };
}

// ---- 地球（楕円体＋経緯度グリッド） ------------------------------

/**
 * 地球の3Dオブジェクトを生成する
 * z方向を (1−f) 倍して WGS84 楕円体形状を再現する
 * グリニッジ子午線（λ=0）を緑でハイライトし、ECEF の向きを示す
 */
function makeEarth(): THREE.Group {
  const group = new THREE.Group();

  // 本体（単位球を z 方向に扁平化）
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 32),
    new THREE.MeshLambertMaterial({ color: 0x163a63 }),
  );
  group.add(sphere);

  const gridMat = new THREE.LineBasicMaterial({ color: 0x3a6ea5, transparent: true, opacity: 0.65 });
  const eqMat = new THREE.LineBasicMaterial({ color: 0xcc4455 });
  const pmMat = new THREE.LineBasicMaterial({ color: 0x33cc77 });
  const R = 1.003; // グリッドを表面よりわずかに浮かせて Z-fighting を防ぐ

  // 緯線（30°おき、赤道は赤系で強調）
  for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
    const lat = latDeg * Math.PI / 180;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 96; k++) {
      const lon = (k / 96) * 2 * Math.PI;
      pts.push(new THREE.Vector3(
        R * Math.cos(lat) * Math.cos(lon),
        R * Math.cos(lat) * Math.sin(lon),
        R * Math.sin(lat),
      ));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      latDeg === 0 ? eqMat : gridMat,
    );
    group.add(line);
  }

  // 経線（30°おき、グリニッジ子午線 λ=0 は緑で強調）
  for (let lonDeg = 0; lonDeg < 360; lonDeg += 30) {
    const lon = lonDeg * Math.PI / 180;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 48; k++) {
      const lat = -Math.PI / 2 + (k / 48) * Math.PI;
      pts.push(new THREE.Vector3(
        R * Math.cos(lat) * Math.cos(lon),
        R * Math.cos(lat) * Math.sin(lon),
        R * Math.sin(lat),
      ));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      lonDeg === 0 ? pmMat : gridMat,
    );
    group.add(line);
  }

  // グリニッジ（λ=0, φ=51.48°）位置のマーカー
  const gw = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x33ff99 }),
  );
  const gwLat = 51.48 * Math.PI / 180;
  gw.position.set(Math.cos(gwLat), 0, Math.sin(gwLat));
  group.add(gw);
  const gwLabel = makeLabel('グリニッジ', '#33ff99', 0.11);
  gwLabel.position.set(Math.cos(gwLat) * 1.12, 0, Math.sin(gwLat) * 1.12);
  group.add(gwLabel);

  // WGS84 扁平率を適用
  group.scale.z = 1 - WGS84.F;
  return group;
}

// ---- 2点間ラインのユーティリティ ---------------------------------

/** 端点を毎フレーム更新できる2点ライン */
class DynamicLine {
  readonly line: THREE.Line;
  private readonly positions: THREE.BufferAttribute;

  constructor(color: number, dashed = false) {
    const geom = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(6), 3);
    geom.setAttribute('position', this.positions);
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.05, gapSize: 0.03 })
      : new THREE.LineBasicMaterial({ color });
    this.line = new THREE.Line(geom, mat);
  }

  set(a: THREE.Vector3, b: THREE.Vector3): void {
    this.positions.setXYZ(0, a.x, a.y, a.z);
    this.positions.setXYZ(1, b.x, b.y, b.z);
    this.positions.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
    if ((this.line.material as THREE.LineDashedMaterial).isLineDashedMaterial) {
      this.line.computeLineDistances();
    }
  }
}

// ---- メインシーンクラス -----------------------------------------

export class TransformScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  /** フレーム乗り換え回転（ECI表示=単位、ECEF表示=Rz(−θ)） */
  private worldGroup = new THREE.Group();
  /** PQW→ECI の累積回転を適用するグループ */
  private orbitGroup = new THREE.Group();
  /** 地球の実姿勢 Rz(θ_GMST) を常に適用するグループ */
  private earthFixedGroup = new THREE.Group();

  // orbitGroup 内のオブジェクト
  private orbitLine: THREE.Line;
  private pqwTriad: Triad;
  private nodeLine: THREE.Line;
  private nodeLabel: THREE.Sprite;
  private periMarker: THREE.Mesh;
  private periLabel: THREE.Sprite;
  private satellite: THREE.Mesh;
  private posArrow: THREE.ArrowHelper;
  private velArrow: THREE.ArrowHelper;

  // worldGroup / earthFixedGroup 内のオブジェクト
  private eciTriad: Triad;
  private ecefTriad: Triad;
  private subMarker: THREE.Mesh;
  private subLine: DynamicLine;
  private stationGroup = new THREE.Group();
  private stationMarker: THREE.Mesh;
  private enuTriad: Triad;
  private losLine: DynamicLine;

  /** 軌道形状の再構築判定用キャッシュキー */
  private shapeKey = '';

  constructor(container: HTMLElement) {
    // ---- レンダラ・カメラ・コントロール ----
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05050f);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.up.set(0, 0, 1);  // 宇宙工学の慣習どおり Z-up
    this.resetCamera();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    // ---- ライト ----
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(5, -3, 4);
    this.scene.add(sun);

    // ---- シーングラフ構築 ----
    this.scene.add(this.worldGroup);
    this.worldGroup.add(this.orbitGroup, this.earthFixedGroup);

    // ECI 軸（慣性系）
    this.eciTriad = makeTriad(1.9, [0xff5252, 0x4cd964, 0x4a90ff], ['X (♈)', 'Y', 'Z']);
    this.worldGroup.add(this.eciTriad.group);

    // 地球＋ECEF 軸
    this.earthFixedGroup.add(makeEarth());
    this.ecefTriad = makeTriad(1.55, [0xffb0b0, 0xb8f5c0, 0xb0d0ff], ['xE', 'yE', 'zE'], 0.13);
    this.earthFixedGroup.add(this.ecefTriad.group);

    // 軌道楕円（形状は update 時に生成）
    this.orbitLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffd34d }),
    );
    this.orbitGroup.add(this.orbitLine);

    // PQW 軸
    this.pqwTriad = makeTriad(1.45, [0xff6ad5, 0xffaa33, 0x33e0cc], ['P', 'Q', 'W'], 0.14);
    this.orbitGroup.add(this.pqwTriad.group);

    // 昇交点方向の破線（PQW 座標では引数 −ω の方向）
    this.nodeLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0x9090b0, dashSize: 0.07, gapSize: 0.045 }),
    );
    this.orbitGroup.add(this.nodeLine);
    this.nodeLabel = makeLabel('☊ 昇交点', '#9090b0', 0.12);
    this.orbitGroup.add(this.nodeLabel);

    // 近地点マーカー
    this.periMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd34d }),
    );
    this.periLabel = makeLabel('近地点', '#ffd34d', 0.11);
    this.orbitGroup.add(this.periMarker, this.periLabel);

    // 衛星と位置・速度ベクトル
    this.satellite = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.posArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 1, 0x29c8e0, 0.08, 0.04,
    );
    this.velArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 0.5, 0xff8c42, 0.07, 0.035,
    );
    this.orbitGroup.add(this.satellite, this.posArrow, this.velArrow);

    // 直下点（ステップ6）
    this.subMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff5577 }),
    );
    this.subLine = new DynamicLine(0xff5577, true);
    this.earthFixedGroup.add(this.subMarker, this.subLine.line);

    // 地上局＋ENU 軸＋視線ベクトル（ステップ7）
    this.stationMarker = new THREE.Mesh(
      new THREE.ConeGeometry(0.03, 0.08, 12),
      new THREE.MeshBasicMaterial({ color: 0x66ff66 }),
    );
    this.enuTriad = makeTriad(0.55, [0xff5252, 0x4cd964, 0x4a90ff], ['E', 'N', 'U'], 0.11);
    this.losLine = new DynamicLine(0x66ff66);
    this.stationGroup.add(this.stationMarker, this.enuTriad.group, this.losLine.line);
    this.earthFixedGroup.add(this.stationGroup);

    // ---- リサイズ対応 ----
    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      if (w === 0 || h === 0) return;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(onResize).observe(container);
    onResize();

    // ---- 描画ループ ----
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** カメラを初期位置に戻す */
  resetCamera(): void {
    this.camera.position.set(3.4, -2.8, 2.1);
    this.camera.lookAt(0, 0, 0);
    if (this.controls) this.controls.target.set(0, 0, 0);
  }

  /**
   * 軌道要素が変わったときに軌道楕円などの形状を再構築する
   */
  private rebuildShape(els: Elements): void {
    const key = `${els.a}|${els.e}|${els.argp}`;
    if (key === this.shapeKey) return;
    this.shapeKey = key;

    // 軌道楕円: r(ν) = p / (1 + e cosν) を PQW 平面に描く
    const p = els.a * (1 - els.e * els.e);
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 256; k++) {
      const nu = (k / 256) * 2 * Math.PI;
      const r = p / (1 + els.e * Math.cos(nu)) * SCALE;
      pts.push(new THREE.Vector3(r * Math.cos(nu), r * Math.sin(nu), 0));
    }
    this.orbitLine.geometry.dispose();
    this.orbitLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);

    // 近地点マーカー（ν=0 の点）
    const rp = els.a * (1 - els.e) * SCALE;
    this.periMarker.position.set(rp, 0, 0);
    this.periLabel.position.set(rp + 0.16, 0, 0.1);

    // 昇交点方向: PQW 座標では角度 −ω の単位ベクトル
    const nodeDir = new THREE.Vector3(Math.cos(-els.argp), Math.sin(-els.argp), 0);
    const d = 2.0;
    const nodePts = [nodeDir.clone().multiplyScalar(-d), nodeDir.clone().multiplyScalar(d)];
    this.nodeLine.geometry.dispose();
    this.nodeLine.geometry = new THREE.BufferGeometry().setFromPoints(nodePts);
    this.nodeLine.computeLineDistances();
    this.nodeLabel.position.copy(nodeDir).multiplyScalar(d + 0.15);
  }

  /**
   * 現在のパイプライン結果・ステップ・アニメーション進捗 s∈[0,1] で
   * シーン全体を更新する
   *
   * orbitGroup の回転（PQW→ECI の途中経過）:
   *   step ≤1 : I
   *   step 2  : Rz(s·ω)
   *   step 3  : Rx(s·i)·Rz(ω)
   *   step 4  : Rz(s·Ω)·Rx(i)·Rz(ω)
   *   step ≥5 : Rz(Ω)·Rx(i)·Rz(ω)
   *
   * worldGroup の回転（フレーム乗り換え）:
   *   step ≤4 : I（ECI 視点）
   *   step 5  : Rz(−s·θ_GMST)
   *   step ≥6 : Rz(−θ_GMST)（ECEF 視点）
   */
  update(res: PipelineResult, els: Elements, step: number, s: number): void {
    this.rebuildShape(els);

    const zAxis = new THREE.Vector3(0, 0, 1);
    const xAxis = new THREE.Vector3(1, 0, 0);
    const qz = (ang: number) => new THREE.Quaternion().setFromAxisAngle(zAxis, ang);
    const qx = (ang: number) => new THREE.Quaternion().setFromAxisAngle(xAxis, ang);

    // ---- orbitGroup の累積回転 ----
    const qW = qz(els.argp);
    const qI = qx(els.i);
    const qO = qz(els.raan);
    let q: THREE.Quaternion;
    if (step <= 1)      q = new THREE.Quaternion();
    else if (step === 2) q = qz(s * els.argp);
    else if (step === 3) q = qx(s * els.i).multiply(qW);
    else if (step === 4) q = qz(s * els.raan).multiply(qI).multiply(qW);
    else                 q = qO.clone().multiply(qI).multiply(qW);
    this.orbitGroup.quaternion.copy(q);

    // ---- worldGroup のフレーム乗り換え回転 ----
    if (step <= 4)      this.worldGroup.quaternion.identity();
    else if (step === 5) this.worldGroup.quaternion.copy(qz(-s * res.gmst));
    else                 this.worldGroup.quaternion.copy(qz(-res.gmst));

    // ---- 地球の実姿勢（常に GMST 回転） ----
    this.earthFixedGroup.rotation.z = res.gmst;

    // ---- 衛星・ベクトル ----
    const rLocal = toScene(res.rPQW);
    this.satellite.position.copy(rLocal);
    const rLen = rLocal.length();
    this.posArrow.setDirection(rLocal.clone().normalize());
    this.posArrow.setLength(rLen, Math.min(0.09, rLen * 0.2), 0.045);

    const vDir = new THREE.Vector3(res.vPQW[0], res.vPQW[1], res.vPQW[2]).normalize();
    this.velArrow.position.copy(rLocal);
    this.velArrow.setDirection(vDir);
    this.velArrow.setLength(0.5, 0.08, 0.04);

    // ---- ステップごとの表示切り替え ----
    this.pqwTriad.group.visible = step <= 4;
    this.nodeLine.visible = this.nodeLabel.visible = step >= 2 && step <= 5;
    this.ecefTriad.group.visible = step >= 5;
    this.eciTriad.group.visible = step <= 5;
    // 速度ベクトル（慣性速度）は回転変換ステップの間だけ表示する
    this.velArrow.visible = step >= 1 && step <= 4;

    // ---- 直下点（ステップ6） ----
    const showSub = step === 6;
    this.subMarker.visible = this.subLine.line.visible = showSub;
    if (showSub) {
      const sub = toScene(res.subPoint);
      this.subMarker.position.copy(sub);
      this.subLine.set(toScene(res.rECEF), sub);
    }

    // ---- 地上局・ENU・視線ベクトル（ステップ7） ----
    const showStn = step === 7;
    this.stationGroup.visible = showStn;
    if (showStn) {
      const stn = toScene(res.rStation);
      this.stationMarker.position.copy(stn);
      // 円錐の軸（ローカル+Y）を天頂方向（U = ENU 行列の第3行）へ向ける
      const up = new THREE.Vector3(res.Renu[2][0], res.Renu[2][1], res.Renu[2][2]);
      this.stationMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);

      // ENU 軸を地上局位置に配置し、各軸方向を ENU 行列の行ベクトルに合わせる
      this.enuTriad.group.position.copy(stn);
      for (let k = 0; k < 3; k++) {
        const dir = new THREE.Vector3(res.Renu[k][0], res.Renu[k][1], res.Renu[k][2]);
        this.enuTriad.arrows[k].setDirection(dir);
        this.enuTriad.labels[k].position.copy(dir).multiplyScalar(0.55 + 0.12);
      }
      this.losLine.set(stn, toScene(res.rECEF));
    }
  }
}
