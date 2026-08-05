# 公開ロードマップ

「退職日計算ナビ」をインターネットに公開するまでの手順。
**方針: GitHub連携 ＋ Cloudflare Pages ＋ 独自ドメイン（`tokutai-navi.com` 取得済み）**

進捗はチェックボックスで管理する。

---

## 現在地

- [x] 仕様書 v17.2 準拠で全面改修完了（`js/constants.js`・`calculator.js`・`faq_master.js`・`glossary.js`・`schema_generator.js`・`feedback.js`・`app.js`・`index.html`・`css/styles.css`・`changelog.html`）
- [x] 社会保険料試算ロジックの重大な誤り（「免除」の誤案内）を修正し、レンジ推定＋3値判定（`MONTH_END`/`BEFORE_MONTH_END`/`UNCERTAIN`）へ刷新
- [x] 法令条文の誤引用3件を修正、傷病手当金の受給要件判定を新設
- [x] 段階的開示UI（コア4問→精度向上モーダル）、フィードバック機能（Phase1+2）、用語ミニ解説・FAQ機能を追加
- [x] `README.md`（保守手順）作成（v17.2構成に合わせて要更新）
- [x] ローカルGitリポジトリで運用中

**残っているのは、フィードバックフォームの実体作成とKVバインドなど、コード外の運営者作業。**

---

## ✅ 公開済み

- **2026-08-04**: `https://taishokubi-navi.pages.dev/`（`.pages.dev` 無料サブドメイン）で公開完了。本番環境で全19項目の動作検証をパス
- **2026-08-05**: 独自ドメイン `https://tokutai-navi.com/` を取得。コード内の公開URL参照（canonical / OGP / sitemap.xml / robots.txt / schema_generator.js 等）を新ドメインへ更新済み
  - ⚠️ Cloudflare Pagesプロジェクトの「カスタムドメイン」設定でこのドメインを接続するまでは、実際には旧`.pages.dev`のURLでのみアクセスできる状態（Phase 4参照）

---

## Phase 0 — 公開前の仕上げ ✅ 完了

- [x] **favicon の追加** — インラインSVG（data URI）でファイル追加なしに実装
- [x] **canonical / og:url の設定** — HTML冒頭のマーカー内5行を置換すれば変更可能
- [x] **og:image（SNSシェア画像）** — 1200×630pxで作成
- [x] **robots.txt / sitemap.xml** — AI検索クローラーを明示的に許可
- [x] **アプリアイコン** — apple-touch-icon（180px）／192px／512px

> 💡 og:image がないとX・LINEでシェアされたとき味気ないカードになる。
> 流入経路がSNS中心になる想定なので、ここは手を抜かない。

---

## Phase 1 — GitHubに上げる ✅ 完了

- [x] GitHubアカウントを作成（`64Ti`）
- [x] 新規リポジトリを作成（github.com/64Ti/taishokubi-navi）
  - リポジトリ名: `taishokubi-navi` を推奨
  - **Public / Private どちらでもよい**（Cloudflare Pagesは両対応）
  - README・.gitignore・ライセンスは**追加しない**（ローカルに既にあるため）
- [x] リモートを登録してpush

**完了の判定**: GitHubのページで `index.html` が見えている。

---

## Phase 2 — 独自ドメイン ✅ 完了

- [x] ドメイン名を決める → **`tokutai-navi.com`**
- [x] レジストラで取得する → Cloudflare Registrar（2026-08-05）

---

## Phase 3 — Cloudflare Pages でデプロイ ✅ 完了

- [x] Cloudflareアカウントを作成
- [x] ダッシュボード → **Workers & Pages** → 「作成」→ **Pages** タブ → 「Gitに接続」
- [x] GitHubを連携し、`taishokubi-navi` リポジトリを選択
- [x] **ビルド設定はすべて空のままにする**（ここが唯一の注意点）

| 項目 | 設定値 |
|---|---|
| フレームワークプリセット | `なし` |
| ビルドコマンド | **空欄** |
| ビルド出力ディレクトリ | `/` |

- [x] 「保存してデプロイ」

**完了の判定**: `xxxx.pages.dev` のURLでツールが動く。
この時点で**すでにインターネット上に公開されている**。https も自動で付く。

> 以降、GitHubにpushするたび自動で再デプロイされる。

---

## Phase 4 — 独自ドメインをつなぐ ⏱ 5分／担当: 本人 ← 👈 いまここ

コード側（canonical・OGP・sitemap.xml等）は `tokutai-navi.com` 前提に更新済み。
**この接続作業をしないと、実際のアクセスは今まで通り `.pages.dev` のままになる。**

- [ ] Cloudflareダッシュボード → Workers & Pages → `taishokubi-navi` プロジェクト → 「カスタムドメイン」→ `tokutai-navi.com` を追加
- [ ] DNSの反映を待つ（Cloudflare Registrarで取得済みのため**数分**で反映されるはず）
- [ ] `https://tokutai-navi.com` でアクセスできることを確認（鍵マークが付くこと）

**完了の判定**: `https://tokutai-navi.com` で開ける。

> ✅ ここで **`file://` 制限が外れ、テンプレのワンタップコピーが正常動作する**ようになる。

---

## Phase 5 — 検索に載せる ⏱ 1時間／担当: Claude＋本人

- [x] `og:url` / `canonical` を確定URLに設定（Claude）
- [x] `sitemap.xml` / `robots.txt` を確定URLで生成（Claude）
- [ ] **Google Search Console** にサイトを登録（本人）
  - ドメイン所有権の確認 → sitemap送信 → インデックス登録をリクエスト
- [ ] **Bing Webmaster Tools** にも登録（本人）
  - ChatGPTの検索はBingのインデックスを使うため、**AIO狙いなら必須**
- [ ] 実機（iPhone/Android）で表示と動作を確認（本人）

> ⏳ インデックスされるまで数日〜数週間かかる。ここは待つしかない。

---

## Phase 6 — 収益化の導線を入れる ⏱ 要相談／担当: 未定

**⚠️ 未決定**: 前回の確認で「まだ入れない」と「Note・Amazon・X導線」の両方が選ばれていたため、方針が未確定。

現実的な進め方は、**Phase 5 まで終えてアクセスが出てから設計する**こと。
どこから来て、どこで離脱するかを見てから置いたほうが当たる。

導線ごとの状況:

| 導線 | 今すぐ置けるか | 必要なもの |
|---|---|---|
| Xアカウント（@TAB_6400） | ✅ 置ける | なし |
| Note記事 | ❌ 記事が必要 | 退職ノウハウ記事の執筆 |
| Amazonアフィリ | ❌ ID審査が必要 | アソシエイトIDの取得（審査あり） |

- [ ] 導線の方針を決める
- [ ] 実装する

---

## Phase 7 — 公開後の運用

放置すると壊れる箇所があるため、期限を明記する。

| いつ | やること | 場所 |
|---|---|---|
| **毎年2〜3月ごろ** | 健康保険料率（47都道府県）・介護保険料率・国民年金保険料等の改定を反映 | `js/constants.js` の `RATE_MASTER` / `PREFECTURE_HEALTH_RATES` |
| **2035年中に必ず** | 祝日判定ロジックの対応年（2000〜2035年）を延長 | `js/holidays.js` |
| 随時 | 給与所得控除の速算表（時限特例の期限：令和9年分まで）を確認・更新 | `js/constants.js` の `salaryIncomeDeduction` |
| 週次 | フィードバック（`calc_mismatch`等）を確認し、再現テスト・原因分類 | 第13.7節・フィードバックフォーム設計書 第6章 |
| 随時 | 修正した内容を `/changelog.html` に追記 | `changelog.html` |
| 月1回 | Search Consoleで検索順位と流入を確認 | — |

> 🚨 **祝日ロジックの対応期限は2035年。** これを過ぎると `js/holidays.js` の祝日判定が
> 正しく機能しなくなる（土日は正しく処理されるが、祝日が営業日として数えられてしまう）。

### v17.2移行に伴うコード外の残作業

- [ ] Googleフォームを作成し、`js/feedback.js` の `FORM_ID` / `ENTRY.*` を実際の値に差し替える
- [ ] Cloudflare Pages ダッシュボードで KV Namespace を作成し `FEEDBACK_KV` としてバインドする（`functions/api/feedback.js` が参照）

---

## 所要時間のまとめ

| Phase | 担当 | 時間 | 費用 |
|---|---|---|---|
| 0. 公開前の仕上げ | Claude | 30分 | 0円 |
| 1. GitHub | 本人 | 15分 | 0円 |
| 2. ドメイン取得 | 本人 | 15分 | **年1,500〜2,000円** |
| 3. Cloudflare Pages | 本人 | 15分 | 0円 |
| 4. 独自ドメイン接続 | 本人 | 10分＋反映待ち | 0円 |
| 5. 検索に載せる | 両方 | 1時間 | 0円 |
| **合計** | | **実作業 約2.5時間** | **年1,500〜2,000円のみ** |

Phase 3 まで進めば `.pages.dev` のURLで**その日のうちに公開できる**。
独自ドメインは後から付け替えられるので、先に動かして後から整える進め方も可能。
