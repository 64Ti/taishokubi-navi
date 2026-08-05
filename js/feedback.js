/**
 * feedback.js
 * ユーザーフィードバック送信 Ver.17.2（Phase 1: Googleフォーム／Phase 2: Cloudflare Pages Functions）
 * 出典: フィードバックフォーム設計書 v1.0／仕様書 第13章
 *
 * 「外部依存ゼロ」原則に対する唯一の例外。ユーザーがボタンをタップした場合にのみ通信が発生する
 * （自動送信・バックグラウンド送信は一切行わない）。要配慮個人情報（体調不調フラグ等）・
 * 生年月日実値・年収実額・退職金額実額は一切送信しない（assertNoSensitiveDataでガード）。
 *
 * window.TokutaiFeedback として公開。
 */
(function (global) {
  'use strict';

  const SPEC_VERSION = 'v17.2';
  const RATE_MASTER = global.TokutaiConstants.RATE_MASTER;

  // ⚠️ TODO（サイト運営者作業）：フィードバックフォーム設計書 v1.0 第4.2節の手順で
  //    実際のGoogleフォームを作成し、以下の FORM_ID と ENTRY の値を差し替えること。
  //    未設定の間はPhase1（フォーム遷移）は動作せず、コンソールに警告を出すのみとなる。
  const FORM_ID = 'REPLACE_WITH_ACTUAL_FORM_ID';
  const FORM_BASE = `https://docs.google.com/forms/d/e/${FORM_ID}/viewform`;
  const ENTRY = {
    category: 'entry.REPLACE_CATEGORY_ENTRY_ID',   // Q1（セクション1のカテゴリ選択）
    context: 'entry.REPLACE_CONTEXT_ENTRY_ID',      // Q3-1（診断条件・自動入力）
    freeText: 'entry.REPLACE_FREETEXT_ENTRY_ID',    // Q3-2（そのほかご自由に）
  };

  // Q1の選択肢と完全一致させる（事前入力の反映条件）
  const CATEGORY_LABELS = {
    calc_mismatch: '計算結果が、実際の金額と違っていた',
    content_error: '説明の内容が間違っている・古いと思う',
    usability: '使い方が分からなかった',
    feature_request: 'こんな条件にも対応してほしい',
    praise: '感想・応援',
  };

  // 送信してはならない情報（第13.4節）
  const FORBIDDEN_KEYS = ['isMentalPhysicalUnfit', 'birthDate', 'birthYear', 'retirementPayAmount', 'bonusAmount', 'annualIncome'];

  function assertNoSensitiveData(payload) {
    const json = JSON.stringify(payload);
    FORBIDDEN_KEYS.forEach(k => {
      if (json.includes(k)) throw new Error(`要配慮情報が含まれる可能性があるキーが検出されました: ${k}`);
    });
  }

  /**
   * 送信ペイロード仕様（第13.3節）。年齢・年収は区分/年代に丸め、実額は含めない。
   * @param {object} ctx { resignDate, prefecture, annualIncomeCategory, ageDecade, tenureYears,
   *                        branch, retireReason, afterInsurance, verdict, reductionApplied }
   */
  function buildContextSummary(ctx) {
    ctx = ctx || {};
    const parts = [
      `V:${SPEC_VERSION}`,
      `RY:${RATE_MASTER.fiscalYear}`,
      `RD:${ctx.resignDate || ''}`,
      `PF:${ctx.prefecture || ''}`,
      `IN:${ctx.annualIncomeCategory || ''}`,
      `AG:${ctx.ageDecade || ''}`,
      `TN:${ctx.tenureYears === null || ctx.tenureYears === undefined ? '' : ctx.tenureYears}`,
      `BR:${ctx.branch || ''}`,
      `RR:${ctx.retireReason || ''}`,
      `AI:${ctx.afterInsurance || ''}`,
      `VD:${ctx.verdict || ''}`,
      `RA:${ctx.reductionApplied === undefined || ctx.reductionApplied === null ? '' : ctx.reductionApplied}`,
    ];
    return parts.join('|');
  }

  function openGoogleForm(category, contextSummary, freeText) {
    if (FORM_ID.indexOf('REPLACE_') === 0) {
      console.warn('[feedback.js] Googleフォームが未設定のため、フィードバックフォームへの遷移をスキップしました。docs/tokutai_feedback_form_v1.md 第4.2節を参照し、FORM_ID / ENTRY を実際の値に差し替えてください。');
      return false;
    }
    const params = new URLSearchParams({ usp: 'pp_url' });
    params.set(ENTRY.category, CATEGORY_LABELS[category] || category);
    params.set(ENTRY.context, contextSummary);
    if (freeText) params.set(ENTRY.freeText, freeText);
    window.open(`${FORM_BASE}?${params.toString()}`, '_blank', 'noopener,noreferrer');
    return true;
  }

  /**
   * Phase 2（Cloudflare Pages Functions）への送信。ベストエフォートとし、
   * エンドポイント未デプロイ・オフライン等で失敗してもPhase1の動作を妨げない。
   */
  function postToPhase2(body) {
    try {
      fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => { /* Functions未稼働環境でも致命的にしない */ });
    } catch (e) { /* noop */ }
  }

  /**
   * 結果画面マイクロフィードバックの「👍 参考になった」用。
   * Phase1ではカウント取得不可のため、Phase2側にのみ軽量な計測を送る（能動タップ時のみ）。
   */
  function sendGoodSignal() {
    postToPhase2({ category: 'praise_quick', context: '', freeText: '', createdAt: new Date().toISOString() });
  }

  /**
   * フィードバック送信本体。能動的な送信ボタン押下時にのみ呼び出すこと。
   * @param {{category:string, freeText:string, context:object}} params
   */
  function submitFeedback({ category, freeText, context }) {
    const contextSummary = buildContextSummary(context);
    const payload = { category, freeText: freeText || '', context: contextSummary, createdAt: new Date().toISOString() };
    assertNoSensitiveData(payload);

    postToPhase2(payload);
    openGoogleForm(category, contextSummary, freeText);
  }

  global.TokutaiFeedback = {
    buildContextSummary,
    assertNoSensitiveData,
    submitFeedback,
    sendGoodSignal,
  };
})(window);
