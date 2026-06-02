// ============================================================
// アプリ全体で使用する型定義
// ============================================================

/** 中心天体の種類 */
export type CelestialBody = 'earth' | 'moon';

/** 対応座標系の識別子 */
export type FrameType = 'eci' | 'ecef' | 'rtn' | 'groundtrack' | 'lci' | 'lcf';

/** 3次元ベクトル [x, y, z] */
export type Vec3 = [number, number, number];

/** 衛星オブジェクトのインターフェース */
export interface Satellite {
  /** 衛星名 */
  name: string;
  /** 中心天体（地球 or 月） */
  body: CelestialBody;
  /** 重力定数 [m³/s²] */
  mu: number;
  /** 半長径 [m] */
  a: number;
  /** 離心率 */
  e: number;
  /** 軌道傾斜角 [rad] */
  i: number;
  /** 昇交点赤経 [rad] */
  raan: number;
  /** 近点引数 [rad] */
  argp: number;
  /** 平均近点角（エポック時刻での初期値）[rad] */
  M0: number;
  /** 平均運動 [rad/s] */
  n: number;
  /** エポック（J2000からの経過秒数）[s] */
  epochJ2000: number;
  /** 軌道周期 [s] */
  period: number;
}

/** 位置・速度状態ベクトルのペア */
export interface State {
  /** 位置ベクトル [m] */
  pos: Vec3;
  /** 速度ベクトル [m/s] */
  vel: Vec3;
}

/** orbitTrace が返す軌跡データ */
export interface OrbitTraceResult {
  /** 各時刻における位置ベクトルの配列 */
  positions: Vec3[];
  /** 各時刻における速度ベクトルの配列 */
  velocities: Vec3[];
  /** 対応するJ2000からの時刻 [s] の配列 */
  times: number[];
}

/** 地理座標（緯度・経度）*/
export interface LatLon {
  /** 緯度 [deg]（-90〜90） */
  lat: number;
  /** 経度 [deg]（-180〜180） */
  lon: number;
}

/** 軌道要素入力フォームのパラメータ */
export interface ElementParams {
  name: string;
  body: string;
  a: string;
  e: string;
  i: string;
  raan: string;
  argp: string;
  M0: string;
}
