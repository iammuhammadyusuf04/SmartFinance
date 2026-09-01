/* ============================================================
   SmartFinance PWA — Application logic
   100% local-first. No network calls. State lives in localStorage.

   Data model (v2):
   state = {
     settings: { salaryDay, currency, theme },
     periods: [ { id, periodStart, salaryAmount, categories:[...], closed } ],
     expenses: [ { id, periodId, categoryId, amount, date, note } ],
     incomes:  [ { id, periodId, amount, date, note } ],
     debts:    [ { id, periodId, type:'lent'|'borrowed', amount, date, note } ]
   }
   Every period is a frozen snapshot once closed — editing salary or
   category percentages only ever touches the LAST (open) period.
   ============================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'smartfinance_state_v2';
  const OLD_STORAGE_KEY = 'smartfinance_state_v1';

  const DEFAULT_CATEGORIES = [
    { id: 'cat_food',     name: "Oziq-ovqat va Ro'zg'or",        icon: '🍲', percentage: 25, color: '#10B981' },
    { id: 'cat_home',     name: 'Kvartira / Ijara / Kommunal',    icon: '🏠', percentage: 15, color: '#6366F1' },
    { id: 'cat_parents',  name: "Ota-onaga yordam / Ehson",       icon: '🧓', percentage: 15, color: '#3B82F6' },
    { id: 'cat_savings',  name: 'Jamg\'arma & Investitsiya',      icon: '💰', percentage: 15, color: '#F59E0B' },
    { id: 'cat_wants',    name: "Shaxsiy istaklar & Ko'ngilochar", icon: '🎯', percentage: 15, color: '#EC4899' },
    { id: 'cat_transport',name: 'Transport va Yo\'l',             icon: '🚌', percentage: 10, color: '#06B6D4' },
    { id: 'cat_health',   name: 'Kutilmagan / Salomatlik',        icon: '💊', percentage: 5,  color: '#EF4444' }
  ];

  const MONTHS_UZ = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];
  const WEEKDAYS_UZ = ['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba'];

  // ---------------- State ----------------

  let state = null;

  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 10);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);

      // Migrate from the old flat (v1) shape if present, so early testers
      // don't lose their data.
      const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
      if (oldRaw) {
        const old = JSON.parse(oldRaw);
        return migrateV1(old);
      }
      return null;
    } catch (e) {
      console.error('State load failed', e);
      return null;
    }
  }

  function migrateV1(old) {
    const period = {
      id: uid('per'),
      periodStart: old.settings.periodStart || isoDate(todayDate()),
      salaryAmount: old.settings.salaryAmount || 0,
      categories: (old.categories || []).map((c) => ({ ...c })),
      closed: false
    };
    const expenses = (old.expenses || []).map((e) => ({ ...e, periodId: period.id }));
    return {
      settings: {
        salaryDay: old.settings.salaryDay || 1,
        currency: old.settings.currency || 'UZS',
        theme: old.settings.theme || 'light'
      },
      periods: [period],
      expenses,
      incomes: [],
      debts: []
    };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('State save failed', e);
      showToast('Saqlashda xatolik yuz berdi');
    }
  }

  function currentPeriod() {
    return state.periods[state.periods.length - 1];
  }

  function findPeriod(periodId) {
    return state.periods.find((p) => p.id === periodId) || currentPeriod();
  }

  function recalcCurrentAllocations() {
    const p = currentPeriod();
    p.categories.forEach((c) => {
      c.allocatedAmount = Math.round((p.salaryAmount * c.percentage) / 100);
    });
  }

  function createInitialState(salaryAmount, salaryDay) {
    const cats = DEFAULT_CATEGORIES.map((c) => ({ ...c, allocatedAmount: Math.round((salaryAmount * c.percentage) / 100) }));
    const period = {
      id: uid('per'),
      periodStart: computePeriodStartForToday(salaryDay),
      salaryAmount,
      categories: cats,
      closed: false
    };
    return {
      settings: { salaryDay, currency: 'UZS', theme: 'light' },
      periods: [period],
      expenses: [],
      incomes: [],
      debts: []
    };
  }

  // ---------------- Date helpers ----------------

  function todayDate() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function clampDay(year, month, day) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return Math.min(day, lastDay);
  }

  function addMonthsClamped(date, n, salaryDay) {
    const d = new Date(date);
    const targetMonth = d.getMonth() + n;
    const year = d.getFullYear() + Math.floor(targetMonth / 12);
    const month = ((targetMonth % 12) + 12) % 12;
    const day = clampDay(year, month, salaryDay);
    return new Date(year, month, day);
  }

  function computePeriodStartForToday(salaryDay) {
    const today = todayDate();
    let candidate = new Date(today.getFullYear(), today.getMonth(), clampDay(today.getFullYear(), today.getMonth(), salaryDay));
    if (candidate > today) {
      candidate = addMonthsClamped(candidate, -1, salaryDay);
    }
    return isoDate(candidate);
  }

  function periodEndDate(periodStartIso, salaryDay) {
    const start = new Date(periodStartIso + 'T00:00:00');
    return addMonthsClamped(start, 1, salaryDay);
  }

  function formatPeriodLabel(periodStartIso, salaryDay) {
    const start = new Date(periodStartIso + 'T00:00:00');
    const end = periodEndDate(periodStartIso, salaryDay);
    const endShown = new Date(end);
    endShown.setDate(endShown.getDate() - 1);
    const f = (d) => `${d.getDate()} ${MONTHS_UZ[d.getMonth()].slice(0,3)}`;
    return `${f(start)} — ${f(endShown)}`;
  }

  function isPendingRollover() {
    if (!state) return false;
    const p = currentPeriod();
    const end = periodEndDate(p.periodStart, state.settings.salaryDay);
    return todayDate() >= end;
  }

  // ---------------- Formatting ----------------

  function formatSom(n) {
    n = Math.round(n || 0);
    const neg = n < 0;
    n = Math.abs(n);
    const s = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (neg ? '-' : '') + s;
  }

  function parseAmountInput(str) {
    return parseInt((str || '0').toString().replace(/\D/g, ''), 10) || 0;
  }

  // ---------------- Period-scoped queries ----------------

  function periodExpenses(periodId) {
    return state.expenses.filter((e) => e.periodId === periodId);
  }
  function periodIncomes(periodId) {
    return state.incomes.filter((e) => e.periodId === periodId);
  }
  function periodDebts(periodId) {
    return state.debts.filter((e) => e.periodId === periodId);
  }

  function spentByCategory(expenses) {
    const map = {};
    expenses.forEach((e) => { map[e.categoryId] = (map[e.categoryId] || 0) + e.amount; });
    return map;
  }

  function periodBalance(period) {
    const expenses = periodExpenses(period.id);
    const incomes = periodIncomes(period.id);
    const debts = periodDebts(period.id);
    const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);
    const totalIncome = incomes.reduce((s, e) => s + e.amount, 0);
    const totalBorrowed = debts.filter((d) => d.type === 'borrowed').reduce((s, d) => s + d.amount, 0);
    const totalLent = debts.filter((d) => d.type === 'lent').reduce((s, d) => s + d.amount, 0);
    const remaining = period.salaryAmount + totalIncome + totalBorrowed - totalLent - totalExpense;
    return { totalExpense, totalIncome, totalBorrowed, totalLent, remaining };
  }

  function catStatus(spent, allocated) {
    if (allocated <= 0) return 'danger';
    const pct = spent / allocated;
    if (pct > 1) return 'danger';
    if (pct >= 0.75) return 'warn';
    return 'ok';
  }

  // ---------------- Toast ----------------

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------------- Theme ----------------

  function applyTheme() {
    const theme = state && state.settings.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B1220' : '#10B981');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  function hexTint(hex) { return hex + '22'; }

  // ================================================================
  //  ONBOARDING
  // ================================================================

  function initOnboarding() {
    const ob = document.getElementById('onboarding');
    ob.style.display = 'flex';

    const salaryInput = document.getElementById('ob-salary');
    const dayInput = document.getElementById('ob-day');
    const next1 = document.getElementById('ob-next-1');
    const next2 = document.getElementById('ob-next-2');
    const finish = document.getElementById('ob-finish');

    function goStep(n) {
      document.querySelectorAll('.onboard-step').forEach((s) => s.classList.remove('active'));
      document.querySelector(`.onboard-step[data-step="${n}"]`).classList.add('active');
    }

    next1.addEventListener('click', () => goStep(2));

    salaryInput.addEventListener('input', () => {
      const digits = salaryInput.value.replace(/\D/g, '');
      salaryInput.value = digits ? formatSom(parseInt(digits, 10)) : '';
      next2.disabled = parseAmountInput(salaryInput.value) <= 0;
    });

    next2.addEventListener('click', () => {
      if (parseAmountInput(salaryInput.value) <= 0) return;
      goStep(3);
    });

    finish.addEventListener('click', () => {
      const salary = parseAmountInput(salaryInput.value);
      let day = parseInt(dayInput.value, 10);
      if (!day || day < 1) day = 1;
      if (day > 28) day = 28;
      if (salary <= 0) { goStep(2); return; }

      state = createInitialState(salary, day);
      saveState();
      ob.style.display = 'none';
      boot();
    });
  }

  // ================================================================
  //  RENDERING — HOME  (always the live/open period)
  // ================================================================

  function renderHome() {
    const p = currentPeriod();
    document.getElementById('home-period').textContent = formatPeriodLabel(p.periodStart, state.settings.salaryDay);

    const hour = new Date().getHours();
    const greetEl = document.getElementById('home-greeting');
    greetEl.textContent = hour < 6 ? 'Xayrli tun' : hour < 12 ? 'Xayrli tong' : hour < 18 ? 'Xayrli kun' : 'Xayrli kech';

    const bal = periodBalance(p);

    document.getElementById('home-remaining').innerHTML = `${formatSom(bal.remaining)} <small>so'm</small>`;
    document.getElementById('home-salary').textContent = formatSom(p.salaryAmount);
    document.getElementById('home-spent').textContent = formatSom(bal.totalExpense);

    const subLine = document.getElementById('home-sub-line');
    const extras = [];
    if (bal.totalIncome > 0) extras.push(`+${formatSom(bal.totalIncome)} qo'shimcha daromad`);
    if (bal.totalBorrowed > 0) extras.push(`+${formatSom(bal.totalBorrowed)} qarzga olingan`);
    if (bal.totalLent > 0) extras.push(`−${formatSom(bal.totalLent)} qarzga berilgan`);
    if (extras.length > 0) {
      subLine.style.display = 'block';
      subLine.textContent = extras.join(' · ');
    } else {
      subLine.style.display = 'none';
    }

    const spentMap = spentByCategory(periodExpenses(p.id));
    const list = document.getElementById('home-cat-list');
    list.innerHTML = '';

    if (isPendingRollover()) {
      const banner = document.createElement('div');
      banner.className = 'chart-card';
      banner.style.background = 'var(--accent-tint)';
      banner.style.border = 'none';
      banner.innerHTML = `
        <h3 style="color:var(--accent);margin-bottom:4px;">🔔 Yangi oylik davr boshlandi</h3>
        <p style="font-size:12.5px;color:var(--text-muted);margin:0 0 10px;">O'tgan davr hisobotini ko'ring va yangi davrni tasdiqlang.</p>
        <button class="btn btn-primary" id="banner-open-report" style="padding:11px;">Hisobotni ko'rish</button>
      `;
      list.appendChild(banner);
      banner.querySelector('#banner-open-report').addEventListener('click', () => openReport());
    }

    p.categories.forEach((c) => {
      const spent = spentMap[c.id] || 0;
      const remainingCat = c.allocatedAmount - spent;
      const pct = c.allocatedAmount > 0 ? Math.min(100, (spent / c.allocatedAmount) * 100) : 100;
      const status = catStatus(spent, c.allocatedAmount);

      const card = document.createElement('div');
      card.className = 'cat-card';
      card.innerHTML = `
        <div class="cat-card-top">
          <div class="cat-emoji" style="background:${hexTint(c.color)};">${c.icon}</div>
          <div class="cat-info">
            <p class="cat-name">${escapeHtml(c.name)}</p>
            <p class="cat-sub">${formatSom(c.allocatedAmount)} so'm limit</p>
          </div>
          <div class="cat-status" style="color:${status === 'danger' ? 'var(--danger)' : status === 'warn' ? 'var(--warn)' : 'var(--text)'}">${Math.round(pct)}%</div>
        </div>
        <div class="progress-track"><div class="progress-fill ${status === 'danger' ? 'danger' : status === 'warn' ? 'warn' : ''}" style="width:${pct}%"></div></div>
        <div class="cat-foot">
          <span>Sarflandi: ${formatSom(spent)}</span>
          ${remainingCat < 0
            ? `<span class="over">+${formatSom(-remainingCat)} ortiqcha</span>`
            : `<span>Qoldi: ${formatSom(remainingCat)}</span>`}
        </div>
      `;
      list.appendChild(card);
    });

    if (p.categories.length === 0) {
      list.innerHTML += `<div class="empty-state"><div class="glyph">📂</div><h3>Kategoriya yo'q</h3><p>Sozlamalar bo'limidan kategoriya qo'shing.</p></div>`;
    }
  }

  // ================================================================
  //  PERIOD SELECTORS (Expenses / Analytics screens — browse history)
  // ================================================================

  function populatePeriodSelect(selectEl, selectedId) {
    selectEl.innerHTML = '';
    // Most recent period first.
    const ordered = state.periods.slice().reverse();
    ordered.forEach((p, idx) => {
      const isCurrent = p.id === currentPeriod().id;
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = formatPeriodLabel(p.periodStart, state.settings.salaryDay) + (isCurrent ? ' (joriy)' : '');
      selectEl.appendChild(opt);
    });
    selectEl.value = selectedId || currentPeriod().id;
  }

  let expViewingPeriodId = null;
  let anViewingPeriodId = null;

  // ================================================================
  //  RENDERING — EXPENSES / TRANSACTIONS (history-aware)
  // ================================================================

  function renderExpenses() {
    if (!expViewingPeriodId) expViewingPeriodId = currentPeriod().id;
    const select = document.getElementById('exp-period-select');
    populatePeriodSelect(select, expViewingPeriodId);

    const period = findPeriod(expViewingPeriodId);
    const expenses = periodExpenses(period.id);
    const incomes = periodIncomes(period.id);
    const bal = periodBalance(period);

    const summary = document.getElementById('expenses-summary');
    summary.innerHTML = `
      <div class="ts-item"><p class="k">Maosh</p><p class="v">${formatSom(period.salaryAmount)}</p></div>
      <div class="ts-item"><p class="k">Sarf</p><p class="v" style="color:var(--danger);">${formatSom(bal.totalExpense)}</p></div>
      <div class="ts-item"><p class="k">Qoldiq</p><p class="v" style="color:var(--primary-dark);">${formatSom(bal.remaining)}</p></div>
    `;

    const container = document.getElementById('expenses-list');
    const catMap = {};
    period.categories.forEach((c) => { catMap[c.id] = c; });

    const items = [];
    expenses.forEach((e) => items.push({ kind: 'expense', date: e.date, data: e }));
    incomes.forEach((e) => items.push({ kind: 'income', date: e.date, data: e }));

    if (items.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="glyph">🧾</div><h3>Bu davrda yozuv yo'q</h3><p>Pastdagi + tugmasi orqali xarajat yoki daromad kiriting.</p></div>`;
      return;
    }

    items.sort((a, b) => b.date.localeCompare(a.date));

    const groups = {};
    items.forEach((it) => {
      const key = it.date.slice(0, 10);
      if (!groups[key]) groups[key] = [];
      groups[key].push(it);
    });

    container.innerHTML = '';
    Object.keys(groups).sort().reverse().forEach((dateKey) => {
      const dayWrap = document.createElement('div');
      dayWrap.className = 'exp-day-group';
      const d = new Date(dateKey + 'T00:00:00');
      const isToday = dateKey === isoDate(todayDate());
      const label = isToday ? 'Bugun' : `${d.getDate()} ${MONTHS_UZ[d.getMonth()]}, ${WEEKDAYS_UZ[d.getDay()]}`;
      dayWrap.innerHTML = `<p class="exp-day-label">${label}</p>`;

      groups[dateKey].forEach((it) => {
        const row = document.createElement('div');
        if (it.kind === 'expense') {
          const cat = catMap[it.data.categoryId] || { icon: '❓', name: "O'chirilgan kategoriya", color: '#94A3B8' };
          row.className = 'exp-row';
          row.innerHTML = `
            <div class="cat-emoji" style="background:${hexTint(cat.color)};">${cat.icon}</div>
            <div class="exp-info">
              <div class="exp-cat">${escapeHtml(cat.name)}</div>
              ${it.data.note ? `<div class="exp-note">${escapeHtml(it.data.note)}</div>` : ''}
            </div>
            <div class="exp-amt">−${formatSom(it.data.amount)}</div>
            <button class="exp-del" data-kind="expense" data-id="${it.data.id}" aria-label="O'chirish">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
            </button>
          `;
        } else {
          row.className = 'exp-row income-row';
          row.innerHTML = `
            <div class="cat-emoji">💵</div>
            <div class="exp-info">
              <div class="exp-cat">Qo'shimcha daromad</div>
              ${it.data.note ? `<div class="exp-note">${escapeHtml(it.data.note)}</div>` : ''}
            </div>
            <div class="exp-amt">+${formatSom(it.data.amount)}</div>
            <button class="exp-del" data-kind="income" data-id="${it.data.id}" aria-label="O'chirish">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
            </button>
          `;
        }
        dayWrap.appendChild(row);
      });
      container.appendChild(dayWrap);
    });

    container.querySelectorAll('.exp-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const kind = btn.getAttribute('data-kind');
        if (kind === 'expense') state.expenses = state.expenses.filter((e) => e.id !== id);
        else state.incomes = state.incomes.filter((e) => e.id !== id);
        saveState();
        renderExpenses();
        renderHome();
        showToast("O'chirildi");
      });
    });
  }

  // ================================================================
  //  RENDERING — DEBTS
  // ================================================================

  function renderDebts() {
    const all = state.debts.slice().sort((a, b) => b.date.localeCompare(a.date));
    const totalBorrowed = all.filter((d) => d.type === 'borrowed').reduce((s, d) => s + d.amount, 0);
    const totalLent = all.filter((d) => d.type === 'lent').reduce((s, d) => s + d.amount, 0);

    document.getElementById('debt-owed-to-me').textContent = formatSom(totalLent);
    document.getElementById('debt-i-owe').textContent = formatSom(totalBorrowed);

    const list = document.getElementById('debts-list');
    if (all.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="glyph">🤝</div><h3>Qarz yozuvi yo'q</h3><p>Pastdagi + tugmasi orqali qo'shing.</p></div>`;
      return;
    }

    list.innerHTML = '';
    all.forEach((d) => {
      const period = state.periods.find((p) => p.id === d.periodId);
      const dateObj = new Date(d.date.slice(0, 10) + 'T00:00:00');
      const dateLabel = `${dateObj.getDate()} ${MONTHS_UZ[dateObj.getMonth()]}${period ? ' · ' + formatPeriodLabel(period.periodStart, state.settings.salaryDay) : ''}`;
      const row = document.createElement('div');
      row.className = 'debt-row';
      const isBorrowed = d.type === 'borrowed';
      row.innerHTML = `
        <div class="d-icon" style="background:${isBorrowed ? 'var(--primary-tint)' : 'var(--danger-tint)'};color:${isBorrowed ? 'var(--primary-dark)' : 'var(--danger)'};">${isBorrowed ? '+' : '−'}</div>
        <div class="d-info">
          <div class="d-label">${isBorrowed ? 'Qarzga oldim' : 'Qarzga berdim'}</div>
          ${d.note ? `<div class="d-note">${escapeHtml(d.note)}</div>` : ''}
          <div class="d-date">${dateLabel}</div>
        </div>
        <div class="d-amt" style="color:${isBorrowed ? 'var(--primary-dark)' : 'var(--danger)'};">${isBorrowed ? '+' : '−'}${formatSom(d.amount)}</div>
        <button class="exp-del" data-id="${d.id}" aria-label="O'chirish">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
        </button>
      `;
      list.appendChild(row);
    });

    list.querySelectorAll('.exp-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        state.debts = state.debts.filter((d) => d.id !== id);
        saveState();
        renderDebts();
        renderHome();
        showToast("O'chirildi");
      });
    });
  }

  // ================================================================
  //  RENDERING — ANALYTICS (history-aware)
  // ================================================================

  let donutChartInstance = null;
  let barChartInstance = null;

  function renderAnalytics() {
    if (!anViewingPeriodId) anViewingPeriodId = currentPeriod().id;
    const select = document.getElementById('an-period-select');
    populatePeriodSelect(select, anViewingPeriodId);

    const period = findPeriod(anViewingPeriodId);
    const expenses = periodExpenses(period.id);
    const spentMap = spentByCategory(expenses);

    const labels = [];
    const data = [];
    const colors = [];
    period.categories.forEach((c) => {
      const v = spentMap[c.id] || 0;
      if (v > 0) {
        labels.push(c.icon + ' ' + c.name);
        data.push(v);
        colors.push(c.color);
      }
    });

    const donutCtx = document.getElementById('donutChart').getContext('2d');
    if (donutChartInstance) donutChartInstance.destroy();

    const legendEl = document.getElementById('donutLegend');
    legendEl.innerHTML = '';

    if (data.length === 0) {
      legendEl.innerHTML = `<div class="empty-state" style="padding:20px 0;"><p>Bu davrda xarajat yo'q</p></div>`;
    } else {
      donutChartInstance = new Chart(donutCtx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
        options: {
          cutout: '68%',
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${formatSom(ctx.parsed)} so'm` } } }
        }
      });

      const total = data.reduce((a, b) => a + b, 0);
      period.categories.forEach((c) => {
        const v = spentMap[c.id] || 0;
        if (v <= 0) return;
        const pct = total > 0 ? Math.round((v / total) * 100) : 0;
        const row = document.createElement('div');
        row.className = 'legend-row';
        row.innerHTML = `<span class="legend-dot" style="background:${c.color}"></span><span class="lname">${escapeHtml(c.name)}</span><span class="lval">${pct}% · ${formatSom(v)}</span>`;
        legendEl.appendChild(row);
      });
    }

    // Daily bar chart across the selected period.
    const start = new Date(period.periodStart + 'T00:00:00');
    const end = periodEndDate(period.periodStart, state.settings.salaryDay);
    const today = todayDate();
    const isCurrentPeriod = period.id === currentPeriod().id;
    const lastDay = isCurrentPeriod && today < end ? today : new Date(end.getTime() - 86400000);

    const dayLabels = [];
    const dayTotals = [];
    const dayMap = {};
    expenses.forEach((e) => { const k = e.date.slice(0, 10); dayMap[k] = (dayMap[k] || 0) + e.amount; });

    for (let d = new Date(start); d <= lastDay; d.setDate(d.getDate() + 1)) {
      const key = isoDate(d);
      dayLabels.push(String(d.getDate()));
      dayTotals.push(dayMap[key] || 0);
    }

    const barCtx = document.getElementById('barChart').getContext('2d');
    if (barChartInstance) barChartInstance.destroy();
    barChartInstance = new Chart(barCtx, {
      type: 'bar',
      data: { labels: dayLabels, datasets: [{ data: dayTotals, backgroundColor: '#6366F1', borderRadius: 4, maxBarThickness: 14 }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${formatSom(ctx.parsed.y)} so'm` } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { font: { size: 10 }, callback: (v) => formatSom(v) } }
        }
      }
    });
  }

  // ================================================================
  //  RENDERING — SETTINGS  (edits ONLY ever touch the open period)
  // ================================================================

  function renderSettings() {
    const p = currentPeriod();
    document.getElementById('settings-salary-sub').textContent = `${formatSom(p.salaryAmount)} so'm`;
    document.getElementById('settings-day-sub').textContent = `Har oyning ${state.settings.salaryDay}-sanasi`;

    const themeSwitch = document.getElementById('switch-theme');
    themeSwitch.classList.toggle('on', state.settings.theme === 'dark');

    const list = document.getElementById('settings-cat-list');
    list.innerHTML = '';

    p.categories.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'cat-edit-row';
      row.innerHTML = `
        <div class="cat-emoji" style="background:${hexTint(c.color)};">${c.icon}</div>
        <div class="name">${escapeHtml(c.name)}</div>
        <input type="number" min="0" max="100" value="${c.percentage}" data-id="${c.id}" class="pct-input">
        <span style="font-size:12px;color:var(--text-muted);">%</span>
        <button class="exp-del cat-del-btn" data-id="${c.id}" aria-label="O'chirish" style="margin-left:2px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      `;
      list.appendChild(row);
    });

    const addRow = document.createElement('div');
    addRow.className = 'cat-edit-row';
    addRow.style.cursor = 'pointer';
    addRow.innerHTML = `
      <div class="cat-emoji" style="background:var(--accent-tint);color:var(--accent);">+</div>
      <div class="name" style="color:var(--accent);font-weight:600;">Yangi kategoriya qo'shish</div>
    `;
    addRow.addEventListener('click', openAddCategory);
    list.appendChild(addRow);

    updatePctTotal();

    list.querySelectorAll('.pct-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const cat = currentPeriod().categories.find((c) => c.id === inp.getAttribute('data-id'));
        cat.percentage = Math.max(0, Math.min(100, parseInt(inp.value, 10) || 0));
        recalcCurrentAllocations();
        saveState();
        updatePctTotal();
        renderHome();
      });
    });

    list.querySelectorAll('.cat-del-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (currentPeriod().categories.length <= 1) { showToast('Kamida bitta kategoriya kerak'); return; }
        const id = btn.getAttribute('data-id');
        currentPeriod().categories = currentPeriod().categories.filter((c) => c.id !== id);
        saveState();
        renderSettings();
        renderHome();
      });
    });
  }

  function updatePctTotal() {
    const total = currentPeriod().categories.reduce((s, c) => s + c.percentage, 0);
    const el = document.getElementById('pct-total');
    el.innerHTML = `Jami: <strong>${total}%</strong>`;
    el.classList.toggle('bad', total !== 100);
  }

  const EMOJI_CHOICES = ['🍲','🏠','🧓','💰','🎯','🚌','💊','📚','🎁','🐾','👶','✈️','🛒','☕','🏋️','📱','🚗','💻','🎓','❤️'];

  function openAddCategory() {
    openEditSheet('Yangi kategoriya', [
      { key: 'name', label: 'Nomi', type: 'text', placeholder: 'Masalan: Kiyim-kechak' },
      { key: 'icon', label: 'Ikonka', type: 'select', options: EMOJI_CHOICES.map((e) => ({ value: e, label: e })) },
      { key: 'percentage', label: 'Foiz (%)', type: 'number', placeholder: '10' }
    ], (values) => {
      const name = (values.name || '').trim();
      if (!name) { showToast('Nomini kiriting'); return false; }
      const pct = Math.max(0, Math.min(100, parseInt(values.percentage, 10) || 0));
      const palette = ['#10B981','#6366F1','#3B82F6','#F59E0B','#EC4899','#06B6D4','#EF4444','#8B5CF6','#14B8A6','#F97316'];
      const p = currentPeriod();
      const color = palette[p.categories.length % palette.length];
      p.categories.push({
        id: uid('cat'),
        name, icon: values.icon || '📦', percentage: pct, color,
        allocatedAmount: Math.round((p.salaryAmount * pct) / 100)
      });
      saveState();
      renderSettings();
      renderHome();
      showToast('Kategoriya qo\'shildi');
      return true;
    });
  }

  // ================================================================
  //  GENERIC EDIT SHEET (salary / day / new category)
  // ================================================================

  let editSheetSubmit = null;

  function openEditSheet(title, fields, onSubmit) {
    document.getElementById('edit-title').textContent = title;
    const container = document.getElementById('edit-fields');
    container.innerHTML = '';

    fields.forEach((f) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.textContent = f.label;
      label.setAttribute('for', 'ef-' + f.key);
      wrap.appendChild(label);

      let input;
      if (f.type === 'select') {
        input = document.createElement('select');
        f.options.forEach((o) => {
          const opt = document.createElement('option');
          opt.value = o.value; opt.textContent = o.label;
          input.appendChild(opt);
        });
      } else {
        input = document.createElement('input');
        input.type = f.type === 'number' ? 'text' : f.type;
        if (f.type === 'number') input.setAttribute('inputmode', 'numeric');
        if (f.placeholder) input.placeholder = f.placeholder;
      }
      input.id = 'ef-' + f.key;
      input.setAttribute('data-key', f.key);
      wrap.appendChild(input);
      container.appendChild(wrap);
    });

    editSheetSubmit = () => {
      const values = {};
      fields.forEach((f) => {
        const el = document.getElementById('ef-' + f.key);
        values[f.key] = el.value;
      });
      const ok = onSubmit(values);
      if (ok !== false) closeSheet('overlay-edit');
    };

    openSheet('overlay-edit');
  }

  // ================================================================
  //  FAB ACTION MENU
  // ================================================================

  function openFabMenu() { openSheet('overlay-fab-menu'); }

  // ================================================================
  //  UNIFIED TRANSACTION SHEET (expense / income / debt)
  // ================================================================

  let txnMode = 'expense'; // 'expense' | 'income' | 'debt'
  let txnAmountStr = '0';
  let txnSelectedCat = null;
  let txnSelectedDebtType = null;

  function openTxnSheet(mode) {
    txnMode = mode;
    txnAmountStr = '0';
    txnSelectedCat = null;
    txnSelectedDebtType = null;

    document.getElementById('txn-amount').textContent = '0';
    document.getElementById('txn-note').value = '';
    document.getElementById('txn-date').value = isoDate(todayDate());

    const catPicker = document.getElementById('txn-cat-picker');
    const debtPicker = document.getElementById('txn-debt-picker');
    const noteLabel = document.getElementById('txn-note-label');

    if (mode === 'expense') {
      document.getElementById('txn-title').textContent = 'Xarajat qo\'shish';
      catPicker.style.display = 'grid';
      debtPicker.style.display = 'none';
      noteLabel.textContent = 'Izoh (ixtiyoriy)';
      txnSelectedCat = currentPeriod().categories[0] ? currentPeriod().categories[0].id : null;
      renderTxnCatPicker();
    } else if (mode === 'income') {
      document.getElementById('txn-title').textContent = 'Qo\'shimcha daromad';
      catPicker.style.display = 'none';
      debtPicker.style.display = 'none';
      noteLabel.textContent = 'Manba (ixtiyoriy) — masalan: Bonus, Frilanс';
    } else {
      document.getElementById('txn-title').textContent = 'Qarz qo\'shish';
      catPicker.style.display = 'none';
      debtPicker.style.display = 'grid';
      noteLabel.textContent = 'Kim bilan bog\'liq (ixtiyoriy)';
      renderTxnDebtPicker();
    }

    updateTxnSaveState();
    openSheet('overlay-txn');
  }

  function renderTxnCatPicker() {
    const picker = document.getElementById('txn-cat-picker');
    picker.innerHTML = '';
    currentPeriod().categories.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'cat-pick' + (c.id === txnSelectedCat ? ' selected' : '');
      btn.innerHTML = `<span class="em">${c.icon}</span><span>${escapeHtml(c.name.split(' ')[0])}</span>`;
      btn.addEventListener('click', () => { txnSelectedCat = c.id; renderTxnCatPicker(); updateTxnSaveState(); });
      picker.appendChild(btn);
    });
  }

  function renderTxnDebtPicker() {
    const picker = document.getElementById('txn-debt-picker');
    picker.querySelectorAll('.cat-pick').forEach((btn) => {
      btn.classList.toggle('selected', btn.getAttribute('data-debt-type') === txnSelectedDebtType);
    });
  }

  function updateTxnSaveState() {
    const amt = parseAmountInput(txnAmountStr);
    let ok = amt > 0;
    if (txnMode === 'expense') ok = ok && !!txnSelectedCat;
    if (txnMode === 'debt') ok = ok && !!txnSelectedDebtType;
    document.getElementById('txn-save').disabled = !ok;
  }

  function initTxnSheet() {
    document.getElementById('txn-keypad').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const k = btn.getAttribute('data-k');
      if (k === 'del') {
        txnAmountStr = txnAmountStr.slice(0, -1) || '0';
      } else {
        if (txnAmountStr === '0') txnAmountStr = '';
        txnAmountStr += k;
        if (txnAmountStr.length > 12) txnAmountStr = txnAmountStr.slice(0, 12);
      }
      document.getElementById('txn-amount').textContent = formatSom(parseAmountInput(txnAmountStr));
      updateTxnSaveState();
    });

    document.getElementById('txn-debt-picker').addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-pick');
      if (!btn) return;
      txnSelectedDebtType = btn.getAttribute('data-debt-type');
      renderTxnDebtPicker();
      updateTxnSaveState();
    });

    document.getElementById('txn-save').addEventListener('click', () => {
      const amount = parseAmountInput(txnAmountStr);
      if (amount <= 0) return;
      const dateVal = document.getElementById('txn-date').value || isoDate(todayDate());
      const note = document.getElementById('txn-note').value.trim();
      const periodId = currentPeriod().id;

      if (txnMode === 'expense') {
        if (!txnSelectedCat) return;
        state.expenses.push({ id: uid('exp'), periodId, categoryId: txnSelectedCat, amount, date: dateVal + 'T00:00:00.000Z', note });
        showToast("Xarajat qo'shildi");
      } else if (txnMode === 'income') {
        state.incomes.push({ id: uid('inc'), periodId, amount, date: dateVal + 'T00:00:00.000Z', note });
        showToast("Daromad qo'shildi");
      } else {
        if (!txnSelectedDebtType) return;
        state.debts.push({ id: uid('debt'), periodId, type: txnSelectedDebtType, amount, date: dateVal + 'T00:00:00.000Z', note });
        showToast("Qarz qo'shildi");
      }

      saveState();
      closeSheet('overlay-txn');
      renderHome();
      renderExpenses();
      renderDebts();
    });
  }

  // ================================================================
  //  MONTHLY REPORT (always for the current/open period until confirmed)
  // ================================================================

  function buildReportData(period) {
    const expenses = periodExpenses(period.id);
    const spentMap = spentByCategory(expenses);
    const bal = periodBalance(period);

    const overspent = [];
    const underspent = [];
    period.categories.forEach((c) => {
      const spent = spentMap[c.id] || 0;
      const diff = c.allocatedAmount - spent;
      if (diff < 0) overspent.push({ cat: c, over: -diff, spent });
      else if (diff > 0) underspent.push({ cat: c, left: diff, spent });
    });
    overspent.sort((a, b) => b.over - a.over);
    underspent.sort((a, b) => b.left - a.left);

    const successScore = period.salaryAmount > 0 ? Math.max(0, Math.min(100, Math.round(100 - (overspent.reduce((s, o) => s + o.over, 0) / period.salaryAmount) * 100))) : 100;

    let advice;
    if (overspent.length > 0) {
      const worst = overspent[0];
      const overPct = worst.cat.allocatedAmount > 0 ? Math.round((worst.over / worst.cat.allocatedAmount) * 100) : 100;
      advice = `${worst.cat.name} xarajati limitdan ${overPct}% ga oshdi. Keyingi oyda bu toifaga ko'proq limit ajratish yoki sarfni kamaytirish tavsiya etiladi.`;
    } else if (bal.remaining > 0) {
      advice = `Barcha kategoriyalarda limit ichida qoldingiz va ${formatSom(bal.remaining)} so'm tejadingiz. Shu tartibni davom ettiring!`;
    } else {
      advice = "Xarajatlar rejaga mos keldi. Keyingi oyda jamg'arma ulushini biroz oshirishni ko'rib chiqing.";
    }

    return { expenses, spentMap, bal, overspent, underspent, successScore, advice };
  }

  function openReport() {
    const period = currentPeriod();
    const r = buildReportData(period);
    const pending = isPendingRollover();
    const body = document.getElementById('report-body');

    let html = `
      <div class="report-hero">
        <div class="ring" style="--pct:${r.successScore}"><span>${r.successScore}%</span></div>
        <h3>Rejaga muvofiqlik darajasi</h3>
        <p>${formatPeriodLabel(period.periodStart, state.settings.salaryDay)}</p>
      </div>

      <div class="report-block">
        <h4>Umumiy natija</h4>
        <div class="rline"><span>Maosh</span><span>${formatSom(period.salaryAmount)} so'm</span></div>
        ${r.bal.totalIncome > 0 ? `<div class="rline good"><span>Qo'shimcha daromad</span><span>+${formatSom(r.bal.totalIncome)} so'm</span></div>` : ''}
        ${r.bal.totalBorrowed > 0 ? `<div class="rline good"><span>Qarzga olingan</span><span>+${formatSom(r.bal.totalBorrowed)} so'm</span></div>` : ''}
        ${r.bal.totalLent > 0 ? `<div class="rline bad"><span>Qarzga berilgan</span><span>−${formatSom(r.bal.totalLent)} so'm</span></div>` : ''}
        <div class="rline"><span>Sarflandi</span><span>${formatSom(r.bal.totalExpense)} so'm</span></div>
        <div class="rline ${r.bal.remaining >= 0 ? 'good' : 'bad'}"><span>${r.bal.remaining >= 0 ? 'Jamg\'armaga o\'tdi' : 'Ortiqcha sarflandi'}</span><span>${formatSom(Math.abs(r.bal.remaining))} so'm</span></div>
      </div>
    `;

    if (r.overspent.length > 0) {
      html += `<div class="report-block"><h4>Limitdan oshgan kategoriyalar</h4>`;
      r.overspent.forEach((o) => {
        html += `<div class="rline bad"><span>${o.cat.icon} ${escapeHtml(o.cat.name)}</span><span>+${formatSom(o.over)}</span></div>`;
      });
      html += `</div>`;
    }

    if (r.underspent.length > 0) {
      html += `<div class="report-block"><h4>Iqtisod qilingan toifalar</h4>`;
      r.underspent.slice(0, 5).forEach((u) => {
        html += `<div class="rline good"><span>${u.cat.icon} ${escapeHtml(u.cat.name)}</span><span>${formatSom(u.left)}</span></div>`;
      });
      html += `</div>`;
    }

    html += `<div class="advice-box"><p class="a-label">💡 TAVSIYA</p>${escapeHtml(r.advice)}</div>`;

    if (pending) {
      html += `
        <div class="field">
          <label for="rollover-salary">Yangi davr uchun maosh (so'm)</label>
          <input type="text" inputmode="numeric" id="rollover-salary" value="${formatSom(period.salaryAmount)}">
        </div>
        <button class="btn btn-primary" id="confirm-rollover">Yangi davrni tasdiqlash</button>
      `;
    }

    body.innerHTML = html;

    if (pending) {
      const salaryInput = document.getElementById('rollover-salary');
      salaryInput.addEventListener('input', () => {
        const digits = salaryInput.value.replace(/\D/g, '');
        salaryInput.value = digits ? formatSom(parseInt(digits, 10)) : '';
      });
      document.getElementById('confirm-rollover').addEventListener('click', () => {
        const newSalary = parseAmountInput(salaryInput.value) || period.salaryAmount;
        doRollover(newSalary);
      });
    }

    openSheet('overlay-report');
  }

  function doRollover(newSalary) {
    const prev = currentPeriod();
    prev.closed = true;

    let newStart = periodEndDate(prev.periodStart, state.settings.salaryDay);
    // If multiple periods have been skipped while the app was closed, jump forward.
    while (periodEndDate(isoDate(newStart), state.settings.salaryDay) <= todayDate()) {
      newStart = periodEndDate(isoDate(newStart), state.settings.salaryDay);
    }

    const newCategories = prev.categories.map((c) => ({
      id: c.id, name: c.name, icon: c.icon, percentage: c.percentage, color: c.color,
      allocatedAmount: Math.round((newSalary * c.percentage) / 100)
    }));

    const newPeriod = {
      id: uid('per'),
      periodStart: isoDate(newStart),
      salaryAmount: newSalary,
      categories: newCategories,
      closed: false
    };
    state.periods.push(newPeriod);

    saveState();
    closeSheet('overlay-report');
    expViewingPeriodId = newPeriod.id;
    anViewingPeriodId = newPeriod.id;
    renderAll();
    showToast('Yangi davr boshlandi');
  }

  // ================================================================
  //  SHEET / NAV HELPERS
  // ================================================================

  function openSheet(id) { document.getElementById(id).classList.add('open'); }
  function closeSheet(id) { document.getElementById(id).classList.remove('open'); }

  function switchScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById('screen-' + name).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-screen') === name));
    if (name === 'analytics') renderAnalytics();
    if (name === 'expenses') renderExpenses();
    if (name === 'debts') renderDebts();
    if (name === 'settings') renderSettings();
    if (name === 'home') renderHome();
  }

  // ================================================================
  //  EXPORT / IMPORT / RESET
  // ================================================================

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = isoDate(todayDate());
    a.href = url;
    a.download = `smartfinance-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Fayl yuklab olindi');
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.settings || !Array.isArray(parsed.periods) || !Array.isArray(parsed.expenses)) {
          throw new Error('invalid shape');
        }
        state = parsed;
        if (!state.incomes) state.incomes = [];
        if (!state.debts) state.debts = [];
        saveState();
        applyTheme();
        expViewingPeriodId = currentPeriod().id;
        anViewingPeriodId = currentPeriod().id;
        renderAll();
        showToast('Ma\'lumotlar tiklandi');
      } catch (e) {
        showToast("Fayl noto'g'ri formatda");
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm("Barcha ma'lumotlar butunlay o'chiriladi. Davom etasizmi?")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(OLD_STORAGE_KEY);
    state = null;
    location.reload();
  }

  // ================================================================
  //  EVENT WIRING (once, on first boot)
  // ================================================================

  let wired = false;
  function wireEvents() {
    if (wired) return;
    wired = true;

    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchScreen(btn.getAttribute('data-screen')));
    });

    document.getElementById('fab-add').addEventListener('click', openFabMenu);
    document.getElementById('close-fab-menu').addEventListener('click', () => closeSheet('overlay-fab-menu'));
    document.getElementById('overlay-fab-menu').addEventListener('click', (e) => { if (e.target.id === 'overlay-fab-menu') closeSheet('overlay-fab-menu'); });

    document.getElementById('fab-menu-expense').addEventListener('click', () => { closeSheet('overlay-fab-menu'); openTxnSheet('expense'); });
    document.getElementById('fab-menu-income').addEventListener('click', () => { closeSheet('overlay-fab-menu'); openTxnSheet('income'); });
    document.getElementById('fab-menu-debt').addEventListener('click', () => { closeSheet('overlay-fab-menu'); openTxnSheet('debt'); });

    document.getElementById('close-txn').addEventListener('click', () => closeSheet('overlay-txn'));
    document.getElementById('overlay-txn').addEventListener('click', (e) => { if (e.target.id === 'overlay-txn') closeSheet('overlay-txn'); });
    initTxnSheet();

    document.getElementById('close-edit').addEventListener('click', () => closeSheet('overlay-edit'));
    document.getElementById('overlay-edit').addEventListener('click', (e) => { if (e.target.id === 'overlay-edit') closeSheet('overlay-edit'); });
    document.getElementById('edit-save').addEventListener('click', () => { if (editSheetSubmit) editSheetSubmit(); });

    document.getElementById('close-report').addEventListener('click', () => closeSheet('overlay-report'));
    document.getElementById('overlay-report').addEventListener('click', (e) => { if (e.target.id === 'overlay-report') closeSheet('overlay-report'); });
    document.getElementById('home-report-link').addEventListener('click', openReport);

    document.getElementById('exp-period-select').addEventListener('change', (e) => {
      expViewingPeriodId = e.target.value;
      renderExpenses();
    });
    document.getElementById('an-period-select').addEventListener('change', (e) => {
      anViewingPeriodId = e.target.value;
      renderAnalytics();
    });

    document.getElementById('btn-theme').addEventListener('click', toggleTheme);
    document.getElementById('switch-theme').addEventListener('click', toggleTheme);

    document.getElementById('row-edit-salary').addEventListener('click', () => {
      openEditSheet('Joriy davr maoshi', [{ key: 'salary', label: "Oylik daromad (so'm)", type: 'number', placeholder: '5 000 000' }], (v) => {
        const amt = parseAmountInput(v.salary);
        if (amt <= 0) { showToast("To'g'ri summa kiriting"); return false; }
        currentPeriod().salaryAmount = amt;
        recalcCurrentAllocations();
        saveState();
        renderAll();
        return true;
      });
      document.getElementById('ef-salary').value = formatSom(currentPeriod().salaryAmount);
      document.getElementById('ef-salary').addEventListener('input', (e) => {
        const digits = e.target.value.replace(/\D/g, '');
        e.target.value = digits ? formatSom(parseInt(digits, 10)) : '';
      });
    });

    document.getElementById('row-edit-day').addEventListener('click', () => {
      openEditSheet('Maosh kuni', [{ key: 'day', label: 'Oyning kuni (1-28)', type: 'number', placeholder: '10' }], (v) => {
        let day = parseInt(v.day, 10);
        if (!day || day < 1) day = 1;
        if (day > 28) day = 28;
        state.settings.salaryDay = day;
        saveState();
        renderAll();
        return true;
      });
      document.getElementById('ef-day').value = state.settings.salaryDay;
    });

    document.getElementById('row-export').addEventListener('click', exportData);
    document.getElementById('row-import').addEventListener('click', () => document.getElementById('import-file').click());
    document.getElementById('import-file').addEventListener('change', (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('row-reset').addEventListener('click', resetAll);
  }

  function toggleTheme() {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    saveState();
    applyTheme();
    renderSettings();
  }

  // ================================================================
  //  BOOT
  // ================================================================

  function renderAll() {
    renderHome();
    const activeScreen = document.querySelector('.nav-btn.active');
    const name = activeScreen ? activeScreen.getAttribute('data-screen') : 'home';
    if (name === 'analytics') renderAnalytics();
    if (name === 'expenses') renderExpenses();
    if (name === 'debts') renderDebts();
    if (name === 'settings') renderSettings();
  }

  function boot() {
    document.getElementById('app').style.display = 'flex';
    expViewingPeriodId = currentPeriod().id;
    anViewingPeriodId = currentPeriod().id;
    applyTheme();
    wireEvents();
    switchScreen('home');
  }

  document.addEventListener('DOMContentLoaded', () => {
    state = loadState();
    if (!state) {
      document.getElementById('app').style.display = 'none';
      initOnboarding();
    } else {
      saveState(); // persist any v1->v2 migration immediately
      boot();
    }

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
      });
    }
  });
})();
