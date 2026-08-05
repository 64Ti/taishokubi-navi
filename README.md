# トク退｜退職日計算ナビ

退職希望日・有給残日数・年収・退職後の進路などを入力すると、金銭面で有利な退職日と
手取り差額の目安、実務期限（最終出社日・資格喪失日・企業型DC移管期限等）を算出する
クライアントサイド完結型のシミュレーター（β版）。

- 公開URL: https://tokutai-navi.com/
- ホスティング: Cloudflare Pages
- **外部依存ゼロ**（フィードバック送信のクリック時通信を除く）
- **完全ローカル処理**: 入力値はサーバーに送信されず、端末内だけで計算する

プロジェクトの運用ルール・絶対に守るべき表現/実装ルールは [`CLAUDE.md`](./CLAUDE.md) を参照。
仕様の詳細は `docs/` 配下の仕様書群（実装前に必読）を参照。

## ディレクトリ構成

```
taishokubi_navi/
├── index.html            アプリ本体
├── changelog.html         更新履歴ページ
├── css/styles.css
├── js/
│   ├── constants.js        料率・法定金額マスタ
│   ├── holidays.js         祝日判定
│   ├── calculator.js       試算エンジン（純粋関数のみ）
│   ├── faq_master.js       FAQデータ
│   ├── glossary.js         用語ミニ解説データ
│   ├── schema_generator.js 構造化データ生成
│   ├── feedback.js         フィードバック送信
│   └── app.js               UI制御・DOM描画
├── functions/api/feedback.js  Cloudflare Pages Functions（フィードバックPhase2）
├── docs/                    仕様書一式（システム仕様書・FAQ・用語解説・フィードバック設計）
├── CLAUDE.md                プロジェクトルール
└── _headers / robots.txt / sitemap.xml
```

ビルド不要・依存パッケージなし。このディレクトリをそのまま静的ホスティングに置けば公開できる。

---

## 保守手順

年度改定・制度改正の反映箇所は `js/constants.js` に集約されている。**ロジック本体（`calculator.js`）には基本的に手を入れず、定数の書き換えのみで対応する。**

| 項目 | 更新箇所 | 頻度 |
|---|---|---|
| 都道府県別健康保険料率・厚生年金料率・介護保険料率・国民年金保険料等 | `js/constants.js` の `RATE_MASTER` / `PREFECTURE_HEALTH_RATES` | 毎年2〜3月 |
| 給与所得控除の速算表（時限特例：令和8・9年分限定） | `js/constants.js` の `RATE_MASTER.salaryIncomeDeduction` | 令和10年分から本則に戻る可能性が高いため要確認 |
| 祝日判定（アルゴリズム生成・西暦2000〜2035年対応） | `js/holidays.js` | 2035年までに対応年を延長 |
| FAQ・用語解説の内容更新 | `js/faq_master.js` / `js/glossary.js`（出典: `docs/tokutai_faq_content_v1.md` 等） | 随時・法令改正時 |
| 根拠法令の条文番号 | `js/schema_generator.js` の `LEGISLATIONS`（出典: 仕様書第9章） | 法令改正時 |

出典は必ず一次情報（協会けんぽ・日本年金機構・厚生労働省・国税庁）で確認すること。

---

## デプロイ

### Cloudflare Pages（現行運用）

1. このリポジトリをGitHubにpush
2. Cloudflare ダッシュボード → Workers & Pages → Pagesプロジェクトを連携
3. ビルド設定は**すべて空のまま**（フレームワークプリセット: なし／ビルドコマンド: 空／出力ディレクトリ: `/`）

以降、GitHubにpushするたび自動で再デプロイされる。

### フィードバック機能（Phase1+2）を有効化するための追加作業

コードは実装済みだが、以下2点は運営者による手動セットアップが必要（未設定でも他機能には影響しない設計）。

1. **Googleフォームの作成**（`docs/tokutai_feedback_form_v1.md` 第1〜2節の手順）→ `js/feedback.js` の `FORM_ID` / `ENTRY.*` を実際の値に差し替える
2. **Cloudflare Pages で KV Namespace を作成し `FEEDBACK_KV` としてバインド**（`functions/api/feedback.js` が参照）

---

## 動作確認

`index.html` をブラウザで開き、以下を確認する（詳細な期待値は仕様書 第12章参照）。

| シナリオ | 確認observation |
|---|---|
| コア4問（退職日・有給残日数・年収・進路）入力 | 暫定結果（社会保険料の3値判定・ToDoタイムライン）が表示される |
| 精度向上モーダルA/B/C を適用 | 都道府県別料率・軽減措置・傷病手当金要件等が反映され「精密結果」に切り替わる |
| 体調不調フラグON | 相談窓口ボックスが表示され、`localStorage`に保存されないこと |
| 印刷 / PDF保存 | A4で入力画面が非表示、アコーディオンが全開、使用した用語のミニ辞典が末尾に出る |
| フィードバック送信 | 送信前に条件サマリ（個人情報を含まない）が表示される |

---

## 免責

本ツールは一般的な労働・社会保険関係法令に基づく概算値を提供するものであり、
会社独自の就業規則・退職金規程・加入健康保険組合の規約、またはお住まいの自治体の
保険料率により実際の金額とは差が生じる。詳細な免責事項は結果画面末尾に常時表示している。
