# Point Diary MVP

ブラウザだけで動くポイント日記アプリのプロトタイプです。

- 個人ルームとグループルーム
- グループID/PWによる入室
- 投稿者名、アイコン、テキスト、写真の記録
- 車/家アイコンをポイントの代わりに投稿
- 投稿者本人だけが24時間以内に削除可能
- 月間カレンダーでアイコン記録を可視化
- 特定QRコードの特別ポイント
- AI連携を想定したサマリー表示

## 試せるQRコード

- `SPECIAL-100`
- `SPECIAL-50`
- `WELLNESS-20`

## Firebase接続

- Firebase ConsoleでWebアプリを登録
- AuthenticationでAnonymousを有効化
- Firestore Databaseを作成
- Storageを作成
- `firebase-config.js` の `YOUR_...` をFirebaseの設定値に置換
- Firestore Rulesに `firestore.rules` を適用
- Storage Rulesに `storage.rules` を適用

Firebase設定が未入力の場合は、従来通りブラウザ内のlocalStorageで動作します。

## 本番化の残タスク

- QR: 発行済みコードをDBに保存し、使用履歴で重複付与を制御
- AI: 投稿テキストと集計値をAPI経由で渡し、週次コメントや目標提案を生成

詳しいDB/API案は `backend-plan.md` にまとめています。
