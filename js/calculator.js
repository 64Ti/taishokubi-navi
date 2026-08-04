/**
 * calculator.js
 * 「トク退」社労士実務試算エンジン Ver.10.0
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
  /**
   * iOS Safari等での時差・NaNバグを防ぐため、日付文字列を数値へ分解してから
   * ローカルタイムゾーンの Date を安全に生成する。
   * 不正な入力（空文字・区切り不足など）の場合は現在時刻の Date を返す。
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
  // 旧名 parseDate は既存コード全体との互換のため parseSafeDate のエイリアスとして残す
  const parseDate = parseSafeDate;
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
  /**
   * 月またぎで日付が溢れる場合（例：8/31の6か月後→本来2/28だが、
   * setMonthだけだと3/3等に繰り上がってしまう）を防ぐ安全な月加算。
   * 溢れが起きたら、加算後の月の末日にクランプする。
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

  // ---------------------------------------------------------------
  // ① 社会保険料資格喪失日（健康保険法第36条）
  // ---------------------------------------------------------------
  /**
   * 加入中の健康保険の種類ごとの注記。
   *   kyokai: 協会けんぽ（デフォルト）
   *   kumiai: 健康保険組合（組合健保）
   *   kyosai: 共済組合（公務員等）
   */
  const INSURANCE_TYPE_NOTES = {
    kumiai: 'ご加入の健康保険が「健康保険組合」の場合、独自のお得な付加給付や任意継続時の保険料上限額が設定されている場合があります。組合の規約をご確認ください。',
    kyosai: '共済組合（公務員等）は健康保険組合とは異なる独自の規定・手続きが優先されます。退職・保険の切り替えについては、必ず所属先の共済組合窓口にご確認ください。',
  };

  /**
   * 資格喪失日 = 退職日の翌日。
   * @param {Date} lastWorkDate 退職日（雇用契約上の最終在籍日）
   * @param {string} insuranceType 加入中の健康保険種別 'kyokai'|'kumiai'|'kyosai'
   */
  function calcQualificationLossDate(lastWorkDate, insuranceType) {
    const lossDate = addDays(lastWorkDate, 1);
    const isMonthEnd = isLastDayOfMonth(lastWorkDate);
    return {
      lossDate,
      lossDateLabel: fmtJP(lossDate),
      isMonthEndRetirement: isMonthEnd,
      note: isMonthEnd
        ? '月末退職のため、当月分の社会保険料は会社と労使折半（自己負担50%）で済みます。'
        : '月末より前の退職のため、当月分の社会保険料は徴収されない一方、当月分は国民健康保険・国民年金へ自己全額負担（100%）で加入する必要があります。',
      insuranceType: insuranceType || 'kyokai',
      insuranceTypeNote: INSURANCE_TYPE_NOTES[insuranceType] || null,
    };
  }

  // ---------------------------------------------------------------
  // ⓪ 就業規則アドバイス（民法627条 と 就業規則の申し出期限の関係）
  // ---------------------------------------------------------------
  function buildResignationNoticeAdvice() {
    return {
      title: '退職の申し出はいつまでにすべき？',
      body: '民法上は、期間の定めのない雇用契約であれば申し出から2週間の経過で退職できます（民法第627条第1項）。ただし多くの会社の就業規則には「1か月前まで」等の独自ルールがあり、円満退職のためには法律より就業規則を優先して早めに相談するのが実務上の目安です。まずは会社の就業規則を確認し、直属の上司に事前相談しましょう。',
    };
  }

  /**
   * 月をまたぐ減算を、対象月に存在しない日付（例：3/31の1か月前→2/31）に
   * ならないよう月末でクランプして行う。
   */
  function subMonthsClamped(date, months) {
    const targetMonthIndex = date.getMonth() - months;
    const lastDayOfTargetMonth = new Date(date.getFullYear(), targetMonthIndex + 1, 0).getDate();
    const day = Math.min(date.getDate(), lastDayOfTargetMonth);
    return new Date(date.getFullYear(), targetMonthIndex, day);
  }

  /**
   * 上司へ退職を切り出す目安日。
   * 通常は理想の退職日の1か月前だが、有休消化が多く最終出社日の方が
   * それより早く来る場合は、出社しているうちに伝える必要があるため
   * 最終出社日を目安日として採用する（在籍していない日には伝えられないため）。
   *
   * @param {Date} recommendedDate 理想の退職日
   * @param {Date} lastWorkDay 最終出社日
   */
  function calcNoticeDate(recommendedDate, lastWorkDay) {
    const oneMonthBefore = subMonthsClamped(recommendedDate, 1);
    const clampedByLastWorkDay = lastWorkDay.getTime() < oneMonthBefore.getTime();
    const date = clampedByLastWorkDay ? lastWorkDay : oneMonthBefore;
    return { date, dateLabel: fmtJP(date), clampedByLastWorkDay };
  }

  // ---------------------------------------------------------------
  // 定年退職の情報アドバイス（1か月前退職の可能性 ＋ 同日得喪特例）
  // ---------------------------------------------------------------
  /**
   * 定年退職は多くの場合、就業規則で退職日そのものが定められているため、
   * このツールが自動で「1か月前に繰り上げてください」と断定するのは不適切。
   * そのため数値計算には反映せず、労務担当者への確認を促す情報アドバイスとして提供する。
   */
  function buildMandatoryRetirementAdvice() {
    return {
      title: '定年退職をご検討の方へ（1か月前退職のメリット ＆ 同日得喪特例）',
      body: '定年到達月の1か月前（前月末）に退職日を設定できる場合、就業規則や退職金規程の条件によっては「退職所得控除の勤続年数計算」や「社会保険料の1か月分折半」で手取りが多くなることがあります。就業規則で退職日が固定されている場合は対象外なので、まずは労務担当者に確認しましょう。また、定年後に同じ会社で再雇用（嘱託等）される場合は、社会保険の「同日得喪（資格喪失と再取得を同時に行い、給与減額に合わせて1か月目から保険料を引き下げる特例）」の手続き予定もあわせて確認しましょう。',
    };
  }

  // ---------------------------------------------------------------
  // 企業型DC（確定拠出年金）の移管期限
  // ---------------------------------------------------------------
  /**
   * 退職日翌日（資格喪失日）から6か月以内にiDeCoまたは転職先の企業型DCへの
   * 移管手続きをしないと、自動的に国民年金基金連合会へ自動移管され、
   * 運用が停止したうえ手数料がかかり続ける。
   * @param {Date} resignDate 退職日（理想の退職日を渡すこと）
   */
  function calcDcDeadline(resignDate) {
    const startDate = addDays(resignDate, 1);
    const deadline = addMonthsSafe(startDate, 6);
    return { startDate, deadline, deadlineLabel: fmtJP(deadline) };
  }

  // ---------------------------------------------------------------
  // 退職金・退職所得申告書（20.42%源泉徴収回避）＆ 勤続1年未満切り上げ
  // ---------------------------------------------------------------
  function buildRetirementPayAdvice() {
    return {
      taskTitle: '「退職所得の受給に関する申告書」を提出する',
      taskBody: '退職日までに会社へ提出してください。未提出だと退職金に20.42%の一律課税がされ、本来より手取りが一時的に大きく減ってしまいます（後日確定申告で還付は受けられますが、まずは提出しておくのが確実です）。',
      note: '退職所得控除の計算に使う勤続年数は「1年未満の端数を切り上げ」て計算します（例：勤続20年3か月→21年として控除額を計算）。この分、控除額が有利になります。',
    };
  }

  // ---------------------------------------------------------------
  // 進路別の実務期限（転職／療養・無職／独立で異なる「次にやること」）
  // ---------------------------------------------------------------
  /**
   * 療養・無職：国民健康保険・国民年金の切替手続き期限（資格喪失日から原則14日以内）。
   */
  function calcInsuranceSwitchDeadline(lossDate) {
    const deadline = addDays(lossDate, 14);
    return { from: lossDate, fromLabel: fmtJP(lossDate), to: deadline, toLabel: fmtJP(deadline) };
  }

  /**
   * 独立：青色申告承認申請書の提出期限の目安。
   * 原則は開業日から2か月以内。ただし1/1〜1/15に開業した場合のみ、
   * その年の3/15まで（＝2か月ルールより遅い期限）を使える特例がある。
   * 開業日は個別に把握できないため、退職日の翌日を「開業準備を始める日」の目安として計算する。
   */
  function calcBlueFormDeadline(resignDate) {
    const assumedStartDate = addDays(resignDate, 1);
    const twoMonthsLater = (() => {
      const d = new Date(assumedStartDate);
      d.setMonth(d.getMonth() + 2);
      return d;
    })();
    const isJan1to15 = assumedStartDate.getMonth() === 0 && assumedStartDate.getDate() <= 15;
    const deadline = isJan1to15
      ? new Date(assumedStartDate.getFullYear(), 2, 15)
      : twoMonthsLater;
    return { assumedStartDate, deadline, deadlineLabel: fmtJP(deadline) };
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

  /**
   * 特定の退職日を選んだ場合の、当月ぶん社会保険料の自己負担額（月額）を返す。
   * 月末退職なら労使折半（低い方）、月末より前なら自己全額負担相当（高い方＝2倍）。
   * calcInsuranceOptimization は「常に月末と比較した場合の差」を返す設計のため、
   * 任意の日付（推奨日が入社日の制約で月末にならない場合など）についても
   * 実額を求められるよう、この関数を独立して用意する。
   */
  function calcInsuranceMonthlyCost(date, grade) {
    return isLastDayOfMonth(date) ? grade.employeeMonthlyBurden : grade.employeeMonthlyBurden * 2;
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
  // ⑤ 年収→月給の簡易換算（標準報酬月額の推定に使う）
  // ---------------------------------------------------------------
  /**
   * 年収（賞与込み）を12等分して月給の概算値を出す。
   * 標準報酬月額は本来「賞与を除いた月々の固定給」で決まるため、
   * 賞与の割合が大きい人ほどこの概算は実額より高めに出る点に注意。
   */
  function estimateMonthlyFromAnnual(annualIncomeYen) {
    const annual = Math.max(0, Number(annualIncomeYen) || 0);
    return Math.round(annual / 12);
  }

  // ---------------------------------------------------------------
  // ⑥ 社会保険の空白期間判定（次の入社日が分かっている場合）
  // ---------------------------------------------------------------
  /**
   * @param {Date} resignDateForGap 空白期間の起点とする退職日（推奨退職日など）
   * @param {string|null} nextJoinDateStr 次の入社予定日 'YYYY-MM-DD'（未入力ならnull）
   */
  function calcInsuranceGap(resignDateForGap, nextJoinDateStr) {
    if (!nextJoinDateStr) return null;
    const nextJoin = parseDate(nextJoinDateStr);
    const lossDate = addDays(resignDateForGap, 1); // 資格喪失日 = 退職日の翌日
    const gapDays = Math.round((nextJoin.getTime() - lossDate.getTime()) / 86400000);

    if (gapDays === 0) {
      return { type: 'none', days: 0, nextJoinLabel: fmtJP(nextJoin) };
    }
    if (gapDays > 0) {
      return { type: 'gap', days: gapDays, nextJoinLabel: fmtJP(nextJoin) };
    }
    return { type: 'overlap', days: Math.abs(gapDays), nextJoinLabel: fmtJP(nextJoin) };
  }

  // ---------------------------------------------------------------
  // ⑦ ボーナス（賞与）の支給日在籍判定
  // ---------------------------------------------------------------
  /**
   * 賞与規程の「支給日在籍要件」に基づき、指定した退職日でボーナスを
   * 受け取れるかを判定する。退職日（雇用契約上の最終在籍日）が支給日以降で
   * あれば支給日にまだ在籍しているため対象、支給日より前ならすでに退職済みのため対象外。
   *
   * @param {Date} date 判定したい退職日
   * @param {string|null} bonusDateStr 次回ボーナス支給予定日 'YYYY-MM-DD'（未入力ならnull）
   * @param {number|null} bonusAmountYen ボーナス見込み額（円）（未入力ならnull）
   */
  function calcBonusImpact(date, bonusDateStr, bonusAmountYen) {
    if (!bonusDateStr || !bonusAmountYen) return null;
    const bonusDate = parseDate(bonusDateStr);
    const amount = Math.max(0, Number(bonusAmountYen) || 0);
    const willReceive = date.getTime() >= bonusDate.getTime();
    return { bonusDate, bonusDateLabel: fmtJP(bonusDate), amount, willReceive };
  }

  // ---------------------------------------------------------------
  // ⑧ おすすめ退職日の統合判定
  // ---------------------------------------------------------------
  /**
   * 「結局いつ辞めればいいか」への単一の結論を返す。優先順位は次のとおり。
   *   1. 次の入社日が確定している場合は、その前日を超える日付は選べない（絶対条件）
   *   2. ボーナス支給日が①の制約内に収まるなら、支給日以降の最初の月末まで繰り下げる
   *      （ボーナス額は通常、社会保険料の差より大きいため優先する）
   *   3. 上記いずれもなければ、社会保険料が最適な月末退職日を推奨する
   *
   * @param {Date} resignDate 今考えている退職日
   * @param {string|null} nextJoinDateStr 次の入社予定日
   * @param {object} insuranceOptimization calcInsuranceOptimization() の結果
   * @param {string|null} bonusDateStr 次回ボーナス支給予定日
   */
  function calcRecommendedResignDate(resignDate, nextJoinDateStr, insuranceOptimization, bonusDateStr) {
    const ceiling = nextJoinDateStr ? addDays(parseDate(nextJoinDateStr), -1) : null;
    let candidate = insuranceOptimization.optimalDate;
    let bonusConflict = null; // 'unreachable'（入社日の制約でボーナス支給日まで待てない） | null

    if (bonusDateStr) {
      const bonusDate = parseDate(bonusDateStr);
      if (ceiling && bonusDate.getTime() > ceiling.getTime()) {
        bonusConflict = 'unreachable';
      } else if (candidate.getTime() < bonusDate.getTime()) {
        // lastDayOfMonth(bonusDate) は定義上つねに bonusDate 以降になるため、
        // 支給日を含む月の月末まで繰り下げれば必ず支給日以降になる。
        candidate = lastDayOfMonth(bonusDate);
      }
    }

    let limitedByNextJob = false;
    if (ceiling && candidate.getTime() > ceiling.getTime()) {
      candidate = ceiling;
      limitedByNextJob = true;
    }

    return {
      date: candidate,
      dateLabel: fmtJP(candidate),
      limitedByNextJob,
      bonusConflict,
      isSameAsUserPlan: fmtISO(candidate) === fmtISO(resignDate),
    };
  }

  // ---------------------------------------------------------------
  // ⑨ 退職日を変えることによる損得（社会保険料 + ボーナス）
  // ---------------------------------------------------------------
  /**
   * 「今考えている日」のまま退職した場合と、「理想の退職日」にした場合とで、
   * 実際に手元に残るお金がいくら変わるかを計算する。
   * 有給休暇の金銭的価値は、消化する日数が同じである限りどちらの日付でも
   * 変わらないため、この損得計算には含めない（別途「参考情報」として扱う）。
   *
   * @param {Date} userResignDate 今考えている退職日
   * @param {Date} recommendedDate 理想の退職日（calcRecommendedResignDate の結果）
   * @param {object} grade calcStandardRemunerationGrade() の結果
   * @param {string|null} bonusDateStr 次回ボーナス支給予定日
   * @param {number|null} bonusAmountYen ボーナス見込み額（円）
   */
  function calcResignDateGainLoss(userResignDate, recommendedDate, grade, bonusDateStr, bonusAmountYen) {
    const userInsuranceCost = calcInsuranceMonthlyCost(userResignDate, grade);
    const recommendedInsuranceCost = calcInsuranceMonthlyCost(recommendedDate, grade);
    const insuranceDelta = userInsuranceCost - recommendedInsuranceCost; // 正なら理想日の方が安く済む

    const userBonus = calcBonusImpact(userResignDate, bonusDateStr, bonusAmountYen);
    const recommendedBonus = calcBonusImpact(recommendedDate, bonusDateStr, bonusAmountYen);
    const userBonusYen = userBonus && userBonus.willReceive ? userBonus.amount : 0;
    const recommendedBonusYen = recommendedBonus && recommendedBonus.willReceive ? recommendedBonus.amount : 0;
    const bonusDelta = recommendedBonusYen - userBonusYen; // 正なら理想日の方がボーナスを受け取れる

    return {
      insuranceDelta,
      bonusDelta,
      totalDelta: insuranceDelta + bonusDelta,
      userBonus,
      recommendedBonus,
    };
  }

  // ---------------------------------------------------------------
  // ⑧ 進路3分岐ごとの文脈型ノート（Critical Alert × Solution ペア／一般Caution）
  // ---------------------------------------------------------------
  /**
   * v10.0仕様書に準拠。外部PR・アフィリエイトリンクは一切含まず、
   * 純粋なテキストアドバイスのみを返す（旧 monetize フィールドは廃止）。
   * critical: Crimson Red 警告。存在する場合は必ず Emerald Green の solution とペアで返す。
   * caution: Amber Yellow の一般注意（住民税一括徴収等）。
   */
  function getBranchContext(branch) {
    const CONTEXT = {
      transfer: {
        label: '①転職',
        caution: {
          title: '住民税の一括徴収に注意',
          description: '退職月によっては、翌年5月分までの住民税が最後の給与や退職金から一括徴収されることがあります。手取り額を見込むときは差し引いて考えましょう。',
        },
        critical: null,
      },
      recuperation: {
        label: '②療養・無職',
        caution: null,
        critical: {
          title: '傷病手当金の受給資格を失うリスク',
          description: '退職日に一日でも出社すると「労務不能」と認められず、退職後の傷病手当金継続受給ができなくなる場合があります。',
          solutionTitle: '退職日は出社しないスケジュールにする',
          solutionDescription: '体調を優先し、退職日当日は出社しないよう調整しましょう。引き継ぎや会社への連絡はそれより前に済ませておくと安心です。',
        },
      },
      independence: {
        label: '③独立',
        caution: null,
        critical: {
          title: '再就職手当の受給資格を失うリスク',
          description: 'ハローワークで受給資格が決定してから1か月以内に開業届を提出すると、再就職手当を受け取れなくなる場合があります。',
          solutionTitle: '受給資格決定日を確認してから開業届を出す',
          solutionDescription: 'ハローワークで受給資格決定日を確認し、そこから1か月が経過してから開業届を提出すると、再就職手当の対象から外れずに済む可能性があります。',
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
    parseSafeDate,
    fmtJP,
    fmtISO,
    addDays,
    addMonthsSafe,
    lastDayOfMonth,
    isLastDayOfMonth,
    calcQualificationLossDate,
    buildResignationNoticeAdvice,
    buildMandatoryRetirementAdvice,
    calcDcDeadline,
    buildRetirementPayAdvice,
    calcNoticeDate,
    calcInsuranceSwitchDeadline,
    calcBlueFormDeadline,
    calcStandardRemunerationGrade,
    calcPaidLeaveBackward,
    calcLastWorkDayByCount,
    estimateMonthlyFromAnnual,
    calcInsuranceGap,
    calcBonusImpact,
    calcRecommendedResignDate,
    calcResignDateGainLoss,
    calcInsuranceOptimization,
    calcInsuranceMonthlyCost,
    calcTakeHomeImpact,
    getBranchContext,
    judgeBranch,
  };
})(window);
