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

  /** SoftwareApplication スキーマ：サイト全体の性質をAIに伝える基礎スキーマ。ページロード時に常時挿入。 */
  function generateWebApplicationSchema() {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
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
      name: '退職の申し出タイミングを確認する',
      text: '民法上は申し出から2週間で退職できますが（民法第627条第1項）、就業規則に「1か月前まで」等の定めがある場合は、就業規則を優先して早めに直属の上司へ相談します。',
    });

    if (result.mandatoryAdvice) {
      steps.push({
        '@type': 'HowToStep',
        name: '定年退職ならではの確認事項（1か月前退職・同日得喪特例）',
        text: result.mandatoryAdvice.body,
      });
    }

    if (result.retirementPayAdvice) {
      steps.push({
        '@type': 'HowToStep',
        name: result.retirementPayAdvice.taskTitle,
        text: result.retirementPayAdvice.taskBody,
      });
    }

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
        text: `理想の退職日は${result.recommendation.dateLabel}です。${result.qualification.note}`,
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

    if (result.branch === 'transfer') {
      steps.push({
        '@type': 'HowToStep',
        name: '雇用保険被保険者証・源泉徴収票を準備する',
        text: '離職票は不要です。転職先へ「雇用保険被保険者証」と「源泉徴収票」を提出します。',
      });
    } else if (result.branch === 'recuperation') {
      steps.push({
        '@type': 'HowToStep',
        name: '離職票の到着を待ち、基本手当を申請する',
        text: '退職後10日〜2週間で届く「離職票」を持参し、ハローワークで基本手当（および傷病手当金）の申請を行います。',
      });
    } else if (result.branch === 'independence') {
      if (result.wantAllowance === 'yes') {
        steps.push({
          '@type': 'HowToStep',
          name: '離職票の到着を待ち、再就職手当を申請する',
          text: '再就職手当の申請には離職票が必要です。受給資格決定後1か月間は開業届の提出を控え、支給条件を満たしてから提出します。',
        });
      } else {
        steps.push({
          '@type': 'HowToStep',
          name: '雇用保険被保険者証を準備する',
          text: 'すぐに開業する場合、離職票の到着を待つ必要はありません。雇用保険被保険者証を保管しておきます。',
        });
      }
    }

    if (result.dcDeadline) {
      steps.push({
        '@type': 'HowToStep',
        name: '企業型DC（確定拠出年金）を移管する',
        text: `退職翌日から6か月以内の${result.dcDeadline.deadlineLabel}までに、iDeCoまたは転職先の企業型DCへ移管手続きを行います。放置すると自動移管され、運用停止と手数料発生の対象になります。`,
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
      {
        q: '退職の申し出はいつまでにすればいいですか？',
        a: '民法上は申し出から2週間の経過で退職できます（民法第627条第1項）。ただし多くの会社の就業規則には「1か月前まで」等の独自ルールがあり、円満退職のためには就業規則を確認したうえで早めに直属の上司へ相談するのが実務上の目安です。',
      },
    ];

    if (result.qualification && result.qualification.insuranceType === 'kyosai') {
      baseFaqs.push({
        q: '公務員の共済組合の場合も同じ計算でいいですか？',
        a: '共済組合（公務員等）は健康保険組合とは異なる独自の規定・手続きが優先されるため、本ツールの試算はあくまで一般的な目安です。退職・保険の切り替えの詳細は、必ず所属先の共済組合窓口にご確認ください。',
      });
    } else if (result.qualification && result.qualification.insuranceType === 'kumiai') {
      baseFaqs.push({
        q: '健康保険組合に加入している場合、何か違いはありますか？',
        a: '健康保険組合（組合健保）は、協会けんぽとは別に独自の付加給付や任意継続時の保険料上限額を設けている場合があります。詳細は加入している組合の規約をご確認ください。',
      });
    }

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

    if (result.mandatoryAdvice) {
      baseFaqs.push({
        q: '定年退職では1か月前に退職日を設定した方がお得ですか？',
        a: '定年到達月の1か月前（前月末）に退職日を設定できる場合、退職所得控除の勤続年数計算や社会保険料の1か月分折半で手取りが多くなることがあります。ただし就業規則で退職日そのものが固定されている場合は対象外なので、労務担当者に確認が必要です。定年後に同じ会社で再雇用される場合は、社会保険の「同日得喪」（資格喪失と再取得を同時に行い、給与減額に合わせて1か月目から保険料を引き下げる特例）の手続きも確認しましょう。',
      });
    }

    if (result.dcDeadline) {
      baseFaqs.push({
        q: '企業型DC（確定拠出年金）はいつまでに移管すればいいですか？',
        a: `退職日翌日から6か月以内（${result.dcDeadline.deadlineLabel}まで）に、iDeCoまたは転職先の企業型DCへ移管する必要があります。期限を過ぎると自動的に国民年金基金連合会へ自動移管され、運用が停止したうえ手数料がかかり続けます。`,
      });
    }

    if (result.retirementPayAdvice) {
      baseFaqs.push({
        q: '退職金を受け取るとき、何か提出書類が必要ですか？',
        a: '「退職所得の受給に関する申告書」を退職日までに会社へ提出してください。未提出だと退職金に20.42%の一律課税がされ、手取りが一時的に大きく減ります。また退職所得控除の計算に使う勤続年数は、1年未満の端数を切り上げて計算されるため、控除額が有利になる点も覚えておくとよいでしょう。',
      });
    }

    if (result.gainLoss && result.bonusDate && result.bonusAmount) {
      baseFaqs.push({
        q: 'ボーナス支給日の前に退職するとどうなりますか？',
        a: '多くの会社の賞与規程には「支給日に在籍していること」という支給日在籍要件があります。支給日より前が退職日になっていると、査定期間を勤務していても賞与を受け取れない場合があります。支給日をまたいで在籍できるよう退職日を調整することで、この規定の対象外になれるかを確認できます。',
      });
    }

    const ctx = result.branchContext;
    if (ctx) {
      // 独立branchのcritical（再就職手当リスク）は、再就職手当の受給を希望する場合のみ該当する
      const criticalApplies = ctx.critical && (result.branch !== 'independence' || result.wantAllowance === 'yes');
      if (criticalApplies) {
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
