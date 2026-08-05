/**
 * constants.js
 * 「トク退」料率・法定金額マスタ Ver.17.2
 * 年度改定はこのファイルの書き換えのみで完結させる（計算ロジック本体には手を入れない）。
 *
 * 出典:
 *   - 協会けんぽ「令和8年度都道府県毎の保険料率」
 *     https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/rate_prefectures/r08/index.html
 *   - こども家庭庁・協会けんぽ「子ども・子育て支援金制度」（令和8年4月分〜）
 *   - 国税庁「給与所得の源泉徴収税額表」令和8年分／令和8年度税制改正大綱（基礎控除・給与所得控除の時限特例）
 *   - 日本年金機構「国民年金保険料」令和8年度
 *
 * 最終更新: 2026-08-05
 * ⚠️ 毎年2〜3月に必ず最新値を一次情報で確認し更新すること
 * window.TokutaiConstants として公開。
 */
(function (global) {
  'use strict';

  const RATE_MASTER = {
    // 適用年度（表示用）
    fiscalYear: '令和8年度（2026年度）',
    lastVerified: '2026-08-05',

    // ---- 厚生年金保険 ----
    pension: {
      totalRate: 0.183,          // 労使合算 18.3%（平成29年9月以降固定）
      employeeRate: 0.0915,      // 本人負担 9.15%
    },

    // ---- 健康保険（協会けんぽ）----
    health: {
      // 都道府県別。令和8年度は 9.21%（新潟）〜10.55%（佐賀）
      nationalAverageTotal: 0.099,     // 全国平均 9.9%（労使合算・目安）
      nationalAverageEmployee: 0.0495, // 全国平均 本人負担 4.95%
      // 都道府県別テーブルは PREFECTURE_HEALTH_RATES に定義（下記）
    },

    // ---- 子ども・子育て支援金（v17.2仕様書には未記載・追加確認のうえ計算に組み込み）----
    // 令和8年4月分（5月納付分）から健康保険料に上乗せして徴収開始。全国一律・労使折半。
    // 標準報酬月額 × 0.23% の折半額（0.115%）が本人負担。
    childcareSupportLevy: {
      totalRate: 0.0023,       // 全国一律 0.23%（労使合算）
      employeeRate: 0.00115,   // 本人負担 0.115%
      startYearMonth: '2026-04',
    },

    // ---- 介護保険（第2号被保険者：40歳以上65歳未満）----
    nursingCare: {
      totalRate: 0.0162,         // 全国一律 1.62%（令和8年度、令和7年度1.59%から改定）
      employeeRate: 0.0081,      // 本人負担 0.81%
      ageFrom: 40,
      ageTo: 65,                 // 65歳到達で第1号被保険者となり給与天引き対象外
    },

    // ---- 国民年金（第1号被保険者）----
    nationalPension: {
      monthlyPremium: 17920,     // 令和8年度 月額17,920円
      nextYearPremium: 18290,    // 令和9年度 月額18,290円（参考）
    },

    // ---- 国民健康保険（レンジ推定用）----
    // ⚠️ 国保料は自治体ごとに料率・均等割額が異なり、点推定は原理的に不可能。
    //    必ずレンジで提示すること（第5章参照）。
    nationalHealthInsurance: {
      // 所得割率（医療分＋後期高齢者支援金分の合算）の全国的な分布
      incomeRateMin: 0.085,
      incomeRateMax: 0.115,
      // 介護分（40〜64歳のみ加算）の所得割率
      nursingIncomeRateMin: 0.015,
      nursingIncomeRateMax: 0.025,
      // 均等割（1人あたり年額）の全国的な分布
      perCapitaMin: 45000,
      perCapitaMax: 75000,
      // 介護分の均等割（40〜64歳のみ）
      nursingPerCapitaMin: 14000,
      nursingPerCapitaMax: 22000,
      // 給与所得控除後の所得から差し引く基礎控除（住民税の基礎控除に準拠）
      basicDeduction: 430000,
    },

    // ---- 非自発的失業者の国民健康保険料軽減措置 ----
    involuntaryUnemploymentReduction: {
      // 前年の「給与所得」を100分の30とみなして算定する
      incomeMultiplier: 0.30,
      // 対象年齢（離職時）
      maxAge: 65,
      // 対象：雇用保険の特定受給資格者および特定理由離職者
      eligibleReasons: ['company', 'contract_end', 'specific_reason'],
      // 軽減期間：離職日の翌日が属する月から、その月が属する年度の翌年度末まで
      periodDescription: '離職日の翌日が属する月から、その月が属する年度の翌年度末まで',
    },

    // ---- 住民税 ----
    residentTax: {
      // 所得割：市町村民税6% + 道府県民税4% = 10%（標準税率）
      incomeRate: 0.10,
      // 均等割の目安（自治体差あり。年額）
      perCapitaAmount: 5000,
      // 特別徴収期間：6月〜翌年5月
      specialCollectionStartMonth: 6,
      specialCollectionEndMonth: 5,
    },

    // ---- 給与所得控除 速算表（令和8年分・令和9年分の時限特例込み）----
    // ⚠️ 最低保障74万円（本則69万円＋時限特例5万円）は令和8・9年分限定の措置。
    //    令和10年分以降は本則の金額に戻る可能性が高いため、更新時は必ず最新の速算表を確認すること。
    // 収入金額が maxIncome 以下の最初のブラケットを適用する。
    // formula:'minimum' は収入によらず minimumDeduction を固定適用。
    // formula:'linear' は 収入 × rate + addAmount で算出。
    // formula:'cap' は収入によらず capAmount を固定適用（上限）。
    salaryIncomeDeduction: {
      minimumDeduction: 740000, // 収入220万円以下は一律この額
      brackets: [
        { maxIncome: 2_200_000, formula: 'minimum' },
        { maxIncome: 3_600_000, formula: 'linear', rate: 0.30, addAmount: 80000 },   // 収入×30%＋8万円
        { maxIncome: 6_600_000, formula: 'linear', rate: 0.20, addAmount: 440000 },  // 収入×20%＋44万円
        { maxIncome: 8_500_000, formula: 'linear', rate: 0.10, addAmount: 1100000 }, // 収入×10%＋110万円
        { maxIncome: Infinity, formula: 'cap', capAmount: 1950000 },                 // 850万円超は195万円で頭打ち
      ],
    },

    // ---- 退職所得 ----
    retirementIncome: {
      // 「退職所得の受給に関する申告書」未提出時の源泉徴収税率
      withholdingRateWithoutForm: 0.2042,
      deductionPerYearUnder20: 400000,  // 勤続20年以下：40万円/年
      deductionPerYearOver20: 700000,   // 勤続20年超：70万円/年
      deductionBaseOver20: 8000000,     // 勤続20年超：800万円 + 70万円×(勤続-20)
      minimumDeduction: 800000,         // 最低保障額 80万円
    },

    // ---- 雇用保険 ----
    employmentInsurance: {
      waitingPeriodDays: 7,             // 待期期間（法定）
      reformEnforcementDate: '2025-04-01', // 改正雇用保険法 施行日
      highAgeThreshold: 65,             // 高年齢求職者給付金の境界
    },

    // ---- 企業型DC ----
    corporateDC: {
      transferDeadlineMonths: 6,        // 資格喪失日から6ヶ月以内
    },

    // ---- 傷病手当金 ----
    sicknessAllowance: {
      requiredInsuredMonths: 12,        // 資格喪失後の継続給付に必要な被保険者期間
      maxSupportMonths: 18,             // 通算1年6ヶ月
      waitingDays: 3,                   // 待期3日
    },
  };

  // 都道府県別 健康保険料率（協会けんぽ 令和8年度・労使合算）
  // 出典: 協会けんぽ公式サイト「都道府県毎の保険料率」令和8年度（2026年3月分〜）
  // https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/rate_prefectures/r08/index.html
  // ⚠️ 令和8年4月分（5月納付分）から、上記に加えて全国一律の子ども・子育て支援金0.23%が別建てで徴収される
  //    （本テーブルには含めない。加算は RATE_MASTER.childcareSupportLevy を計算時に別途合算すること）
  const PREFECTURE_HEALTH_RATES = {
    '北海道': 0.1028, '青森県': 0.0985, '岩手県': 0.0951, '宮城県': 0.1010,
    '秋田県': 0.1001, '山形県': 0.0975, '福島県': 0.0950, '茨城県': 0.0952,
    '栃木県': 0.0982, '群馬県': 0.0968, '埼玉県': 0.0967, '千葉県': 0.0973,
    '東京都': 0.0985, '神奈川県': 0.0992, '新潟県': 0.0921, '富山県': 0.0959,
    '石川県': 0.0970, '福井県': 0.0971, '山梨県': 0.0955, '長野県': 0.0963,
    '岐阜県': 0.0980, '静岡県': 0.0961, '愛知県': 0.0993, '三重県': 0.0977,
    '滋賀県': 0.0988, '京都府': 0.0989, '大阪府': 0.1013, '兵庫県': 0.1012,
    '奈良県': 0.0991, '和歌山県': 0.1006, '鳥取県': 0.0986, '島根県': 0.0994,
    '岡山県': 0.1005, '広島県': 0.0978, '山口県': 0.1015, '徳島県': 0.1024,
    '香川県': 0.1002, '愛媛県': 0.0998, '高知県': 0.1005, '福岡県': 0.1011,
    '佐賀県': 0.1055, '長崎県': 0.1006, '熊本県': 0.1008, '大分県': 0.1008,
    '宮崎県': 0.0977, '鹿児島県': 0.1013, '沖縄県': 0.0944,
  };

  global.TokutaiConstants = {
    RATE_MASTER,
    PREFECTURE_HEALTH_RATES,
  };
})(window);
