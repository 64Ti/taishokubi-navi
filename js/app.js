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
    closedOnSaturday: true,
    closedOnHolidays: true,
    extraOffDates: [],     // ['YYYY-MM-DD', ...]
    paidLeave: null,
    salary: null,
    insuranceContinuation: 'kokuho',
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

    // STEP1
    document.getElementById('inputResignDate').addEventListener('change', e => {
      const todayISO = Calc.fmtISO(new Date());
      if (e.target.value < todayISO) { e.target.value = todayISO; }
      state.resignDate = e.target.value;
      saveToStorage();
      validateStep1();
    });

    // STEP2
    document.getElementById('toggleSaturday').addEventListener('click', () => toggleSwitch('closedOnSaturday'));
    document.getElementById('toggleHoliday').addEventListener('click', () => toggleSwitch('closedOnHolidays'));
    document.getElementById('inputPaidLeave').addEventListener('input', e => {
      state.paidLeave = e.target.value;
      saveToStorage();
      validateStep2();
      updateLivePreview();
    });
    document.getElementById('btnAddExtraDate').addEventListener('click', onAddExtraDate);

    // STEP3
    document.getElementById('inputSalary').addEventListener('input', e => {
      state.salary = e.target.value;
      saveToStorage();
      validateStep3();
    });
    document.getElementById('inputInsuranceContinuation').addEventListener('change', e => {
      state.insuranceContinuation = e.target.value;
      saveToStorage();
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

  function toggleSwitch(key) {
    state[key] = !state[key];
    const id = key === 'closedOnSaturday' ? 'toggleSaturday' : 'toggleHoliday';
    const el = document.getElementById(id);
    el.classList.toggle('toggle-on', state[key]);
    el.setAttribute('aria-pressed', String(state[key]));
    saveToStorage();
    updateLivePreview();
  }

  // ---------------------------------------------------------------
  // STEP2：独自休業予定日リスト
  // ---------------------------------------------------------------
  function onAddExtraDate() {
    const input = document.getElementById('extraDateInput');
    if (!input.value) return;
    if (state.extraOffDates.length >= 3) return;
    if (state.extraOffDates.includes(input.value)) return;
    state.extraOffDates.push(input.value);
    state.extraOffDates.sort();
    input.value = '';
    saveToStorage();
    renderExtraDatesList();
    updateLivePreview();
  }

  function renderExtraDatesList() {
    const container = document.getElementById('extraDatesList');
    container.innerHTML = '';
    state.extraOffDates.forEach(dateStr => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm';
      row.innerHTML = `
        <span>${escapeHtml(Calc.fmtJP(Calc.parseDate(dateStr)))}</span>
        <button type="button" class="text-slate-400 text-xs font-bold" data-date="${escapeAttr(dateStr)}">削除</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        state.extraOffDates = state.extraOffDates.filter(d => d !== dateStr);
        saveToStorage();
        renderExtraDatesList();
        updateLivePreview();
      });
      container.appendChild(row);
    });
  }

  function buildBusinessDayChecker() {
    return H.createBusinessDayChecker({
      closedOnSaturday: state.closedOnSaturday,
      closedOnHolidays: state.closedOnHolidays,
      extraOffDates: state.extraOffDates,
    });
  }

  function updateLivePreview() {
    const preview = document.getElementById('livePreview');
    if (!state.resignDate || state.paidLeave === null || state.paidLeave === '') {
      preview.classList.add('hidden');
      return;
    }
    const resignDate = Calc.parseDate(state.resignDate);
    const checker = buildBusinessDayChecker();
    const r = Calc.calcPaidLeaveBackward(resignDate, state.paidLeave, checker);
    document.getElementById('previewLastWorkDay').textContent = Calc.fmtJP(r.lastWorkDay);
    preview.classList.remove('hidden');
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
    const valid = state.paidLeave !== null && state.paidLeave !== '' && Number(state.paidLeave) >= 0 && Number(state.paidLeave) <= 40;
    document.getElementById('btnNext').disabled = !valid;
    return valid;
  }
  function validateStep3() {
    const valid = !!state.salary && !!state.branch;
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
      resignDate: null, closedOnSaturday: true, closedOnHolidays: true, extraOffDates: [],
      paidLeave: null, salary: null, insuranceContinuation: 'kokuho', isUnionKenpo: false,
      branch: null, result: null,
    });
    document.getElementById('inputPaidLeave').value = '';
    document.getElementById('inputSalary').value = '';
    document.getElementById('inputInsuranceContinuation').value = 'kokuho';
    document.getElementById('inputUnionKenpo').checked = false;
    document.getElementById('toggleSaturday').classList.add('toggle-on');
    document.getElementById('toggleHoliday').classList.add('toggle-on');
    document.querySelectorAll('#branchSelector .branch-btn').forEach(b => {
      b.classList.remove('border-emerald', 'bg-emerald-light');
      b.classList.add('border-slate-300');
    });
    prefillDefaultDate();
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
    const paidLeaveResult = Calc.calcPaidLeaveBackward(resignDate, state.paidLeave, checker);
    const gradeResult = Calc.calcStandardRemunerationGrade(state.salary);
    const qualification = Calc.calcQualificationLossDate(resignDate, state.isUnionKenpo);
    const insuranceOptimization = Calc.calcInsuranceOptimization(resignDate, gradeResult);
    const impact = Calc.calcTakeHomeImpact(state.salary, state.paidLeave, insuranceOptimization);
    const branchContext = Calc.getBranchContext(state.branch);

    state.result = {
      resignDate,
      resignDateLabel: Calc.fmtJP(resignDate),
      lastWorkDay: paidLeaveResult.lastWorkDay,
      lastWorkDayLabel: Calc.fmtJP(paidLeaveResult.lastWorkDay),
      paidLeaveStartDay: paidLeaveResult.paidLeaveStartDay,
      paidLeaveStartLabel: paidLeaveResult.paidLeaveStartDay ? Calc.fmtJP(paidLeaveResult.paidLeaveStartDay) : null,
      grade: gradeResult,
      qualification,
      insuranceOptimization,
      impact,
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

    // 手取り最大化インパクトカード（Gold Amber）
    const impactCard = document.getElementById('impactCard');
    const optimalNote = r.insuranceOptimization.isOptimal
      ? '現在の退職希望日はすでに社会保険料の観点で最適な「月末退職」です。'
      : `退職日を${r.insuranceOptimization.optimalDateLabel}（月末）に変更すると、社会保険料の自己負担を約${r.insuranceOptimization.potentialSavings.toLocaleString()}円抑えられる可能性があります。`;
    impactCard.innerHTML = `
      <p class="text-[11px] font-black tracking-widest opacity-80 mb-1">手取り最大化インパクト</p>
      <p class="text-3xl font-black mb-1">${r.impact.totalImpact.toLocaleString()}円</p>
      <p class="text-xs opacity-90 leading-relaxed mb-2">
        有休消化価値 約${r.impact.paidLeaveValue.toLocaleString()}円（日給概算${r.impact.dailyWage.toLocaleString()}円×${r.impact.days}日）
        ${r.impact.insuranceSavings > 0 ? `＋ 社会保険料最適化 約${r.impact.insuranceSavings.toLocaleString()}円` : ''}
      </p>
      <p class="text-[11px] font-bold bg-white/15 rounded-lg px-3 py-2 leading-relaxed">最適退職日：${r.insuranceOptimization.optimalDateLabel}／${escapeHtml(optimalNote)}</p>
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
    const text = [
      `【退職日シミュレーション結果】`,
      `最適退職日：${r.insuranceOptimization.optimalDateLabel}`,
      `最終出社日：${r.lastWorkDayLabel}`,
      `資格喪失日：${r.qualification.lossDateLabel}`,
      `手取り最大化インパクト：約${r.impact.totalImpact.toLocaleString()}円`,
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
        closedOnSaturday: state.closedOnSaturday,
        closedOnHolidays: state.closedOnHolidays,
        extraOffDates: state.extraOffDates,
        paidLeave: state.paidLeave,
        salary: state.salary,
        insuranceContinuation: state.insuranceContinuation,
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

      if (state.paidLeave !== null && state.paidLeave !== undefined) document.getElementById('inputPaidLeave').value = state.paidLeave;
      if (state.salary) document.getElementById('inputSalary').value = state.salary;
      document.getElementById('inputInsuranceContinuation').value = state.insuranceContinuation || 'kokuho';
      document.getElementById('inputUnionKenpo').checked = !!state.isUnionKenpo;
      document.getElementById('toggleSaturday').classList.toggle('toggle-on', state.closedOnSaturday !== false);
      document.getElementById('toggleHoliday').classList.toggle('toggle-on', state.closedOnHolidays !== false);
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
