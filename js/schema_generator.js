/**
 * schema_generator.js
 * 構造化データ(JSON-LD)の動的生成 Ver.17.2
 *
 * v17.2での目的の再定義（第1章）：
 * HowTo/FAQPageリッチリザルトはGoogleでは既に廃止されているため、本ファイルの目的は
 * 「Google検索での見た目の強化」ではなく「AI検索（ChatGPT/Perplexity/Claude/AI Overviews）
 * における引用獲得」である。あわせてLegislationスキーマを新設し、第9章の正しい条文番号を発信する。
 *
 * window.SchemaGenerator として公開。
 */
(function (global) {
  'use strict';

  const SITE_URL = 'https://taishokubi-navi.pages.dev/';
  const SITE_NAME = 'トク退｜退職日計算ナビ';
  const EGOV_BASE = 'https://laws.e-gov.go.jp/law/';

  // 第9章：根拠法令一覧（正しい条文番号）
  const LEGISLATIONS = [
    { name: '健康保険法 第36条（資格喪失）', lawId: '211AC0000000070', article: '36' },
    { name: '健康保険法 第99条（傷病手当金）', lawId: '211AC0000000070', article: '99' },
    { name: '健康保険法 第104条（資格喪失後の継続給付）', lawId: '211AC0000000070', article: '104' },
    { name: '厚生年金保険法 第14条（資格喪失）', lawId: '229AC0000000115', article: '14' },
    { name: '労働基準法 第39条（年次有給休暇）', lawId: '322AC0000000049', article: '39' },
    { name: '民法 第627条（雇用の解約の申入れ）', lawId: '129AC0000000089', article: '627' },
    { name: '雇用保険法 第33条（給付制限）', lawId: '349AC0000000116', article: '33' },
  ];

  function injectSchema(id, jsonObject) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = id;
    script.textContent = JSON.stringify(jsonObject, null, 2);
    document.head.appendChild(script);
  }

  /** SoftwareApplication スキーマ：Google検索結果の表示にも実際に寄与する基礎スキーマ。ページロード時に常時挿入。 */
  function generateWebApplicationSchema() {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      url: SITE_URL,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: '退職希望日・有休残日数・年収・定年等の条件を入力すると、最終出社日・資格喪失日・手取り差額（具体金額）・住民税や退職金の注意点を自動算定する無料シミュレーター。登録不要、完全端末内処理。',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' },
      inLanguage: 'ja-JP',
    };
    injectSchema('schema-webapplication', schema);
    generateLegislationSchema();
    return schema;
  }

  /** Legislation スキーマ：第9章の正しい条文番号をe-Gov法令検索へのリンク付きで発信する。 */
  function generateLegislationSchema() {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: '本ツールが参照する根拠法令',
      itemListElement: LEGISLATIONS.map((law, i) => ({
        '@type': 'Legislation',
        position: i + 1,
        name: law.name,
        url: `${EGOV_BASE}${law.lawId}#Mp-At_${law.article}`,
        legislationIdentifier: law.lawId,
      })),
    };
    injectSchema('schema-legislation', schema);
    return schema;
  }

  /**
   * HowTo スキーマ：試算結果のToDoタイムラインを「損しない退職手続き手順」として提示。
   * @param {object} result app.js が組み立てた試算結果一式（state.result）
   */
  function generateHowToSchema(result) {
    const steps = [];

    steps.push({
      '@type': 'HowToStep',
      name: '退職の申し出タイミングを確認する',
      text: `民法上は申し出から2週間で退職できます（民法第627条）。就業規則に「1ヶ月前まで」等の定めがある場合は、${result.noticeDate.dateLabel}までを目安に直属の上司へ相談します。`,
    });

    if (result.lastWorkDayLabel) {
      steps.push({
        '@type': 'HowToStep',
        name: '最終出社日を迎える',
        text: `引き継ぎ業務は${result.lastWorkDayLabel}までに完了させます。`,
      });
    }
    if (result.qualification && result.qualification.lossDateLabel) {
      steps.push({
        '@type': 'HowToStep',
        name: '社会保険の資格喪失日を把握する',
        text: `健康保険・厚生年金の資格喪失日は${result.qualification.lossDateLabel}です（健康保険法第36条・厚生年金保険法第14条）。`,
      });
    }
    if (result.insuranceComparison) {
      const ic = result.insuranceComparison;
      const verdictText = ic.verdict === 'UNCERTAIN'
        ? 'この条件では、月末退職と月末前退職のどちらが有利か判定が分かれます。'
        : ic.verdict === 'MONTH_END'
          ? `この条件では、月末退職のほうが約${ic.difference.min.toLocaleString()}〜${ic.difference.max.toLocaleString()}円有利になる見込みです。`
          : `この条件では、月末より前の退職のほうが約${ic.difference.min.toLocaleString()}〜${ic.difference.max.toLocaleString()}円有利になる見込みです。`;
      steps.push({
        '@type': 'HowToStep',
        name: '社会保険料を退職日別に比較する',
        text: verdictText,
      });
    }
    if (result.residentTaxImpact && result.residentTaxImpact.type !== 'NORMAL') {
      steps.push({
        '@type': 'HowToStep',
        name: '住民税の納付方法を確認する',
        text: result.residentTaxImpact.message,
      });
    }
    if (result.dcDeadline) {
      steps.push({
        '@type': 'HowToStep',
        name: '企業型DC（確定拠出年金）を移管する',
        text: `退職翌日から6か月以内の${result.dcDeadline.deadlineLabel}までに、iDeCoまたは転職先の企業型DCへ移管手続きを行います。`,
      });
    }

    const schema = {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: '金銭面で有利な退職日を確認する手順',
      description: '退職希望日・有休残日数・年収から、最終出社日・資格喪失日・社会保険料の比較・実務期限を算出する手順。',
      step: steps,
    };
    injectSchema('schema-howto', schema);
    return schema;
  }

  /**
   * FAQPage スキーマ：画面に表示中のFAQのみをスキーマ化する（可視コンテンツとの一致を厳守）。
   * @param {Array} visibleFaqs 画面の第1層に表示中のFAQ配列（faq_master.jsの形式）
   */
  function generateFAQSchema(visibleFaqs) {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: (visibleFaqs || []).map(f => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `${f.conclusion} ${f.detail} ${f.action}`,
        },
      })),
    };
    injectSchema('schema-faq', schema);
    return schema;
  }

  global.SchemaGenerator = {
    generateWebApplicationSchema,
    generateLegislationSchema,
    generateHowToSchema,
    generateFAQSchema,
  };
})(window);
