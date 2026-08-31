/* ============================================================
   SmartFinance PWA — Application logic
   100% local-first. No network calls. State lives in localStorage.
   ============================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'smartfinance_state_v1';

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

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error('State load failed', e);
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('State save failed', e);
      showToast('Saqlashda xatolik yuz berdi');
    }
  }

  function recalcAllocations() {
    const salary = state.settings.salaryAmount;
    state.categories.forEach((c) => {
      c.allocatedAmount = Math.round((salary * c.percentage) / 100);
    });
  }

  function createInitialState(salaryAmount, salaryDay) {
    const cats = DEFAULT_CATEGORIES.map((c) => ({ ...c, allocatedAmount: Math.round((salaryAmount * c.percentage) / 100) }));
    return {
      settings: {
        salaryAmount,
        salaryDay,
        currency: 'UZS',
        theme: 'light',
        periodStart: computePeriodStartForToday(salaryDay)
      },
      categories: cats,
      expenses: [],
      monthlyArchives: []
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
    // month is 0-indexed here
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
    const end = periodEndDate(state.settings.periodStart, state.settings.salaryDay);
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

  // ---------------- Expense / period queries ----------------

  function currentPeriodExpenses() {
    const start = state.settings.periodStart;
    const end = isoDate(periodEndDate(start, state.settings.salaryDay));
    return state.expenses.filter((e) => e.date.slice(0, 10) >= start && e.date.slice(0, 10) < end);
  }

  function spentByCategory(expenses) {
    const map = {};
    expenses.forEach((e) => {
      map[e.categoryId] = (map[e.categoryId] || 0) + e.amount;
    });
    return map;
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
  //  RENDERING — HOME
  // ================================================================

  function renderHome() {
    document.getElementById('home-period').textContent = formatPeriodLabel(state.settings.periodStart, state.settings.salaryDay);

    const hour = new Date().getHours();
    const greetEl = document.getElementById('home-greeting');
    greetEl.textContent = hour < 6 ? 'Xayrli tun' : hour < 12 ? 'Xayrli tong' : hour < 18 ? 'Xayrli kun' : 'Xayrli kech';

    const expenses = currentPeriodExpenses();
    const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
    const remaining = state.settings.salaryAmount - totalSpent;

    document.getElementById('home-remaining').innerHTML = `${formatSom(remaining)} <small>so'm</small>`;
    document.getElementById('home-salary').textContent = formatSom(state.settings.salaryAmount);
    document.getElementById('home-spent').textContent = formatSom(totalSpent);

    const spentMap = spentByCategory(expenses);
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

    state.categories.forEach((c) => {
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

    if (state.categories.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="glyph">📂</div><h3>Kategoriya yo'q</h3><p>Sozlamalar bo'limidan kategoriya qo'shing.</p></div>`;
    }
  }

  function hexTint(hex) {
    // Light tint background behind an emoji, works reasonably in both themes.
    return hex + '22';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ================================================================
  //  RENDERING — EXPENSES
  // ================================================================

  function renderExpenses() {
    const container = document.getElementById('expenses-list');
    const expenses = currentPeriodExpenses().slice().sort((a, b) => b.date.localeCompare(a.date));

    if (expenses.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="glyph">🧾</div><h3>Hozircha xarajat yo'q</h3><p>Pastdagi + tugmasi orqali birinchi xarajatingizni kiriting.</p></div>`;
      return;
    }

    const groups = {};
    expenses.forEach((e) => {
      const key = e.date.slice(0, 10);
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });

    const catMap = {};
    state.categories.forEach((c) => { catMap[c.id] = c; });

    container.innerHTML = '';
    Object.keys(groups).sort().reverse().forEach((dateKey) => {
      const dayWrap = document.createElement('div');
      dayWrap.className = 'exp-day-group';
      const d = new Date(dateKey + 'T00:00:00');
      const isToday = dateKey === isoDate(todayDate());
      const label = isToday ? 'Bugun' : `${d.getDate()} ${MONTHS_UZ[d.getMonth()]}, ${WEEKDAYS_UZ[d.getDay()]}`;
      dayWrap.innerHTML = `<p class="exp-day-label">${label}</p>`;

      groups[dateKey].forEach((e) => {
        const cat = catMap[e.categoryId] || { icon: '❓', name: "O'chirilgan", color: '#94A3B8' };
        const row = document.createElement('div');
        row.className = 'exp-row';
        row.innerHTML = `
          <div class="cat-emoji" style="background:${hexTint(cat.color)};">${cat.icon}</div>
          <div class="exp-info">
            <div class="exp-cat">${escapeHtml(cat.name)}</div>
            ${e.note ? `<div class="exp-note">${escapeHtml(e.note)}</div>` : ''}
          </div>
          <div class="exp-amt">${formatSom(e.amount)}</div>
          <button class="exp-del" data-id="${e.id}" aria-label="O'chirish">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        `;
        dayWrap.appendChild(row);
      });
      container.appendChild(dayWrap);
    });

    container.querySelectorAll('.exp-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        state.expenses = state.expenses.filter((e) => e.id !== id);
        saveState();
        renderExpenses();
        renderHome();
        showToast("Xarajat o'chirildi");
      });
    });
  }

  // ================================================================
  //  RENDERING — ANALYTICS
  // ================================================================

  let donutChartInstance = null;
  let barChartInstance = null;

  function renderAnalytics() {
    const expenses = currentPeriodExpenses();
    const spentMap = spentByCategory(expenses);

    const labels = [];
    const data = [];
    const colors = [];
    state.categories.forEach((c) => {
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
      legendEl.innerHTML = `<div class="empty-state" style="padding:20px 0;"><p>Hali xarajat kiritilmagan</p></div>`;
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
      state.categories.forEach((c) => {
        const v = spentMap[c.id] || 0;
        if (v <= 0) return;
        const pct = total > 0 ? Math.round((v / total) * 100) : 0;
        const row = document.createElement('div');
        row.className = 'legend-row';
        row.innerHTML = `<span class="legend-dot" style="background:${c.color}"></span><span class="lname">${escapeHtml(c.name)}</span><span class="lval">${pct}% · ${formatSom(v)}</span>`;
        legendEl.appendChild(row);
      });
    }

    // Daily bar chart across the period so far
    const start = new Date(state.settings.periodStart + 'T00:00:00');
    const end = periodEndDate(state.settings.periodStart, state.settings.salaryDay);
    const today = todayDate();
    const lastDay = today < end ? today : new Date(end.getTime() - 86400000);

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
  //  RENDERING — SETTINGS
  // ================================================================

  function renderSettings() {
    document.getElementById('settings-salary-sub').textContent = `${formatSom(state.settings.salaryAmount)} so'm`;
    document.getElementById('settings-day-sub').textContent = `Har oyning ${state.settings.salaryDay}-sanasi`;

    const themeSwitch = document.getElementById('switch-theme');
    themeSwitch.classList.toggle('on', state.settings.theme === 'dark');

    const list = document.getElementById('settings-cat-list');
    list.innerHTML = '';

    state.categories.forEach((c) => {
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
        const cat = state.categories.find((c) => c.id === inp.getAttribute('data-id'));
        cat.percentage = Math.max(0, Math.min(100, parseInt(inp.value, 10) || 0));
        recalcAllocations();
        saveState();
        updatePctTotal();
        renderHome();
      });
    });

    list.querySelectorAll('.cat-del-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.categories.length <= 1) { showToast('Kamida bitta kategoriya kerak'); return; }
        const id = btn.getAttribute('data-id');
        state.categories = state.categories.filter((c) => c.id !== id);
        saveState();
        renderSettings();
        renderHome();
      });
    });
  }

  function updatePctTotal() {
    const total = state.categories.reduce((s, c) => s + c.percentage, 0);
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
      const color = palette[state.categories.length % palette.length];
      state.categories.push({
        id: 'cat_' + Math.random().toString(36).slice(2, 9),
        name, icon: values.icon || '📦', percentage: pct, color,
        allocatedAmount: Math.round((state.settings.salaryAmount * pct) / 100)
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
  //  QUICK ADD EXPENSE
  // ================================================================

  let qaAmountStr = '0';
  let qaSelectedCat = null;

  function openQuickAdd() {
    qaAmountStr = '0';
    qaSelectedCat = state.categories[0] ? state.categories[0].id : null;
    document.getElementById('qa-amount').textContent = '0';
    document.getElementById('qa-note').value = '';
    document.getElementById('qa-date').value = isoDate(todayDate());
    renderQaCatPicker();
    updateQaSaveState();
    openSheet('overlay-add');
  }

  function renderQaCatPicker() {
    const picker = document.getElementById('qa-cat-picker');
    picker.innerHTML = '';
    state.categories.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'cat-pick' + (c.id === qaSelectedCat ? ' selected' : '');
      btn.innerHTML = `<span class="em">${c.icon}</span><span>${escapeHtml(c.name.split(' ')[0])}</span>`;
      btn.addEventListener('click', () => {
        qaSelectedCat = c.id;
        renderQaCatPicker();
      });
      picker.appendChild(btn);
    });
  }

  function updateQaSaveState() {
    const amt = parseAmountInput(qaAmountStr);
    document.getElementById('qa-save').disabled = !(amt > 0 && qaSelectedCat);
  }

  function initQuickAddKeypad() {
    document.getElementById('qa-keypad').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const k = btn.getAttribute('data-k');
      if (k === 'del') {
        qaAmountStr = qaAmountStr.slice(0, -1) || '0';
      } else {
        if (qaAmountStr === '0') qaAmountStr = '';
        qaAmountStr += k;
        if (qaAmountStr.length > 12) qaAmountStr = qaAmountStr.slice(0, 12);
      }
      document.getElementById('qa-amount').textContent = formatSom(parseAmountInput(qaAmountStr));
      updateQaSaveState();
    });

    document.getElementById('qa-save').addEventListener('click', () => {
      const amount = parseAmountInput(qaAmountStr);
      if (amount <= 0 || !qaSelectedCat) return;
      const dateVal = document.getElementById('qa-date').value || isoDate(todayDate());
      state.expenses.push({
        id: 'exp_' + Math.random().toString(36).slice(2, 10),
        categoryId: qaSelectedCat,
        amount,
        date: dateVal + 'T00:00:00.000Z',
        note: document.getElementById('qa-note').value.trim()
      });
      saveState();
      closeSheet('overlay-add');
      renderHome();
      renderExpenses();
      showToast("Xarajat qo'shildi");
    });
  }

  // ================================================================
  //  MONTHLY REPORT
  // ================================================================

  function buildReportData() {
    const expenses = currentPeriodExpenses();
    const spentMap = spentByCategory(expenses);
    const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
    const totalIncome = state.settings.salaryAmount;
    const saved = totalIncome - totalSpent;

    const overspent = [];
    const underspent = [];
    state.categories.forEach((c) => {
      const spent = spentMap[c.id] || 0;
      const diff = c.allocatedAmount - spent;
      if (diff < 0) overspent.push({ cat: c, over: -diff, spent });
      else if (diff > 0) underspent.push({ cat: c, left: diff, spent });
    });
    overspent.sort((a, b) => b.over - a.over);
    underspent.sort((a, b) => b.left - a.left);

    const successScore = totalIncome > 0 ? Math.max(0, Math.min(100, Math.round(100 - (overspent.reduce((s, o) => s + o.over, 0) / totalIncome) * 100))) : 100;

    let advice;
    if (overspent.length > 0) {
      const worst = overspent[0];
      const overPct = worst.cat.allocatedAmount > 0 ? Math.round((worst.over / worst.cat.allocatedAmount) * 100) : 100;
      advice = `${worst.cat.name} xarajati limitdan ${overPct}% ga oshdi. Keyingi oyda bu toifaga ko'proq limit ajratish yoki sarfni kamaytirish tavsiya etiladi.`;
    } else if (saved > 0) {
      advice = `Barcha kategoriyalarda limit ichida qoldingiz va ${formatSom(saved)} so'm tejadingiz. Shu tartibni davom ettiring!`;
    } else {
      advice = "Xarajatlar rejaga mos keldi. Keyingi oyda jamg'arma ulushini biroz oshirishni ko'rib chiqing.";
    }

    return { expenses, spentMap, totalSpent, totalIncome, saved, overspent, underspent, successScore, advice };
  }

  function openReport() {
    const r = buildReportData();
    const pending = isPendingRollover();
    const body = document.getElementById('report-body');

    let html = `
      <div class="report-hero">
        <div class="ring" style="--pct:${r.successScore}"><span>${r.successScore}%</span></div>
        <h3>Rejaga muvofiqlik darajasi</h3>
        <p>${formatPeriodLabel(state.settings.periodStart, state.settings.salaryDay)}</p>
      </div>

      <div class="report-block">
        <h4>Umumiy natija</h4>
        <div class="rline"><span>Maosh</span><span>${formatSom(r.totalIncome)} so'm</span></div>
        <div class="rline"><span>Sarflandi</span><span>${formatSom(r.totalSpent)} so'm</span></div>
        <div class="rline ${r.saved >= 0 ? 'good' : 'bad'}"><span>${r.saved >= 0 ? 'Jamg\'armaga o\'tdi' : 'Ortiqcha sarflandi'}</span><span>${formatSom(Math.abs(r.saved))} so'm</span></div>
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
      html += `<button class="btn btn-primary" id="confirm-rollover">Yangi davrni tasdiqlash</button>`;
    }

    body.innerHTML = html;

    if (pending) {
      document.getElementById('confirm-rollover').addEventListener('click', () => {
        doRollover(r);
      });
    }

    openSheet('overlay-report');
  }

  function doRollover(reportData) {
    state.monthlyArchives.push({
      period: formatPeriodLabel(state.settings.periodStart, state.settings.salaryDay),
      periodStart: state.settings.periodStart,
      totalIncome: reportData.totalIncome,
      totalSpent: reportData.totalSpent,
      totalSaved: reportData.saved,
      overspentCategories: reportData.overspent.map((o) => o.cat.id)
    });

    let newStart = periodEndDate(state.settings.periodStart, state.settings.salaryDay);
    // If multiple periods have been skipped, jump forward to the most recent applicable start.
    while (newStart < todayDate() && periodEndDate(isoDate(newStart), state.settings.salaryDay) <= todayDate()) {
      newStart = periodEndDate(isoDate(newStart), state.settings.salaryDay);
    }
    state.settings.periodStart = isoDate(newStart);
    saveState();
    closeSheet('overlay-report');
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
        if (!parsed.settings || !parsed.categories || !Array.isArray(parsed.expenses)) {
          throw new Error('invalid shape');
        }
        state = parsed;
        if (!state.monthlyArchives) state.monthlyArchives = [];
        saveState();
        applyTheme();
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

    document.getElementById('fab-add').addEventListener('click', openQuickAdd);
    document.getElementById('close-add').addEventListener('click', () => closeSheet('overlay-add'));
    document.getElementById('overlay-add').addEventListener('click', (e) => { if (e.target.id === 'overlay-add') closeSheet('overlay-add'); });
    initQuickAddKeypad();

    document.getElementById('close-edit').addEventListener('click', () => closeSheet('overlay-edit'));
    document.getElementById('overlay-edit').addEventListener('click', (e) => { if (e.target.id === 'overlay-edit') closeSheet('overlay-edit'); });
    document.getElementById('edit-save').addEventListener('click', () => { if (editSheetSubmit) editSheetSubmit(); });

    document.getElementById('close-report').addEventListener('click', () => closeSheet('overlay-report'));
    document.getElementById('overlay-report').addEventListener('click', (e) => { if (e.target.id === 'overlay-report') closeSheet('overlay-report'); });
    document.getElementById('home-report-link').addEventListener('click', openReport);

    document.getElementById('btn-theme').addEventListener('click', toggleTheme);
    document.getElementById('switch-theme').addEventListener('click', toggleTheme);

    document.getElementById('row-edit-salary').addEventListener('click', () => {
      openEditSheet('Oylik maosh', [{ key: 'salary', label: "Oylik daromad (so'm)", type: 'number', placeholder: '5 000 000' }], (v) => {
        const amt = parseAmountInput(v.salary);
        if (amt <= 0) { showToast("To'g'ri summa kiriting"); return false; }
        state.settings.salaryAmount = amt;
        recalcAllocations();
        saveState();
        renderAll();
        return true;
      });
      document.getElementById('ef-salary').value = formatSom(state.settings.salaryAmount);
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
    if (name === 'settings') renderSettings();
  }

  function boot() {
    document.getElementById('app').style.display = 'flex';
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
      boot();
    }

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
      });
    }
  });
})();
