/**
 * calculator.js
 * 「トク退」社労士実務試算エンジン Ver.4.0.0
 * 資格喪失日／標準報酬月額等級／有休消化逆算／社会保険料の月末最適化／
 * 進路3分岐ごとの文脈型ノート（Critical Alert × Solution ペア、一般Caution）を提供する。
 * window.TokutaiCalculator として公開。
 *
 * 注意：標準報酬月額等級テーブルは協会けんぽ（令和6年3月分〜）を参考にした簡易版（抜粋）。
 * 保険料率・国保料は自治体・組合により異なるため、本エンジンの数値はすべて概算です。
 */
(function (global) {
  'use strict';

  const H = global.HolidaysJP;

  // ---- 日付ユーティリティ ----
  function parseDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function fmtJP(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }
  function fmtISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }
  function lastDayOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }
  function isLastDayOfMonth(date) {
    return date.getDate() === lastDayOfMonth(date).getDate();
  }

  // ---------------------------------------------------------------
  // ① 社会保険料資格喪失日（健康保険法第36条）
  // ---------------------------------------------------------------
  /**
   * 資格喪失日 = 退職日の翌日。
   * @param {Date} lastWorkDate 退職日（雇用契約上の最終在籍日）
   * @param {boolean} isUnionKenpo 健康保険組合（組合健保）加入者か
   */
  function calcQualificationLossDate(lastWorkDate, isUnionKenpo) {
    const lossDate = addDays(lastWorkDate, 1);
    const isMonthEnd = isLastDayOfMonth(lastWorkDate);
    return {
      lossDate,
      lossDateLabel: fmtJP(lossDate),
      isMonthEndRetirement: isMonthEnd,
      note: isMonthEnd
        ? '月末退職のため、当月分の社会保険料は会社と労使折半（自己負担50%）で済みます。'
        : '月末より前の退職のため、当月分の社会保険料は徴収されない一方、当月分は国民健康保険・国民年金へ自己全額負担（100%）で加入する必要があります。',
      unionKenpoNote: isUnionKenpo
        ? 'ご加入の健康保険が「健康保険組合」の場合、独自のお得な付加給付や任意継続時の保険料上限額が設定されている場合があります。組合の規約をご確認ください。'
        : null,
    };
  }

  // ---- 標準報酬月額等級テーブル（簡易版・主要帯のみ抜粋） ----
  const STANDARD_REMUNERATION_TABLE = [
    { min: 0, max: 93000, grade: 1, standard: 88000 },
    { min: 93000, max: 101000, grade: 2, standard: 98000 },
    { min: 101000, max: 107000, grade: 3, standard: 104000 },
    { min: 107000, max: 114000, grade: 4, standard: 110000 },
    { min: 114000, max: 122000, grade: 5, standard: 118000 },
    { min: 122000, max: 130000, grade: 6, standard: 126000 },
    { min: 130000, max: 138000, grade: 7, standard: 134000 },
    { min: 138000, max: 146000, grade: 8, standard: 142000 },
    { min: 146000, max: 155000, grade: 9, standard: 150000 },
    { min: 155000, max: 165000, grade: 10, standard: 160000 },
    { min: 165000, max: 175000, grade: 11, standard: 170000 },
    { min: 175000, max: 185000, grade: 12, standard: 180000 },
    { min: 185000, max: 195000, grade: 13, standard: 190000 },
    { min: 195000, max: 210000, grade: 14, standard: 200000 },
    { min: 210000, max: 230000, grade: 15, standard: 220000 },
    { min: 230000, max: 250000, grade: 16, standard: 240000 },
    { min: 250000, max: 270000, grade: 17, standard: 260000 },
    { min: 270000, max: 290000, grade: 18, standard: 280000 },
    { min: 290000, max: 310000, grade: 19, standard: 300000 },
    { min: 310000, max: 330000, grade: 20, standard: 320000 },
    { min: 330000, max: 350000, grade: 21, standard: 340000 },
    { min: 350000, max: 370000, grade: 22, standard: 360000 },
    { min: 370000, max: 395000, grade: 23, standard: 380000 },
    { min: 395000, max: 425000, grade: 24, standard: 410000 },
    { min: 425000, max: 455000, grade: 25, standard: 440000 },
    { min: 455000, max: 485000, grade: 26, standard: 470000 },
    { min: 485000, max: 515000, grade: 27, standard: 500000 },
    { min: 515000, max: 545000, grade: 28, standard: 530000 },
    { min: 545000, max: 575000, grade: 29, standard: 560000 },
    { min: 575000, max: 605000, grade: 30, standard: 590000 },
    { min: 605000, max: 635000, grade: 31, standard: 620000 },
    { min: 635000, max: Infinity, grade: 32, standard: 650000 },
  ];

  function calcStandardRemunerationGrade(monthlySalary) {
    const salary = Number(monthlySalary) || 0;
    const row = STANDARD_REMUNERATION_TABLE.find(r => salary >= r.min && salary < r.max)
      || STANDARD_REMUNERATION_TABLE[STANDARD_REMUNERATION_TABLE.length - 1];
    const employeePensionEstimate = Math.round(row.standard * 0.0915); // 厚生年金18.3%の労使折半・本人負担概算
    const employeeHealthEstimate = Math.round(row.standard * 0.05);   // 健保料率目安10%の労使折半・本人負担概算
    return {
      grade: row.grade,
      standardMonthlyRemuneration: row.standard,
      employeePensionEstimate,
      employeeHealthEstimate,
      employeeMonthlyBurden: employeePensionEstimate + employeeHealthEstimate,
      note: '簡易概算値です。都道府県・組合により実際の保険料率は異なります。',
    };
  }

  // ---------------------------------------------------------------
  // ② 有休消化逆算（holidays.js の営業日チェッカーと連携）
  // ---------------------------------------------------------------
  /**
   * 退職日を「有休消化1日目」として数える（退職日を含めて paidLeaveDays 日ぶんを消化する）。
   * 旧仕様（Ver.10.1）を踏襲し、必要営業日数 = paidLeaveDays + handoverDays を
   * 退職日から過去へ遡ってカウントし、その直前の営業日を「最終出社日」とする。
   * paidLeaveStartDay は「有休のみ」の消化開始日（引き継ぎ日数を含まない）を別途示す。
   *
   * @param {Date} resignDate 退職希望日（契約終了日）
   * @param {number} paidLeaveDays 有給残日数
   * @param {function} businessDayChecker holidays.js createBusinessDayChecker() の返り値
   * @param {number} [handoverDays=0] 引き継ぎ必要日数（有休消化前に出社する日数）
   */
  function calcPaidLeaveBackward(resignDate, paidLeaveDays, businessDayChecker, handoverDays) {
    const days = Math.max(0, Number(paidLeaveDays) || 0);
    const handover = Math.max(0, Number(handoverDays) || 0);
    const needDays = days + handover;

    if (needDays === 0) {
      return { lastWorkDay: resignDate, paidLeaveStartDay: null, businessDaysUsed: 0, handoverDaysUsed: 0 };
    }

    // 退職日自身を1日目として数えるため、起点は「退職日の翌日」からの逆算にする
    const paidLeaveStartDay = days > 0
      ? H.subtractBusinessDays(addDays(resignDate, 1), days, businessDayChecker)
      : null;

    // 最終出社日：退職日から (有休+引き継ぎ) 営業日ぶん遡った直前の営業日
    const lastWorkDay = calcLastWorkDayByCount(resignDate, needDays, businessDayChecker);

    return { lastWorkDay, paidLeaveStartDay, businessDaysUsed: days, handoverDaysUsed: handover };
  }

  /**
   * 起点日から過去へ1日ずつ遡り、営業日を needDays 日カウントし終えた直前の営業日を返す。
   * 起点日自身も営業日ならカウントに含む（Ver.10.1 の calcLastWorkDay を移植）。
   */
  function calcLastWorkDayByCount(fromDate, needDays, businessDayChecker) {
    const isBiz = businessDayChecker || H.isBusinessDay;
    const GUARD = 3650; // 無限ループ保険（約10年分）
    let cursor = new Date(fromDate);
    let counted = 0, steps = 0;

    while (counted < needDays) {
      if (isBiz(cursor)) counted++;
      cursor = addDays(cursor, -1);
      if (++steps > GUARD) return cursor;
    }
    while (!isBiz(cursor)) {
      cursor = addDays(cursor, -1);
      if (++steps > GUARD) return cursor;
    }
    return cursor;
  }

  // ---------------------------------------------------------------
  // ③ 社会保険料の月末最適化（手取り最大化インパクトの核）
  // ---------------------------------------------------------------
  /**
   * 月末退職 vs 月末より前の退職での自己負担差分を簡易試算する。
   * 月末より前の退職では、当月残り日数分を国保・国民年金へ自己全額負担（100%）で
   * 加入する必要があるため、労使折半（50%）で済む月末退職よりも自己負担が重くなりやすい。
   */
  function calcInsuranceOptimization(resignDate, grade) {
    const optimalDate = lastDayOfMonth(resignDate);
    const isOptimal = isLastDayOfMonth(resignDate);
    const employeeMonthlyBurden = grade.employeeMonthlyBurden; // 労使折半時の自己負担（月額）
    const selfPayEstimate = employeeMonthlyBurden * 2;          // 自己全額負担時の概算（折半なし）
    const potentialSavings = isOptimal ? 0 : (selfPayEstimate - employeeMonthlyBurden);

    return {
      isOptimal,
      optimalDate,
      optimalDateLabel: fmtJP(optimalDate),
      employeeMonthlyBurden,
      selfPayEstimate,
      potentialSavings,
      note: '簡易概算です。実際の国民健康保険料は前年所得・自治体の料率により異なります。',
    };
  }

  // ---------------------------------------------------------------
  // ④ 手取り最大化インパクト（有休消化価値 + 保険料最適化差分）
  // ---------------------------------------------------------------
  function calcTakeHomeImpact(monthlySalary, paidLeaveDays, insuranceOptimization) {
    const salary = Number(monthlySalary) || 0;
    const days = Math.max(0, Number(paidLeaveDays) || 0);
    const dailyWage = salary / 21.75; // 1か月の所定労働日数の目安
    const paidLeaveValue = Math.round(dailyWage * days);
    const insuranceSavings = insuranceOptimization ? insuranceOptimization.potentialSavings : 0;
    return {
      paidLeaveValue,
      dailyWage: Math.round(dailyWage),
      days,
      insuranceSavings,
      totalImpact: paidLeaveValue + insuranceSavings,
    };
  }

  // ---------------------------------------------------------------
  // ⑤ 進路3分岐ごとの文脈型ノート（Critical Alert × Solution ペア／一般Caution）
  // ---------------------------------------------------------------
  /**
   * 仕様書 4.1 の文脈型マネタイズ導線テーブルに準拠。
   * critical: Crimson Red 警告。存在する場合は必ず Emerald Green の solution とペアで返す。
   * caution: Amber Yellow の一般注意（住民税一括徴収・空白期間・離職票タイムラグ等）。
   * monetize: 進路の文脈に調和したPR導線（タスクコンテキスト付き）。
   */
  function getBranchContext(branch) {
    const CONTEXT = {
      transfer: {
        label: '①転職',
        caution: {
          title: '住民税の一括徴収・空白期間に注意',
          description: '退職月によっては住民税が一括徴収されたり、転職先入社までに空白期間が生じたりすることがあります。',
        },
        critical: null,
        monetize: {
          taskContext: 'STEP2: 有休消化期間',
          message: '有休消化中の引き継ぎ完了後、時間を有効活用して次のキャリアのスカウトを受け取る',
          ctaLabel: '無料スカウト登録・転職エージェントを見る',
        },
      },
      recuperation: {
        label: '②療養・無職',
        caution: null,
        critical: {
          title: '傷病手当金の受給資格を失うリスク',
          description: '退職日に一日でも出社すると「労務不能」と認められず、退職後の傷病手当金継続受給ができなくなる場合があります。',
          solutionTitle: '退職手続きを専門家に任せる',
          solutionDescription: '体調が優れない状態で会社と直接交渉するのは負担が大きいため、退職代行・給付金サポートへの相談も選択肢です。',
        },
        monetize: {
          taskContext: 'STEP1: 退職手続き',
          message: '体調不良で会社との退職交渉や手続きが困難な場合、無理をせず専門家に委任する',
          ctaLabel: '退職代行・退職給付金サポート相談窓口を見る',
        },
      },
      independence: {
        label: '③独立',
        caution: null,
        critical: {
          title: '開業届の提出タイミングを誤るリスク',
          description: 'ハローワークで受給資格が決定してから1か月以内に開業届を提出すると、再就職手当を受け取れなくなる場合があります。',
          solutionTitle: '提出日をコントロールして開業届を作成する',
          solutionDescription: 'スマホで10分、提出日を指定して無料で開業届を作成できるツールを使えば、提出タイミングを誤らず準備できます。',
        },
        monetize: {
          taskContext: 'STEP3: 開業届提出',
          message: '受給資格決定から1か月経過後以降、スマホで10分・提出日を指定して無料で開業届を作成する',
          ctaLabel: '無料で開業届を作成する（freee開業 / マネーフォワード開業）',
        },
      },
    };
    return CONTEXT[branch] || null;
  }

  function judgeBranch(selected, input) {
    const branches = ['transfer', 'recuperation', 'independence'];
    if (branches.includes(selected)) return selected;
    if (Number(input.paidLeave) === 0) return 'recuperation';
    return 'transfer';
  }

  global.TokutaiCalculator = {
    parseDate,
    fmtJP,
    fmtISO,
    addDays,
    lastDayOfMonth,
    isLastDayOfMonth,
    calcQualificationLossDate,
    calcStandardRemunerationGrade,
    calcPaidLeaveBackward,
    calcLastWorkDayByCount,
    calcInsuranceOptimization,
    calcTakeHomeImpact,
    getBranchContext,
    judgeBranch,
  };
})(window);
