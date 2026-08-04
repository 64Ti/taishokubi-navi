/**
 * app.js
 * トク退：UI制御本体 Ver.10.0
 * STEP1(退職希望日+退職区分) → STEP2(休日・有休設定) → STEP3(給与・資産・進路) → 結果(ToDoタイムライン)
 *
 * v10.0での主要変更：
 * - 外部PR・アフィリエイトボタン・広告要素を完全撤去。純粋なテキストアドバイスのみ表示。
 * - SafeStorage: iOS Safariプライベートモード等でlocalStorageが使えない環境でも例外を投げない。
 * - INITIAL_STATE を用いたデフォルト値マージで、旧形式データとの衝突・欠損フィールドを防止。
 * - 退職区分（定年退職）・企業型DC・退職金・再就職手当希望の入力と、それに応じた
 *   タイムラインの条件分岐（離職票の要否等）を追加。
 * - 結果画面の印刷 / PDF保存（window.print）に対応。
 */
(function () {
  'use strict';

  const Calc = window.TokutaiCalculator;
  const H = window.HolidaysJP;
  const Schema = window.SchemaGenerator;

  const STORAGE_KEY = 'tokutai_form_state';
  const STEPS = ['step1', 'step2', 'step3', 'stepResult'];
  const STEP_LABELS = ['STEP 1 / 3', 'STEP 2 / 3', 'STEP 3 / 3', '診断結果'];
  let currentStepIndex = 0;

  // ---------------------------------------------------------------
  // SafeStorage：iOS Safariのプライベートブラウジング等でlocalStorageの
  // setItem/getItemが例外を投げる環境でも、アプリ全体を落とさないためのラッパー。
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

  // 復元・リセット双方の基準となる初期状態。マイグレーション時は
  // 「この形をベースに、保存データを上書きマージする」ことで欠損フィールドを防ぐ。
  function createInitialState() {
    return {
      resignDate: null,        // 'YYYY-MM-DD'
      retireReason: 'voluntary', // 'voluntary'|'company'|'mandatory'
      nextJoinDate: null,       // 'YYYY-MM-DD'（次の会社への入社予定日・転職時のみ）
      bonusDate: null,          // 'YYYY-MM-DD'（直近1回分のボーナス支給予定日・任意）
      bonusAmount: null,        // 選択したボーナス見込み額の代表額（円）
      offDays: [0, 6],          // 毎週の定休日（0:日〜6:土）。シフト制の人向けに自由選択。
      closedOnHolidays: true,
      extraOffDates: [],        // ['YYYY-MM-DD', ...] 会社独自の休み
      extraWorkDates: [],       // ['YYYY-MM-DD', ...] 会社独自の出勤日
      paidLeave: null,
      handoverDays: 0,          // 引き継ぎ必要日数
      annualIncome: null,       // 選択した年収帯の代表額（円）
      salary: null,             // annualIncome から換算した月給概算（円）
      insuranceType: 'kyokai',  // 加入中の健康保険 'kyokai'|'kumiai'|'kyosai'
      corporateDC: 'no',        // 企業型DC（確定拠出年金）の加入有無 'yes'|'no'
      retirementPay: 'no',      // 退職金の支給予定 'yes'|'no'
      branch: null,             // 'transfer'|'recuperation'|'independence'
      wantAllowance: 'no',      // 再就職手当の受給希望（独立選択時のみ意味を持つ）'yes'|'no'
      result: null,
    };
  }

  const state = createInitialState();

  // ---------------------------------------------------------------
  // 初期化
  // ---------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    Schema.generateWebApplicationSchema();
    restoreFromStorage();
    prefillDefaultDate();
    bindEvents();
    buildWeekdayGrid();
    renderExtraDatesList();
    renderStep();
  });

  function prefillDefaultDate() {
    const input = document.getElementById('inputResignDate');
    const todayISO = Calc.fmtISO(new Date());
    input.min = todayISO;
    if (!state.resignDate) {
      const eom = Calc.lastDayOfMonth(new Date());
      state.resignDate = Calc.fmtISO(eom);
    }
    input.value = state.resignDate;
  }

  function bindEvents() {
    document.getElementById('btnNext').addEventListener('click', onNext);
    document.getElementById('btnBack').addEventListener('click', onBack);
    document.getElementById('btnRestart').addEventListener('click', onRestart);
    document.getElementById('btnShareX').addEventListener('click', onShareX);
    document.getElementById('btnPrint').addEventListener('click', onPrint);
    document.getElementById('customDaysAccordion').addEventListener('click', e => {
      const btn = e.target.closest('.cd-del');
      if (btn) removeExtraDate(btn.dataset.kind, btn.dataset.date);
    });

    // STEP1
    document.getElementById('inputResignDate').addEventListener('change', e => {
      const todayISO = Calc.fmtISO(new Date());
      if (e.target.value < todayISO) { e.target.value = todayISO; }
      state.resignDate = e.target.value;
      saveToStorage();
      validateStep1();
    });
    document.getElementById('inputRetireReason').addEventListener('change', e => {
      state.retireReason = e.target.value;
      saveToStorage();
    });
    document.getElementById('resignDateChips').addEventListener('click', e => {
      const chip = e.target.closest('.qc-chip');
      if (chip) applyQuickDate(chip.dataset.quick);
    });
    document.getElementById('inputBonusDate').addEventListener('change', e => {
      state.bonusDate = e.target.value || null;
      document.getElementById('bonusAmountField').hidden = !state.bonusDate;
      saveToStorage();
      // STEP1の入力なので、他ステップの btnNext 状態には触れない
    });

    // STEP2
    document.getElementById('holidayOnBtn').addEventListener('click', () => setHolidayOff(true));
    document.getElementById('holidayOffBtn').addEventListener('click', () => setHolidayOff(false));
    document.getElementById('inputPaidLeave').addEventListener('input', e => {
      state.paidLeave = e.target.value;
      saveToStorage();
      validateStep2();
      updateLivePreview();
    });
    document.getElementById('inputHandoverDays').addEventListener('input', e => {
      state.handoverDays = e.target.value;
      saveToStorage();
      updateLivePreview();
    });
    document.getElementById('btnAddExtraDate').addEventListener('click', () => onAddExtraDate('off'));
    document.getElementById('btnAddExtraWorkDate').addEventListener('click', () => onAddExtraDate('work'));

    // STEP3
    document.getElementById('inputAnnualIncome').addEventListener('change', e => {
      state.annualIncome = e.target.value || null;
      state.salary = state.annualIncome ? Calc.estimateMonthlyFromAnnual(state.annualIncome) : null;
      saveToStorage();
      validateStep3();
    });
    document.getElementById('inputBonusAmount').addEventListener('change', e => {
      state.bonusAmount = e.target.value || null;
      saveToStorage();
      validateStep3();
    });
    document.getElementById('inputInsuranceType').addEventListener('change', e => {
      state.insuranceType = e.target.value;
      saveToStorage();
    });
    document.getElementById('inputCorporateDC').addEventListener('change', e => {
      state.corporateDC = e.target.value;
      saveToStorage();
    });
    document.getElementById('inputRetirementPay').addEventListener('change', e => {
      state.retirementPay = e.target.value;
      saveToStorage();
    });
    document.getElementById('inputWantAllowance').addEventListener('change', e => {
      state.wantAllowance = e.target.value;
      saveToStorage();
    });
    document.querySelectorAll('#branchSelector .branch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.branch = btn.dataset.branch;
        document.querySelectorAll('#branchSelector .branch-btn').forEach(b => {
          b.classList.remove('border-emerald', 'bg-emerald-light');
          b.classList.add('border-slate-300');
        });
        btn.classList.remove('border-slate-300');
        btn.classList.add('border-emerald', 'bg-emerald-light');
        updateNextJoinDateVisibility();
        updateWantAllowanceVisibility();
        saveToStorage();
        validateStep3();
      });
    });
  }

  // ---------------------------------------------------------------
  // STEP3：次の入社日は「①転職」を選んだときだけ意味を持つため、
  // それ以外の進路（療養・無職／独立）では入力欄ごと隠し、値もクリアする。
  // ---------------------------------------------------------------
  function updateNextJoinDateVisibility() {
    const field = document.getElementById('nextJoinDateField');
    const isTransfer = state.branch === 'transfer';
    field.hidden = !isTransfer;
    if (!isTransfer && state.nextJoinDate) {
      state.nextJoinDate = null;
      document.getElementById('inputNextJoinDate').value = '';
    }
  }

  // ---------------------------------------------------------------
  // STEP3：再就職手当の受給希望は「③独立」を選んだときだけ意味を持つ。
  // ---------------------------------------------------------------
  function updateWantAllowanceVisibility() {
    const field = document.getElementById('wantAllowanceField');
    const isIndependence = state.branch === 'independence';
    field.hidden = !isIndependence;
    if (!isIndependence) {
      state.wantAllowance = 'no';
      document.getElementById('inputWantAllowance').value = 'no';
    }
  }

  // ---------------------------------------------------------------
  // STEP1：退職希望日のクイック選択チップ（EFO改善）
  // ---------------------------------------------------------------
  function applyQuickDate(kind) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let target;
    if (kind === '2weeks') {
      target = Calc.addDays(today, 14);
    } else if (kind === 'thisMonthEnd') {
      target = Calc.lastDayOfMonth(today);
    } else if (kind === 'nextMonthEnd') {
      target = Calc.lastDayOfMonth(Calc.addDays(Calc.lastDayOfMonth(today), 1));
    } else if (kind === 'nextMonth1st') {
      target = Calc.addDays(Calc.lastDayOfMonth(today), 1);
    } else {
      return;
    }
    const iso = Calc.fmtISO(target);
    const input = document.getElementById('inputResignDate');
    input.value = iso;
    state.resignDate = iso;
    saveToStorage();
    validateStep1();
  }

  // 祝日の扱い：ON/OFFの抽象的なトグルではなく、選んだボタンの文言そのものが
  // 現在の設定を表す2択ボタンにして「わかりにくい」を解消する。
  function setHolidayOff(value) {
    state.closedOnHolidays = value;
    document.getElementById('holidayOnBtn').setAttribute('aria-pressed', String(value === true));
    document.getElementById('holidayOffBtn').setAttribute('aria-pressed', String(value === false));
    saveToStorage();
    updateLivePreview();
  }

  // ---------------------------------------------------------------
  // 毎週の定休日（曜日グリッド）
  // ---------------------------------------------------------------
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
          if (state.offDays.length <= 1) { return; } // 定休日は最低1日必要
          state.offDays.splice(idx, 1);
        } else {
          state.offDays.push(i);
        }
        btn.setAttribute('aria-pressed', state.offDays.includes(i) ? 'true' : 'false');
        saveToStorage();
        updateLivePreview();
      });
      grid.appendChild(btn);
    });
  }

  // ---------------------------------------------------------------
  // STEP2：会社独自の休日・出勤日リスト（優先順位：出勤日 > 休み > 通常判定）
  // ---------------------------------------------------------------
  function onAddExtraDate(kind) {
    const input = document.getElementById(kind === 'work' ? 'extraWorkDateInput' : 'extraDateInput');
    if (!input.value) return;
    const target = kind === 'work' ? state.extraWorkDates : state.extraOffDates;
    const other = kind === 'work' ? state.extraOffDates : state.extraWorkDates;
    const dateStr = input.value;

    if (target.includes(dateStr)) { input.value = ''; return; }
    const otherIdx = other.indexOf(dateStr);
    if (otherIdx !== -1) other.splice(otherIdx, 1); // 反対側に既にあれば移動する（優先順位に従い一意にする）

    target.push(dateStr);
    target.sort();
    input.value = '';
    saveToStorage();
    renderExtraDatesList();
    updateLivePreview();
  }

  function removeExtraDate(kind, dateStr) {
    if (kind === 'work') {
      state.extraWorkDates = state.extraWorkDates.filter(d => d !== dateStr);
    } else {
      state.extraOffDates = state.extraOffDates.filter(d => d !== dateStr);
    }
    saveToStorage();
    renderExtraDatesList();
    updateLivePreview();
  }

  function renderDateChipList(containerId, dateList, kind) {
    const container = document.getElementById(containerId);
    if (!dateList.length) {
      container.innerHTML = '<li class="cd-empty">まだ登録がありません</li>';
      return;
    }
    container.innerHTML = dateList.map(dateStr => {
      const label = escapeHtml(Calc.fmtJP(Calc.parseDate(dateStr)));
      return `<li class="cd-chip ${kind}"><span>${label}</span>` +
        `<button type="button" class="cd-del" data-kind="${kind}" data-date="${escapeAttr(dateStr)}" aria-label="${label}を削除">×</button></li>`;
    }).join('');
  }

  function renderExtraDatesList() {
    renderDateChipList('extraDatesList', state.extraOffDates, 'off');
    renderDateChipList('extraWorkDatesList', state.extraWorkDates, 'work');

    const total = state.extraOffDates.length + state.extraWorkDates.length;
    const badge = document.getElementById('cdBadge');
    badge.textContent = total ? `${total}件 設定中` : '';
    badge.hidden = !total;
  }

  function buildBusinessDayChecker() {
    return H.createBusinessDayChecker({
      offDays: state.offDays,
      closedOnHolidays: state.closedOnHolidays,
      extraOffDates: state.extraOffDates,
      extraWorkDates: state.extraWorkDates,
    });
  }

  function updateLivePreview() {
    renderHolidayCalendar();

    const preview = document.getElementById('livePreview');
    if (!state.resignDate || state.paidLeave === null || state.paidLeave === '') {
      preview.classList.add('hidden');
      return;
    }
    const resignDate = Calc.parseDate(state.resignDate);
    const checker = buildBusinessDayChecker();
    const r = Calc.calcPaidLeaveBackward(resignDate, state.paidLeave, checker, state.handoverDays);
    document.getElementById('previewLastWorkDay').textContent = Calc.fmtJP(r.lastWorkDay);

    // 自分が指定した退職日に対して、いつが理想かを先出しで伝える
    // （金額はSTEP3の給与・ボーナス入力後に確定するためここでは日付のみ）
    const optimalStub = {
      optimalDate: Calc.lastDayOfMonth(resignDate),
      optimalDateLabel: Calc.fmtJP(Calc.lastDayOfMonth(resignDate)),
      isOptimal: Calc.isLastDayOfMonth(resignDate),
    };
    const rec = Calc.calcRecommendedResignDate(resignDate, state.nextJoinDate, optimalStub, state.bonusDate);
    const recEl = document.getElementById('previewRecommendation');
    const compareEl = document.getElementById('previewCompare');

    if (rec.isSameAsUserPlan) {
      recEl.textContent = '✓ この退職日はすでに理想的です（このまま変更不要）。';
      compareEl.hidden = true;
    } else {
      document.getElementById('previewUserDate').textContent = Calc.fmtJP(resignDate);
      document.getElementById('previewIdealDate').textContent = rec.dateLabel;
      compareEl.hidden = false;

      if (rec.bonusConflict === 'unreachable') {
        recEl.textContent = '次の入社日の都合で、ボーナス支給日までは待てません。空白期間が出ない日を理想の日にしています。';
      } else if (rec.limitedByNextJob) {
        recEl.textContent = '次の入社日の前日が、保険を途切れさせずに退職できる最終日です。';
      } else if (state.bonusDate && rec.dateLabel !== optimalStub.optimalDateLabel) {
        recEl.textContent = 'ボーナス支給日をまたいで在籍できる、直後の月末を理想の日にしています。';
      } else {
        recEl.textContent = '月末に変更すると社会保険料がお得になります。くわしい金額はSTEP3の入力後に表示されます。';
      }
    }

    preview.classList.remove('hidden');
  }

  // ---------------------------------------------------------------
  // 期間内の祝日カレンダー（可視化）
  // ---------------------------------------------------------------
  function renderHolidayCalendar() {
    const listEl = document.getElementById('holidayCalendarList');
    const badge = document.getElementById('holidayBadge');
    if (!state.resignDate) {
      listEl.innerHTML = '<li class="cd-empty">退職希望日を入力すると表示されます</li>';
      badge.hidden = true;
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const resignDate = Calc.parseDate(state.resignDate);
    const from = today < resignDate ? today : resignDate;
    const to = today < resignDate ? resignDate : today;
    const offDaySet = new Set(state.offDays);
    const holidays = H.listHolidaysInRange(from, to, offDaySet);

    if (!holidays.length) {
      listEl.innerHTML = '<li class="cd-empty">この期間に該当する祝日はありません</li>';
      badge.hidden = true;
      return;
    }
    const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
    listEl.innerHTML = holidays.map(h => {
      const dateLabel = `${h.date.getMonth() + 1}/${h.date.getDate()}（${DOW_JA[h.dayOfWeek]}）`;
      return `<li class="holiday-cal-row"><span class="hc-date">${escapeHtml(dateLabel)}</span><span class="hc-name">${escapeHtml(h.name)}</span></li>`;
    }).join('');
    badge.textContent = `${holidays.length}件`;
    badge.hidden = false;
  }

  // ---------------------------------------------------------------
  // ステップ制御
  // ---------------------------------------------------------------
  function renderStep() {
    STEPS.forEach((id, i) => {
      document.getElementById(id).classList.toggle('active', i === currentStepIndex);
    });
    document.getElementById('stepLabel').textContent = STEP_LABELS[currentStepIndex];
    document.getElementById('progressBar').style.width = `${Math.min(currentStepIndex + 1, 3) / 3 * 100}%`;
    document.getElementById('btnBack').classList.toggle('hidden', currentStepIndex === 0);

    const nextBtn = document.getElementById('btnNext');
    if (currentStepIndex === STEPS.length - 1) {
      nextBtn.classList.add('hidden');
    } else {
      nextBtn.classList.remove('hidden');
      nextBtn.textContent = currentStepIndex === STEPS.length - 2 ? '診断結果を見る' : '次へ進む';
    }

    if (currentStepIndex === 0) validateStep1();
    if (currentStepIndex === 1) { validateStep2(); updateLivePreview(); }
    if (currentStepIndex === 2) validateStep3();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function validateStep1() {
    const valid = !!state.resignDate;
    document.getElementById('btnNext').disabled = !valid;
    return valid;
  }
  function validateStep2() {
    const valid = state.paidLeave !== null && state.paidLeave !== '' && Number(state.paidLeave) >= 0 && Number(state.paidLeave) <= 60;
    document.getElementById('btnNext').disabled = !valid;
    return valid;
  }
  function validateStep3() {
    // ボーナス支給日を入力した場合は、金額も選ばないと損得計算ができないため必須にする
    const bonusOk = !state.bonusDate || !!state.bonusAmount;
    const valid = !!state.annualIncome && !!state.branch && bonusOk;
    document.getElementById('btnNext').disabled = !valid;
    return valid;
  }

  function onNext() {
    if (currentStepIndex === 0) {
      if (!validateStep1()) return;
    } else if (currentStepIndex === 1) {
      if (!validateStep2()) return;
    } else if (currentStepIndex === 2) {
      if (!validateStep3()) return;
      runDiagnosis();
      renderResult();
    }
    currentStepIndex = Math.min(currentStepIndex + 1, STEPS.length - 1);
    renderStep();
  }

  function onBack() {
    currentStepIndex = Math.max(currentStepIndex - 1, 0);
    renderStep();
  }

  function onRestart() {
    SafeStorage.removeItem(STORAGE_KEY);
    Object.assign(state, createInitialState());
    document.getElementById('inputRetireReason').value = 'voluntary';
    document.getElementById('inputNextJoinDate').value = '';
    document.getElementById('nextJoinDateField').hidden = true;
    document.getElementById('inputBonusDate').value = '';
    document.getElementById('inputBonusAmount').value = '';
    document.getElementById('bonusAmountField').hidden = true;
    document.getElementById('inputPaidLeave').value = '';
    document.getElementById('inputHandoverDays').value = '0';
    document.getElementById('inputAnnualIncome').value = '';
    document.getElementById('inputInsuranceType').value = 'kyokai';
    document.getElementById('inputCorporateDC').value = 'no';
    document.getElementById('inputRetirementPay').value = 'no';
    document.getElementById('inputWantAllowance').value = 'no';
    document.getElementById('wantAllowanceField').hidden = true;
    document.getElementById('holidayOnBtn').setAttribute('aria-pressed', 'true');
    document.getElementById('holidayOffBtn').setAttribute('aria-pressed', 'false');
    document.querySelectorAll('#branchSelector .branch-btn').forEach(b => {
      b.classList.remove('border-emerald', 'bg-emerald-light');
      b.classList.add('border-slate-300');
    });
    prefillDefaultDate();
    buildWeekdayGrid();
    renderExtraDatesList();
    currentStepIndex = 0;
    renderStep();
  }

  // ---------------------------------------------------------------
  // 試算実行（calculator.js を呼び出す）
  // ---------------------------------------------------------------
  function runDiagnosis() {
    const resignDate = Calc.parseDate(state.resignDate);
    const checker = buildBusinessDayChecker();
    const gradeResult = Calc.calcStandardRemunerationGrade(state.salary);
    const noticeAdvice = Calc.buildResignationNoticeAdvice();
    const insuranceOptimization = Calc.calcInsuranceOptimization(resignDate, gradeResult);
    const branchContext = Calc.getBranchContext(state.branch);
    const recommendation = Calc.calcRecommendedResignDate(resignDate, state.nextJoinDate, insuranceOptimization, state.bonusDate);
    const insuranceGap = Calc.calcInsuranceGap(recommendation.date, state.nextJoinDate);

    // タイムラインは「理想の退職日」を軸に構成するため、最終出社日・資格喪失日は
    // 指定日(resignDate)ではなく理想の退職日(recommendation.date)を基準に計算する。
    const paidLeaveResult = Calc.calcPaidLeaveBackward(recommendation.date, state.paidLeave, checker, state.handoverDays);
    const qualification = Calc.calcQualificationLossDate(recommendation.date, state.insuranceType);

    // 損得計算：指定日のまま vs 理想の退職日で、社会保険料とボーナスがどう変わるか
    const gainLoss = Calc.calcResignDateGainLoss(resignDate, recommendation.date, gradeResult, state.bonusDate, state.bonusAmount);

    // 有休の金銭的価値は「参考情報」。退職日をどちらにしても消化日数が同じなら変わらない。
    const paidLeaveInfo = Calc.calcTakeHomeImpact(state.salary, state.paidLeave, { potentialSavings: 0 });

    // 上司へ切り出す目安日（最終出社日でクランプ）
    const noticeDate = Calc.calcNoticeDate(recommendation.date, paidLeaveResult.lastWorkDay);

    // 進路別の実務期限（療養＝国保切替、独立＝青色申告）
    let branchDeadline = null;
    if (state.branch === 'recuperation') {
      branchDeadline = { type: 'insuranceSwitch', ...Calc.calcInsuranceSwitchDeadline(qualification.lossDate) };
    } else if (state.branch === 'independence') {
      branchDeadline = { type: 'blueForm', ...Calc.calcBlueFormDeadline(resignDate) };
    }

    // 定年退職アドバイス（数値計算は変えず、情報アドバイスとしてのみ提供）
    const mandatoryAdvice = state.retireReason === 'mandatory' ? Calc.buildMandatoryRetirementAdvice() : null;

    // 企業型DC移管期限
    const dcDeadline = state.corporateDC === 'yes' ? Calc.calcDcDeadline(recommendation.date) : null;

    // 退職金・退職所得申告書アドバイス
    const retirementPayAdvice = state.retirementPay === 'yes' ? Calc.buildRetirementPayAdvice() : null;

    state.result = {
      resignDate,
      resignDateLabel: Calc.fmtJP(resignDate),
      retireReason: state.retireReason,
      nextJoinDate: state.nextJoinDate,
      lastWorkDay: paidLeaveResult.lastWorkDay,
      lastWorkDayLabel: Calc.fmtJP(paidLeaveResult.lastWorkDay),
      paidLeaveStartDay: paidLeaveResult.paidLeaveStartDay,
      paidLeaveStartLabel: paidLeaveResult.paidLeaveStartDay ? Calc.fmtJP(paidLeaveResult.paidLeaveStartDay) : null,
      grade: gradeResult,
      qualification,
      noticeAdvice,
      noticeDate,
      insuranceOptimization,
      recommendation,
      insuranceGap,
      gainLoss,
      paidLeaveInfo,
      branchDeadline,
      mandatoryAdvice,
      dcDeadline,
      retirementPayAdvice,
      wantAllowance: state.branch === 'independence' ? state.wantAllowance : null,
      bonusDate: state.bonusDate,
      bonusAmount: state.bonusAmount,
      branch: state.branch,
      branchContext,
    };

    Schema.generateHowToSchema(state.result);
    Schema.generateFAQSchema(state.result);
    saveToStorage();
  }

  // ---------------------------------------------------------------
  // 結果画面：見出しカード + ToDoタイムライン
  // ---------------------------------------------------------------
  function renderResult() {
    const r = state.result;

    // 見出しカード：まず「結局いつ辞めればいいか」の結論を最上段に出す（Gold Amber）
    const impactCard = document.getElementById('impactCard');
    const headline = buildHeadline(r);
    const compareRow = r.recommendation.isSameAsUserPlan ? '' : `
      <div class="preview-compare" style="background:rgba(255,255,255,.15);margin:0 0 10px;">
        <div><span class="pc-label" style="color:#fff;opacity:.75;">指定した退職日</span><span class="pc-value" style="color:#fff;">${escapeHtml(r.resignDateLabel)}</span></div>
        <div class="pc-arrow" style="color:#fff;opacity:.75;">→</div>
        <div><span class="pc-label" style="color:#fff;opacity:.75;">理想の退職日</span><span class="pc-value" style="color:#fff;">${escapeHtml(r.recommendation.dateLabel)}</span></div>
      </div>`;
    const gapNote = buildGapNote(r);
    const bonusNote = buildBonusNote(r);
    const gainLossBlock = buildGainLossBlock(r);
    const lossAversionHeadline = buildLossAversionHeadline(r);
    const branchLabel = buildBranchLabel(r.branch);

    impactCard.innerHTML = `
      ${lossAversionHeadline}
      ${branchLabel}
      <p class="text-[11px] font-black tracking-widest opacity-80 mb-1">あなたの理想の退職日</p>
      <p class="text-3xl font-black mb-2">${escapeHtml(r.recommendation.dateLabel)}</p>
      <p class="text-xs opacity-90 leading-relaxed mb-2">${escapeHtml(headline)}</p>
      ${compareRow}
      ${gapNote}
      ${bonusNote}
      ${gainLossBlock}
      <p class="text-[11px] opacity-80 leading-relaxed mt-3">※有休消化の価値（約${r.paidLeaveInfo.paidLeaveValue.toLocaleString()}円／日給概算${r.paidLeaveInfo.dailyWage.toLocaleString()}円×${r.paidLeaveInfo.days}日）は、退職日をどちらにしても消化日数が同じであれば変わらないため、上の損得には含めていません。</p>
    `;

    // 定年退職の情報アドバイス（見出しカードとタイムラインの間に独立表示）
    const mandatoryCard = document.getElementById('mandatoryAdviceCard');
    if (r.mandatoryAdvice) {
      mandatoryCard.hidden = false;
      mandatoryCard.innerHTML = `
        <p class="ic-title">💡 ${escapeHtml(r.mandatoryAdvice.title)}</p>
        <p class="ic-body">${escapeHtml(r.mandatoryAdvice.body)}</p>
      `;
    } else {
      mandatoryCard.hidden = true;
      mandatoryCard.innerHTML = '';
    }

    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';
    let step = 1;

    // --- ① 上司に相談する（就業規則アドバイスの本文を統合し、具体的な日付を明示） ---
    const noticeBody = r.noticeDate.clampedByLastWorkDay
      ? `${r.noticeAdvice.body} なお、有休消化の日数が多いため、通常の「退職日の1か月前」より早い、最終出社日までに伝える必要があります。`
      : r.noticeAdvice.body;
    timeline.appendChild(buildTimelineNode(step++, r.noticeDate.dateLabel + 'まで', r.noticeAdvice.title, noticeBody));

    // --- ② 退職所得の受給に関する申告書（退職金ありの場合のみ） ---
    if (r.retirementPayAdvice) {
      timeline.appendChild(buildTimelineNode(step++, r.recommendation.dateLabel + 'まで', r.retirementPayAdvice.taskTitle, r.retirementPayAdvice.taskBody));
      timeline.appendChild(wrapAside(buildAdviceCard('こうすることをお勧めします', r.retirementPayAdvice.note)));
    }

    // 療養branchのcritical（傷病手当金）は「出社しない」判断に直結するため、相談の直後に挿入
    if (r.branch === 'recuperation' && r.branchContext && r.branchContext.critical) {
      timeline.appendChild(wrapAside(buildCriticalPair(r.branchContext.critical)));
    }

    // --- ③ 最終出社日 ---
    timeline.appendChild(buildTimelineNode(step++, r.lastWorkDayLabel, '最終出社日を迎える', '社章・備品の返却、引き継ぎ資料の準備をこの日までに終えましょう。ここが会社に出社する最後の日です。'));

    // --- ④ 有給休暇の消化開始（あれば） ---
    if (r.paidLeaveStartLabel) {
      timeline.appendChild(buildTimelineNode(step++, r.paidLeaveStartLabel, '有給休暇の消化を開始', `${r.paidLeaveStartLabel}から理想の退職日まで、残っている有給休暇を消化する期間に入ります。有休消化中の二重就労を避け、次の準備や体調管理に充てましょう。`));
    }

    // --- ⑤ 理想の退職日を迎える（ハイライト表示） ---
    timeline.appendChild(buildTimelineNode(step++, r.recommendation.dateLabel, '理想の退職日を迎える', '社会保険料の会社折半負担やボーナス受給権が最大化される、雇用契約上の最終在籍日です。この日の翌日から社会保険の資格を失います。', 'gold'));

    // --- ⑥ 社会保険 資格喪失日 ---
    let qualBody = r.qualification.note;
    if (r.qualification.insuranceTypeNote) qualBody += ' ' + r.qualification.insuranceTypeNote;
    qualBody += ' 健康保険証はこの日以降使用できません。会社への返却を行いましょう。';
    timeline.appendChild(buildTimelineNode(step++, r.qualification.lossDateLabel, '社会保険 資格喪失日', qualBody, 'crimson'));

    // --- ⑦ 進路別の実務ステップ（離職票の要否を含め、ここが最も差が出る部分） ---
    if (r.branch === 'transfer') {
      timeline.appendChild(buildTimelineNode(step++, r.qualification.lossDateLabel + '以降', '雇用保険被保険者証・源泉徴収票を準備する', '離職票の到着を待つ必要はありません。転職先へ「雇用保険被保険者証」と「源泉徴収票」を提出しましょう。'));
      if (r.nextJoinDate) {
        const nextJoinLabel = Calc.fmtJP(Calc.parseDate(r.nextJoinDate));
        const gapBody = r.insuranceGap && r.insuranceGap.type === 'gap'
          ? `新しい会社で働き始める日です。退職日との間に約${r.insuranceGap.days}日間の空白期間があるため、国民健康保険・国民年金への一時加入が必要です。`
          : r.insuranceGap && r.insuranceGap.type === 'overlap'
            ? '新しい会社で働き始める予定日ですが、退職日より前になっています。日程を見直してください。'
            : '新しい会社で働き始める日です。退職日の翌日なので、社会保険の手続きは会社間でそのまま引き継がれます。';
        timeline.appendChild(buildTimelineNode(step++, nextJoinLabel, '次の会社で働き始める', gapBody));
      }
      if (r.branchContext && r.branchContext.caution) {
        timeline.appendChild(wrapAside(buildTimelineCaution(r.branchContext.caution.title, r.branchContext.caution.description)));
      }
    } else if (r.branch === 'recuperation') {
      const noticeFrom = Calc.fmtJP(Calc.addDays(r.qualification.lossDate, 10));
      const noticeTo = Calc.fmtJP(Calc.addDays(r.qualification.lossDate, 14));
      timeline.appendChild(buildTimelineNode(step++, `${noticeFrom}〜${noticeTo}ごろ`, '離職票の到着を待ち、基本手当を申請する', '会社から「離職票-1, 2」が自宅に郵送されます。届いたらハローワークで基本手当（および傷病手当金）の申請を行いましょう。', 'caution'));
      if (r.branchDeadline) {
        const bd = r.branchDeadline;
        timeline.appendChild(buildTimelineNode(step++, `${bd.fromLabel}から${bd.toLabel}まで`, '国民健康保険・国民年金へ切り替える', '資格喪失日から原則14日以内に、お住まいの市区町村役場で手続きします。期限を過ぎても加入自体はできますが、給付が受けられない期間が生じる場合があるため早めに済ませましょう。'));
      }
    } else if (r.branch === 'independence') {
      if (r.wantAllowance === 'yes') {
        const noticeFrom = Calc.fmtJP(Calc.addDays(r.qualification.lossDate, 10));
        const noticeTo = Calc.fmtJP(Calc.addDays(r.qualification.lossDate, 14));
        timeline.appendChild(buildTimelineNode(step++, `${noticeFrom}〜${noticeTo}ごろ`, '離職票の到着を待ち、再就職手当を申請する', '再就職手当の申請には離職票が必要です。ハローワークで受給資格が決定してから1か月以内に開業届を提出すると、再就職手当を受け取れなくなる場合があります。', 'caution'));
        if (r.branchContext && r.branchContext.critical) timeline.appendChild(wrapAside(buildCriticalPair(r.branchContext.critical)));
      } else {
        timeline.appendChild(buildTimelineNode(step++, r.qualification.lossDateLabel + '以降', '雇用保険被保険者証を準備する', 'すぐに開業する場合、離職票の到着を待つ必要はありません。雇用保険被保険者証を保管しておきましょう。'));
      }
      if (r.branchDeadline) {
        const bd = r.branchDeadline;
        timeline.appendChild(buildTimelineNode(step++, bd.deadlineLabel + 'まで', '青色申告承認申請書を提出する（開業する場合）', '開業日から2か月以内（1/1〜1/15開業の場合はその年の3/15まで）に税務署へ提出すると、その年から青色申告の特典を受けられます。開業日は退職日の翌日を仮定した目安です。'));
      }
    }

    // --- ⑧ 企業型DC（確定拠出年金）の移管手続き（加入ありの場合のみ） ---
    if (r.dcDeadline) {
      timeline.appendChild(buildTimelineNode(step++, r.dcDeadline.deadlineLabel + 'まで', '企業型DC（確定拠出年金）を移管する', '退職翌日から6か月以内に、iDeCoまたは転職先の企業型DCへの移管手続きを行ってください。放置すると自動的に移管され、運用が停止したうえ手数料がかかり続けます。'));
    }
  }

  // ---------------------------------------------------------------
  // 損失回避コピー（プロスペクト理論：得より損失の方が強く響く）
  // 差額があるときだけ警告として提示し、差がなければ安心コピーに切り替える
  // ---------------------------------------------------------------
  function buildLossAversionHeadline(r) {
    const delta = r.gainLoss.totalDelta;
    if (delta === 0) {
      return `<p class="loss-aversion-safe">✓ 今の退職日のままで問題ありません。損はしていません。</p>`;
    }
    const yen = Math.abs(delta).toLocaleString();
    return `<p class="loss-aversion-warn"><b>【注意】</b>退職日を1日間違えるだけで、最大<b>${yen}円</b>をドブに捨てることになります。</p>`;
  }

  // ---------------------------------------------------------------
  // 進路別のラベル（診断が「誰向け」かを冒頭で明示し、以降のタイムラインとの
  // つながりを分かりやすくする）
  // ---------------------------------------------------------------
  function buildBranchLabel(branch) {
    const LABELS = {
      transfer: '💼 転職される方向けの診断結果です',
      recuperation: '🩺 療養・離職される方向けの診断結果です',
      independence: '🚀 独立される方向けの診断結果です',
    };
    const text = LABELS[branch];
    if (!text) return '';
    return `<p class="text-[11px] font-bold opacity-85 mb-2">${escapeHtml(text)}</p>`;
  }

  // ---------------------------------------------------------------
  // 結論の見出し文言（「結局いつ辞めればいいか」への一言回答）
  // ---------------------------------------------------------------
  function buildHeadline(r) {
    const rec = r.recommendation;

    if (rec.isSameAsUserPlan) {
      return `今考えている退職日（${r.resignDateLabel}）のままで大丈夫です。これが一番損のない退職日です。`;
    }
    if (rec.bonusConflict === 'unreachable') {
      return `次の入社日の都合でボーナス支給日までは在籍できません。空白期間が出ない範囲で理想の日を計算しました。`;
    }
    if (rec.limitedByNextJob) {
      return `次の入社日の前日が、社会保険を途切れさせずに退職できる最終日です。`;
    }
    if (r.bonusDate && r.bonusAmount) {
      return `ボーナス支給日をまたいで在籍できる退職日にすることをおすすめします。`;
    }
    return `社会保険料の自己負担を抑えられるため、退職日を月末に変更することをおすすめします。`;
  }

  // ---------------------------------------------------------------
  // 空白期間（社会保険の切れ目）の注記
  // ---------------------------------------------------------------
  function buildGapNote(r) {
    if (!r.insuranceGap) return '';
    const g = r.insuranceGap;
    if (g.type === 'none') {
      return `<p class="text-[11px] font-bold bg-white/15 rounded-lg px-3 py-2 leading-relaxed mb-2">✓ 社会保険の空白期間なし：退職日の翌日＝入社日（${escapeHtml(g.nextJoinLabel)}）なので、手続きなしで新しい健康保険・厚生年金にそのまま移行できます。</p>`;
    }
    if (g.type === 'gap') {
      return `<p class="text-[11px] font-bold bg-white/15 rounded-lg px-3 py-2 leading-relaxed mb-2">⚠ 約${g.days}日間の空白期間が発生：入社日（${escapeHtml(g.nextJoinLabel)}）までの間、国民健康保険・国民年金への一時加入、または任意継続被保険者制度の手続きが必要です。</p>`;
    }
    return `<p class="text-[11px] font-bold bg-white/15 rounded-lg px-3 py-2 leading-relaxed mb-2">⚠ 退職日と入社日が重なっています：入社日（${escapeHtml(g.nextJoinLabel)}）が退職日より前になっているため、日程を見直してください。</p>`;
  }

  // ---------------------------------------------------------------
  // ボーナス（賞与）の受給可否の注記
  // ---------------------------------------------------------------
  function buildBonusNote(r) {
    if (!r.bonusDate || !r.bonusAmount) return '';
    const gl = r.gainLoss;
    const bonusLabel = gl.recommendedBonus ? gl.recommendedBonus.bonusDateLabel : '';
    const amountLabel = Number(r.bonusAmount).toLocaleString();

    if (gl.userBonus.willReceive) {
      return `<p class="text-[11px] font-bold bg-white/15 rounded-lg px-3 py-2 leading-relaxed mb-2">✓ 今の予定でもボーナス（約${amountLabel}円・支給日${escapeHtml(bonusLabel)}）は受け取れる見込みです。</p>`;
    }
    if (gl.recommendedBonus.willReceive) {
      return `<p class="text-[11px] font-bold bg-white/15 rounded-lg px-3 py-2 leading-relaxed mb-2">⚠ 今の予定のままだとボーナス（約${amountLabel}円）を受け取れません。理想の日まで在籍すれば、支給日（${escapeHtml(bonusLabel)}）に間に合い受け取れます。</p>`;
    }
    return `<p class="text-[11px] font-bold bg-white/15 rounded-lg px-3 py-2 leading-relaxed mb-2">⚠ 次の入社日の都合で、ボーナス（約${amountLabel}円・支給日${escapeHtml(bonusLabel)}）には間に合いません。</p>`;
  }

  // ---------------------------------------------------------------
  // 損得の内訳（社会保険料 + ボーナス）
  // ---------------------------------------------------------------
  function buildGainLossBlock(r) {
    const gl = r.gainLoss;
    const rowStyle = 'display:flex;justify-content:space-between;gap:10px;padding:5px 0;';
    const rows = [];
    if (gl.insuranceDelta !== 0) {
      rows.push(`<div style="${rowStyle}"><span>社会保険料の差</span><b>${signedYen(gl.insuranceDelta)}</b></div>`);
    }
    if (gl.bonusDelta !== 0) {
      rows.push(`<div style="${rowStyle}"><span>ボーナスの有無の差</span><b>${signedYen(gl.bonusDelta)}</b></div>`);
    }

    if (gl.totalDelta === 0) {
      return `
        <div class="border-t pt-3 mt-1" style="border-color:rgba(255,255,255,.25);">
          <p class="text-[11px] font-black tracking-widest opacity-80 mb-1">退職日を変えた場合の損得</p>
          <p class="text-lg font-black mb-1">差はありません</p>
          <p class="text-xs opacity-90 leading-relaxed">今の予定のままで、社会保険料・ボーナスともに理想の日と同じ結果になります。</p>
        </div>`;
    }

    const sign = gl.totalDelta > 0 ? 'お得' : '損';
    const absYen = Math.abs(gl.totalDelta).toLocaleString();
    return `
      <div class="border-t pt-3 mt-1" style="border-color:rgba(255,255,255,.25);">
        <p class="text-[11px] font-black tracking-widest opacity-80 mb-1">退職日を変えた場合の損得</p>
        <p class="text-xl font-black mb-1">理想の日にすると約${absYen}円${sign}</p>
        <div class="text-xs" style="background:rgba(255,255,255,.12);border-radius:.5rem;padding:2px 12px;">
          ${rows.join('')}
        </div>
      </div>`;
  }

  function signedYen(yen) {
    const sign = yen > 0 ? '+' : (yen < 0 ? '−' : '±');
    return `${sign}${Math.abs(yen).toLocaleString()}円`;
  }

  // ---------------------------------------------------------------
  // 番号付き・日付付きの接続タイムラインノード
  // 「具体的にいつ・何をするか」を1項目1アクションで明示する。
  // ---------------------------------------------------------------
  function buildTimelineNode(stepNum, dateLabel, heading, body, variant) {
    const el = document.createElement('div');
    el.className = 'tl-item';
    el.innerHTML = `
      <div class="tl-node">
        <span class="tl-num">${stepNum}</span>
        <span class="tl-line"></span>
      </div>
      <div class="tl-card${variant ? ' ' + variant : ''}">
        <span class="tl-date">${escapeHtml(dateLabel)}</span>
        <h3 class="tl-heading">${escapeHtml(heading)}</h3>
        <p class="tl-body">${escapeHtml(body)}</p>
      </div>
    `;
    return el;
  }

  // 番号を持たない補足カード（アラート/テキストアドバイス）を、直前の番号付き
  // アクションに従属する形で挿入するためのラッパー。
  function wrapAside(el) {
    const wrap = document.createElement('div');
    wrap.className = 'tl-aside';
    wrap.appendChild(el);
    return wrap;
  }

  // 番号を持たない一般的な注意カード（住民税の一括徴収など、日付に紐づかない補足情報）
  function buildTimelineCaution(heading, body) {
    const el = document.createElement('div');
    el.className = 'rounded-2xl border-2 p-4 shadow-card border-caution bg-caution-light';
    el.innerHTML = `
      <p class="text-[11px] font-black tracking-wider text-caution-dark mb-1">CAUTION</p>
      <h3 class="text-sm font-bold text-navy mb-1">${escapeHtml(heading)}</h3>
      <p class="text-xs text-slate-600 leading-relaxed">${escapeHtml(body)}</p>
    `;
    return el;
  }

  // 純粋なテキストアドバイスカード（外部リンク・PRバッジ・クリックハンドラなし）
  function buildAdviceCard(label, body) {
    const el = document.createElement('div');
    el.className = 'tl-advice';
    el.innerHTML = `
      <p class="ta-label">${escapeHtml(label)}</p>
      <p class="ta-body">${escapeHtml(body)}</p>
    `;
    return el;
  }

  // Crimson警告 × Emerald解決アクションの必須ペア描画
  function buildCriticalPair(critical) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="rounded-2xl border-2 border-crimson bg-crimson-light p-4 shadow-card">
        <div class="flex items-start gap-2">
          <span class="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-crimson text-white text-[11px] font-black flex items-center justify-center">!</span>
          <div>
            <p class="text-[11px] font-black tracking-wider text-crimson mb-0.5">CRITICAL ALERT</p>
            <p class="snippet-fuel text-sm text-crimson-dark leading-snug">${escapeHtml(critical.title)}</p>
            <p class="text-xs text-crimson-dark/80 mt-1 leading-relaxed">${escapeHtml(critical.description)}</p>
          </div>
        </div>
      </div>
      <div class="flex justify-center -my-3 relative z-10">
        <div class="w-8 h-8 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center shadow-card">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="3"><path d="M12 4v16m0 0l-6-6m6 6l6-6"/></svg>
        </div>
      </div>
      <div class="rounded-2xl border-2 border-emerald bg-emerald-light p-4 shadow-card">
        <div class="flex items-start gap-2">
          <span class="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-emerald text-white text-[11px] font-black flex items-center justify-center">✓</span>
          <div>
            <p class="text-[11px] font-black tracking-wider text-emerald mb-0.5">解決アクション</p>
            <p class="text-sm font-bold text-emerald-dark leading-snug">${escapeHtml(critical.solutionTitle)}</p>
            <p class="text-xs text-emerald-dark/80 mt-1 leading-relaxed">${escapeHtml(critical.solutionDescription)}</p>
          </div>
        </div>
      </div>
    `;
    return wrap;
  }

  // ---------------------------------------------------------------
  // Xシェア：ワンタップ投稿テキスト生成
  // ---------------------------------------------------------------
  function onShareX() {
    const r = state.result;
    if (!r) return;
    const deltaLine = r.gainLoss.totalDelta === 0
      ? '今の予定のままで問題なし'
      : `理想の日にすると約${Math.abs(r.gainLoss.totalDelta).toLocaleString()}円${r.gainLoss.totalDelta > 0 ? 'お得' : '損'}`;
    const text = [
      `【退職日シミュレーション結果】`,
      `理想の退職日：${r.recommendation.dateLabel}`,
      `最終出社日：${r.lastWorkDayLabel}`,
      `資格喪失日：${r.qualification.lossDateLabel}`,
      deltaLine,
      `#トク退 #退職準備`,
    ].join('\n');

    const url = new URL('https://twitter.com/intent/tweet');
    url.searchParams.set('text', text);
    url.searchParams.set('url', 'https://taishokubi-navi.pages.dev/');
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  // ---------------------------------------------------------------
  // 印刷 / PDF保存
  // ---------------------------------------------------------------
  function onPrint() {
    window.print();
  }

  // ---------------------------------------------------------------
  // LocalStorage 管理（SafeStorage経由。マイグレーションは
  // createInitialState() をベースにしたマージで実現する）
  // ---------------------------------------------------------------
  function saveToStorage() {
    const persistable = {
      resignDate: state.resignDate,
      retireReason: state.retireReason,
      nextJoinDate: state.nextJoinDate,
      bonusDate: state.bonusDate,
      bonusAmount: state.bonusAmount,
      offDays: state.offDays,
      closedOnHolidays: state.closedOnHolidays,
      extraOffDates: state.extraOffDates,
      extraWorkDates: state.extraWorkDates,
      paidLeave: state.paidLeave,
      handoverDays: state.handoverDays,
      annualIncome: state.annualIncome,
      salary: state.salary,
      insuranceType: state.insuranceType,
      corporateDC: state.corporateDC,
      retirementPay: state.retirementPay,
      branch: state.branch,
      wantAllowance: state.wantAllowance,
    };
    const ok = SafeStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    if (!ok) console.warn('LocalStorage save skipped (unavailable or failed).');
  }

  function restoreFromStorage() {
    const raw = SafeStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.warn('LocalStorage restore failed (invalid JSON):', e);
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;

    // マイグレーション：createInitialState() をベースに保存データをマージする。
    // こうすることで、旧バージョンのデータに新フィールドが欠けていても
    // 必ずデフォルト値で補われ、undefined由来のバグを防げる。
    Object.assign(state, createInitialState(), parsed);

    if (!Array.isArray(state.extraOffDates)) state.extraOffDates = [];
    if (!Array.isArray(state.extraWorkDates)) state.extraWorkDates = [];
    if (state.handoverDays === undefined || state.handoverDays === null) state.handoverDays = 0;

    // 旧データ互換：closedOnSaturday(boolean) しかない場合は offDays へ変換する。
    if (!Array.isArray(parsed.offDays) || !parsed.offDays.length) {
      state.offDays = parsed.closedOnSaturday !== undefined
        ? (parsed.closedOnSaturday === false ? [0] : [0, 6])
        : [0, 6];
    }
    delete state.closedOnSaturday;

    // 旧データ互換：insuranceType が保存データに無く isUnionKenpo(boolean) しかない場合に変換。
    if (parsed.insuranceType === undefined && parsed.isUnionKenpo !== undefined) {
      state.insuranceType = parsed.isUnionKenpo ? 'kumiai' : 'kyokai';
    }
    delete state.isUnionKenpo;

    if (state.nextJoinDate) document.getElementById('inputNextJoinDate').value = state.nextJoinDate;
    if (state.bonusDate) {
      document.getElementById('inputBonusDate').value = state.bonusDate;
      document.getElementById('bonusAmountField').hidden = false;
    }
    if (state.bonusAmount) document.getElementById('inputBonusAmount').value = state.bonusAmount;
    if (state.paidLeave !== null && state.paidLeave !== undefined) document.getElementById('inputPaidLeave').value = state.paidLeave;
    document.getElementById('inputHandoverDays').value = state.handoverDays;
    if (state.annualIncome) {
      document.getElementById('inputAnnualIncome').value = state.annualIncome;
      if (!state.salary) state.salary = Calc.estimateMonthlyFromAnnual(state.annualIncome);
    }
    document.getElementById('inputRetireReason').value = state.retireReason;
    document.getElementById('inputInsuranceType').value = state.insuranceType;
    document.getElementById('inputCorporateDC').value = state.corporateDC;
    document.getElementById('inputRetirementPay').value = state.retirementPay;
    document.getElementById('inputWantAllowance').value = state.wantAllowance;
    document.getElementById('holidayOnBtn').setAttribute('aria-pressed', String(state.closedOnHolidays !== false));
    document.getElementById('holidayOffBtn').setAttribute('aria-pressed', String(state.closedOnHolidays === false));
    if (state.branch) {
      document.querySelectorAll('#branchSelector .branch-btn').forEach(b => {
        const active = b.dataset.branch === state.branch;
        b.classList.toggle('border-emerald', active);
        b.classList.toggle('bg-emerald-light', active);
        b.classList.toggle('border-slate-300', !active);
      });
    }
    updateNextJoinDateVisibility();
    updateWantAllowanceVisibility();
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
})();
