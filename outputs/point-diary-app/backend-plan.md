# DB / AI 連携設計メモ

## 推奨構成

- Frontend: PWA対応のWebアプリ
- Auth/DB: Supabase または Firebase
- Storage: 投稿写真用のオブジェクトストレージ
- QR: 管理画面で特典QRを発行し、利用履歴を保存
- AI: サーバー側APIからOpenAI APIへ接続

## テーブル案

### users

| column | type | note |
| --- | --- | --- |
| id | uuid | auth user id |
| display_name | text | 投稿者名 |
| created_at | timestamptz | 作成日時 |

### rooms

| column | type | note |
| --- | --- | --- |
| id | uuid | room id |
| room_code | text | 共有するグループID |
| password_hash | text | PWはハッシュ化して保存 |
| type | text | personal / group |
| created_by | uuid | 作成者 |
| created_at | timestamptz | 作成日時 |

### room_members

| column | type | note |
| --- | --- | --- |
| room_id | uuid | rooms.id |
| user_id | uuid | users.id |
| joined_at | timestamptz | 参加日時 |

### posts

| column | type | note |
| --- | --- | --- |
| id | uuid | post id |
| room_id | uuid | rooms.id |
| author_id | uuid | users.id |
| points | integer | 通常/QRポイント |
| body | text | 日記テキスト |
| photo_url | text | 写真URL |
| kind | text | normal / qr |
| qr_code_id | uuid | QR投稿の場合 |
| created_at | timestamptz | 投稿日時 |
| locked_at | timestamptz | created_at + 24h |
| deleted_at | timestamptz | 論理削除 |

### qr_codes

| column | type | note |
| --- | --- | --- |
| id | uuid | QR id |
| code | text | QRに埋め込む値 |
| points | integer | 付与ポイント |
| starts_at | timestamptz | 有効開始 |
| ends_at | timestamptz | 有効終了 |
| max_uses_per_user | integer | 重複制御 |

## API案

- `POST /rooms/join`: グループID/PWで参加
- `GET /rooms/:roomId/posts`: 投稿一覧
- `POST /rooms/:roomId/posts`: 通常投稿
- `DELETE /posts/:postId`: 投稿者本人、かつ24時間以内のみ削除
- `POST /qr/redeem`: QRコード検証とポイント付与
- `POST /ai/insights`: 投稿と集計からAIコメント生成

## Firebase実装上の注意

クライアントだけでグループPWを安全に検証することはできません。MVPではFirestore上の`passwordHash`をクライアントで比較していますが、本番ではCloud FunctionsまたはCloud Runで`POST /rooms/join`を実装し、PW検証とメンバー追加をサーバー側で行う必要があります。

## AIでできること

- 週次/月次の振り返りコメント
- 投稿テキストからカテゴリ推定
- ポイントが続いている行動の称賛
- グループ内の偏りや未投稿者へのやさしい促し
- 写真付き投稿の簡単な説明生成
