# 英語フレーズ学習アプリ

教材の写真 → Geminiでフレーズ抽出 → 確認・編集 → Supabaseに保存 → Speak用プロンプトを生成してコピー。

## ファイル構成
- `index.html` … 画面
- `api/extract-phrases.js` … 写真からフレーズ抽出（Gemini。AIを使うのはここだけ）
- `api/db.js` … データの読み書き（Supabase）
- `supabase/schema.sql` … テーブル作成用SQL（最初に1回だけ実行）
- `package.json`

## 環境変数（Vercel → Settings → Environment Variables）
| 名前 | 内容 |
|---|---|
| `GEMINI_API_KEY` | Geminiのキー（設定済み） |
| `SUPABASE_URL` | SupabaseのProject URL |
| `SUPABASE_SERVICE_KEY` | Supabaseの service_role キー（または Secret key） |
| `APP_PASSCODE` | 自分で決めるパスコード（アプリ起動時に入力） |

環境変数を追加・変更したら、Deployments から Redeploy してください。

## Supabaseの準備
1. https://supabase.com でプロジェクトを作成
2. 左メニュー「SQL Editor」→ `supabase/schema.sql` の中身を貼り付けて Run
3. 左メニュー「Project Settings」→「API」で Project URL と service_role キー（または Secret key）を確認し、Vercelの環境変数に設定

## 既存データの移行
更新後に初めて開くと、この端末に保存されていた旧データがある場合のみ「クラウドに移行する」カードが出ます。
