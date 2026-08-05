/**
 * app.js
 * 「トク退」UI制御本体 Ver.17.2（DOM描画・状態管理。計算は行わない）
 *
 * v17.2での構成：
 * - フェーズ1（コア4問）→ 暫定結果 → 精度向上モーダル(A/B/C) → 精密結果、という段階的開示フロー。
 * - 「理想の退職日」の推奨は行わない。ユーザー自身が選んだ退職希望日を基準に、
 *   compareSocialInsuranceByResignDate の3値判定（MONTH_END/BEFORE_MONTH_END/UNCERTAIN）や
 *   各種期限・注意点を提示するのみ。
 * - 体調不調フラグ（inputMentalPhysicalUnfit）はSafeStorageに保存せず、送信もしない。
 */
(function () {
  'use strict';

  const Calc = window.TokutaiCalculator;
  const H = window.HolidaysJP;
  const Schema = window.SchemaGenerator;
  const FaqMaster = window.TokutaiFaqMaster;
  const Glossary = window.TokutaiGlossary;
  const Feedback = window.TokutaiFeedback;

  const STORAGE_KEY = 'tokutai_form_state';
  // 要配慮個人情報：localStorageに保存しない・フィードバック送信もしない
  const NEVER_PERSIST_KEYS = ['isMentalPhysicalUnfit'];

  // ---------------------------------------------------------------
  // SafeStorage：iOS Safariのプライベートブラウジング等でlocalStorageが
  // 例外を投げる環境でも、アプリ全体を落とさないためのラッパー。
  // ---------------------------------------------------------------
  const SafeStorage = (function () {
    let available = true;
    try {
      const testKey = '__tokutai_storage_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
    } catch (e) {
      available = false;
    }
    return {
      isAvailable: () => available,
      getItem(key) {
        if (!available) return null;
        try { return window.localStorage.getItem(key); } catch (e) { return null; }
      },
      setItem(key, value) {
        if (!available) return false;
        try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
      },
      removeItem(key) {
        if (!available) return;
        try { window.localStorage.removeItem(key); } catch (e) { /* noop */ }
      },
    };
  })();

  function createInitialState() {
    return {
      // フェーズ1（コア4問）
      resignDate: null,
      paidLeave: null,
      annualIncome: null,
      branch: null,
      // フェーズ2 グループA
      retireReason: 'personal',
      resignCount5Years: '2_or_less',
      isEnrolledEducation: 'no',
      birthYear: null,
      // フェーズ2 グループB
      prefecture: '東京都',
      insuranceType: 'kyokai',
      afterInsurance: 'kokuho',
      tenureYears: null,
      // フェーズ2 グループC
      isMentalPhysicalUnfit: 'no', // 保存・送信しない（セッション内メモリのみ）
      bonusDate: null,
      bonusAmount: null,
      retirementPay: 'no',
      corporateDC: 'no',
      nextJoinDate: null,
      wantAllowance: 'no',
      handoverDays: 0,
      offDays: [0, 6],
      closedOnHolidays: true,
      // 精度向上フェーズを一度でも開いたか（暫定/精密の切り替え判定用）
      hasPrecisionInput: false,
      // グループごとの入力済みフラグ（精度向上カードのボタンに「入力済み」を出すため）
      groupACompleted: false,
      groupBCompleted: false,
      groupCCompleted: false,
      result: null,
    };
  }

  const state = createInitialState();
  let faqFeedbackState = {}; // faqId -> 'clear'|'unclear'（セッション内のみ、保存しない）

  // ---------------------------------------------------------------
  // 初期化
  // ---------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    Schema.generateWebApplicationSchema();
    restoreFromStorage();
    prefillDefaults();
    populateBirthYearSelect();
    populatePrefectureSelect();
    buildWeekdayGrid();
    bindEvents();
    validateCoreForm();
    updatePrecisionButtons();
    if (state.resignDate && state.paidLeave !== null && state.annualIncome && state.branch) {
      runDiagnosisAndRender();
    }
  });

  function prefillDefaults() {
    const input = document.getElementById('inputResignDate');
    const todayISO = Calc.fmtISO(new Date());
    input.min = todayISO;
    if (state.resignDate) input.value = state.resignDate;
    if (state.paidLeave !== null) document.getElementById('inputPaidLeave').value = state.paidLeave;
    if (state.annualIncome) document.getElementById('inputAnnualIncome').value = state.annualIncome;
    if (state.branch) setBranchPressed(state.branch);

    document.getElementById('inputRetireReason').value = state.retireReason;
    document.getElementById('inputResignCount5Years').value = state.resignCount5Years;
    document.getElementById('inputEnrolledEducation').value = state.isEnrolledEducation;
    document.getElementById('inputPrefecture').value = state.prefecture; // 選択肢投入後に再設定される
    document.getElementById('inputInsuranceType').value = state.insuranceType;
    document.getElementById('inputAfterInsurance').value = state.afterInsurance;
    if (state.tenureYears !== null) document.getElementById('inputTenureYears').value = state.tenureYears;
    document.getElementById('inputMentalPhysicalUnfit').value = state.isMentalPhysicalUnfit;
    if (state.bonusDate) {
      document.getElementById('inputBonusDate').value = state.bonusDate;
      document.getElementById('bonusAmountField').hidden = false;
    }
    if (state.bonusAmount) document.getElementById('inputBonusAmount').value = state.bonusAmount;
    document.getElementById('inputRetirementPay').value = state.retirementPay;
    document.getElementById('inputCorporateDC').value = state.corporateDC;
    if (state.nextJoinDate) document.getElementById('inputNextJoinDate').value = state.nextJoinDate;
    document.getElementById('inputWantAllowance').value = state.wantAllowance;
    document.getElementById('inputHandoverDays').value = state.handoverDays;
    document.getElementById('holidayOnBtn').setAttribute('aria-pressed', String(state.closedOnHolidays !== false));
    document.getElementById('holidayOffBtn').setAttribute('aria-pressed', String(state.closedOnHolidays === false));
    updateGroupCConditionalFields();
  }

  function populateBirthYearSelect() {
    const select = document.getElementById('inputBirthYear');
    const thisYear = new Date().getFullYear();
    const frag = document.createDocumentFragment();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '選択してください';
    placeholder.disabled = true;
    if (!state.birthYear) placeholder.selected = true;
    frag.appendChild(placeholder);
    for (let y = thisYear - 18; y >= thisYear - 80; y--) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = `${y}年（${thisYear - y}歳前後）`;
      if (state.birthYear === y) opt.selected = true;
      frag.appendChild(opt);
    }
    select.appendChild(frag);
  }

  function populatePrefectureSelect() {
    const select = document.getElementById('inputPrefecture');
    const prefectures = Object.keys(window.TokutaiConstants.PREFECTURE_HEALTH_RATES);
    const frag = document.createDocumentFragment();
    prefectures.forEach(pref => {
      const opt = document.createElement('option');
      opt.value = pref;
      opt.textContent = pref;
      if (state.prefecture === pref) opt.selected = true;
      frag.appendChild(opt);
    });
    select.appendChild(frag);
  }

  // ---------------------------------------------------------------
  // イベント配線
  // ---------------------------------------------------------------
  function bindEvents() {
    // フェーズ1
    document.getElementById('inputResignDate').addEventListener('change', e => {
      const todayISO = Calc.fmtISO(new Date());
      if (e.target.value < todayISO) e.target.value = todayISO;
      state.resignDate = e.target.value || null;
      saveToStorage();
      validateCoreForm();
    });
    document.getElementById('resignDateChips').addEventListener('click', e => {
      const chip = e.target.closest('.qc-chip');
      if (chip) applyQuickResignDate(chip.dataset.quick);
    });
    document.getElementById('inputPaidLeave').addEventListener('input', e => {
      state.paidLeave = e.target.value === '' ? null : e.target.value;
      saveToStorage();
      validateCoreForm();
    });
    document.getElementById('paidLeaveChips').addEventListener('click', e => {
      const chip = e.target.closest('.qc-chip');
      if (!chip) return;
      document.getElementById('inputPaidLeave').value = chip.dataset.quickLeave;
      state.paidLeave = chip.dataset.quickLeave;
      saveToStorage();
      validateCoreForm();
    });
    document.getElementById('inputAnnualIncome').addEventListener('change', e => {
      state.annualIncome = e.target.value || null;
      saveToStorage();
      validateCoreForm();
    });
    document.querySelectorAll('#branchSelector .branch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.branch = btn.dataset.branch;
        setBranchPressed(state.branch);
        updateGroupCConditionalFields();
        saveToStorage();
        validateCoreForm();
      });
    });
    document.getElementById('btnShowResult').addEventListener('click', () => {
      runDiagnosisAndRender();
      document.getElementById('resultScreen').scrollIntoView({ behavior: 'smooth' });
    });

    // 精度向上モーダルの開閉
    document.getElementById('btnOpenGroupA').addEventListener('click', () => openModal('modalGroupA'));
    document.getElementById('btnOpenGroupB').addEventListener('click', () => openModal('modalGroupB'));
    document.getElementById('btnOpenGroupC').addEventListener('click', () => openModal('modalGroupC'));
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
    });
    document.querySelectorAll('[data-apply-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyModalInputs(btn.dataset.applyModal);
        closeModal(btn.dataset.applyModal);
        state.hasPrecisionInput = true;
        saveToStorage();
        runDiagnosisAndRender();
      });
    });

    // グループC内の条件付き表示
    document.getElementById('inputBonusDate').addEventListener('change', e => {
      document.getElementById('bonusAmountField').hidden = !e.target.value;
    });
    document.getElementById('inputRetireReason').addEventListener('change', updateGroupAConditionalFields);
    updateGroupAConditionalFields();

    // 会社独自の休日設定（グループC内アコーディオン）
    document.getElementById('holidayOnBtn').addEventListener('click', () => setHolidayOff(true));
    document.getElementById('holidayOffBtn').addEventListener('click', () => setHolidayOff(false));

    // 印刷・シェア・リセット
    document.getElementById('btnPrint').addEventListener('click', () => window.print());
    // 印刷直前に、実際に開かれた用語だけをミニ辞典へ反映する
    window.addEventListener('beforeprint', renderGlossaryAppendix);
    document.getElementById('btnShareX').addEventListener('click', onShareX);
    document.getElementById('btnRestart').addEventListener('click', onRestart);

    // 上司連絡テンプレートモーダル
    document.getElementById('btnOpenTemplateModal').addEventListener('click', openTemplateModal);
    document.getElementById('btnCopyTemplate').addEventListener('click', onCopyTemplate);

    // マイクロフィードバック（入口A）
    document.getElementById('feedbackMicro').addEventListener('click', e => {
      const btn = e.target.closest('[data-fb]');
      if (btn) onMicroFeedback(btn.dataset.fb);
    });

    // フッター報告リンク（入口C）
    document.getElementById('btnReportError').addEventListener('click', e => {
      e.preventDefault();
      openFeedbackModal('feature_request');
    });
    document.getElementById('btnSendFeedback').addEventListener('click', onSendFeedback);

    // 用語ポップオーバーを閉じる
    document.getElementById('term-popover').querySelector('.term-close').addEventListener('click', closeTermPopover);
    document.addEventListener('click', e => {
      const popover = document.getElementById('term-popover');
      if (popover.classList.contains('hidden')) return;
      if (!popover.contains(e.target) && !e.target.closest('.term-trigger')) closeTermPopover();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeTermPopover();
    });
  }

  function setBranchPressed(branch) {
    document.querySelectorAll('#branchSelector .branch-btn').forEach(b => {
      const active = b.dataset.branch === branch;
      b.setAttribute('aria-pressed', String(active));
    });
  }

  function applyQuickResignDate(kind) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let target;
    if (kind === '2weeks') target = Calc.addDays(today, 14);
    else if (kind === 'thisMonthEnd') target = Calc.lastDayOfMonth(today);
    else if (kind === 'nextMonthEnd') target = Calc.lastDayOfMonth(Calc.addDays(Calc.lastDayOfMonth(today), 1));
    else return;
    const iso = Calc.fmtISO(target);
    document.getElementById('inputResignDate').value = iso;
    state.resignDate = iso;
    saveToStorage();
    validateCoreForm();
  }

  function setHolidayOff(value) {
    state.closedOnHolidays = value;
    document.getElementById('holidayOnBtn').setAttribute('aria-pressed', String(value === true));
    document.getElementById('holidayOffBtn').setAttribute('aria-pressed', String(value === false));
    saveToStorage();
  }

  function buildWeekdayGrid() {
    const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
    const grid = document.getElementById('weekdayGrid');
    grid.innerHTML = '';
    DOW_JA.forEach((label, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wd-btn';
      btn.textContent = label;
      btn.setAttribute('aria-pressed', state.offDays.includes(i) ? 'true' : 'false');
      btn.setAttribute('aria-label', `${label}曜日を定休日にする`);
      btn.addEventListener('click', () => {
        const idx = state.offDays.indexOf(i);
        if (idx !== -1) {
          if (state.offDays.length <= 1) return;
          state.offDays.splice(idx, 1);
        } else {
          state.offDays.push(i);
        }
        btn.setAttribute('aria-pressed', state.offDays.includes(i) ? 'true' : 'false');
        saveToStorage();
      });
      grid.appendChild(btn);
    });
  }

  // ---------------------------------------------------------------
  // モーダル制御（<dialog> のネイティブ機能を利用）
  // ---------------------------------------------------------------
  function openModal(id) {
    document.getElementById(id).showModal();
  }
  function closeModal(id) {
    document.getElementById(id).close();
  }

  function applyModalInputs(id) {
    if (id === 'modalGroupA') {
      state.retireReason = document.getElementById('inputRetireReason').value;
      state.resignCount5Years = document.getElementById('inputResignCount5Years').value;
      state.isEnrolledEducation = document.getElementById('inputEnrolledEducation').value;
      const by = document.getElementById('inputBirthYear').value;
      state.birthYear = by ? Number(by) : null;
      state.groupACompleted = true;
    } else if (id === 'modalGroupB') {
      state.prefecture = document.getElementById('inputPrefecture').value;
      state.insuranceType = document.getElementById('inputInsuranceType').value;
      state.afterInsurance = document.getElementById('inputAfterInsurance').value;
      const ty = document.getElementById('inputTenureYears').value;
      state.tenureYears = ty === '' ? null : Number(ty);
      state.groupBCompleted = true;
    } else if (id === 'modalGroupC') {
      // 体調不調フラグはstateのセッション内メモリにのみ保持（保存・送信しない）
      state.isMentalPhysicalUnfit = document.getElementById('inputMentalPhysicalUnfit').value;
      state.bonusDate = document.getElementById('inputBonusDate').value || null;
      state.bonusAmount = document.getElementById('inputBonusAmount').value || null;
      state.retirementPay = document.getElementById('inputRetirementPay').value;
      state.corporateDC = document.getElementById('inputCorporateDC').value;
      state.nextJoinDate = document.getElementById('inputNextJoinDate').value || null;
      state.wantAllowance = document.getElementById('inputWantAllowance').value;
      state.handoverDays = document.getElementById('inputHandoverDays').value || 0;
      state.groupCCompleted = true;
    }
    updatePrecisionButtons();
  }

  /** 精度向上カードの各ボタンに、入力済みかどうかを分かる形で反映する */
  function updatePrecisionButtons() {
    const map = [
      ['btnOpenGroupA', state.groupACompleted],
      ['btnOpenGroupB', state.groupBCompleted],
      ['btnOpenGroupC', state.groupCCompleted],
    ];
    map.forEach(([btnId, completed]) => {
      const btn = document.getElementById(btnId);
      const sub = btn.querySelector('.pu-sub');
      btn.classList.toggle('pu-btn-done', completed);
      if (completed) {
        sub.textContent = '✓ 入力済み';
      } else {
        sub.textContent = sub.dataset.defaultLabel;
      }
    });
  }

  function updateGroupAConditionalFields() {
    const reason = document.getElementById('inputRetireReason').value;
    document.getElementById('resignCountField').hidden = reason !== 'personal';
    document.getElementById('educationField').hidden = reason !== 'personal';
  }

  function updateGroupCConditionalFields() {
    document.getElementById('mentalUnfitField').hidden = state.branch !== 'recuperation';
    document.getElementById('nextJoinDateField').hidden = state.branch !== 'transfer';
    document.getElementById('wantAllowanceField').hidden = state.branch !== 'independence';
    if (state.branch !== 'transfer' && state.nextJoinDate) {
      state.nextJoinDate = null;
      document.getElementById('inputNextJoinDate').value = '';
    }
    if (state.branch !== 'independence' && state.wantAllowance !== 'no') {
      state.wantAllowance = 'no';
      document.getElementById('inputWantAllowance').value = 'no';
    }
  }

  // ---------------------------------------------------------------
  // フェーズ1バリデーション
  // ---------------------------------------------------------------
  function validateCoreForm() {
    const valid = !!state.resignDate && state.paidLeave !== null && state.paidLeave !== ''
      && Number(state.paidLeave) >= 0 && Number(state.paidLeave) <= 60
      && !!state.annualIncome && !!state.branch;
    document.getElementById('btnShowResult').disabled = !valid;
    return valid;
  }

  function buildBusinessDayChecker() {
    return H.createBusinessDayChecker({
      offDays: state.offDays,
      closedOnHolidays: state.closedOnHolidays,
      extraOffDates: [],
      extraWorkDates: [],
    });
  }

  // ---------------------------------------------------------------
  // 試算実行
  // ---------------------------------------------------------------
  function runDiagnosisAndRender() {
    if (!validateCoreForm()) return;

    const resignDate = Calc.parseDate(state.resignDate);
    const age = state.birthYear ? Calc.calcAge(state.birthYear) : null;
    const checker = buildBusinessDayChecker();

    const paidLeaveResult = Calc.calcPaidLeaveBackward(resignDate, state.paidLeave, checker, state.handoverDays);
    const noticeDate = Calc.calcNoticeDate(resignDate, paidLeaveResult.lastWorkDay);
    const qualification = Calc.calcQualificationLossDate(resignDate, state.insuranceType);

    // 社会保険料比較（都道府県・年齢が未入力の場合は全国平均・年齢不明扱いで暫定計算）
    const compareInput = {
      annualIncome: state.annualIncome,
      prefecture: state.prefecture,
      age: age === null ? 40 : age, // 未入力時は仮に40歳（介護保険なし側）で暫定表示。精密結果には反映されない旨をUIで明示
      afterInsurance: state.afterInsurance,
      retireReason: state.retireReason,
      isMentalPhysicalUnfit: state.isMentalPhysicalUnfit,
      spouseCoveredByEmployeesPension: undefined,
    };
    const insuranceComparison = Calc.compareSocialInsuranceByResignDate(compareInput);
    const residentTaxImpact = Calc.calculateResidentTaxImpact(resignDate, state.annualIncome);

    const restrictionInput = {
      retireDateStr: state.resignDate,
      retireReason: state.retireReason,
      resignCount5Years: state.resignCount5Years,
      isEnrolledEducation: state.isEnrolledEducation,
      age: age === null ? 30 : age,
    };
    const unemploymentRestriction = Calc.calculateUnemploymentRestriction(restrictionInput);

    const sicknessEligibility = Calc.judgeSicknessAllowanceEligibility({
      tenureYears: state.tenureYears === null ? 99 : state.tenureYears,
      isMentalPhysicalUnfit: state.isMentalPhysicalUnfit,
    });

    const retirementIncomeTax = state.retirementPay === 'yes' && state.bonusAmount
      ? null // 退職金額の入力はフェーズ2に存在しないため、金額試算は行わず注意喚起のみ行う
      : null;

    const dcDeadline = state.corporateDC === 'yes' ? Calc.calcDcDeadline(resignDate) : null;
    const insuranceGap = state.branch === 'transfer' ? Calc.calcInsuranceGap(resignDate, state.nextJoinDate) : null;
    const bonusEligibility = Calc.judgeBonusEligibility(resignDate, state.bonusDate, state.bonusAmount);

    let openingDateAdvice = null;
    if (state.branch === 'independence') {
      openingDateAdvice = Calc.calculateRecommendedOpeningDate(resignDate, unemploymentRestriction);
    }

    state.result = {
      resignDate,
      resignDateLabel: Calc.fmtJP(resignDate),
      lastWorkDay: paidLeaveResult.lastWorkDay,
      lastWorkDayLabel: Calc.fmtJP(paidLeaveResult.lastWorkDay),
      paidLeaveStartDay: paidLeaveResult.paidLeaveStartDay,
      paidLeaveStartLabel: paidLeaveResult.paidLeaveStartDay ? Calc.fmtJP(paidLeaveResult.paidLeaveStartDay) : null,
      noticeDate,
      qualification,
      insuranceComparison,
      residentTaxImpact,
      unemploymentRestriction,
      sicknessEligibility,
      dcDeadline,
      insuranceGap,
      bonusEligibility,
      openingDateAdvice,
      branch: state.branch,
      wantAllowance: state.wantAllowance,
      retirementPay: state.retirementPay,
      isPrecise: state.hasPrecisionInput,
      ageProvided: age !== null,
    };

    Schema.generateHowToSchema(state.result);
    const visibleFaqs = getContextualFaqs();
    Schema.generateFAQSchema(visibleFaqs);

    document.getElementById('coreForm').classList.add('hidden');
    document.getElementById('resultScreen').classList.remove('hidden');
    renderResult(visibleFaqs);
    saveToStorage();
  }

  // ---------------------------------------------------------------
  // 結果描画
  // ---------------------------------------------------------------
  function renderResult(visibleFaqs) {
    const r = state.result;

    // 暫定/精密の注記
    const note = document.getElementById('resultPrecisionNote');
    if (r.isPrecise) {
      note.textContent = '入力いただいた条件をもとに計算しています。';
      note.classList.add('is-final');
    } else {
      note.textContent = '概算です。あと数問で精度が上がります（下の「精度向上」カードから追加入力できます）。';
      note.classList.remove('is-final');
    }

    renderImpactCard(r);
    renderInfoCards(r);
    document.getElementById('supportBox').classList.toggle('hidden', state.isMentalPhysicalUnfit !== 'yes');
    renderTimeline(r);
    renderContextualFaq(visibleFaqs);
    renderAllFaq();
    renderGlossaryAppendix();
  }

  function verdictBadge(verdict) {
    if (verdict === 'MONTH_END' || verdict === 'BEFORE_MONTH_END') {
      return { cls: 'verdict-favorable', icon: '✓', label: 'お得ポイント' };
    }
    return { cls: 'verdict-info', icon: 'ℹ', label: '参考情報' };
  }

  function renderImpactCard(r) {
    const ic = r.insuranceComparison;
    const badge = verdictBadge(ic.verdict);
    const userChoseMonthEnd = Calc.isLastDayOfMonth(r.resignDate);

    let verdictText;
    if (ic.verdict === 'UNCERTAIN') {
      verdictText = `<b>どちらが有利かは判定が分かれます。</b>月末退職：${ic.patternA.toLocaleString()}円／月末前退職：約${ic.patternB.min.toLocaleString()}〜${ic.patternB.max.toLocaleString()}円。国民健康保険料はお住まいの市区町村によって幅があるため、この条件では逆転する可能性があります。`;
    } else if (ic.verdict === 'MONTH_END') {
      verdictText = `<b>この条件では、月末退職のほうが約${ic.difference.min.toLocaleString()}〜${ic.difference.max.toLocaleString()}円おトク</b>になる見込みです。`;
    } else {
      verdictText = `<b>この条件では、月末より前の退職のほうが約${ic.difference.min.toLocaleString()}〜${ic.difference.max.toLocaleString()}円おトク</b>になる見込みです。`;
    }

    const reductionNote = ic.reductionApplied
      ? `<p class="text-[11px] font-bold bg-white/15 rounded-lg px-3 py-2 leading-relaxed mb-2">会社都合・雇止め・体調不良などでのご退職のため、国民健康保険料の軽減措置（前年の給与所得を30%とみなして計算）を適用した金額で試算しています。<b>この軽減は自動では適用されません。</b>市区町村の窓口でのお手続きが必要です。</p>`
      : '';

    const impactCard = document.getElementById('impactCard');
    impactCard.innerHTML = `
      <p class="verdict-line ${badge.cls}"><span class="vl-icon" aria-hidden="true">${badge.icon}</span><span>${verdictText}</span></p>
      <p class="text-[11px] font-black tracking-widest opacity-80 mb-1">${escapeHtml(r.resignDateLabel)}に退職した場合</p>
      <div class="text-xs" style="background:rgba(255,255,255,.12);border-radius:.5rem;padding:10px 12px;">
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>月末（${userChoseMonthEnd ? '今回選んだ日' : '月末'}）に退職した場合</span><b>${ic.patternA.toLocaleString()}円</b></div>
        <p style="font-size:.68rem;opacity:.75;margin:0 0 6px;">内訳：健康保険 ${ic.breakdown.employeeHealth.toLocaleString()}円／厚生年金 ${ic.breakdown.employeePension.toLocaleString()}円${ic.breakdown.employeeNursing ? `／介護保険 ${ic.breakdown.employeeNursing.toLocaleString()}円` : ''}／子ども・子育て支援金 ${ic.breakdown.employeeChildcareLevy.toLocaleString()}円　※会社が同額を負担しています</p>
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>月末より前に退職した場合</span><b>約${ic.patternB.min.toLocaleString()}〜${ic.patternB.max.toLocaleString()}円</b></div>
      </div>
      ${reductionNote}
      <p class="text-[11px] opacity-80 leading-relaxed mt-3">※国民健康保険料は前年の所得とお住まいの市区町村により大きく変動します。上記は全国的な料率の幅から算出した目安です。${r.ageProvided ? '' : '生年を入力すると、介護保険料（40〜64歳）を反映した金額になります。'}</p>
    `;
  }

  function renderInfoCards(r) {
    const container = document.getElementById('infoCardsContainer');
    const cards = [];

    if (r.residentTaxImpact.type === 'LUMP_SUM_MANDATORY') {
      cards.push(buildInfoCard('住民税の一括徴収について', r.residentTaxImpact.message));
    }
    if (r.sicknessEligibility.applicable || r.sicknessEligibility.code === 'TENURE_UNDER_1Y') {
      cards.push(buildInfoCard('傷病手当金について', r.sicknessEligibility.message));
    }
    if (r.unemploymentRestriction.note) {
      cards.push(buildInfoCard(r.unemploymentRestriction.text, r.unemploymentRestriction.note));
    }

    container.innerHTML = cards.join('');
  }

  function buildInfoCard(title, body) {
    return `<div class="info-card"><p class="ic-title">${escapeHtml(title)}</p><p class="ic-body">${escapeHtml(body)}</p></div>`;
  }

  function renderTimeline(r) {
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';
    let step = 1;

    timeline.appendChild(buildTimelineNode(step++, r.noticeDate.dateLabel + 'まで', '直属の上司へ退職意思を伝える',
      '民法上は退職の申入れから2週間で退職できるとされています（民法第627条）。就業規則で「1ヶ月前まで」等と定められている場合、円満退職のためにはこれに従うのが望ましいものの、法的には民法の2週間が優先されるという見解が有力です。まずは口頭や1on1で相談し、承認後に退職届を提出するのが円満退職のコツです。'));

    if (r.retirementPay === 'yes') {
      timeline.appendChild(buildTimelineNode(step++, r.resignDateLabel + 'まで', '「退職所得の受給に関する申告書」を提出する',
        '未提出の場合、退職金の全額に20.42%が源泉徴収されます。ただし翌年の確定申告で還付を受けられます。勤続年数は「1年未満切り上げ」で計算されます。'));
    }

    timeline.appendChild(buildTimelineNode(step++, r.lastWorkDayLabel, '最終出社日を迎える',
      '社章・備品・資格確認書返却の準備を行い、引き継ぎを完了させましょう。'));

    if (r.paidLeaveStartLabel) {
      const sicknessNote = state.isMentalPhysicalUnfit === 'yes'
        ? ' 傷病手当金を受け取る予定がある場合、退職日は出勤せず有給または欠勤とされることをおすすめします。'
        : '';
      timeline.appendChild(buildTimelineNode(step++, r.paidLeaveStartLabel + '〜', '有給休暇の消化を開始する',
        `退職日までの有休消化期間に入ります（労働基準法第39条）。${sicknessNote}`));
    }

    const monthEndBonus = Calc.isLastDayOfMonth(r.resignDate) && r.insuranceComparison.verdict === 'MONTH_END';
    timeline.appendChild(buildTimelineNode(step++, r.resignDateLabel, '退職日を迎える',
      monthEndBonus
        ? `この日にすることで、社会保険料の自己負担が約${r.insuranceComparison.difference.min.toLocaleString()}〜${r.insuranceComparison.difference.max.toLocaleString()}円軽くなる計算です。`
        : '雇用契約上の最終在籍日です。', 'gold'));

    timeline.appendChild(buildTimelineNode(step++, r.qualification.lossDateLabel,
      `社会保険 ${termTrigger('shikaku_soushitsu_bi', '資格喪失日')}（${termTrigger('shikaku_kakunin_sho', '資格確認書')}の返却）`,
      '退職日の翌日です（健康保険法第36条・厚生年金保険法第14条）。資格確認書はこの日以降使用できませんので会社へ返却します（5日以内が目安）。マイナンバーカード自体は返却不要で、次の健康保険に加入すればそのまま使えます。', 'crimson', true));

    if (r.residentTaxImpact.type !== 'NORMAL') {
      timeline.appendChild(buildTimelineNode(step++, r.resignDateLabel + '頃', '【該当者】住民税の納付方法を確認する', r.residentTaxImpact.message, 'caution'));
    }

    if (r.branch !== 'transfer') {
      const from = Calc.fmtJP(Calc.addDays(r.qualification.lossDate, 10));
      const to = Calc.fmtJP(Calc.addDays(r.qualification.lossDate, 14));
      let body = '自宅に離職票が届く目安日です（退職後10日〜2週間程度）。';
      if (state.isMentalPhysicalUnfit === 'yes') {
        body += ' 医師の診断書をお持ちいただくと「特定理由離職者」に認定される可能性があり、給付制限が解除される場合があります。';
      }
      timeline.appendChild(buildTimelineNode(step++, `${from}〜${to}ごろ`, `【無職・独立】${termTrigger('rishoku_hyo', '離職票')}を持って初回ハローワークへ行く`, body, 'caution', true));
    }

    if (r.insuranceComparison.reductionApplied) {
      timeline.appendChild(buildTimelineNode(step++, r.qualification.lossDateLabel + '以降', '【該当者】国民健康保険料の軽減を申請する',
        '会社都合・雇止め・体調不良などでのご退職の場合、前年の給与所得を30%とみなして国民健康保険料が計算される軽減措置があります。自動では適用されないため、お手続きが必要です。ハローワークで受け取る「雇用保険受給資格者証」をお持ちのうえ、お住まいの市区町村の国民健康保険窓口へお越しください。軽減はこの年度の翌年度末まで続きます。'));
    }

    if (r.branch === 'transfer') {
      timeline.appendChild(buildTimelineNode(step++, r.qualification.lossDateLabel + '以降', '【転職】雇用保険被保険者証等を提出する',
        '転職先へ「雇用保険被保険者証」等を提出します。離職票は原則不要です。'));
      if (r.insuranceGap) {
        const gapBody = r.insuranceGap.type === 'gap'
          ? `新しい会社で働き始める日です。退職日との間に約${r.insuranceGap.days}日間の空白期間があるため、国民健康保険・国民年金への一時加入、または任意継続被保険者制度の手続きが必要です。`
          : r.insuranceGap.type === 'overlap'
            ? '新しい会社で働き始める予定日ですが、退職日より前になっています。日程を見直してください。'
            : '新しい会社で働き始める日です。退職日の翌日なので、社会保険の手続きは会社間でそのまま引き継がれます。';
        timeline.appendChild(buildTimelineNode(step++, r.insuranceGap.nextJoinLabel, '次の会社で働き始める', gapBody));
      }
    } else if (r.branch === 'independence' && r.openingDateAdvice) {
      timeline.appendChild(buildTimelineNode(step++, r.openingDateAdvice.earliestSafeDateLabel + '以降', '【独立】開業届を提出する目安日', r.openingDateAdvice.note));
    } else {
      timeline.appendChild(buildTimelineNode(step++, '受給資格決定後', '【無職】待期・給付制限の経過後に受給開始', r.unemploymentRestriction.text + (r.unemploymentRestriction.note ? ' ' + r.unemploymentRestriction.note : '')));
    }

    if (r.dcDeadline) {
      timeline.appendChild(buildTimelineNode(step++, r.dcDeadline.deadlineLabel + 'まで', `【該当者】${termTrigger('kigyogata_dc', '企業型DC（確定拠出年金）')}を移管する`,
        '資格喪失日から6ヶ月以内が移管期限です。放置すると自動移換され、運用が止まり手数料が発生します。', null, true));
    }
  }

  function buildTimelineNode(stepNum, dateLabel, heading, body, variant, headingIsHtml) {
    const el = document.createElement('div');
    el.className = 'tl-item';
    // 詳細説明（tl-body）はやや長文になりがちなため、折りたたみ可能にする。
    // 日付・見出しは常に見える summary 側に置き、初期状態は閉じておいて
    // 気になった項目だけ開いて詳細を読む形にする。
    el.innerHTML = `
      <div class="tl-node">
        <span class="tl-num">${stepNum}</span>
        <span class="tl-line"></span>
      </div>
      <details class="tl-card${variant ? ' ' + variant : ''}">
        <summary class="tl-summary">
          <span class="tl-summary-text">
            <span class="tl-date">${escapeHtml(dateLabel)}</span>
            <h3 class="tl-heading">${headingIsHtml ? heading : escapeHtml(heading)}</h3>
          </span>
          <span class="cd-chev" aria-hidden="true"></span>
        </summary>
        <p class="tl-body">${escapeHtml(body)}</p>
      </details>
    `;
    return el;
  }

  /** 用語ミニ解説（第3層）のトリガーボタンを生成する。見出しは静的文字列のみで組み立てるため安全。 */
  function termTrigger(termId, label) {
    return `<button type="button" class="term-trigger" data-term="${escapeAttr(termId)}" aria-expanded="false" aria-describedby="term-popover">${escapeHtml(label)}</button>`;
  }

  // ---------------------------------------------------------------
  // FAQ描画（第1層：文脈連動／第2層：全件）
  // ---------------------------------------------------------------
  function evaluateTrigger(trigger, r) {
    if (trigger === 'always') return true;
    if (trigger === 'bonusDate入力あり') return !!state.bonusDate;
    if (trigger === 'afterInsurance入力あり') return state.hasPrecisionInput;
    if (trigger === 'afterInsurance=fuyou') return state.afterInsurance === 'fuyou';
    if (trigger === 'paidLeave > 0') return Number(state.paidLeave) > 0;
    if (trigger === 'branch=transfer') return state.branch === 'transfer';
    if (trigger === 'branch≠transfer') return state.branch !== 'transfer';
    if (trigger === 'isMentalPhysicalUnfit=yes') return state.isMentalPhysicalUnfit === 'yes';
    if (trigger === '退職月が1〜4月') return r ? [1, 2, 3, 4].includes(r.resignDate.getMonth() + 1) : false;
    if (trigger === 'retirementPay=あり') return state.retirementPay === 'yes';
    if (trigger === 'corporateDC=あり') return state.corporateDC === 'yes';
    if (trigger === 'branch=independence') return state.branch === 'independence';
    return false;
  }

  function getContextualFaqs() {
    const r = state.result;
    const matched = FaqMaster.getAllFaqs().filter(f => evaluateTrigger(f.trigger, r));
    return matched.sort((a, b) => b.priority - a.priority).slice(0, 5);
  }

  function renderContextualFaq(faqs) {
    const container = document.getElementById('contextualFaq');
    // 文脈連動FAQ（最大5件）は既に絞り込み済みのため初期状態で開いておく。
    // アンカーID(id="faq-xxx")は全件FAQ側にのみ付与し、DOM ID重複を避ける。
    container.innerHTML = faqs.map(f => buildFaqItemHtml(f, { defaultOpen: true, anchorId: false })).join('');
    bindFaqFeedbackButtons(container);
  }

  function renderAllFaq() {
    const container = document.getElementById('allFaqList');
    const byCategory = {};
    FaqMaster.getAllFaqs().forEach(f => {
      (byCategory[f.category] = byCategory[f.category] || []).push(f);
    });
    let html = '';
    Object.keys(byCategory).forEach(cat => {
      html += `<h3 class="all-faq-category">${escapeHtml(cat)}</h3>`;
      // 全22件を並べると長くなるため、質問文だけを見せる閉じたアコーディオンにする
      html += byCategory[cat].map(f => buildFaqItemHtml(f, { defaultOpen: false, anchorId: true })).join('');
    });
    container.innerHTML = html;
    bindFaqFeedbackButtons(container);
  }

  /**
   * FAQ1件分を折りたたみ可能な <details> として描画する。
   * ネイティブの <details>/<summary> を使うことで、キーボード操作・スクリーンリーダー
   * 対応をブラウザ標準機能に委ね、フラグメントリンク（#faq-xxx）で自動的に開く挙動も得られる。
   */
  function buildFaqItemHtml(f, opts) {
    opts = opts || {};
    const pressed = faqFeedbackState[f.id];
    const idAttr = opts.anchorId ? ` id="faq-${escapeAttr(f.id)}"` : '';
    const openAttr = opts.defaultOpen ? ' open' : '';
    return `
      <details class="faq-item"${idAttr}${openAttr}>
        <summary class="faq-summary">
          <span class="faq-q">Q. ${escapeHtml(f.question)}</span>
          <span class="cd-chev" aria-hidden="true"></span>
        </summary>
        <div class="faq-body">
          <p class="faq-a1">${escapeHtml(f.conclusion)}</p>
          <p class="faq-a2">${escapeHtml(f.detail)}</p>
          <p class="faq-a3"><span class="faq-a3-label">→ 次にやること　</span>${escapeHtml(f.action)}</p>
          <div class="faq-feedback">
            <span>この説明は分かりやすかったですか？</span>
            <button type="button" data-fb-item="${escapeAttr(f.id)}" data-fb="clear" aria-pressed="${pressed === 'clear'}">👍</button>
            <button type="button" data-fb-item="${escapeAttr(f.id)}" data-fb="unclear" aria-pressed="${pressed === 'unclear'}">🤔</button>
          </div>
        </div>
      </details>
    `;
  }

  function bindFaqFeedbackButtons(container) {
    container.querySelectorAll('.faq-feedback button').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.fbItem;
        const value = btn.dataset.fb;
        faqFeedbackState[itemId] = value;
        container.querySelectorAll(`[data-fb-item="${cssEscape(itemId)}"]`).forEach(b => {
          b.setAttribute('aria-pressed', String(b.dataset.fb === value));
        });
      });
    });
  }

  // ---------------------------------------------------------------
  // 用語ミニ解説ポップオーバー（第3層）
  // ---------------------------------------------------------------
  let usedGlossaryTerms = new Set();

  function openTermPopover(termId, anchorEl) {
    const term = Glossary.getTerm(termId);
    if (!term) return;
    usedGlossaryTerms.add(termId);
    const popover = document.getElementById('term-popover');
    document.getElementById('term-title').textContent = term.term;
    document.getElementById('term-short-el').textContent = term.short;
    document.getElementById('term-detail-el').textContent = term.detail;
    const link = document.getElementById('term-link-el');
    if (term.relatedFaq) {
      link.href = '#faq-' + term.relatedFaq;
      link.hidden = false;
    } else {
      link.hidden = true;
    }
    const rect = anchorEl.getBoundingClientRect();
    popover.style.top = Math.min(window.innerHeight - 220, rect.bottom + 8) + 'px';
    popover.style.left = Math.max(8, Math.min(window.innerWidth - 308, rect.left)) + 'px';
    popover.classList.remove('hidden');
    anchorEl.setAttribute('aria-expanded', 'true');
  }
  function closeTermPopover() {
    document.getElementById('term-popover').classList.add('hidden');
    document.querySelectorAll('.term-trigger[aria-expanded="true"]').forEach(el => el.setAttribute('aria-expanded', 'false'));
  }
  document.addEventListener('click', e => {
    const trigger = e.target.closest('.term-trigger');
    if (trigger) {
      // term-trigger は tl-card の <summary> 内に置かれることがあるため、
      // ここで止めないとクリックがタイムラインの開閉トグルにも伝播してしまう。
      e.preventDefault();
      e.stopPropagation();
      openTermPopover(trigger.dataset.term, trigger);
    }
  });

  function renderGlossaryAppendix() {
    const list = document.getElementById('glossaryAppendixList');
    const ids = Array.from(usedGlossaryTerms);
    list.innerHTML = ids.map(id => {
      const t = Glossary.getTerm(id);
      return t ? `<li><b>${escapeHtml(t.term)}</b>：${escapeHtml(t.short)}</li>` : '';
    }).join('');
  }

  // ---------------------------------------------------------------
  // 上司連絡テンプレートモーダル
  // ---------------------------------------------------------------
  function openTemplateModal() {
    const text = [
      'お疲れ様です。',
      '',
      '折り入ってご相談したいことがあり、少しお時間をいただけますでしょうか。',
      '来週あたりで、30分ほどお時間を頂戴できるタイミングはございますか。',
      '',
      'どうぞよろしくお願いいたします。',
    ].join('\n');
    document.getElementById('templateText').value = text;
    document.getElementById('templateCopyToast').classList.add('hidden');
    document.getElementById('templateModal').showModal();
  }

  function onCopyTemplate() {
    const textarea = document.getElementById('templateText');
    const toast = document.getElementById('templateCopyToast');
    const finish = () => {
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 2000);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(textarea.value).then(finish).catch(() => {
        textarea.select();
        try { document.execCommand('copy'); } catch (e) { /* noop */ }
        finish();
      });
    } else {
      textarea.select();
      try { document.execCommand('copy'); } catch (e) { /* noop */ }
      finish();
    }
  }

  // ---------------------------------------------------------------
  // フィードバック（第13章。能動操作時のみ送信、要配慮情報は送らない）
  // ---------------------------------------------------------------
  function buildFeedbackContext() {
    const r = state.result;
    return {
      resignDate: state.resignDate,
      prefecture: state.hasPrecisionInput ? state.prefecture : null,
      annualIncomeCategory: state.annualIncome,
      ageDecade: state.birthYear ? `${Math.floor(Calc.calcAge(state.birthYear) / 10) * 10}s` : null,
      tenureYears: state.tenureYears,
      branch: state.branch,
      retireReason: state.retireReason,
      afterInsurance: state.afterInsurance,
      verdict: r ? r.insuranceComparison.verdict : null,
      reductionApplied: r ? r.insuranceComparison.reductionApplied : null,
    };
  }

  function onMicroFeedback(kind) {
    document.querySelectorAll('#feedbackMicro [data-fb]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fb === kind)));
    if (kind === 'good') {
      document.getElementById('feedbackThanks').classList.remove('hidden');
      Feedback.sendGoodSignal();
      return;
    }
    openFeedbackModal(kind === 'wrong' ? 'calc_mismatch' : 'usability');
  }

  function openFeedbackModal(category) {
    document.getElementById('fbCategory').value = category;
    document.getElementById('fbFreeText').value = '';
    document.getElementById('fbContextSummary').textContent = Feedback.buildContextSummary(buildFeedbackContext());
    document.getElementById('feedbackModal').showModal();
  }

  function onSendFeedback() {
    const category = document.getElementById('fbCategory').value;
    const freeText = document.getElementById('fbFreeText').value;
    Feedback.submitFeedback({ category, freeText, context: buildFeedbackContext() });
    closeModal('feedbackModal');
  }

  // ---------------------------------------------------------------
  // シェア・リセット
  // ---------------------------------------------------------------
  function onShareX() {
    const r = state.result;
    if (!r) return;
    const text = [
      '【退職日シミュレーション結果】',
      `最終出社日：${r.lastWorkDayLabel}`,
      `資格喪失日：${r.qualification.lossDateLabel}`,
      '#トク退 #退職準備',
    ].join('\n');
    const url = new URL('https://twitter.com/intent/tweet');
    url.searchParams.set('text', text);
    url.searchParams.set('url', 'https://taishokubi-navi.pages.dev/');
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  function onRestart() {
    SafeStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  // ---------------------------------------------------------------
  // LocalStorage 管理（SafeStorage経由。要配慮情報は保存しない）
  // ---------------------------------------------------------------
  function saveToStorage() {
    const persistable = {
      resignDate: state.resignDate,
      paidLeave: state.paidLeave,
      annualIncome: state.annualIncome,
      branch: state.branch,
      retireReason: state.retireReason,
      resignCount5Years: state.resignCount5Years,
      isEnrolledEducation: state.isEnrolledEducation,
      birthYear: state.birthYear,
      prefecture: state.prefecture,
      insuranceType: state.insuranceType,
      afterInsurance: state.afterInsurance,
      tenureYears: state.tenureYears,
      bonusDate: state.bonusDate,
      bonusAmount: state.bonusAmount,
      retirementPay: state.retirementPay,
      corporateDC: state.corporateDC,
      nextJoinDate: state.nextJoinDate,
      wantAllowance: state.wantAllowance,
      handoverDays: state.handoverDays,
      offDays: state.offDays,
      closedOnHolidays: state.closedOnHolidays,
      hasPrecisionInput: state.hasPrecisionInput,
      groupACompleted: state.groupACompleted,
      groupBCompleted: state.groupBCompleted,
      groupCCompleted: state.groupCCompleted,
      // isMentalPhysicalUnfit は NEVER_PERSIST_KEYS のため意図的に含めない
    };
    NEVER_PERSIST_KEYS.forEach(k => delete persistable[k]);
    SafeStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  }

  function restoreFromStorage() {
    const raw = SafeStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return; }
    if (!parsed || typeof parsed !== 'object') return;
    NEVER_PERSIST_KEYS.forEach(k => delete parsed[k]);
    Object.assign(state, createInitialState(), parsed);
    if (!Array.isArray(state.offDays) || !state.offDays.length) state.offDays = [0, 6];
  }

  // ---------------------------------------------------------------
  // XSS対策ユーティリティ
  // ---------------------------------------------------------------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(str) { return escapeHtml(str); }
  function cssEscape(str) {
    return String(str).replace(/["\\]/g, '\\$&');
  }
})();
