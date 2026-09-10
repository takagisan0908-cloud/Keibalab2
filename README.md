# 方法A: Vercel 用（おすすめ）

この フォルダの中身を GitHub リポジトリの直下に置き、Vercel で Import するだけです。

```
index.html              アプリ本体
api/race.js             中継（Vercel が /api/race として自動で動かします）
vercel.json             キャッシュ無効化（任意）
manifest.webmanifest / apple-touch-icon.png / icon-*.png / favicon-*.png   ホーム画面アイコン用
```

手順の詳細は同梱の「別ホストで運用する手順_2026-09-10.md」の「方法A」をご覧ください。
