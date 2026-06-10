# reference-frame-visualizer
衛星の軌道を様々な座標系でプロットして可視化するツール。

## ページ構成

| ページ | 内容 |
|---|---|
| `index.html` | 軌道座標系ビジュアライザー（TLE/軌道要素入力、ECI/ECEF/RTN/地上トラック/月座標系） |
| `transform.html` | **座標変換ステップビジュアライザー**（Three.js 製 3D、変換の各ステップをアニメーションで確認） |

## 座標変換ステップビジュアライザー

衛星の座標変換チェーンを 8 ステップに分解し、回転行列・中間ベクトルの数値と
3D アニメーションで1段ずつ確認できる。

| ステップ | 内容 | 理論 |
|---|---|---|
| 0 | 軌道要素 → 真近点角 | ケプラー方程式 M = E − e·sinE（ニュートン・ラフソン法） |
| 1 | ペリフォーカル座標 (PQW) | r = r[cosν, sinν, 0]ᵀ, v = √(μ/p)[−sinν, e+cosν, 0]ᵀ |
| 2 | 回転① Rz(ω) | 3-1-3 オイラー回転の第1回転（近点引数） |
| 3 | 回転② Rx(i) | 第2回転（軌道傾斜角、昇交点線まわり） |
| 4 | 回転③ Rz(Ω) → ECI | 第3回転（昇交点赤経）。合成 DCM = Rz(Ω)Rx(i)Rz(ω) |
| 5 | ECI → ECEF | GMST（IAU 1982）による R₃(θ) 回転。速度は輸送定理 v' = R₃v − ω⊕×r |
| 6 | ECEF → 測地座標 | WGS84 楕円体、測地緯度の反復解法 |
| 7 | ENU・方位/仰角 | 地上局基準の局所地平座標、Az = atan2(E,N), El = asin(U/ρ) |

※ 歳差・章動・極運動は無視した簡易モデル（ECI ≈ J2000、厳密な GCRF→ITRF は IAU 2006/2000A）。

## 開発

```bash
npm install
npm run dev      # 開発サーバー
npm run build    # ビルド
npm test         # 理論検証テスト（Vallado の例題と照合）
```

`npm test` は GMST・軌道要素→ECI 変換・WGS84 測地変換などを
Vallado, *Fundamentals of Astrodynamics and Applications* (4th ed.) の
例題 2-6 / 3-3 / 3-5 の数値と照合する。
