/**
 * calculator.js
 * 「トク退」試算エンジン Ver.17.2（純粋関数のみ・DOM操作を含まない）
 *
 * v17.2での最重要変更：
 * - 社会保険料比較を「免除」の誤解に基づく単一推奨日ロジックから、
 *   compareSocialInsuranceByResignDate による3値判定（MONTH_END/BEFORE_MONTH_END/UNCERTAIN）へ全面刷新。
 * - 国民健康保険料は点推定をやめ、必ずレンジ（幅）で返す。
 * - 「理想の退職日」という単一の推奨日を計算する概念そのものを廃止。
 *   本ファイルはユーザー自身が選んだ退職希望日を基準に実額・期限を算出するのみで、
 *   「この日にすべき」という価値判断は行わない。
 * - 法令条文の誤引用（健保法102条→99条、104条の欠落、厚年法36条→14条）を修正。
 * - 傷病手当金の受給要件（継続1年以上）判定を新設。
 *
 * 料率・法定金額はすべて constants.js（window.TokutaiConstants）から参照する。
 * window.TokutaiCalculator として公開。
 */
(function (global) {
  'use strict';

  const H = global.HolidaysJP;
  const { RATE_MASTER, PREFECTURE_HEALTH_RATES } = global.TokutaiConstants;

  // =================================================================
  // 日付ユーティリティ
  // =================================================================

  /**
   * iOS Safari等での時差・NaNバグを防ぐため、日付文字列を数値へ分解してから
   * ローカルタイムゾーンの Date を安全に生成する。
   * @param {string} dateString 'YYYY-MM-DD' または 'YYYY/MM/DD'
   */
  function parseSafeDate(dateString) {
    if (!dateString) return new Date();
    const parts = String(dateString).split(/[-/]/);
    if (parts.length !== 3) return new Date();
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date();
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  const parseDate = parseSafeDate; // 既存コードとの互換のためのエイリアス

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
  const addDaysSafe = addDays; // 仕様書コード中の呼称に合わせたエイリアス

  function lastDayOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }
  function isLastDayOfMonth(date) {
    return date.getDate() === lastDayOfMonth(date).getDate();
  }

  /**
   * 月またぎで日付が溢れる場合（例：8/31の6か月後→本来2/28だが、
   * setMonthだけだと3/3等に繰り上がってしまう）を防ぐ安全な月加算。
   */
  function addMonthsSafe(baseDate, monthsToAdd) {
    const result = new Date(baseDate.getTime());
    const expectedMonth = (result.getMonth() + monthsToAdd) % 12;
    result.setMonth(result.getMonth() + monthsToAdd);
    if (result.getMonth() !== ((expectedMonth + 12) % 12)) {
      result.setDate(0); // 翌月に溢れた場合、前月末日へ調整
    }
    return result;
  }

  /** 月をまたぐ減算を、対象月に存在しない日付にならないよう月末でクランプして行う */
  function subMonthsClamped(date, months) {
    const targetMonthIndex = date.getMonth() - months;
    const lastDayOfTargetMonth = new Date(date.getFullYear(), targetMonthIndex + 1, 0).getDate();
    const day = Math.min(date.getDate(), lastDayOfTargetMonth);
    return new Date(date.getFullYear(), targetMonthIndex, day);
  }

  /**
   * 生年（西暦のみ）から年齢を算出する。
   * ⚠️ 仕様書に基準日の定義がないため、着手前の確認により
   *    「診断実行時点（今日）の年齢」を採用（合意事項）。
   *    生年月日ではなく生年のみを入力させる設計のため、誕生月によって
   *    ±1歳の誤差が生じうる（UI側で概算である旨を注記すること）。
   * @param {number} birthYear 西暦生年
   * @param {Date} [today] 基準日（省略時は現在時刻）
   */
  function calcAge(birthYear, today) {
    const base = today || new Date();
    return Math.max(0, base.getFullYear() - Number(birthYear));
  }

  // =================================================================
  // ① 資格喪失日（健康保険法第36条・厚生年金保険法第14条）
  // =================================================================
  /**
   * 資格喪失日 = 退職日の翌日。
   * @param {Date} lastWorkDate 退職日（雇用契約上の最終在籍日）
   * @param {string} [insuranceType] 加入中の健康保険種別 'kyokai'|'kumiai'|'kyosai'（そのまま返すのみ）
   */
  function calcQualificationLossDate(lastWorkDate, insuranceType) {
    const lossDate = addDays(lastWorkDate, 1);
    return {
      lossDate,
      lossDateLabel: fmtJP(lossDate),
      isMonthEndRetirement: isLastDayOfMonth(lastWorkDate),
      insuranceType: insuranceType || 'kyokai',
    };
  }

  // =================================================================
  // ② 上司への申し出目安日（民法第627条）
  // =================================================================
  /**
   * 上司へ退職を切り出す目安日。
   * 通常は退職希望日の1か月前だが、有休消化により最終出社日の方が
   * それより早く来る場合は、出社しているうちに伝える必要があるため
   * 最終出社日を目安日として採用する。
   * @param {Date} resignDate ユーザーが指定した退職希望日
   * @param {Date} lastWorkDay 最終出社日
   */
  function calcNoticeDate(resignDate, lastWorkDay) {
    const oneMonthBefore = subMonthsClamped(resignDate, 1);
    const clampedByLastWorkDay = lastWorkDay.getTime() < oneMonthBefore.getTime();
    const date = clampedByLastWorkDay ? lastWorkDay : oneMonthBefore;
    return { date, dateLabel: fmtJP(date), clampedByLastWorkDay };
  }

  // =================================================================
  // ③ 有休消化逆算（holidays.js の営業日チェッカーと連携）
  // =================================================================
  function calcPaidLeaveBackward(resignDate, paidLeaveDays, businessDayChecker, handoverDays) {
    const days = Math.max(0, Number(paidLeaveDays) || 0);
    const handover = Math.max(0, Number(handoverDays) || 0);
    const needDays = days + handover;

    if (needDays === 0) {
      return { lastWorkDay: resignDate, paidLeaveStartDay: null, businessDaysUsed: 0, handoverDaysUsed: 0 };
    }
    const paidLeaveStartDay = days > 0
      ? H.subtractBusinessDays(addDays(resignDate, 1), days, businessDayChecker)
      : null;
    const lastWorkDay = calcLastWorkDayByCount(resignDate, needDays, businessDayChecker);
    return { lastWorkDay, paidLeaveStartDay, businessDaysUsed: days, handoverDaysUsed: handover };
  }

  function calcLastWorkDayByCount(fromDate, needDays, businessDayChecker) {
    const isBiz = businessDayChecker || H.isBusinessDay;
    const GUARD = 3650;
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

  // =================================================================
  // ④ 標準報酬月額の概算（第5章①で使用する estimateStandardMonthlyWage）
  // =================================================================
  /**
   * ⚠️ 仕様書には中身が定義されていない関数。以下の方針で実装（着手前に合意済み）：
   * 年収（賞与込み）を12等分した概算値を、厚生年金保険の標準報酬月額の法定上下限
   * （1等級 88,000円〜32等級 650,000円）でクランプする。
   * 協会けんぽの健康保険等級表（〜50等級・139万円）とは별도の上限を持つが、
   * 仕様書 第5章①のコードは健保・厚年で単一の standardWage を共用する設計のため、
   * より制約の強い厚生年金の上下限に合わせている。
   * 標準報酬月額は本来「賞与を除いた月々の固定給」の等級で決まるため、
   * 賞与の割合が大きい人ほどこの概算は実額よりやや高めに出る点に注意。
   */
  function estimateStandardMonthlyWage(annualIncome) {
    const PENSION_MIN = 88000;
    const PENSION_MAX = 650000;
    const raw = Math.round(Math.max(0, Number(annualIncome) || 0) / 12);
    return Math.min(PENSION_MAX, Math.max(PENSION_MIN, raw));
  }

  // =================================================================
  // ⑤ 給与所得控除後の所得（国保・住民税レンジ推定の起点）
  // =================================================================
  /**
   * ⚠️ 仕様書には中身が定義されていない関数。国税庁「給与所得の源泉徴収税額表」
   * 令和8年分の速算表（constants.js の RATE_MASTER.salaryIncomeDeduction）を出典に実装。
   */
  function calcSalaryIncomeAfterDeduction(annualIncome) {
    const income = Math.max(0, Number(annualIncome) || 0);
    const table = RATE_MASTER.salaryIncomeDeduction;
    const bracket = table.brackets.find(b => income <= b.maxIncome) || table.brackets[table.brackets.length - 1];
    let deduction;
    if (bracket.formula === 'minimum') deduction = table.minimumDeduction;
    else if (bracket.formula === 'linear') deduction = Math.round(income * bracket.rate) + bracket.addAmount;
    else deduction = bracket.capAmount;
    return Math.max(0, income - deduction);
  }

  // =================================================================
  // ⑥ 住民税額の概算（RATE_MASTER.residentTax を使用）
  // =================================================================
  /**
   * ⚠️ 仕様書には中身が定義されていない関数。給与所得控除後の所得から、
   * 仕様書が既に定義している住民税の基礎控除（nationalHealthInsurance.basicDeduction、
   * 「住民税の基礎控除に準拠」と明記）・所得割率10%・均等割5,000円を用いて概算する。
   */
  function estimateAnnualResidentTax(annualIncome) {
    const salaryIncome = calcSalaryIncomeAfterDeduction(annualIncome);
    const taxableIncome = Math.max(0, salaryIncome - RATE_MASTER.nationalHealthInsurance.basicDeduction);
    return Math.round(taxableIncome * RATE_MASTER.residentTax.incomeRate) + RATE_MASTER.residentTax.perCapitaAmount;
  }

  // =================================================================
  // ⑦ 国民年金第3号被保険者の該当判定
  // =================================================================
  /**
   * ⚠️ 仕様書 第4章の入力項目一覧には配偶者の加入状況を尋ねる項目が存在せず、
   * 判定に必要な情報（配偶者が厚生年金に加入しているか等）を本ツールは収集していない。
   * 第12.2節のテストケース（「年収200万・扶養に入る」→自己負担0円が前提）に合わせ、
   * 「家族の扶養に入る」を選んだ場合は原則として配偶者が厚生年金等に加入しており
   * 第3号被保険者に該当するとみなす（最も一般的なケースを既定値とする）。
   * 将来的に配偶者の加入状況を尋ねる入力項目が追加された場合、
   * input.spouseCoveredByEmployeesPension === false で明示的に非該当と判定できるようにしてある。
   */
  function isThirdCategoryEligible(input) {
    if (input && input.spouseCoveredByEmployeesPension === false) return false;
    return true;
  }

  // =================================================================
  // 第5章① 社会保険料の退職日別比較エンジン（最重要修正箇所）
  // =================================================================
  /**
   * 国民健康保険料をレンジで推定する。
   * ⚠️ 国保料は市区町村ごとに料率・均等割額が異なり、点推定は原理的に不可能。
   *    必ずレンジ（幅）で返すこと。
   */
  function estimateNationalHealthInsurance({ annualIncome, age, applyReduction }) {
    const C = RATE_MASTER.nationalHealthInsurance;
    const isNursing = (age >= 40 && age < 65);

    let salaryIncome = calcSalaryIncomeAfterDeduction(annualIncome);
    if (applyReduction) {
      salaryIncome = Math.round(salaryIncome * RATE_MASTER.involuntaryUnemploymentReduction.incomeMultiplier);
    }

    const base = Math.max(0, salaryIncome - C.basicDeduction);
    const incomeMin = base * (C.incomeRateMin + (isNursing ? C.nursingIncomeRateMin : 0));
    const incomeMax = base * (C.incomeRateMax + (isNursing ? C.nursingIncomeRateMax : 0));
    const perCapitaMin = C.perCapitaMin + (isNursing ? C.nursingPerCapitaMin : 0);
    const perCapitaMax = C.perCapitaMax + (isNursing ? C.nursingPerCapitaMax : 0);

    return {
      min: Math.round((incomeMin + perCapitaMin) / 12),
      max: Math.round((incomeMax + perCapitaMax) / 12),
    };
  }

  /**
   * 非自発的失業者の国民健康保険料軽減措置の判定。
   * 特定受給資格者（倒産・解雇等＝会社都合）／特定理由離職者（雇止め、
   * 体調不良による正当な理由のある自己都合）かつ離職時65歳未満が対象。
   * ⚠️ 申請主義（自動適用されない）。表示時は必ず申請が必要な旨を明記すること。
   */
  function judgeInvoluntaryReduction({ retireReason, isMentalPhysicalUnfit, age }) {
    if (age >= RATE_MASTER.involuntaryUnemploymentReduction.maxAge) return false;
    if (retireReason === 'company') return true;
    if (retireReason === 'contract_end') return true;
    if (retireReason === 'personal' && isMentalPhysicalUnfit === 'yes') return true;
    return false;
  }

  /**
   * 月末退職と月末前退職の自己負担額をレンジで比較する（第5章①）。
   * @returns {{verdict:'MONTH_END'|'BEFORE_MONTH_END'|'UNCERTAIN', patternA:number,
   *            patternB:{min:number,max:number}, difference:{min:number,max:number},
   *            reductionApplied:boolean, breakdown:object}}
   */
  function compareSocialInsuranceByResignDate(input) {
    const { annualIncome, prefecture, age, afterInsurance, retireReason, isMentalPhysicalUnfit } = input;
    const standardWage = estimateStandardMonthlyWage(annualIncome);
    const isNursingCareTarget = (age >= 40 && age < 65);

    // ---- パターンA：月末退職（在職中の社会保険を1ヶ月分多く負担・確定値）----
    const healthRate = PREFECTURE_HEALTH_RATES[prefecture] ?? RATE_MASTER.health.nationalAverageTotal;
    const employeeHealth = Math.round(standardWage * healthRate / 2);
    const employeePension = Math.round(standardWage * RATE_MASTER.pension.employeeRate);
    const employeeNursing = isNursingCareTarget
      ? Math.round(standardWage * RATE_MASTER.nursingCare.employeeRate)
      : 0;
    // 令和8年4月分〜：子ども・子育て支援金（全国一律・労使折半）が健康保険料に上乗せされる
    const employeeChildcareLevy = Math.round(standardWage * RATE_MASTER.childcareSupportLevy.employeeRate);
    const patternA = employeeHealth + employeePension + employeeNursing + employeeChildcareLevy;

    // ---- パターンB：月末前退職（その月は自分で国保・国民年金等に加入・レンジ値）----
    let patternB = { min: 0, max: 0 };
    let reductionApplied = false;

    switch (afterInsurance) {
      case 'kokuho': {
        reductionApplied = judgeInvoluntaryReduction({ retireReason, isMentalPhysicalUnfit, age });
        const nhi = estimateNationalHealthInsurance({ annualIncome, age, applyReduction: reductionApplied });
        patternB = {
          min: RATE_MASTER.nationalPension.monthlyPremium + nhi.min,
          max: RATE_MASTER.nationalPension.monthlyPremium + nhi.max,
        };
        break;
      }
      case 'nini_keizoku': {
        const nini = Math.round(standardWage * healthRate)
          + (isNursingCareTarget ? Math.round(standardWage * RATE_MASTER.nursingCare.totalRate) : 0);
        const total = RATE_MASTER.nationalPension.monthlyPremium + nini;
        patternB = { min: total, max: total };
        break;
      }
      case 'fuyou': {
        const pension = isThirdCategoryEligible(input) ? 0 : RATE_MASTER.nationalPension.monthlyPremium;
        patternB = { min: pension, max: pension };
        break;
      }
    }

    const diffMin = patternB.min - patternA;
    const diffMax = patternB.max - patternA;

    let verdict;
    if (diffMin > 0 && diffMax > 0) verdict = 'MONTH_END';
    else if (diffMin < 0 && diffMax < 0) verdict = 'BEFORE_MONTH_END';
    else verdict = 'UNCERTAIN';

    return {
      verdict,
      patternA,
      patternB,
      difference: { min: Math.abs(diffMin), max: Math.abs(diffMax) },
      reductionApplied,
      breakdown: { employeeHealth, employeePension, employeeNursing, employeeChildcareLevy },
    };
  }

  // =================================================================
  // 第5章② 住民税の退職月別徴収ロジック
  // =================================================================
  /**
   * ⚠️ 住民税は「退職日を変えれば減る」性質のものではなく、支払うタイミングが
   *    変わるだけ。呼び出し側（app.js）は「損」として損得額に合算せず、
   *    キャッシュフロー上の注意として別枠で提示すること。
   */
  function calculateResidentTaxImpact(resignDate, annualIncome) {
    const month = resignDate.getMonth() + 1;
    const annualResidentTax = estimateAnnualResidentTax(annualIncome);
    const monthlyAmount = Math.round(annualResidentTax / 12);

    if (month >= 1 && month <= 4) {
      const remainingMonths = 5 - month + 1;
      return {
        type: 'LUMP_SUM_MANDATORY',
        amount: monthlyAmount * remainingMonths,
        months: remainingMonths,
        message: `${month}月退職の場合、${month}月分から5月分までの住民税 約${(monthlyAmount * remainingMonths).toLocaleString()}円が最終給与などから一括で差し引かれます。最後の手取りが大きく減る可能性があるため、生活費の準備にご注意ください。`,
      };
    }
    if (month === 5) {
      return { type: 'NORMAL', amount: monthlyAmount, message: '5月退職の場合、住民税は通常どおり1ヶ月分の徴収で完了します。' };
    }
    return {
      type: 'ORDINARY_COLLECTION',
      amount: monthlyAmount * (12 - month + 5),
      message: `${month}月退職の場合、残りの住民税は原則としてご自宅に届く納付書でご自分で納めます（普通徴収）。給与天引きがなくなるぶん、後から請求が来る点にご注意ください。`,
    };
  }

  // =================================================================
  // 第5章③ 雇用保険法改正対応：給付制限期間動的判定
  // =================================================================
  function calculateUnemploymentRestriction(input) {
    const { retireDateStr, retireReason, resignCount5Years, isEnrolledEducation, age } = input;
    const targetDate = parseSafeDate(retireDateStr);
    const enforcementDate = new Date(2025, 3, 1); // 2025年4月1日

    if (age >= 65) {
      return {
        restrictionMonths: 0,
        code: 'HIGH_AGE_LUMP_SUM',
        text: '高年齢求職者給付金（一時金）の対象',
        note: '65歳以上で離職した場合、受け取れるのは基本手当ではなく「高年齢求職者給付金」という一時金です。被保険者期間1年以上で基本手当日額の50日分、1年未満で30日分が一括支給されます。',
      };
    }
    if (retireReason === 'company') {
      return { restrictionMonths: 0, code: 'COMPANY_REASON', text: '給付制限なし（会社都合）' };
    }
    if (retireReason === 'retirement_age') {
      return {
        restrictionMonths: 0,
        code: 'MANDATORY_RETIREMENT',
        text: '給付制限なし（定年退職）',
        note: '定年退職は給付制限の対象外です。ただし「特定受給資格者」ではないため、所定給付日数は一般の受給資格者と同じ扱いになります。',
      };
    }
    if (retireReason === 'contract_end') {
      return { restrictionMonths: 0, code: 'CONTRACT_END', text: '給付制限なし（契約期間満了）' };
    }

    if (targetDate < enforcementDate) {
      return { restrictionMonths: 2, code: 'OLD_RULE_2M', text: '給付制限 2ヶ月（2025年3月までの旧ルール）' };
    }
    if (isEnrolledEducation === 'yes') {
      return {
        restrictionMonths: 0,
        code: 'EDUCATION_EXEMPT',
        text: '給付制限 解除（待期7日のみ）',
        note: '離職前1年以内または離職後に厚生労働大臣が指定する教育訓練を受講した場合、給付制限が解除されます。',
      };
    }
    if (resignCount5Years === '3_or_more') {
      return {
        restrictionMonths: 3,
        code: 'FREQUENT_RESIGN_3M',
        text: '給付制限 3ヶ月（5年以内に3回以上）',
        note: '過去5年以内に自己都合退職による受給手続きを3回以上行っている場合、3回目以降は3ヶ月の給付制限となります。',
      };
    }
    return { restrictionMonths: 1, code: 'NEW_RULE_2025_1M', text: '給付制限 1ヶ月（2025年4月改正）' };
  }

  // =================================================================
  // 第5章④ 傷病手当金の受給要件判定（健康保険法第99条・第104条）
  // =================================================================
  function judgeSicknessAllowanceEligibility(input) {
    const { tenureYears } = input;
    if (input.isMentalPhysicalUnfit !== 'yes') {
      return { applicable: false };
    }
    if (tenureYears < 1) {
      return {
        applicable: false,
        code: 'TENURE_UNDER_1Y',
        level: 'info',
        message: '在籍期間が1年未満のため、退職後に傷病手当金を継続して受け取る制度（資格喪失後の継続給付）の対象外となる可能性が高いです。ただし在職中の傷病手当金は別途請求できます。詳しくはご加入の健康保険の窓口へご確認ください。',
      };
    }
    return {
      applicable: true,
      code: 'CONTINUATION_POSSIBLE',
      level: 'caution',
      requirements: [
        '退職日の前日まで、継続して1年以上健康保険に加入していること',
        '退職日の時点で、傷病手当金を受けているか、受けられる状態（労務不能）であること',
        '退職日に労務不能の状態であること（＝出勤しないこと）',
      ],
      message: '退職日に出勤して業務を行うと「働ける状態だった」と判断され、退職後の継続給付を受けられなくなる場合があります。退職日は出勤せず、有給休暇の取得または欠勤として扱うことをご検討ください。ご自身のケースについては、必ず事前にご加入の健康保険の窓口へご確認ください。',
    };
  }

  // =================================================================
  // 第5章⑥ 退職所得の試算
  // =================================================================
  function calculateRetirementIncomeTax(retirementPay, tenureYears, hasSubmittedForm) {
    const years = Math.ceil(tenureYears);
    const R = RATE_MASTER.retirementIncome;
    const deduction = years <= 20
      ? Math.max(R.deductionPerYearUnder20 * years, R.minimumDeduction)
      : R.deductionBaseOver20 + R.deductionPerYearOver20 * (years - 20);

    if (!hasSubmittedForm) {
      return {
        withholding: Math.round(retirementPay * R.withholdingRateWithoutForm),
        note: '「退職所得の受給に関する申告書」を提出しないと、退職金の全額に20.42%が源泉徴収されます。ただし、その場合でも翌年の確定申告により納めすぎた分の還付を受けられます。提出し忘れても取り返しがつかないわけではありません。',
      };
    }
    const taxableIncome = Math.max(0, (retirementPay - deduction) / 2);
    return { deduction, taxableIncome, note: '退職所得控除により、多くの場合で税負担は大きく軽減されます。' };
  }

  // =================================================================
  // 第5章⑦ 再就職手当と開業日の関係（進路③独立）
  // =================================================================
  function calculateRecommendedOpeningDate(resignDate, restriction) {
    const waitingEnd = addDaysSafe(resignDate, RATE_MASTER.employmentInsurance.waitingPeriodDays);
    const restrictionEnd = addMonthsSafe(waitingEnd, restriction.restrictionMonths);
    return {
      earliestSafeDate: restrictionEnd,
      earliestSafeDateLabel: fmtJP(restrictionEnd),
      note: '再就職手当を受け取りたい場合、給付制限期間が終わってから開業届を出すことが原則です。なお、待期期間はハローワークで求職の申し込みをした日から数えるため、実際の日付は手続き日によって変わります。',
    };
  }

  // =================================================================
  // 企業型DC（確定拠出年金）の移管期限
  // =================================================================
  function calcDcDeadline(resignDate) {
    const startDate = addDays(resignDate, 1);
    const deadline = addMonthsSafe(startDate, RATE_MASTER.corporateDC.transferDeadlineMonths);
    return { startDate, deadline, deadlineLabel: fmtJP(deadline) };
  }

  // =================================================================
  // ボーナス（賞与）の支給日在籍判定（損得の断定はせず、事実のみを返す）
  // =================================================================
  function judgeBonusEligibility(date, bonusDateStr, bonusAmountYen) {
    if (!bonusDateStr || !bonusAmountYen) return null;
    const bonusDate = parseDate(bonusDateStr);
    const amount = Math.max(0, Number(bonusAmountYen) || 0);
    return { bonusDate, bonusDateLabel: fmtJP(bonusDate), amount, willReceive: date.getTime() >= bonusDate.getTime() };
  }

  // =================================================================
  // 社会保険の空白期間判定（転職・次の入社日が分かっている場合）
  // =================================================================
  function calcInsuranceGap(resignDate, nextJoinDateStr) {
    if (!nextJoinDateStr) return null;
    const nextJoin = parseDate(nextJoinDateStr);
    const lossDate = addDays(resignDate, 1);
    const gapDays = Math.round((nextJoin.getTime() - lossDate.getTime()) / 86400000);
    if (gapDays === 0) return { type: 'none', days: 0, nextJoinLabel: fmtJP(nextJoin) };
    if (gapDays > 0) return { type: 'gap', days: gapDays, nextJoinLabel: fmtJP(nextJoin) };
    return { type: 'overlap', days: Math.abs(gapDays), nextJoinLabel: fmtJP(nextJoin) };
  }

  global.TokutaiCalculator = {
    parseDate,
    parseSafeDate,
    fmtJP,
    fmtISO,
    addDays,
    addDaysSafe,
    addMonthsSafe,
    lastDayOfMonth,
    isLastDayOfMonth,
    calcAge,
    calcQualificationLossDate,
    calcNoticeDate,
    calcPaidLeaveBackward,
    calcLastWorkDayByCount,
    estimateStandardMonthlyWage,
    calcSalaryIncomeAfterDeduction,
    estimateAnnualResidentTax,
    isThirdCategoryEligible,
    estimateNationalHealthInsurance,
    judgeInvoluntaryReduction,
    compareSocialInsuranceByResignDate,
    calculateResidentTaxImpact,
    calculateUnemploymentRestriction,
    judgeSicknessAllowanceEligibility,
    calculateRetirementIncomeTax,
    calculateRecommendedOpeningDate,
    calcDcDeadline,
    judgeBonusEligibility,
    calcInsuranceGap,
  };
})(window);
