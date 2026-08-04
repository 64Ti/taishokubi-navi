/**
 * schema_generator.js
 * AI検索（AIO/SGE, SearchGPT, Perplexity, Gemini）対策として、診断結果のToDoタイムラインを
 * HowTo / FAQPage / WebApplication の構造化データ(JSON-LD)に変換し <head> へ動的挿入する。
 * window.SchemaGenerator として公開。
 *
 * 稼働ドメインは仕様書Ver.4.0.0では https://tokutai.jp （旧: https://taishokubi-navi.pages.dev/）
 * だが、当面は pages.dev のまま運用するため SITE_URL は現行ドメインを既定値にしている。
 * 本番ドメイン移行時はこの定数のみ書き換えれば良い。
 */
(function (global) {
  'use strict';

  const SITE_URL = 'https://taishokubi-navi.pages.dev/';
  const SITE_NAME = 'トク退｜退職日計算ナビ';

  function injectSchema(id, jsonObject) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = id;
    script.textContent = JSON.stringify(jsonObject, null, 2);
    document.head.appendChild(script);
  }

  /** WebApplication スキーマ：サイト全体の性質をAIに伝える基礎スキーマ。ページロード時に常時挿入。 */
  function generateWebApplicationSchema() {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: SITE_NAME,
      url: SITE_URL,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: '退職希望日・有休残日数・給与を入力すると、最終出社日・社会保険資格喪失日・手取り最大化効果を自動算定する無料シミュレーター。登録不要、完全端末内処理。',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' },
      inLanguage: 'ja-JP',
    };
    injectSchema('schema-webapplication', schema);
    return schema;
  }

  /**
   * HowTo スキーマ：試算結果のToDoタイムラインを「手取りを最大化する損しない退職手続き手順」として提示。
   * @param {object} result app.js が組み立てた試算結果一式
   */
  function generateHowToSchema(result) {
    const steps = [];

    steps.push({
      '@type': 'HowToStep',
      name: '離職票の到着確認と国保減免申請',
      text: '退職後10日〜2週間で届く離職票-1,2を持参し、市区町村役場で国民健康保険の軽減申請を行います。',
    });

    if (result.lastWorkDayLabel) {
      steps.push({
        '@type': 'HowToStep',
        name: '最終出社日を迎える',
        text: `引き継ぎ業務は${result.lastWorkDayLabel}までに完了させます。`,
      });
    }
    if (result.paidLeaveStartLabel) {
      steps.push({
        '@type': 'HowToStep',
        name: '有給休暇の消化を開始する',
        text: `${result.paidLeaveStartLabel}から有給休暇の消化期間に入ります。`,
      });
    }
    if (result.recommendation && result.recommendation.dateLabel) {
      steps.push({
        '@type': 'HowToStep',
        name: '退職日を迎える',
        text: `おすすめの退職日は${result.recommendation.dateLabel}です。${result.qualification.note}`,
      });
    }
    if (result.qualification && result.qualification.lossDateLabel) {
      steps.push({
        '@type': 'HowToStep',
        name: '社会保険の資格喪失日を把握する',
        text: `健康保険・厚生年金の資格喪失日は${result.qualification.lossDateLabel}です。`,
      });
    }
    if (result.insuranceGap && result.insuranceGap.type === 'gap') {
      steps.push({
        '@type': 'HowToStep',
        name: '空白期間の健康保険を手続きする',
        text: `次の入社日（${result.insuranceGap.nextJoinLabel}）までの約${result.insuranceGap.days}日間は、国民健康保険・国民年金への一時加入、または任意継続被保険者制度の手続きが必要です。`,
      });
    }

    if (result.branch === 'independence') {
      steps.push({
        '@type': 'HowToStep',
        name: '独立時の開業届提出時期のコントロール',
        text: 'ハローワーク受給資格決定後1ヶ月間は開業届の提出を控え、再就職手当の支給条件を満たします。',
      });
    }

    const schema = {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: '手取りを最大化する損しない退職手続き手順',
      description: '退職希望日・有休残日数から、最終出社日・有休消化開始日・資格喪失日を逆算し、手取りを最大化する手順。',
      step: steps,
    };
    injectSchema('schema-howto', schema);
    return schema;
  }

  /**
   * FAQPage スキーマ：常設Q&A + 検出されたCritical/Cautionノートを統合してAIOに提示する。
   * @param {object} result app.js の試算結果一式（branchContext, qualification を含む）
   */
  function generateFAQSchema(result) {
    const baseFaqs = [
      {
        q: '社会保険の資格喪失日はいつになりますか？',
        a: '健康保険・厚生年金の資格喪失日は、法律上「退職日の翌日」です（健康保険法第36条）。退職日当日ではない点に注意が必要です。',
      },
      {
        q: '月末退職と月末より前の退職、どちらが得ですか？',
        a: '月末退職の場合、当月分の社会保険料は会社との労使折半（自己負担50%）で済みます。月末より前に退職すると、当月分は国民健康保険・国民年金へ自己全額負担（100%）で加入する必要が生じる場合があります。',
      },
    ];

    if (result.insuranceGap) {
      if (result.insuranceGap.type === 'gap') {
        baseFaqs.push({
          q: '次の会社の入社日までに健康保険が途切れる期間ができました。どうすればいいですか？',
          a: `退職日の翌日から次の入社日（${result.insuranceGap.nextJoinLabel}）までの約${result.insuranceGap.days}日間は、健康保険・厚生年金の被保険者ではなくなります。この間は国民健康保険・国民年金への一時加入（原則14日以内に市区町村で手続き）、または健康保険の任意継続被保険者制度（原則20日以内に申請、最大2年）のいずれかを選ぶ必要があります。`,
        });
      } else if (result.insuranceGap.type === 'none') {
        baseFaqs.push({
          q: '転職先が決まっている場合、社会保険の手続きは必要ですか？',
          a: '退職日の翌日と次の入社日が同じであれば、健康保険・厚生年金は途切れることなく転職先へ引き継がれるため、国民健康保険や任意継続被保険者制度の手続きは不要です。',
        });
      }
    }

    const ctx = result.branchContext;
    if (ctx) {
      if (ctx.critical) {
        baseFaqs.push({
          q: ctx.critical.title,
          a: `${ctx.critical.description} 対応策として「${ctx.critical.solutionTitle}」が有効です。${ctx.critical.solutionDescription}`,
        });
      }
      if (ctx.caution) {
        baseFaqs.push({
          q: ctx.caution.title,
          a: ctx.caution.description,
        });
      }
    }

    const schema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: baseFaqs.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    };
    injectSchema('schema-faq', schema);
    return schema;
  }

  global.SchemaGenerator = {
    generateWebApplicationSchema,
    generateHowToSchema,
    generateFAQSchema,
  };
})(window);
