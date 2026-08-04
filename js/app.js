/**
 * app.js
 * トク退：UI制御本体 Ver.4.0.0
 * STEP1(退職希望日) → STEP2(休日・有休設定) → STEP3(給与・進路3分岐) → 結果(ToDoタイムライン)
 */
(function () {
  'use strict';

  const Calc = window.TokutaiCalculator;
  const H = window.HolidaysJP;
  const Schema = window.SchemaGenerator;

  const STORAGE_KEY = 'tokutai_navi_state_v4';
  const STEPS = ['step1', 'step2', 'step3', 'stepResult'];
  const STEP_LABELS = ['STEP 1 / 3', 'STEP 2 / 3', 'STEP 3 / 3', '診断結果'];
  let currentStepIndex = 0;

  const state = {
    resignDate: null,      // 'YYYY-MM-DD'
    nextJoinDate: null,    // 'YYYY-MM-DD'（次の会社への入社予定日・任意）
    bonusDate: null,       // 'YYYY-MM-DD'（次回ボーナス支給予定日・任意）
    bonusAmount: null,     // 選択したボーナス見込み額の代表額（円）
    offDays: [0, 6],       // 毎週の定休日（0:日〜6:土）。シフト制の人向けに自由選択。
    closedOnHolidays: true,
    extraOffDates: [],     // ['YYYY-MM-DD', ...] 会社独自の休み
    extraWorkDates: [],    // ['YYYY-MM-DD', ...] 会社独自の出勤日
    paidLeave: null,
    handoverDays: 0,       // 引き継ぎ必要日数
    annualIncome: null,    // 選択した年収帯の代表額（円）
    salary: null,          // annualIncome から換算した月給概算（円）
    isUnionKenpo: false,
    branch: null,
    result: null,
  };

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
    document.getElementById('sheetBackdrop').addEventListener('click', closeSheet);
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
    document.getElementById('inputNextJoinDate').addEventListener('change', e => {
      state.nextJoinDate = e.target.value || null;
      saveToStorage();
    });
    document.getElementById('inputBonusDate').addEventListener('change', e => {
      state.bonusDate = e.target.value || null;
      document.getElementById('bonusAmountField').hidden = !state.bonusDate;
      saveToStorage();
      // STEP1の入力なので、他ステップの btnNext 状態には触れない
      // （STEP3側は inputBonusAmount のハンドラと renderStep() が担当する）
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
    document.getElementById('inputUnionKenpo').addEventListener('change', e => {
      state.isUnionKenpo = e.target.checked;
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
        saveToStorage();
        validateStep3();
      });
    });
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

    // ③④ 自分が指定した退職日に対して、いつが理想かを先出しで伝える
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
  // ② 期間内の祝日カレンダー（可視化）
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
    localStorage.removeItem(STORAGE_KEY);
    Object.assign(state, {
      resignDate: null, nextJoinDate: null, bonusDate: null, bonusAmount: null,
      offDays: [0, 6], closedOnHolidays: true,
      extraOffDates: [], extraWorkDates: [],
      paidLeave: null, handoverDays: 0, annualIncome: null, salary: null, isUnionKenpo: false,
      branch: null, result: null,
    });
    document.getElementById('inputNextJoinDate').value = '';
    document.getElementById('inputBonusDate').value = '';
    document.getElementById('inputBonusAmount').value = '';
    document.getElementById('bonusAmountField').hidden = true;
    document.getElementById('inputPaidLeave').value = '';
    document.getElementById('inputHandoverDays').value = '0';
    document.getElementById('inputAnnualIncome').value = '';
    document.getElementById('inputUnionKenpo').checked = false;
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
    const paidLeaveResult = Calc.calcPaidLeaveBackward(resignDate, state.paidLeave, checker, state.handoverDays);
    const gradeResult = Calc.calcStandardRemunerationGrade(state.salary);
    const qualification = Calc.calcQualificationLossDate(resignDate, state.isUnionKenpo);
    const insuranceOptimization = Calc.calcInsuranceOptimization(resignDate, gradeResult);
    const branchContext = Calc.getBranchContext(state.branch);
    const recommendation = Calc.calcRecommendedResignDate(resignDate, state.nextJoinDate, insuranceOptimization, state.bonusDate);
    const insuranceGap = Calc.calcInsuranceGap(recommendation.date, state.nextJoinDate);

    // ⑤⑦⑨ 損得計算：指定日のまま vs 理想の退職日で、社会保険料とボーナスがどう変わるか
    const gainLoss = Calc.calcResignDateGainLoss(resignDate, recommendation.date, gradeResult, state.bonusDate, state.bonusAmount);

    // 有休の金銭的価値は「参考情報」。退職日をどちらにしても消化日数が同じなら変わらない。
    const paidLeaveInfo = Calc.calcTakeHomeImpact(state.salary, state.paidLeave, { potentialSavings: 0 });

    state.result = {
      resignDate,
      resignDateLabel: Calc.fmtJP(resignDate),
      nextJoinDate: state.nextJoinDate,
      lastWorkDay: paidLeaveResult.lastWorkDay,
      lastWorkDayLabel: Calc.fmtJP(paidLeaveResult.lastWorkDay),
      paidLeaveStartDay: paidLeaveResult.paidLeaveStartDay,
      paidLeaveStartLabel: paidLeaveResult.paidLeaveStartDay ? Calc.fmtJP(paidLeaveResult.paidLeaveStartDay) : null,
      grade: gradeResult,
      qualification,
      insuranceOptimization,
      recommendation,
      insuranceGap,
      gainLoss,
      paidLeaveInfo,
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
  // 結果画面：インパクトカード + ToDoタイムライン
  // ---------------------------------------------------------------
  function renderResult() {
    const r = state.result;

    // ヘッダーカード：まず「結局いつ辞めればいいか」の結論を最上段に出す（Gold Amber）
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

    impactCard.innerHTML = `
      <p class="text-[11px] font-black tracking-widest opacity-80 mb-1">あなたの理想の退職日</p>
      <p class="text-3xl font-black mb-2">${escapeHtml(r.recommendation.dateLabel)}</p>
      <p class="text-xs opacity-90 leading-relaxed mb-2">${escapeHtml(headline)}</p>
      ${compareRow}
      ${gapNote}
      ${bonusNote}
      ${gainLossBlock}
      <p class="text-[11px] opacity-80 leading-relaxed mt-3">※有休消化の価値（約${r.paidLeaveInfo.paidLeaveValue.toLocaleString()}円／日給概算${r.paidLeaveInfo.dailyWage.toLocaleString()}円×${r.paidLeaveInfo.days}日）は、退職日をどちらにしても消化日数が同じであれば変わらないため、上の損得には含めていません。</p>
    `;

    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';

    // --- タイムライン項目1：離職票タイムラグ注記（STEP1文脈・常設Caution） ---
    timeline.appendChild(buildTimelineCard({
      heading: '離職票の到着を待つ',
      snippetFuel: '結論：離職票は退職後10日〜2週間で郵送されます。届いてから役所手続きへ進みましょう。',
      body: '会社から「離職票-1, 2」が自宅に郵送されてからハローワーク・役所へ向かいましょう（退職後10日〜2週間程度かかります）。',
      colorClass: 'border-caution bg-caution-light',
      labelClass: 'text-caution-dark',
      labelText: 'CAUTION',
    }));

    // --- ②療養branchの critical はSTEP1文脈のため、離職票の後に挿入 ---
    if (r.branchContext && r.branchContext.critical && r.branch === 'recuperation') {
      timeline.appendChild(buildCriticalPair(r.branchContext.critical));
    }

    // --- タイムライン項目2：最終出社日 ---
    timeline.appendChild(buildTimelineCard({
      heading: '最終出社日',
      snippetFuel: `結論：${r.lastWorkDayLabel}までに引き継ぎ業務を完了させてください。`,
      body: `有休消化前の最終出社日は${r.lastWorkDayLabel}です。引き継ぎ資料の準備はこの日までに終えましょう。`,
      colorClass: 'border-slate-200 bg-white',
      labelClass: 'text-navy/60',
      labelText: 'TASK',
    }));

    // --- タイムライン項目3：有休消化開始（①転職branchの文脈monetizeをここに挿入） ---
    if (r.paidLeaveStartLabel) {
      timeline.appendChild(buildTimelineCard({
        heading: '有給休暇の消化を開始',
        snippetFuel: `結論：${r.paidLeaveStartLabel}から退職日まで有給休暇を消化します。`,
        body: `${r.paidLeaveStartLabel}から有給休暇の消化期間に入ります。`,
        colorClass: 'border-slate-200 bg-white',
        labelClass: 'text-navy/60',
        labelText: 'TASK',
      }));
    }
    if (r.branchContext && r.branch === 'transfer') {
      timeline.appendChild(buildMonetizeCard(r.branchContext.monetize));
    }

    // --- タイムライン項目4：退職日・資格喪失日（社労士実務ロジック） ---
    const qualCard = document.createElement('div');
    qualCard.className = `rounded-2xl border-2 p-4 shadow-card border-crimson bg-crimson-light`;
    qualCard.innerHTML = `
      <p class="text-[11px] font-black tracking-wider text-crimson mb-1">社会保険 資格喪失日</p>
      <p class="snippet-fuel text-sm text-crimson-dark leading-snug mb-2">結論：資格喪失日は退職日の翌日（${r.qualification.lossDateLabel}）。月末退職なら保険料は労使折半で済みます。</p>
      <p class="text-xs text-crimson-dark/80 leading-relaxed">${escapeHtml(r.qualification.note)}</p>
      ${r.qualification.unionKenpoNote ? `<p class="text-xs text-crimson-dark/80 leading-relaxed mt-2 border-t border-crimson/20 pt-2">※${escapeHtml(r.qualification.unionKenpoNote)}</p>` : ''}
    `;
    timeline.appendChild(qualCard);

    // --- タイムライン項目5：③独立branchの開業届提出（STEP3文脈） / critical ---
    if (r.branchContext && r.branch === 'independence') {
      if (r.branchContext.critical) timeline.appendChild(buildCriticalPair(r.branchContext.critical));
      timeline.appendChild(buildMonetizeCard(r.branchContext.monetize));
    }
    if (r.branchContext && r.branch === 'recuperation') {
      timeline.appendChild(buildMonetizeCard(r.branchContext.monetize));
    }

    // --- 転職branchの一般Caution ---
    if (r.branchContext && r.branchContext.caution) {
      timeline.appendChild(buildTimelineCard({
        heading: r.branchContext.caution.title,
        snippetFuel: null,
        body: r.branchContext.caution.description,
        colorClass: 'border-caution bg-caution-light',
        labelClass: 'text-caution-dark',
        labelText: 'CAUTION',
      }));
    }
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
      // 今の予定でも既にもらえる
      return `<p class="text-[11px] font-bold bg-white/15 rounded-lg px-3 py-2 leading-relaxed mb-2">✓ 今の予定でもボーナス（約${amountLabel}円・支給日${escapeHtml(bonusLabel)}）は受け取れる見込みです。</p>`;
    }
    if (gl.recommendedBonus.willReceive) {
      // 今の予定だと逃すが、理想の日にすれば受け取れる
      return `<p class="text-[11px] font-bold bg-white/15 rounded-lg px-3 py-2 leading-relaxed mb-2">⚠ 今の予定のままだとボーナス（約${amountLabel}円）を受け取れません。理想の日まで在籍すれば、支給日（${escapeHtml(bonusLabel)}）に間に合い受け取れます。</p>`;
    }
    // 理想の日にしても間に合わない（入社日の制約など）
    return `<p class="text-[11px] font-bold bg-white/15 rounded-lg px-3 py-2 leading-relaxed mb-2">⚠ 次の入社日の都合で、ボーナス（約${amountLabel}円・支給日${escapeHtml(bonusLabel)}）には間に合いません。</p>`;
  }

  // ---------------------------------------------------------------
  // ④ 損得の内訳（社会保険料 + ボーナス）
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

  function buildTimelineCard({ heading, snippetFuel, body, colorClass, labelClass, labelText }) {
    const el = document.createElement('div');
    el.className = `rounded-2xl border-2 p-4 shadow-card ${colorClass}`;
    el.innerHTML = `
      <p class="text-[11px] font-black tracking-wider ${labelClass} mb-1">${escapeHtml(labelText)}</p>
      <h3 class="text-sm font-bold text-navy mb-1">${escapeHtml(heading)}</h3>
      ${snippetFuel ? `<p class="snippet-fuel text-xs text-navy mb-1.5 leading-relaxed">${escapeHtml(snippetFuel)}</p>` : ''}
      <p class="text-xs text-slate-500 leading-relaxed">${escapeHtml(body)}</p>
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

  // 進路文脈型マネタイズ導線カード（PR表記／Slate Light）
  function buildMonetizeCard(monetize) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'w-full text-left rounded-2xl border border-slate-200 bg-white p-4 shadow-card';
    el.innerHTML = `
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-[10px] font-black text-white bg-monetize rounded px-1.5 py-0.5">PR</span>
        <span class="text-[10px] font-bold text-slate-400">${escapeHtml(monetize.taskContext)}</span>
      </div>
      <p class="text-sm font-bold text-navy leading-snug mb-1.5">${escapeHtml(monetize.message)}</p>
      <span class="inline-flex items-center gap-1 text-xs font-bold text-gold">${escapeHtml(monetize.ctaLabel)} →</span>
    `;
    el.addEventListener('click', () => openSheet(monetize.ctaLabel, monetize.message));
    return el;
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
  // ボトムシート（PR詳細・免責）
  // ---------------------------------------------------------------
  function openSheet(title, desc) {
    document.getElementById('sheetContent').innerHTML = `
      <div class="flex items-center gap-2 mb-2">
        <span class="text-[10px] font-black text-white bg-monetize rounded px-1.5 py-0.5">PR</span>
        <h4 class="text-base font-black text-navy">${escapeHtml(title)}</h4>
      </div>
      <p class="text-sm text-slate-600 leading-relaxed mb-4">${escapeHtml(desc)}</p>
      <p class="text-[11px] text-slate-400 leading-relaxed">
        本サービスの紹介にはアフィリエイトプログラムを利用しており、リンク経由でお申し込みいただくと
        当サイトに紹介料が発生する場合があります。表示内容は情報提供時点のものです。
      </p>
      <button id="sheetCloseBtn" class="w-full mt-5 bg-navy text-white rounded-xl py-3 text-sm font-bold">閉じる</button>
    `;
    document.getElementById('sheetCloseBtn').addEventListener('click', closeSheet);
    document.getElementById('bottomSheet').classList.add('open');
    document.getElementById('sheetBackdrop').classList.add('open');
  }
  function closeSheet() {
    document.getElementById('bottomSheet').classList.remove('open');
    document.getElementById('sheetBackdrop').classList.remove('open');
  }

  // ---------------------------------------------------------------
  // LocalStorage 管理
  // ---------------------------------------------------------------
  function saveToStorage() {
    try {
      const persistable = {
        resignDate: state.resignDate,
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
        isUnionKenpo: state.isUnionKenpo,
        branch: state.branch,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  }

  function restoreFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      Object.assign(state, JSON.parse(raw));

      if (!Array.isArray(state.extraOffDates)) state.extraOffDates = [];
      if (!Array.isArray(state.extraWorkDates)) state.extraWorkDates = [];
      if (state.handoverDays === undefined || state.handoverDays === null) state.handoverDays = 0;

      // 旧データ互換：closedOnSaturday(boolean) しかない場合は offDays へ変換する
      if (!Array.isArray(state.offDays) || !state.offDays.length) {
        if (state.closedOnSaturday !== undefined) {
          state.offDays = state.closedOnSaturday === false ? [0] : [0, 6];
        } else {
          state.offDays = [0, 6];
        }
      }
      delete state.closedOnSaturday;

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
        // 旧データ互換：salary が未保存の場合は annualIncome から再計算する
        if (!state.salary) state.salary = Calc.estimateMonthlyFromAnnual(state.annualIncome);
      }
      document.getElementById('inputUnionKenpo').checked = !!state.isUnionKenpo;
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
    } catch (e) {
      console.warn('LocalStorage restore failed:', e);
    }
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
