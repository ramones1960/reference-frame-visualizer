// Vite 設定：2ページ構成（軌道ビュー / 座標変換ステップビジュアライザー）
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        transform: resolve(__dirname, 'transform.html'),
      },
    },
  },
});
