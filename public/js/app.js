document.addEventListener('DOMContentLoaded', () => {
  const loginPage = document.getElementById('login-page');
  const appDashboard = document.getElementById('app-dashboard');
  const loginForm = document.getElementById('login-form');

  // Chart instances
  let salesChart = null;
  let incomeChart = null;
  let dashboardData = null;
  let notificationsList = [];
  let catalogState = { filter: 'All', search: '' };
  let newViewsInitialized = false;

  // -- Login Logic --
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('username').value;
    const passwordInput = document.getElementById('password').value;
    
    const loginError = document.getElementById('login-error');
    const loginErrorText = document.getElementById('login-error-text');
    if (loginError) loginError.classList.add('hidden');

    // Attempt Login
    const result = await API.login(usernameInput, passwordInput);
    if (result.success) {
      // Store user session info in memory or localStorage
      localStorage.setItem('user', JSON.stringify(result.user));
      
      // Hide login, show dashboard
      loginPage.classList.add('hidden');
      appDashboard.classList.remove('hidden');
      
      // Load Dashboard
      loadDashboard();
    } else {
      if (loginError && loginErrorText) {
        loginErrorText.textContent = result.message || "Incorrect username or password.";
        loginError.classList.remove('hidden');
      } else {
        alert("Login failed: " + result.message);
      }
    }
  });

  // Check if already logged in (optional persistence)
  const savedUser = localStorage.getItem('user');
  if (savedUser) {
    // loginPage.classList.add('hidden');
    // appDashboard.classList.remove('hidden');
    // loadDashboard();
    // For demo purposes, we will always show the login screen initially so user can see it
  }

  let syncingOfflineOrders = false;
  window.addEventListener('online', async () => {
    if (syncingOfflineOrders) return;

    syncingOfflineOrders = true;
    try {
      const storedOrders = localStorage.getItem('offline_orders');
      if (!storedOrders) return;

      const offlineOrders = JSON.parse(storedOrders);
      if (!Array.isArray(offlineOrders) || offlineOrders.length === 0) return;

      const response = await fetch('/api/orders/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API.getToken()}`
        },
        body: JSON.stringify({ orders: offlineOrders })
      });
      if (!response.ok) throw new Error(`Offline order sync failed (HTTP ${response.status})`);

      const latestOrders = JSON.parse(localStorage.getItem('offline_orders') || '[]');
      const syncedOrderIds = new Set(offlineOrders.map(order => order.client_order_uuid));
      const remainingOrders = latestOrders.filter(order => !syncedOrderIds.has(order.client_order_uuid));
      if (remainingOrders.length > 0) {
        localStorage.setItem('offline_orders', JSON.stringify(remainingOrders));
      } else {
        localStorage.removeItem('offline_orders');
      }

      alert('Offline orders synced successfully.');
    } catch (error) {
      console.error('Failed to sync offline orders:', error);
    } finally {
      syncingOfflineOrders = false;
    }
  });

  // -- Dashboard Logic --
  async function loadDashboard() {
    const data = await API.getDashboardData();
    if (!data) return;
    dashboardData = data;

    // 1. Populate Profile
    const user = JSON.parse(localStorage.getItem('user'));
    // Find employee info from DB to show proper details (match on username only —
    // matching by role too would attribute a random employee's data to this account)
    const employee = data.employees.find(e => e.name.toLowerCase().split(' ')[0] === user.username.toLowerCase());

    const defaultAvatar = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%239ca3af"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

    const settingsName = document.getElementById('settings-name');
    const settingsRole = document.getElementById('settings-role');

    if (employee) {
      document.getElementById('profile-name').textContent = employee.name;
      document.getElementById('profile-role').textContent = `${employee.role} • ${employee.shiftDuration}`;
      document.getElementById('profile-avatar').src = employee.avatarUrl || defaultAvatar;

      // Prefill Settings
      if (settingsName) settingsName.value = employee.name;
      if (settingsRole) { settingsRole.value = employee.role; settingsRole.disabled = false; }
    } else {
      document.getElementById('profile-name').textContent = user.username;
      document.getElementById('profile-role').textContent = user.role;
      document.getElementById('profile-avatar').src = defaultAvatar;

      // No linked employee record — show the account's own username/role.
      // Role is read-only here: system role changes belong in Role Management, not self-service Settings.
      if (settingsName) settingsName.value = user.username;
      if (settingsRole) { settingsRole.value = user.role; settingsRole.disabled = true; }
    }

    // 2. Populate Summary Cards & Financial KPIs
    document.getElementById('total-orders-value').textContent = data.summary.totalOrders.toLocaleString();
    const ordersGrowthEl = document.getElementById('orders-growth');
    ordersGrowthEl.textContent = `${data.summary.ordersGrowth > 0 ? '+' : ''}${data.summary.ordersGrowth}%`;
    
    document.getElementById('new-customers-value').textContent = data.summary.newCustomers.toLocaleString();
    const customersGrowthEl = document.getElementById('customers-growth');
    customersGrowthEl.textContent = `${data.summary.customersGrowth > 0 ? '+' : ''}${data.summary.customersGrowth}%`;
    
    document.getElementById('total-income-value').textContent = `LKR ${data.summary.totalIncome.toLocaleString()}`;
    updateFinancialKpis(data.summary);
    
    // 3. Populate Tables
    renderDishesTable(data.dishes);
    renderEmployeesTable(data.employees);

    // 4. Render Charts
    renderSalesChart(data.sales);
    renderIncomeChart(data.summary);

    // 5. Render New Views
    renderNewViews(data);

    // 6. Apply Role-Based Permissions
    applyRolePermissions(user.role);

    // 7. Render Drafted Cart
    if (typeof renderCart === 'function') renderCart();

    // 8. Load Notification Settings
    loadSettingsView();
  }

  // Helper to update the 5 Financial KPI cards on Dashboard
  function updateFinancialKpis(summary) {
    if (!summary) return;
    const revEl = document.getElementById('financial-revenue');
    const ordersCountEl = document.getElementById('financial-orders-count');
    const cogsEl = document.getElementById('financial-cogs');
    const grossProfitEl = document.getElementById('financial-gross-profit');
    const grossMarginEl = document.getElementById('financial-gross-margin');
    const expensesEl = document.getElementById('financial-expenses');
    const expensesCountEl = document.getElementById('financial-expenses-count');
    const netProfitEl = document.getElementById('financial-net-profit');
    const netMarginEl = document.getElementById('financial-net-margin');

    const totalIncome = Number(summary.totalIncome || 0);
    const totalCost = Number(summary.totalCost || 0);
    const grossProfit = Number(summary.grossProfit !== undefined ? summary.grossProfit : (totalIncome - totalCost));
    const grossProfitMargin = summary.grossProfitMargin !== undefined 
      ? Number(summary.grossProfitMargin) 
      : (totalIncome > 0 ? (grossProfit / totalIncome) * 100 : 0);
    const totalExpenses = Number(summary.totalExpenses || 0);
    const netProfit = Number(summary.netProfit !== undefined ? summary.netProfit : (grossProfit - totalExpenses));
    const netProfitMargin = summary.netProfitMargin !== undefined 
      ? Number(summary.netProfitMargin) 
      : (totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0);

    if (revEl) revEl.textContent = `LKR ${totalIncome.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    if (ordersCountEl) ordersCountEl.textContent = `${Number(summary.totalOrders || 0).toLocaleString()} orders completed`;
    if (cogsEl) cogsEl.textContent = `LKR ${totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    if (grossProfitEl) {
      grossProfitEl.textContent = `LKR ${grossProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      grossProfitEl.style.color = grossProfit >= 0 ? '#16a34a' : '#dc2626';
    }
    if (grossMarginEl) {
      grossMarginEl.textContent = `${grossProfitMargin.toFixed(1)}%`;
      grossMarginEl.className = `kpi-badge ${grossProfitMargin >= 0 ? 'badge-profit' : 'badge-negative'}`;
    }
    if (expensesEl) expensesEl.textContent = `LKR ${totalExpenses.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    if (expensesCountEl) {
      const expCount = summary.expenseCount !== undefined ? summary.expenseCount : '';
      expensesCountEl.textContent = expCount ? `${expCount} recorded entries` : 'Overheads & operations';
    }
    if (netProfitEl) {
      netProfitEl.textContent = `LKR ${netProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      netProfitEl.style.color = netProfit >= 0 ? '#2563eb' : '#dc2626';
    }
    if (netMarginEl) {
      netMarginEl.textContent = `${netProfitMargin.toFixed(1)}%`;
      netMarginEl.className = `kpi-badge ${netProfitMargin >= 0 ? 'badge-net' : 'badge-negative'}`;
    }
  }

  // Re-fetches and re-renders everything from the server without a page reload —
  // used both right after a checkout and on the periodic live-refresh poll below.
  async function refreshLiveData() {
    const activeFilterBtn = document.querySelector('.filter-btn.active');
    const period = activeFilterBtn ? activeFilterBtn.textContent.trim().toLowerCase() : 'today';

    const freshData = await API.getDashboardData(period);
    if (!freshData) return;
    dashboardData = freshData;

    renderDishesTable(freshData.dishes);
    renderEmployeesTable(freshData.employees);
    renderNewViews(freshData);
    updateCharts(freshData);

    document.getElementById('total-orders-value').textContent = freshData.summary.totalOrders.toLocaleString();
    document.getElementById('total-income-value').textContent = `LKR ${freshData.summary.totalIncome.toLocaleString()}`;
    updateFinancialKpis(freshData.summary);

    // Stock Management has its own editable price/stock inputs — only redraw it
    // when the Stock Keeper isn't actively typing in one of them, so a live
    // refresh never wipes out an in-progress edit.
    const stockView = document.getElementById('view-stock');
    const stockTableFocused = document.activeElement &&
      document.activeElement.closest && document.activeElement.closest('#stock-table-body');
    if (stockView && !stockView.classList.contains('hidden') && !stockTableFocused) {
      renderStockTable(freshData.dishes);
    }
  }

  // Live refresh: poll so changes made from another device/session (a dish added,
  // stock updated, an order rung up) show up here without a manual page reload.
  // Polls every 20s only when tab is active & visible, and syncs instantly when user switches back to the tab.
  const POLLING_INTERVAL_MS = 20000;
  setInterval(() => {
    if (document.hidden) return;
    if (appDashboard.classList.contains('hidden')) return;
    refreshLiveData();
  }, POLLING_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !appDashboard.classList.contains('hidden')) {
      refreshLiveData();
    }
  });

  function getCategoryIconHtml(category) {
    const iconMap = {
      'Food':      { icon: 'fa-burger',    cls: 'food-icon' },
      'Drinks':    { icon: 'fa-mug-hot',   cls: 'drinks-icon' },
      'Snacks':    { icon: 'fa-cookie',    cls: 'snacks-icon' },
      'Ice Cream': { icon: 'fa-ice-cream', cls: 'icecream-icon' },
      'Others':    { icon: 'fa-box',       cls: 'others-icon' }
    };
    const cfg = iconMap[category] || iconMap['Others'];
    return `<div class="item-icon-badge ${cfg.cls}"><i class="fa-solid ${cfg.icon}"></i></div>`;
  }

  let currentDishRanking = 'orders'; // 'orders' or 'profit'

  function renderDishesTable(dishes) {
    const tbody = document.querySelector('#dishes-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    // Sort by orders or by total profit
    const sorted = [...dishes].sort((a, b) => {
      if (currentDishRanking === 'profit') {
        const profitA = a.totalProfit !== undefined ? a.totalProfit : ((Number(a.price || 0) - Number(a.cost || 0)) * (a.orders || 0));
        const profitB = b.totalProfit !== undefined ? b.totalProfit : ((Number(b.price || 0) - Number(b.cost || 0)) * (b.orders || 0));
        return profitB - profitA;
      }
      return (b.orders || 0) - (a.orders || 0);
    });

    sorted.forEach(dish => {
      const tagClass = dish.category === 'Food' ? 'tag-food'
        : dish.category === 'Drinks' ? 'tag-drinks'
        : dish.category === 'Snacks' ? 'tag-snacks'
        : dish.category === 'Ice Cream' ? 'tag-icecream'
        : 'tag-other';
      
      const price = Number(dish.price || 0);
      const cost = Number(dish.cost || 0);
      const unitProfit = price - cost;
      const marginPct = price > 0 ? (unitProfit / price) * 100 : 0;
      const marginClass = marginPct >= 50 ? 'margin-high' : (marginPct >= 25 ? 'margin-med' : 'margin-low');
      const totalProfit = dish.totalProfit !== undefined ? dish.totalProfit : (unitProfit * (dish.orders || 0));

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="item-row">
            ${getCategoryIconHtml(dish.category)}
            <span class="item-name">${dish.name}</span>
          </div>
        </td>
        <td><span class="category-tag ${tagClass}">${dish.category}</span></td>
        <td><strong>LKR ${price.toFixed(2)}</strong></td>
        <td style="color: var(--text-muted);">LKR ${cost.toFixed(2)}</td>
        <td><span class="margin-pill ${marginClass}">${marginPct.toFixed(1)}%</span></td>
        <td><strong>${(dish.orders || 0).toLocaleString()}</strong></td>
        <td><strong style="color: ${totalProfit >= 0 ? '#16a34a' : '#dc2626'}">LKR ${totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Setup ranking toggle listeners
  const btnRankOrders = document.getElementById('btn-rank-orders');
  const btnRankProfit = document.getElementById('btn-rank-profit');
  if (btnRankOrders && btnRankProfit) {
    btnRankOrders.addEventListener('click', () => {
      btnRankOrders.classList.add('active');
      btnRankProfit.classList.remove('active');
      currentDishRanking = 'orders';
      if (dashboardData && dashboardData.dishes) renderDishesTable(dashboardData.dishes);
    });
    btnRankProfit.addEventListener('click', () => {
      btnRankProfit.classList.add('active');
      btnRankOrders.classList.remove('active');
      currentDishRanking = 'profit';
      if (dashboardData && dashboardData.dishes) renderDishesTable(dashboardData.dishes);
    });
  }

  // -- Role-Based Access Control --
  function applyRolePermissions(role) {
    // Role badge config
    const badgeConfig = {
      'Admin':       { text: 'Admin',        cls: 'role-admin' },
      'StockKeeper': { text: 'Stock Keeper',  cls: 'role-stock' },
      'Cashier':     { text: 'Cashier',       cls: 'role-cashier' }
    };
    const cfg = badgeConfig[role] || { text: role, cls: 'role-admin' };
    const badgeEl = document.getElementById('sidebar-role-badge');
    if (badgeEl) {
      badgeEl.textContent = cfg.text;
      badgeEl.className = `sidebar-role-badge role-badge ${cfg.cls}`;
    }

    // Define which nav items are visible per role
    const navVisibility = {
      'Admin': {
        'nav-dashboard': true, 'nav-food-drinks': true, 'nav-stock': true,
        'nav-expenses': true,
        'nav-messages': true, 'nav-bills': true, 'nav-settings': true,
        'nav-notifications': true, 'nav-support': true, 'nav-users': true,
        'nav-audit': true
      },
      'StockKeeper': {
        'nav-dashboard': false, 'nav-food-drinks': false, 'nav-stock': true,
        'nav-expenses': false,
        'nav-messages': true, 'nav-bills': false, 'nav-settings': true,
        'nav-notifications': true, 'nav-support': true, 'nav-users': false,
        'nav-audit': false
      },
      'Cashier': {
        'nav-dashboard': false, 'nav-food-drinks': true, 'nav-stock': false,
        'nav-expenses': false,
        'nav-messages': true, 'nav-bills': true, 'nav-settings': true,
        'nav-notifications': true, 'nav-support': true, 'nav-users': false,
        'nav-audit': false
      }
    };

    const visibility = navVisibility[role] || navVisibility['Admin'];
    Object.entries(visibility).forEach(([id, visible]) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', !visible);
    });

    // Show/hide 'Add New Item' button based on role
    const addItemBtn = document.getElementById('add-item-btn');
    const addItemBtnStock = document.getElementById('add-item-btn-stock');
    if (addItemBtn) addItemBtn.classList.toggle('hidden', role === 'Cashier');
    if (addItemBtnStock) addItemBtnStock.classList.toggle('hidden', role === 'Cashier');

    // Navigate to default view per role
    if (role === 'StockKeeper') {
      switchView('stock', 'Stock Management');
      renderStockTable(dashboardData ? dashboardData.dishes : []);
    } else if (role === 'Cashier') {
      switchView('food-drinks', 'Food & Drinks');
    } else {
      // Admin – stay on dashboard (already active)
    }
  }

  // Live recalculate stock row margin badge
  window.recalcStockMargin = function(dishId) {
    const priceInput = document.getElementById(`price-input-${dishId}`);
    const costInput = document.getElementById(`cost-input-${dishId}`);
    const badge = document.getElementById(`margin-badge-${dishId}`);
    if (!priceInput || !costInput || !badge) return;
    const price = parseFloat(priceInput.value) || 0;
    const cost = parseFloat(costInput.value) || 0;
    const profit = price - cost;
    const marginPct = price > 0 ? (profit / price) * 100 : 0;
    const cls = marginPct >= 50 ? 'margin-high' : (marginPct >= 25 ? 'margin-med' : 'margin-low');
    badge.className = `margin-pill ${cls}`;
    badge.textContent = `${marginPct.toFixed(1)}%`;
  };

  // -- Stock Table Rendering (Stock Keeper & Admin Portal) --
  function renderStockTable(dishes) {
    const tbody = document.getElementById('stock-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const currentUser = JSON.parse(localStorage.getItem('user'));
    const isAdmin = currentUser && currentUser.role === 'Admin';
    const canEdit = isAdmin || (currentUser && currentUser.role === 'StockKeeper');

    dishes.forEach(dish => {
      const tagClass = dish.category === 'Food' ? 'tag-food'
        : dish.category === 'Drinks' ? 'tag-drinks'
        : dish.category === 'Snacks' ? 'tag-snacks'
        : dish.category === 'Ice Cream' ? 'tag-icecream'
        : 'tag-other';
      const stockVal = dish.stock !== undefined ? dish.stock : '-';
      const price = Number(dish.price || 0);
      const cost = Number(dish.cost || 0);
      const marginPct = price > 0 ? ((price - cost) / price) * 100 : 0;
      const marginClass = marginPct >= 50 ? 'margin-high' : (marginPct >= 25 ? 'margin-med' : 'margin-low');

      const tr = document.createElement('tr');
      tr.id = `stock-row-${dish.id}`;
      
      const actionButtons = canEdit
        ? `
          <button class="btn-outline" style="padding: 0.35rem 0.6rem; margin-right: 0.5rem;" onclick="window.openEditModal(${dish.id})">
            <i class="fa-solid fa-pen"></i> Edit
          </button>
          <button class="btn-save-stock" onclick="window.saveStockRow(${dish.id})">
            <i class="fa-solid fa-floppy-disk"></i> Save
          </button>
          ${isAdmin ? `
            <button class="btn-outline" style="padding: 0.35rem 0.6rem; margin-left: 0.5rem; color: #EF4444; border-color: #EF4444;" onclick="window.deleteDish(${dish.id})">
              <i class="fa-solid fa-trash"></i> Delete
            </button>
          ` : ''}
        `
        : `
          <button class="btn-outline" style="padding: 0.35rem 0.6rem; color: #EF4444; border-color: #EF4444;" onclick="window.deleteDish(${dish.id})">
            <i class="fa-solid fa-trash"></i> Delete
          </button>
        `;

      tr.innerHTML = `
        <td>
          <div class="item-row">
            ${getCategoryIconHtml(dish.category)}
            <span class="item-name">${dish.name}</span>
          </div>
        </td>
        <td><span class="category-tag ${tagClass}">${dish.category}</span></td>
        <td><input type="number" step="0.01" min="0" class="stock-input" id="price-input-${dish.id}" value="${price.toFixed(2)}" oninput="window.recalcStockMargin(${dish.id})" ${canEdit ? '' : 'disabled'}></td>
        <td><input type="number" step="0.01" min="0" class="stock-input" id="cost-input-${dish.id}" value="${cost.toFixed(2)}" oninput="window.recalcStockMargin(${dish.id})" ${canEdit ? '' : 'disabled'}></td>
        <td><span class="margin-pill ${marginClass}" id="margin-badge-${dish.id}">${marginPct.toFixed(1)}%</span></td>
        <td><input type="number" step="1" min="0" class="stock-input" id="stock-input-${dish.id}" value="${stockVal === '-' ? 0 : stockVal}" ${canEdit ? '' : 'disabled'}></td>
        <td>
          ${actionButtons}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  window.deleteDish = async function(dishId) {
    const dish = dashboardData ? dashboardData.dishes.find(d => d.id === dishId) : null;
    const label = dish ? `"${dish.name}"` : 'this item';
    if (!confirm(`Are you sure you want to delete ${label}? This cannot be undone.`)) return;

    const result = await API.deleteDish(dishId);
    if (result.success) {
      const data = await API.getDashboardData();
      if (data) {
        dashboardData = data;
        renderStockTable(data.dishes);
        renderNewViews(data);
      }
    } else {
      alert('Failed to delete item: ' + (result.message || 'Unknown error'));
    }
  };

  window.saveStockRow = async function(dishId) {
    const priceInput = document.getElementById(`price-input-${dishId}`);
    const costInput = document.getElementById(`cost-input-${dishId}`);
    const stockInput = document.getElementById(`stock-input-${dishId}`);
    if (!priceInput || !stockInput) return;
    
    const costVal = costInput ? costInput.value : 0;
    const result = await API.updateDish(dishId, {
      price: priceInput.value,
      cost: costVal,
      stock: stockInput.value
    });
    if (result.success) {
      const btn = document.querySelector(`#stock-row-${dishId} .btn-save-stock`);
      if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!';
        btn.style.background = '#10B981';
        setTimeout(() => {
          btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
          btn.style.background = '';
        }, 1800);
      }
      // Update local dashboardData as well
      if (dashboardData) {
        const d = dashboardData.dishes.find(d => d.id === dishId);
        if (d) { 
          d.price = Number(priceInput.value); 
          d.cost = Number(costVal);
          d.stock = Number(stockInput.value); 
        }
      }
    } else {
      alert('Failed to save: ' + result.message);
    }
  };

  function renderEmployeesTable(employees) {
    const tbody = document.querySelector('#employees-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    // Sort by earnings desc
    const sorted = [...employees].sort((a, b) => b.earnings - a.earnings);

    sorted.forEach(emp => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="item-row">
            <img src="${emp.avatarUrl}" alt="${emp.name}" class="item-image">
            <span class="item-name">${emp.name}</span>
          </div>
        </td>
        <td>${emp.role}</td>
        <td class="earnings-text">LKR ${emp.earnings.toLocaleString()}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Chart Rendering with Chart.js
  function renderSalesChart(salesData) {
    const ctx = document.getElementById('salesChart').getContext('2d');
    
    if (salesChart) {
      salesChart.destroy();
    }

    const labels = salesData.map(d => d.timeLabel);
    const dataPoints = salesData.map(d => d.amount);

    salesChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Sales',
          data: dataPoints,
          borderColor: '#800000', /* Dark Red matching logo */
          backgroundColor: 'rgba(128, 0, 0, 0.1)',
          borderWidth: 3,
          tension: 0.4, /* Curved smooth line */
          fill: true,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#800000',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1E1E1E',
            padding: 10,
            displayColors: false,
            callbacks: {
              label: (context) => `${context.parsed.y} Orders`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: '#EAEAEA', borderDash: [5, 5] },
            border: { display: false }
          },
          x: {
            grid: { display: false },
            border: { display: false }
          }
        }
      }
    });
  }

  function renderIncomeChart(summaryData) {
    const ctx = document.getElementById('incomeChart').getContext('2d');
    
    if (incomeChart) {
      incomeChart.destroy();
    }

    document.getElementById('total-income-value').textContent = `LKR ${summaryData.totalIncome.toLocaleString()}`;

    incomeChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Food', 'Drinks', 'Others'],
        datasets: [{
          data: [summaryData.foodIncome, summaryData.drinksIncome, summaryData.othersIncome],
          backgroundColor: ['#800000', '#EAB308', '#2C2C2C'],
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '75%', // Inner hole size
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => ` LKR ${context.parsed.toLocaleString()}`
            }
          }
        }
      }
    });
  }

  // Dashboard Time Filter Click Handlers (Fetches Real Period Analytics)
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      filterBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      
      const period = e.target.textContent.trim().toLowerCase();
      const freshData = await API.getDashboardData(period);
      if (freshData) {
        dashboardData = freshData;

        // Update summary numbers & financial KPIs
        document.getElementById('total-orders-value').textContent = freshData.summary.totalOrders.toLocaleString();
        document.getElementById('orders-growth').textContent = `${freshData.summary.ordersGrowth > 0 ? '+' : ''}${freshData.summary.ordersGrowth}%`;
        document.getElementById('orders-growth').className = `summary-badge ${freshData.summary.ordersGrowth > 0 ? 'positive' : 'negative'}`;
        
        document.getElementById('new-customers-value').textContent = freshData.summary.newCustomers.toLocaleString();
        document.getElementById('customers-growth').textContent = `${freshData.summary.customersGrowth > 0 ? '+' : ''}${freshData.summary.customersGrowth}%`;
        document.getElementById('customers-growth').className = `summary-badge ${freshData.summary.customersGrowth > 0 ? 'positive' : 'negative'}`;
        
        document.getElementById('total-income-value').textContent = `LKR ${freshData.summary.totalIncome.toLocaleString()}`;
        updateFinancialKpis(freshData.summary);

        // Re-render trending dishes for that period
        renderDishesTable(freshData.dishes);

        // Update charts in place
        updateCharts(freshData);
      }
    });
  });

  // -- View Router --
  const views = document.querySelectorAll('.view-section');
  const navLinks = document.querySelectorAll('.sidebar-menu a[data-view]');
  const breadcrumbCurrent = document.querySelector('.breadcrumbs .current');
  const subHeaderTitle = document.querySelector('.sub-header h1');

  function switchView(viewId, title) {
    // Update active nav link
    document.querySelectorAll('.sidebar-menu li').forEach(li => li.classList.remove('active'));
    const activeLink = document.querySelector(`.sidebar-menu a[data-view="${viewId}"]`);
    if (activeLink) activeLink.parentElement.classList.add('active');

    // Hide all views, show target
    views.forEach(view => view.classList.add('hidden'));
    const targetView = document.getElementById(`view-${viewId}`);
    if (targetView) targetView.classList.remove('hidden');

    // Update Header
    if (breadcrumbCurrent) breadcrumbCurrent.textContent = title;
    if (subHeaderTitle) subHeaderTitle.textContent = title;

    // Special logic per view
    const timeFilters = document.querySelector('.time-filters');
    if (viewId === 'dashboard') {
      if (timeFilters) timeFilters.style.display = 'flex';
      if (salesChart && incomeChart) {
        salesChart.update();
        incomeChart.update();
      }
    } else {
      if (timeFilters) timeFilters.style.display = 'none';
    }

    // Mobile cart FAB only makes sense on the ordering screen (CSS also gates it to mobile widths)
    const mobileCartFab = document.getElementById('mobile-cart-fab');
    if (mobileCartFab) {
      mobileCartFab.classList.toggle('hidden', viewId !== 'food-drinks');
    }
    if (viewId !== 'food-drinks') closeMobileCart();
  }

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const viewId = link.getAttribute('data-view');
      
      // Get title by filtering out children like badge
      let title = '';
      link.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          title += node.textContent.trim() + ' ';
        }
      });
      title = title.trim();
      
      switchView(viewId, title);

      // If navigating to stock view, refresh the stock table
      if (viewId === 'stock' && dashboardData) {
        renderStockTable(dashboardData.dishes);
      }
      // If navigating to expenses view, refresh expenses
      if (viewId === 'expenses') {
        renderExpensesView();
      }
      // If navigating to settings view, refresh notification settings
      if (viewId === 'settings') {
        loadSettingsView();
      }
      // If navigating to audit view, refresh audit logs
      if (viewId === 'audit') {
        renderAuditLogsView();
      }

      closeMobileSidebar();
    });
  });

  // -- Mobile Sidebar Drawer --
  const sidebarEl = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');

  function openMobileSidebar() {
    sidebarEl.classList.add('mobile-open');
    sidebarBackdrop.classList.add('show');
  }

  function closeMobileSidebar() {
    sidebarEl.classList.remove('mobile-open');
    sidebarBackdrop.classList.remove('show');
  }

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebarEl.classList.contains('mobile-open') ? closeMobileSidebar() : openMobileSidebar();
    });
  }
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', closeMobileSidebar);
  }

  // -- Mobile Cart Popup (Food & Drinks, mobile layout only) --
  const cartPanelWrapper = document.getElementById('cart-panel-wrapper');
  const mobileCartFabBtn = document.getElementById('mobile-cart-fab');
  const mobileCartCloseBtn = document.getElementById('mobile-cart-close-btn');

  function openMobileCart() {
    if (cartPanelWrapper) cartPanelWrapper.classList.add('cart-mobile-open');
  }

  function closeMobileCart() {
    if (cartPanelWrapper) cartPanelWrapper.classList.remove('cart-mobile-open');
  }

  if (mobileCartFabBtn) {
    mobileCartFabBtn.addEventListener('click', openMobileCart);
  }
  if (mobileCartCloseBtn) {
    mobileCartCloseBtn.addEventListener('click', closeMobileCart);
  }
  if (cartPanelWrapper) {
    // Close when tapping the dimmed backdrop, not the card itself
    cartPanelWrapper.addEventListener('click', (e) => {
      if (e.target === cartPanelWrapper) closeMobileCart();
    });
  }

  document.getElementById('open-profile-btn').addEventListener('click', () => {
    switchView('settings', 'Profile Settings');
    closeMobileSidebar();
  });

  async function handleLogout() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user && user.username) {
      try {
        await API.logAudit({
          action: 'USER_LOGOUT',
          category: 'Auth',
          details: `Staff member "${user.username}" (${user.role || 'Staff'}) logged out.`
        });
      } catch (e) {}
    }
    API.logout();
    appDashboard.classList.add('hidden');
    loginPage.classList.remove('hidden');
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }

  window.addEventListener('smartpos:auth-expired', () => {
    handleLogout();
    const loginError = document.getElementById('login-error');
    const loginErrorText = document.getElementById('login-error-text');
    if (loginError && loginErrorText) {
      loginErrorText.textContent = 'Session expired. Please log in again.';
      loginError.classList.remove('hidden');
    }
  });
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
      const newName = document.getElementById('settings-name').value;
      const newRole = document.getElementById('settings-role').value;
      const originalName = document.getElementById('profile-name').textContent;
      const user = JSON.parse(localStorage.getItem('user'));

      // Accounts without a linked employee record (admin, cashier, stockkeeper, ...)
      // have nothing for API.updateEmployee to match — update the user account instead.
      const isEmployeeLinked = dashboardData && dashboardData.employees.some(
        e => e.name.toLowerCase().split(' ')[0] === user.username.toLowerCase()
      );

      const result = isEmployeeLinked
        ? await API.updateEmployee(newName, newRole, originalName)
        : await API.updateUser(user.id, { username: newName.split(' ')[0].toLowerCase() });

      if (result.success) {
        alert('Profile settings saved successfully!');

        // Also update local storage session if user matching
        if (user) {
          user.username = newName.split(' ')[0].toLowerCase();
          if (isEmployeeLinked) user.role = newRole;
          localStorage.setItem('user', JSON.stringify(user));
        }

        // Refresh dashboard data & profile sidebar
        loadDashboard();
      } else {
        alert('Failed to update settings: ' + result.message);
      }
    });
  }

  // -- Day-End Notifications & Settings Logic --
  async function loadSettingsView() {
    const res = await API.getSettings();
    if (res && res.success && res.settings) {
      const s = res.settings;
      const phoneInput = document.getElementById('setting-notification-phone');
      const recipientInput = document.getElementById('setting-notification-recipient');
      const channelSelect = document.getElementById('setting-notification-channel');
      const autoSelect = document.getElementById('setting-notification-auto');
      const cafeNameInput = document.getElementById('setting-cafe-name');
      const emailInput = document.getElementById('setting-notification-email');
      const addressInput = document.getElementById('setting-address');
      const currencyInput = document.getElementById('setting-currency');

      if (phoneInput && s.notification_phone) phoneInput.value = s.notification_phone;
      if (recipientInput && s.notification_recipient) recipientInput.value = s.notification_recipient;
      if (channelSelect && s.notification_channel) channelSelect.value = s.notification_channel;
      if (autoSelect && s.auto_day_end_enabled !== undefined) {
        autoSelect.value = s.auto_day_end_enabled ? 'auto' : 'manual';
      }
      if (cafeNameInput && s.cafe_name) cafeNameInput.value = s.cafe_name;
      if (emailInput && s.notification_email !== undefined) emailInput.value = s.notification_email;
      if (addressInput && s.address !== undefined) addressInput.value = s.address;
      if (currencyInput && s.currency) currencyInput.value = s.currency;
    }
  }

  const notificationSettingsForm = document.getElementById('notification-settings-form');
  if (notificationSettingsForm) {
    notificationSettingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = document.getElementById('setting-notification-phone').value.trim();
      const recipient = document.getElementById('setting-notification-recipient').value.trim() || 'W.A Lahiru Sampath';
      const channel = document.getElementById('setting-notification-channel').value;
      const autoTrigger = document.getElementById('setting-notification-auto').value === 'auto';
      const cafeName = document.getElementById('setting-cafe-name') ? document.getElementById('setting-cafe-name').value.trim() : 'Mochiato';
      const email = document.getElementById('setting-notification-email').value.trim();
      const address = document.getElementById('setting-address').value.trim();
      const currency = document.getElementById('setting-currency').value.trim() || 'LKR';

      if (!phone) {
        alert('Please enter a valid phone number.');
        return;
      }

      const saveBtn = document.getElementById('save-notification-settings-btn');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
      }

      const res = await API.updateSettings({
        notification_phone: phone,
        notification_recipient: recipient,
        notification_channel: channel,
        auto_day_end_enabled: autoTrigger,
        cafe_name: cafeName,
        notification_email: email,
        address,
        currency
      });

      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Settings Saved!';
        saveBtn.style.background = '#10B981';
        setTimeout(() => {
          saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Notification Settings';
          saveBtn.style.background = '';
        }, 2200);
      }

      if (res && res.success) {
        alert(`Day-End notification recipient updated successfully!\nRecipient: ${recipient}\nPhone: ${phone}\nChannel: ${channel}`);
      } else {
        alert('Failed to save notification settings: ' + ((res && res.message) || 'Unknown error'));
      }
    });
  }

  const testNotificationBtn = document.getElementById('test-notification-btn');
  if (testNotificationBtn) {
    testNotificationBtn.addEventListener('click', async () => {
      const phoneInput = document.getElementById('setting-notification-phone');
      const recipientInput = document.getElementById('setting-notification-recipient');
      const channelSelect = document.getElementById('setting-notification-channel');
      const autoSelect = document.getElementById('setting-notification-auto');
      const cafeNameInput = document.getElementById('setting-cafe-name');
      const emailInput = document.getElementById('setting-notification-email');
      const addressInput = document.getElementById('setting-address');
      const currencyInput = document.getElementById('setting-currency');

      const phone = phoneInput ? phoneInput.value.trim() : '';
      const recipient = recipientInput ? recipientInput.value.trim() || 'W.A Lahiru Sampath' : 'W.A Lahiru Sampath';
      const channel = channelSelect ? channelSelect.value : 'WhatsApp';
      const autoTrigger = autoSelect ? autoSelect.value === 'auto' : true;
      const cafeName = cafeNameInput ? cafeNameInput.value.trim() : 'Mochiato';
      const email = emailInput ? emailInput.value.trim() : '';
      const address = addressInput ? addressInput.value.trim() : '';
      const currency = currencyInput ? currencyInput.value.trim() : 'LKR';

      if (!phone) {
        alert('Please enter a recipient phone number first.');
        if (phoneInput) phoneInput.focus();
        return;
      }

      // Automatically persist settings so any updated number is immediately saved
      testNotificationBtn.disabled = true;
      const origHtml = testNotificationBtn.innerHTML;
      testNotificationBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing...';

      try {
        await API.updateSettings({
          notification_phone: phone,
          notification_recipient: recipient,
          notification_channel: channel,
          auto_day_end_enabled: autoTrigger,
          cafe_name: cafeName,
          notification_email: email,
          address,
          currency
        });

        const activeFilterBtn = document.querySelector('.filter-btn.active');
        const period = activeFilterBtn ? activeFilterBtn.textContent.trim().toLowerCase() : 'today';

        const res = await API.sendDayEndSummary(period, phone, recipient);
        if (res && res.success) {
          if (channel === 'SMS' && res.smsUrl) {
            window.location.href = res.smsUrl;
          } else if (res.whatsappUrl) {
            window.open(res.whatsappUrl, '_blank');
          } else {
            alert('Day-End summary prepared successfully!');
          }
        } else {
          alert('Could not generate summary message. Please try again.');
        }
      } catch (err) {
        console.error(err);
        alert('An error occurred while preparing the notification.');
      } finally {
        testNotificationBtn.disabled = false;
        testNotificationBtn.innerHTML = origHtml;
      }
    });
  }

  const sendDayEndWhatsAppBtn = document.getElementById('send-day-end-whatsapp-btn');
  if (sendDayEndWhatsAppBtn) {
    sendDayEndWhatsAppBtn.addEventListener('click', async () => {
      const activeFilterBtn = document.querySelector('.filter-btn.active');
      const period = activeFilterBtn ? activeFilterBtn.textContent.trim().toLowerCase() : 'today';

      sendDayEndWhatsAppBtn.disabled = true;
      const origText = sendDayEndWhatsAppBtn.innerHTML;
      sendDayEndWhatsAppBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';

      try {
        const res = await API.sendDayEndSummary(period);
        if (res && res.success && res.whatsappUrl) {
          const recName = (res.recipient && res.recipient.name) || 'W.A Lahiru Sampath';
          const recPhone = (res.recipient && res.recipient.phone) || 'Saved Number';
          const confirmSend = confirm(
            `Send ${period.toUpperCase()} Day-End Financial Summary (Gross Revenue, COGS, Expenses & Net Profit) to ${recName} (${recPhone}) via WhatsApp?`
          );
          if (confirmSend) {
            window.open(res.whatsappUrl, '_blank');
          }
        } else {
          alert('Failed to generate Day-End summary. Please ensure notification settings are saved.');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to prepare day-end report.');
      } finally {
        sendDayEndWhatsAppBtn.disabled = false;
        sendDayEndWhatsAppBtn.innerHTML = origText;
      }
    });
  }

  // -- Render New Views --
  async function renderNewViews(data) {
    // Render Catalog (Food & Drinks)
    const catalogGrid = document.getElementById('catalog-grid');
    const searchInput = document.querySelector('.search-bar input');

    function drawCatalog(filter = 'All', searchQuery = '') {
      catalogGrid.innerHTML = '';
      let filteredDishes = data.dishes;
      
      if (filter !== 'All') {
        filteredDishes = data.dishes.filter(d => d.category === filter);
      }
      
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        filteredDishes = filteredDishes.filter(d => d.name.toLowerCase().includes(q));
      }

      let html = '';
      filteredDishes.forEach(dish => {
        // Stock state: undefined/null means no stock tracking, 0 = out of stock
        const hasStock = dish.stock !== undefined && dish.stock !== null;
        const inCartQty = cart.filter(c => c.id === dish.id).reduce((sum, c) => sum + c.quantity, 0);
        const remaining = hasStock ? Math.max(0, dish.stock - inCartQty) : Infinity;
        const isOutOfStock = hasStock && remaining === 0;
        const stockBadge = hasStock
          ? (isOutOfStock
              ? `<span class="stock-badge out">Out of Stock</span>`
              : `<span class="stock-badge ${remaining <= 3 ? 'low' : 'ok'}">${remaining} in stock</span>`)
          : '';
        const tagClass = dish.category === 'Food' ? 'tag-food'
          : dish.category === 'Drinks' ? 'tag-drinks'
          : dish.category === 'Snacks' ? 'tag-snacks'
          : dish.category === 'Ice Cream' ? 'tag-icecream'
          : 'tag-other';
        html += `
          <div class="catalog-item ${isOutOfStock ? 'catalog-item-disabled' : ''}">
            <div class="catalog-item-header">
              ${getCategoryIconHtml(dish.category)}
              <div style="flex: 1; min-width: 0;">
                <div class="catalog-item-name">${dish.name}</div>
                <span class="category-tag ${tagClass}">${dish.category}</span>
              </div>
            </div>
            <div class="catalog-item-info">
              <div class="catalog-item-price">LKR ${Number(dish.price || 0).toFixed(2)}</div>
              ${stockBadge}
              <div style="display: flex; gap: 0.5rem; align-items: stretch; margin-top: 0.5rem;">
                <input type="number" id="qty-input-${dish.id}" value="1" min="1" max="${hasStock ? remaining : ''}" 
                       class="form-control" style="width: 60px; text-align: center; border-radius: 8px; border: 1px solid var(--border-color); background: transparent; color: inherit;" ${isOutOfStock ? 'disabled' : ''}>
                <button class="btn-outline" onclick="window.addToCart(${dish.id})" style="flex: 1;" ${isOutOfStock ? 'disabled' : ''}>
                  <i class="fa-solid fa-cart-plus"></i> ${isOutOfStock ? 'Out of Stock' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        `;
      });
      catalogGrid.innerHTML = html;
    }

    // Expose globally so addToCart/updateQuantity can refresh stock badges
    window.drawCatalogGlobal = () => drawCatalog(catalogState.filter, searchInput ? searchInput.value : '');

    // Re-draw with whatever filter/search was already active — this function runs
    // on every live data refresh, not just once, so it must not reset the user's
    // current filter/search state each time.
    drawCatalog(catalogState.filter, catalogState.search);

    // Listeners are only wired up once: renderNewViews() is called on every
    // periodic refresh, and addEventListener would otherwise stack a fresh
    // duplicate handler on every single call.
    if (!newViewsInitialized) {
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          catalogState.search = e.target.value;
          drawCatalog(catalogState.filter, catalogState.search);
        });
      }

      // Catalog Filters
      const catalogFilters = document.querySelectorAll('.catalog-filter-btn');
      catalogFilters.forEach(btn => {
        btn.addEventListener('click', (e) => {
          catalogFilters.forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
          catalogState.filter = e.target.getAttribute('data-filter');
          drawCatalog(catalogState.filter, searchInput ? searchInput.value : '');
        });
      });

      // Export Menu Button
      const exportBtn = document.getElementById('export-dishes-btn');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => {
          if (!data || !data.dishes || data.dishes.length === 0) {
            alert('No menu items available to export.');
            return;
          }
          const exportItems = data.dishes.map(d => ({
            name: d.name,
            category: d.category,
            price: Number(d.price || 0),
            stock: Number(d.stock || 0)
          }));
          const jsonStr = JSON.stringify(exportItems, null, 2);
          const blob = new Blob([jsonStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `TeensCafe_Menu_${new Date().toISOString().split('T')[0]}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showStockToast(`Exported ${exportItems.length} menu items successfully!`, 'success');
        });
      }

      // Import Menu File Listener
      const importFileInput = document.getElementById('import-dishes-file');
      if (importFileInput) {
        importFileInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async (event) => {
            const text = event.target.result;
            let items = [];
            try {
              if (file.name.endsWith('.csv')) {
                items = parseCSVMenu(text);
              } else {
                items = JSON.parse(text);
                if (!Array.isArray(items)) {
                  if (items.dishes && Array.isArray(items.dishes)) items = items.dishes;
                  else items = [items];
                }
              }
            } catch (err) {
              alert('Invalid file format. Please upload a valid JSON or CSV menu file.');
              importFileInput.value = '';
              return;
            }

            if (items.length === 0) {
              alert('No items found in the uploaded file.');
              importFileInput.value = '';
              return;
            }

            showStockToast(`Importing ${items.length} menu items...`, 'warn');
            const res = await API.importDishes(items);
            importFileInput.value = '';

            if (res.success) {
              showStockToast(`Import complete! Added ${res.count} items (${res.skipped} duplicates skipped).`, 'success');
              await refreshLiveData();
            } else {
              alert('Failed to import menu items: ' + (res.message || 'Unknown error'));
            }
          };
          reader.readAsText(file);
        });
      }

      newViewsInitialized = true;
    }

    function parseCSVMenu(csvText) {
      const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
      if (lines.length <= 1) return [];
      const items = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length >= 3 && cols[0]) {
          items.push({
            name: cols[0],
            category: cols[1] || 'Others',
            price: Number(cols[2]) || 0,
            stock: Number(cols[3]) || 0
          });
        }
      }
      return items;
    }

    // Render Bills
    const billsTbody = document.querySelector('#bills-table tbody');
    if (data.bills) {
      billsTbody.innerHTML = data.bills.map(bill => `
        <tr>
          <td><button class="btn-link" onclick="window.previewBill('${bill.id}')"><strong>${bill.id}</strong></button></td>
          <td>${bill.date}</td>
          <td>${bill.customer}</td>
          <td>LKR ${bill.amount.toFixed(2)}</td>
          <td><span class="summary-badge ${bill.status === 'Paid' ? 'positive' : 'negative'}">${bill.status}</span></td>
        </tr>
      `).join('');
    }

    // Render Messages
    if (data.messages && notificationsList.length === 0 && (!window.hasInitializedNotifications)) {
      notificationsList = [...data.messages];
      window.hasInitializedNotifications = true;
    }
    renderNotifications();
    
    // Load users if Admin
    const currentUser = JSON.parse(localStorage.getItem('user'));
    if (currentUser && currentUser.role === 'Admin') {
      loadUsersData();
    }
  }

  let systemUsers = [];

  async function loadUsersData() {
    const res = await API.getUsers();
    if (res.success && res.users) {
      systemUsers = res.users;
      renderUsersTable();
    }
  }

  function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    systemUsers.forEach(u => {
      const badgeCls = u.role === 'Admin' ? 'role-admin' : (u.role === 'StockKeeper' ? 'role-stock' : 'role-cashier');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.id}</td>
        <td><strong>${u.username}</strong></td>
        <td><span class="role-badge ${badgeCls}">${u.role}</span></td>
        <td>
          <button class="btn-outline" style="padding: 0.35rem 0.6rem; margin-right: 0.5rem;" onclick="window.editUser(${u.id})">
            <i class="fa-solid fa-pen"></i> Edit
          </button>
          <button class="btn-outline" style="padding: 0.35rem 0.6rem; color: #EF4444; border-color: #EF4444;" onclick="window.deleteUser(${u.id})">
            <i class="fa-solid fa-trash"></i> Delete
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // -- Image File Upload Helper --
  function readImageFile(file) {
    return new Promise((resolve) => {
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }

  // -- Modal Logic --
  const addItemModal = document.getElementById('add-item-modal');
  const addItemBtn = document.getElementById('add-item-btn');
  const addItemBtnStock = document.getElementById('add-item-btn-stock');
  const closeModalBtns = [document.getElementById('close-modal-btn'), document.getElementById('cancel-modal-btn')];
  const addItemForm = document.getElementById('add-item-form');

  if (addItemBtn || addItemBtnStock) {
    if (addItemBtn) addItemBtn.addEventListener('click', () => addItemModal.classList.add('show'));
    if (addItemBtnStock) addItemBtnStock.addEventListener('click', () => addItemModal.classList.add('show'));
    closeModalBtns.forEach(btn => btn.addEventListener('click', () => addItemModal.classList.remove('show')));
    
    addItemForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById('item-image-file');
      const imageBase64 = await readImageFile(fileInput.files[0]);

      const costInput = document.getElementById('item-cost');
      const newDish = {
        name: document.getElementById('item-name').value,
        category: document.getElementById('item-category').value,
        price: document.getElementById('item-price').value,
        cost: costInput ? costInput.value : 0,
        imageUrl: document.getElementById('item-image').value,
        imageBase64: imageBase64
      };
      
      const result = await API.addDish(newDish);
      if (result.success) {
        // Refresh dashboard data
        const data = await API.getDashboardData();
        if(data) {
          renderNewViews(data);
          if (typeof renderStockTable === 'function') renderStockTable(data.dishes);
        }
        addItemModal.classList.remove('show');
        addItemForm.reset();
      } else {
        alert(result.message || 'Failed to add item.');
      }
    });
  }

  // Edit Item Modal Logic
  const editItemModal = document.getElementById('edit-item-modal');
  const closeEditModalBtns = [document.getElementById('close-edit-modal-btn'), document.getElementById('cancel-edit-modal-btn')];
  const editItemForm = document.getElementById('edit-item-form');

  if (editItemModal) {
    closeEditModalBtns.forEach(btn => btn.addEventListener('click', () => editItemModal.classList.remove('show')));

    window.openEditModal = function(dishId) {
      const dish = (dashboardData && dashboardData.dishes) ? dashboardData.dishes.find(d => d.id === dishId) : null;
      if (!dish) return;
      
      document.getElementById('edit-item-id').value = dish.id;
      document.getElementById('edit-item-name').value = dish.name;
      document.getElementById('edit-item-category').value = dish.category;
      
      const editPriceEl = document.getElementById('edit-item-price');
      const editCostEl = document.getElementById('edit-item-cost');
      if (editPriceEl) editPriceEl.value = Number(dish.price || 0).toFixed(2);
      if (editCostEl) editCostEl.value = Number(dish.cost || 0).toFixed(2);

      document.getElementById('edit-item-image').value = dish.imageUrl || '';
      document.getElementById('edit-item-image-file').value = '';
      
      editItemModal.classList.add('show');
    };

    editItemForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dishId = document.getElementById('edit-item-id').value;
      const fileInput = document.getElementById('edit-item-image-file');
      const imageBase64 = await readImageFile(fileInput.files[0]);

      const editPriceEl = document.getElementById('edit-item-price');
      const editCostEl = document.getElementById('edit-item-cost');

      const updates = {
        name: document.getElementById('edit-item-name').value,
        category: document.getElementById('edit-item-category').value,
        price: editPriceEl ? editPriceEl.value : undefined,
        cost: editCostEl ? editCostEl.value : undefined,
        imageUrl: document.getElementById('edit-item-image').value,
        imageBase64: imageBase64
      };

      const result = await API.updateDish(dishId, updates);
      if (result.success) {
        const data = await API.getDashboardData();
        if(data) {
          renderNewViews(data);
          if (typeof renderStockTable === 'function') renderStockTable(data.dishes);
        }
        editItemModal.classList.remove('show');
        editItemForm.reset();
      } else {
        alert('Failed to update item details.');
      }
    });
  }

  // -- Expenses Tracker Logic --
  let expensesList = [];

  async function renderExpensesView() {
    const activeFilterBtn = document.querySelector('.filter-btn.active');
    const period = activeFilterBtn ? activeFilterBtn.textContent.trim().toLowerCase() : 'all';

    const result = await API.getExpenses(period);
    if (result && result.success) {
      expensesList = result.expenses || [];
      renderExpensesTable(expensesList);
      
      const totalAmount = expensesList.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
      const totalEl = document.getElementById('expenses-period-total');
      if (totalEl) {
        totalEl.textContent = `LKR ${totalAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      }
    }
  }

  function renderExpensesTable(list) {
    const tbody = document.getElementById('expenses-table-body');
    if (!tbody) return;
    const catFilter = document.getElementById('expense-category-filter');
    const selectedCat = catFilter ? catFilter.value : 'All';
    const filtered = selectedCat === 'All' ? list : list.filter(e => e.category === selectedCat);

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
            <i class="fa-solid fa-receipt" style="font-size: 2.2rem; margin-bottom: 0.6rem; display: block; opacity: 0.4;"></i>
            No expenses recorded for this period. Click "Record Expense" to add one.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(exp => `
      <tr id="expense-row-${exp.id}">
        <td><strong>${exp.date || ''}</strong></td>
        <td><strong>${exp.title || ''}</strong></td>
        <td><span class="badge-expense-cat">${exp.category || 'Miscellaneous'}</span></td>
        <td style="font-weight: 700; color: #dc2626;">LKR ${Number(exp.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        <td><span style="font-size: 0.85rem; color: var(--text-muted);">${exp.created_by || 'Admin'}</span></td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${exp.notes || '-'}</td>
        <td>
          <button class="btn-icon-danger" title="Delete Expense" onclick="window.deleteExpense(${exp.id})">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  const expenseCategoryFilter = document.getElementById('expense-category-filter');
  if (expenseCategoryFilter) {
    expenseCategoryFilter.addEventListener('change', () => {
      renderExpensesTable(expensesList);
    });
  }

  window.deleteExpense = async function(id) {
    if (!confirm('Are you sure you want to delete this expense record?')) return;
    const res = await API.deleteExpense(id);
    if (res.success) {
      await renderExpensesView();
      if (typeof refreshLiveData === 'function') refreshLiveData();
    } else {
      alert('Failed to delete expense: ' + (res.message || 'Unknown error'));
    }
  };

  const addExpenseModal = document.getElementById('add-expense-modal');
  const addExpenseBtn = document.getElementById('add-expense-btn');
  const addExpenseForm = document.getElementById('add-expense-form');
  const closeExpenseModalBtns = [
    document.getElementById('close-expense-modal-btn'),
    document.getElementById('cancel-expense-modal-btn')
  ];

  if (addExpenseModal) {
    if (addExpenseBtn) {
      addExpenseBtn.addEventListener('click', () => {
        const dateInput = document.getElementById('expense-date');
        if (dateInput && !dateInput.value) {
          dateInput.value = new Date().toISOString().split('T')[0];
        }
        addExpenseModal.classList.add('show');
      });
    }

    closeExpenseModalBtns.forEach(btn => {
      if (btn) btn.addEventListener('click', () => addExpenseModal.classList.remove('show'));
    });

    if (addExpenseForm) {
      addExpenseForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          title: document.getElementById('expense-title').value.trim(),
          category: document.getElementById('expense-category').value,
          amount: parseFloat(document.getElementById('expense-amount').value),
          date: document.getElementById('expense-date').value,
          notes: document.getElementById('expense-notes').value.trim()
        };

        const res = await API.addExpense(payload);
        if (res.success) {
          addExpenseModal.classList.remove('show');
          addExpenseForm.reset();
          await renderExpensesView();
          if (typeof refreshLiveData === 'function') refreshLiveData();
        } else {
          alert('Failed to save expense: ' + (res.message || 'Unknown error'));
        }
      });
    }
  }

  // Role Modal Logic
  const roleModal = document.getElementById('role-modal');
  const roleForm = document.getElementById('role-form');
  const addRoleBtn = document.getElementById('add-role-btn');
  const closeRoleModalBtns = [document.getElementById('close-role-modal-btn'), document.getElementById('cancel-role-modal-btn')];
  
  if (roleModal) {
    addRoleBtn.addEventListener('click', () => {
      document.getElementById('role-id').value = '';
      document.getElementById('role-username').value = '';
      document.getElementById('role-type').value = 'Cashier';
      document.getElementById('role-password').value = '';
      document.getElementById('role-password').required = true;
      document.getElementById('role-password-hint').textContent = '';
      document.getElementById('role-modal-title').textContent = 'Add New Role';
      roleModal.classList.add('show');
    });

    closeRoleModalBtns.forEach(btn => btn.addEventListener('click', () => roleModal.classList.remove('show')));

    window.editUser = function(id) {
      const user = systemUsers.find(u => u.id === id);
      if (!user) return;
      document.getElementById('role-id').value = user.id;
      document.getElementById('role-username').value = user.username;
      document.getElementById('role-type').value = user.role;
      document.getElementById('role-password').value = '';
      document.getElementById('role-password').required = false;
      document.getElementById('role-password-hint').textContent = '(Leave blank to keep current)';
      document.getElementById('role-modal-title').textContent = 'Edit Role';
      roleModal.classList.add('show');
    };

    window.deleteUser = async function(id) {
      if (confirm('Are you sure you want to delete this role?')) {
        const res = await API.deleteUser(id);
        if (res.success) {
          loadUsersData();
        } else {
          alert('Failed to delete role: ' + (res.message || 'Unknown error'));
        }
      }
    };

    roleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('role-id').value;
      const data = {
        username: document.getElementById('role-username').value,
        role: document.getElementById('role-type').value,
        password: document.getElementById('role-password').value
      };

      let res;
      if (id) {
        res = await API.updateUser(id, data);
      } else {
        res = await API.addUser(data);
      }

      if (res.success) {
        roleModal.classList.remove('show');
        loadUsersData();
      } else {
        alert('Failed to save role: ' + (res.message || 'Unknown error'));
      }
    });
  }

  // ==========================================================================
  // System Audit Logs Controller (Requirement 3: Activity & Audit Trail)
  // ==========================================================================
  let auditLogsCache = [];
  let auditSearchTimeout = null;
  const auditState = {
    category: 'All',
    search: '',
    timeRange: 'today'
  };

  function formatAuditTime(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${datePart}, ${timePart}`;
  }

  function getCategoryBadge(category) {
    const cat = String(category || 'General').toLowerCase();
    switch (cat) {
      case 'sales':
        return '<span class="badge-audit-cat badge-audit-sales"><i class="fa-solid fa-cart-shopping"></i> Sales</span>';
      case 'inventory':
        return '<span class="badge-audit-cat badge-audit-inventory"><i class="fa-solid fa-boxes-stacked"></i> Inventory</span>';
      case 'expenses':
        return '<span class="badge-audit-cat badge-audit-expenses"><i class="fa-solid fa-money-bill-transfer"></i> Expenses</span>';
      case 'users':
        return '<span class="badge-audit-cat badge-audit-users"><i class="fa-solid fa-users-gear"></i> Users</span>';
      case 'settings':
        return '<span class="badge-audit-cat badge-audit-settings"><i class="fa-solid fa-gear"></i> Settings</span>';
      case 'reports':
        return '<span class="badge-audit-cat badge-audit-reports"><i class="fa-brands fa-whatsapp"></i> Reports</span>';
      case 'auth':
        return '<span class="badge-audit-cat badge-audit-auth"><i class="fa-solid fa-shield-halved"></i> Security</span>';
      default:
        return `<span class="badge-audit-cat badge-audit-auth"><i class="fa-solid fa-circle-info"></i> ${category || 'General'}</span>`;
    }
  }

  async function renderAuditLogsView() {
    const tableBody = document.getElementById('audit-table-body');
    const countBadge = document.getElementById('audit-count-badge');
    const tableStatus = document.getElementById('audit-table-status');
    const refreshBtn = document.getElementById('refresh-audit-btn');

    if (refreshBtn) {
      refreshBtn.querySelector('i')?.classList.add('fa-spin');
    }
    if (tableStatus) tableStatus.textContent = 'Fetching activity logs...';

    let startDate = null;
    let endDate = null;
    const now = new Date();

    if (auditState.timeRange === 'today') {
      startDate = now.toISOString().split('T')[0];
    } else if (auditState.timeRange === 'week') {
      const past = new Date(now.getTime() - 7 * 86400000);
      startDate = past.toISOString().split('T')[0];
    } else if (auditState.timeRange === 'month') {
      const past = new Date(now.getTime() - 30 * 86400000);
      startDate = past.toISOString().split('T')[0];
    }

    try {
      const res = await API.getAuditLogs({
        category: auditState.category,
        search: auditState.search,
        startDate,
        endDate,
        limit: 250
      });

      const logs = (res && res.logs) ? res.logs : [];
      const totalCount = (res && res.totalCount !== undefined) ? res.totalCount : logs.length;
      auditLogsCache = logs;

      const kpiTotal = document.getElementById('audit-kpi-total');
      const kpiSales = document.getElementById('audit-kpi-sales');
      const kpiInv = document.getElementById('audit-kpi-inventory');
      const kpiSec = document.getElementById('audit-kpi-security');

      if (kpiTotal) kpiTotal.textContent = totalCount.toLocaleString();
      if (kpiSales) kpiSales.textContent = logs.filter(l => l.category && l.category.toLowerCase() === 'sales').length.toLocaleString();
      if (kpiInv) kpiInv.textContent = logs.filter(l => l.category && l.category.toLowerCase() === 'inventory').length.toLocaleString();
      if (kpiSec) kpiSec.textContent = logs.filter(l => ['users', 'auth', 'settings'].includes(String(l.category || '').toLowerCase())).length.toLocaleString();

      if (countBadge) countBadge.textContent = `${totalCount} events`;
      if (tableStatus) tableStatus.textContent = `Showing ${logs.length} of ${totalCount} records`;

      if (!tableBody) return;

      if (logs.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
              <i class="fa-solid fa-folder-open" style="font-size: 2.2rem; margin-bottom: 0.75rem; display: block; opacity: 0.4;"></i>
              <div style="font-size: 0.95rem; font-weight: 600;">No activity log records found</div>
              <div style="font-size: 0.8rem; margin-top: 0.25rem;">Try adjusting your category filter, search query, or date range.</div>
            </td>
          </tr>
        `;
        return;
      }

      tableBody.innerHTML = logs.map(log => {
        const initial = (log.username || 'U').charAt(0).toUpperCase();
        const role = log.role || 'Staff';
        const formattedTime = formatAuditTime(log.timestamp);
        const catBadge = getCategoryBadge(log.category);
        const actionCode = log.action || 'EVENT';
        const details = log.details || '-';

        return `
          <tr>
            <td style="white-space: nowrap; font-size: 0.82rem; color: var(--text-muted);">
              <div style="font-weight: 600; color: var(--text-main);">${formattedTime}</div>
            </td>
            <td>
              <div class="audit-user-cell">
                <div class="audit-user-avatar">${initial}</div>
                <div>
                  <div style="font-weight: 600; font-size: 0.88rem; color: var(--text-main);">${log.username || 'System'}</div>
                  <span class="audit-role-pill">${role}</span>
                </div>
              </div>
            </td>
            <td>${catBadge}</td>
            <td><span class="badge-action-code">${actionCode}</span></td>
            <td style="font-size: 0.87rem; line-height: 1.4; color: var(--text-main); max-width: 380px;">${details}</td>
            <td style="text-align: center;">
              <button class="btn-icon-subtle" onclick="showAuditDetail(${log.id})" title="View Details Snapshot">
                <i class="fa-solid fa-eye"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load audit logs:', err);
      if (tableStatus) tableStatus.textContent = 'Error loading logs';
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #dc2626; padding: 2rem;">Failed to load audit trail. Please click Refresh.</td></tr>`;
      }
    } finally {
      if (refreshBtn) {
        refreshBtn.querySelector('i')?.classList.remove('fa-spin');
      }
    }
  }

  // Details Modal Viewer
  window.showAuditDetail = function(logId) {
    const log = auditLogsCache.find(l => l.id === logId);
    if (!log) return;

    const modal = document.getElementById('audit-modal');
    if (!modal) return;

    document.getElementById('audit-modal-time').textContent = formatAuditTime(log.timestamp);
    document.getElementById('audit-modal-user').textContent = `${log.username || 'System'} (${log.role || 'Staff'})`;
    document.getElementById('audit-modal-category').innerHTML = getCategoryBadge(log.category);
    document.getElementById('audit-modal-action').textContent = log.action || '-';
    document.getElementById('audit-modal-details').textContent = log.details || '-';

    const metaEl = document.getElementById('audit-modal-meta');
    if (metaEl) {
      const meta = log.metadata || {};
      metaEl.textContent = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : 'No extra metadata recorded.';
    }

    modal.classList.add('show');
  };

  // Setup Audit Controls Listeners
  const auditSearchInput = document.getElementById('audit-search-input');
  if (auditSearchInput) {
    auditSearchInput.addEventListener('input', (e) => {
      clearTimeout(auditSearchTimeout);
      auditSearchTimeout = setTimeout(() => {
        auditState.search = e.target.value.trim();
        renderAuditLogsView();
      }, 300);
    });
  }

  const auditCategoryFilter = document.getElementById('audit-category-filter');
  if (auditCategoryFilter) {
    auditCategoryFilter.addEventListener('change', (e) => {
      auditState.category = e.target.value;
      renderAuditLogsView();
    });
  }

  const auditTimeRangeFilter = document.getElementById('audit-timerange-filter');
  if (auditTimeRangeFilter) {
    auditTimeRangeFilter.addEventListener('change', (e) => {
      auditState.timeRange = e.target.value;
      renderAuditLogsView();
    });
  }

  const refreshAuditBtn = document.getElementById('refresh-audit-btn');
  if (refreshAuditBtn) {
    refreshAuditBtn.addEventListener('click', () => {
      renderAuditLogsView();
    });
  }

  const exportAuditCsvBtn = document.getElementById('export-audit-csv-btn');
  if (exportAuditCsvBtn) {
    exportAuditCsvBtn.addEventListener('click', async () => {
      exportAuditCsvBtn.disabled = true;
      const origHtml = exportAuditCsvBtn.innerHTML;
      exportAuditCsvBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Exporting...';
      try {
        let startDate = null;
        let endDate = null;
        const now = new Date();
        if (auditState.timeRange === 'today') startDate = now.toISOString().split('T')[0];
        else if (auditState.timeRange === 'week') startDate = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
        else if (auditState.timeRange === 'month') startDate = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];

        await API.exportAuditLogs({
          category: auditState.category,
          search: auditState.search,
          startDate,
          endDate
        });
      } catch (e) {
        console.error(e);
        alert('Failed to export audit logs.');
      } finally {
        exportAuditCsvBtn.disabled = false;
        exportAuditCsvBtn.innerHTML = origHtml;
      }
    });
  }

  // Modal Close Handlers
  const auditModal = document.getElementById('audit-modal');
  const closeAuditModalBtn = document.getElementById('close-audit-modal-btn');
  const closeAuditModalFooterBtn = document.getElementById('close-audit-modal-footer-btn');

  if (closeAuditModalBtn && auditModal) {
    closeAuditModalBtn.addEventListener('click', () => auditModal.classList.remove('show'));
  }
  if (closeAuditModalFooterBtn && auditModal) {
    closeAuditModalFooterBtn.addEventListener('click', () => auditModal.classList.remove('show'));
  }
  if (auditModal) {
    auditModal.addEventListener('click', (e) => {
      if (e.target === auditModal) auditModal.classList.remove('show');
    });
  }

  // -- Cart & Order Checkout System --
  let cart = [];
  try {
    const saved = localStorage.getItem('draftCart');
    if (saved) cart = JSON.parse(saved);
  } catch(e) {}

  function saveCart() {
    localStorage.setItem('draftCart', JSON.stringify(cart));
  }
  
  window.addToCart = function(dishId) {
    if (!dashboardData) return;
    const dish = dashboardData.dishes.find(d => d.id === dishId);
    if (!dish) return;

    const qtyInput = document.getElementById(`qty-input-${dishId}`);
    const qtyToAdd = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;

    if (qtyToAdd < 1) return;

    // Stock enforcement
    const hasStock = dish.stock !== undefined && dish.stock !== null;
    if (hasStock) {
      const inCartQty = cart.filter(c => c.id === dishId).reduce((sum, c) => sum + c.quantity, 0);
      if (dish.stock === 0) {
        showStockToast(`${dish.name} is out of stock!`, 'error');
        return;
      }
      if (inCartQty + qtyToAdd > dish.stock) {
        showStockToast(`Only ${dish.stock - inCartQty} unit(s) of ${dish.name} available to add!`, 'warn');
        return;
      }
    }

    showStockToast(`${qtyToAdd}x ${dish.name} added to order`, 'success');

    const existingItem = cart.find(c => c.id === dish.id);
    if (existingItem) {
      existingItem.quantity += qtyToAdd;
    } else {
      cart.unshift({
        cartItemId: Date.now() + Math.random().toString().substring(2, 6),
        id: dish.id,
        name: dish.name,
        category: dish.category,
        price: Number(dish.price || 0),
        quantity: qtyToAdd
      });
    }

    if (qtyInput) qtyInput.value = 1;
    saveCart();
    renderCart();
    // Refresh catalog to update stock badges
    if (window.drawCatalogGlobal) window.drawCatalogGlobal();
  };

  window.updateQuantity = function(cartItemId, change) {
    const item = cart.find(item => item.cartItemId == cartItemId);
    if (!item) return;

    if (change > 0 && dashboardData) {
      // Stock enforcement on qty increase
      const dish = dashboardData.dishes.find(d => d.id === item.id);
      if (dish && dish.stock !== undefined && dish.stock !== null) {
        const inCartQty = cart.filter(c => c.id === item.id).reduce((sum, c) => sum + c.quantity, 0);
        if (inCartQty >= dish.stock) {
          showStockToast(`Only ${dish.stock} unit(s) of ${dish.name} in stock!`, 'warn');
          return;
        }
      }
    }

    item.quantity += change;
    if (item.quantity <= 0) {
      cart = cart.filter(item => item.cartItemId != cartItemId);
    }
    saveCart();
    renderCart();
    if (window.drawCatalogGlobal) window.drawCatalogGlobal();
  };

  window.setQuantity = function(cartItemId, newQuantity) {
    if (isNaN(newQuantity) || newQuantity <= 0) {
      window.removeFromCart(cartItemId);
      return;
    }
    const item = cart.find(item => item.cartItemId == cartItemId);
    if (!item) return;

    if (dashboardData) {
      const dish = dashboardData.dishes.find(d => d.id === item.id);
      if (dish && dish.stock !== undefined && dish.stock !== null) {
        const otherCartQty = cart.filter(c => c.id === item.id && c.cartItemId != cartItemId).reduce((sum, c) => sum + c.quantity, 0);
        if (otherCartQty + newQuantity > dish.stock) {
          showStockToast(`Only ${dish.stock} unit(s) of ${dish.name} in stock!`, 'warn');
          item.quantity = dish.stock - otherCartQty;
          renderCart();
          if (window.drawCatalogGlobal) window.drawCatalogGlobal();
          return;
        }
      }
    }

    item.quantity = newQuantity;
    saveCart();
    renderCart();
    if (window.drawCatalogGlobal) window.drawCatalogGlobal();
  };

  window.removeFromCart = function(cartItemId) {
    cart = cart.filter(item => item.cartItemId != cartItemId);
    saveCart();
    renderCart();
    if (window.drawCatalogGlobal) window.drawCatalogGlobal();
  };

  // -- Stock Toast Notification --
  function showStockToast(message, type = 'warn') {
    const existing = document.getElementById('stock-toast');
    if (existing) existing.remove();
    const colors = {
      warn:    { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', icon: 'fa-triangle-exclamation' },
      error:   { bg: '#fee2e2', border: '#ef4444', text: '#991b1b', icon: 'fa-circle-xmark' },
      success: { bg: '#d1fae5', border: '#10b981', text: '#065f46', icon: 'fa-circle-check' }
    };
    const c = colors[type] || colors.warn;
    const toast = document.createElement('div');
    toast.id = 'stock-toast';
    toast.className = 'stock-toast';
    toast.style.background = c.bg;
    toast.style.borderColor = c.border;
    toast.style.color = c.text;
    toast.innerHTML = `<i class="fa-solid ${c.icon}"></i> ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2800);
  }

  function renderCart() {
    const cartItems = document.getElementById('cart-items');
    const cartCount = document.getElementById('cart-count');
    const cartSubtotal = document.getElementById('cart-subtotal');
    const cartTax = document.getElementById('cart-tax');
    const cartTotal = document.getElementById('cart-total');
    const checkoutBtn = document.getElementById('checkout-btn');
    const fabBadge = document.getElementById('mobile-cart-fab-badge');
    if (fabBadge) fabBadge.textContent = cart.reduce((sum, item) => sum + item.quantity, 0);

    if (cart.length === 0) {
      cartItems.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding-top: 3.5rem;" id="empty-cart-message">
          <i class="fa-solid fa-basket-shopping" style="font-size: 2.2rem; margin-bottom: 0.75rem; color: #e5e7eb;"></i>
          <p style="font-size: 0.85rem;">No items in this order</p>
        </div>
      `;
      cartCount.textContent = '0';
      cartSubtotal.textContent = 'LKR 0.00';
      if (cartTax) cartTax.textContent = 'LKR 0.00';
      cartTotal.textContent = 'LKR 0.00';
      checkoutBtn.disabled = true;
      return;
    }

    checkoutBtn.disabled = false;
    let subtotal = 0;
    cartItems.innerHTML = '';
    
    let html = '';
    cart.forEach(item => {
      const totalItemPrice = item.price * item.quantity;
      subtotal += totalItemPrice;

      // Stock remaining for this item
      const dish = dashboardData ? dashboardData.dishes.find(d => d.id === item.id) : null;
      const hasStock = dish && dish.stock !== undefined && dish.stock !== null;
      const totalInCartForDish = cart.filter(c => c.id === item.id).reduce((sum, c) => sum + c.quantity, 0);
      const stockRemaining = hasStock ? dish.stock - totalInCartForDish : null;
      const atLimit = hasStock && totalInCartForDish >= dish.stock;
      const stockInfo = hasStock
        ? `<span style="font-size:0.7rem; color:${atLimit ? '#ef4444' : '#6b7280'}; display:block; margin-top:2px;">${atLimit ? '⚠ Max stock reached' : `${stockRemaining} more available`}</span>`
        : '';
      
      html += `
        <div class="cart-item-row">
          <div class="cart-item-details">
            <div class="cart-item-name">${item.name}</div>
            <div class="cart-item-price">LKR ${item.price.toFixed(2)} x ${item.quantity}</div>
            ${stockInfo}
          </div>
          <div class="cart-item-qty-control">
            <button class="qty-btn" onclick="window.updateQuantity('${item.cartItemId}', -1)"><i class="fa-solid fa-minus"></i></button>
            <input type="number" class="cart-item-qty" value="${item.quantity}" min="1" onchange="window.setQuantity('${item.cartItemId}', parseInt(this.value, 10))" style="width: 40px; text-align: center; border: 1px solid var(--border-color); border-radius: 4px; padding: 2px; background: transparent;">
            <button class="qty-btn" onclick="window.updateQuantity('${item.cartItemId}', 1)" ${atLimit ? 'disabled style="opacity:0.35;cursor:not-allowed"' : ''}><i class="fa-solid fa-plus"></i></button>
            <button class="qty-btn-delete" onclick="window.removeFromCart('${item.cartItemId}')"><i class="fa-regular fa-trash-can"></i></button>
          </div>
        </div>
      `;
    });
    cartItems.innerHTML = html;

    const total = subtotal;

    cartCount.textContent = cart.reduce((sum, item) => sum + item.quantity, 0);
    cartSubtotal.textContent = `LKR ${subtotal.toFixed(2)}`;
    if (cartTax) cartTax.textContent = 'LKR 0.00';
    cartTotal.textContent = `LKR ${total.toFixed(2)}`;
  }

  function updateCharts(data) {
    if (salesChart) {
      salesChart.data.labels = data.sales.map(s => s.timeLabel);
      salesChart.data.datasets[0].data = data.sales.map(s => s.amount);
      salesChart.update();
    }
    if (incomeChart) {
      incomeChart.data.datasets[0].data = [data.summary.foodIncome, data.summary.drinksIncome, data.summary.othersIncome];
      incomeChart.update();
    }
  }

  // -- Checkout Modal Logic --
  const checkoutModal = document.getElementById('checkout-modal');
  const checkoutBtn = document.getElementById('checkout-btn');
  const closeCheckoutBtns = [
    document.getElementById('close-checkout-modal-btn'), 
    document.getElementById('cancel-checkout-modal-btn')
  ];
  const checkoutForm = document.getElementById('checkout-form');
  const modalPayable = document.getElementById('modal-payable');

  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
      let total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      modalPayable.textContent = `LKR ${total.toFixed(2)}`;
      closeMobileCart();
      checkoutModal.classList.add('show');
    });

    closeCheckoutBtns.forEach(btn => btn.addEventListener('click', () => checkoutModal.classList.remove('show')));

    checkoutForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const orderType = document.getElementById('checkout-type').value;
      const orderCustomer = document.getElementById('checkout-customer').value;
      const paymentMethod = document.getElementById('checkout-payment').value;

      const orderData = {
        items: cart,
        customer: orderType === 'Takeaway' ? 'Takeaway' : `${orderType} (${orderCustomer})`,
        paymentMethod: paymentMethod
      };
      orderData.client_order_uuid = crypto.randomUUID();

      const cartCopy = [...cart];

      if (!navigator.onLine) {
        const offlineOrders = JSON.parse(localStorage.getItem('offline_orders') || '[]');
        offlineOrders.push(orderData);
        localStorage.setItem('offline_orders', JSON.stringify(offlineOrders));
        alert('Offline mode: Bill saved locally and will sync once reconnected.');

        checkoutModal.classList.remove('show');
        closeMobileCart();
        cart = [];
        saveCart();
        renderCart();
        return;
      }

      const result = await API.checkout(orderData);
      if (result.success) {
        // Print Receipt!
        printReceipt(result.bill, cartCopy);

        checkoutModal.classList.remove('show');
        closeMobileCart();
        cart = [];
        saveCart();
        renderCart();

        // Refresh application data
        await refreshLiveData();
      } else {
        alert('Checkout failed!');
      }
    });
  }

  // Inlined so the receipt logo never depends on an image fetch/cache at print
  // time — that race is why it sometimes failed to show up.
  const RECEIPT_LOGO = 'data:image/png;base64,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';

  function printReceipt(bill, cartItems) {
    const printArea = document.getElementById('receipt-print-area');
    if (!printArea) return;

    const itemsHtml = cartItems.map(item => `
      <tr>
        <td style="text-align: left; padding: 4px 0;">${item.name} x${item.quantity}</td>
        <td style="text-align: right; padding: 4px 0;">LKR ${(item.price * item.quantity).toFixed(2)}</td>
      </tr>
    `).join('');

    const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

    printArea.innerHTML = `
      <img class="logo" src="${RECEIPT_LOGO}" alt="Logo">
      <div class="title">Mochiato</div>
      <div class="info">
        138B, Matara Para, Tangalle<br>
        Tel: 0768899324<br>
        Email: wanniarachchigelahirusampath@gmail.com
      </div>

      <div class="divider"></div>

      <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 5px;">
        <span><strong>Bill ID:</strong> ${bill.id}</span>
        <span><strong>Date:</strong> ${bill.date}</span>
      </div>
      <div style="text-align: left; font-size: 10px; margin-bottom: 10px;">
        <strong>Order Details:</strong> ${bill.customer}
      </div>

      <div class="divider"></div>

      <table>
        <thead>
          <tr style="border-bottom: 1px solid #eee;">
            <th style="text-align: left; padding-bottom: 4px;">Item</th>
            <th style="text-align: right; padding-bottom: 4px;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div class="divider"></div>

      <table class="totals-table">
        <tr class="total-row">
          <td style="text-align: left; padding-top: 6px;">Total Paid</td>
          <td style="text-align: right; padding-top: 6px; color: #800000;">LKR ${total.toFixed(2)}</td>
        </tr>
      </table>

      <div class="divider"></div>

      <div class="footer">
        Thank you for dining with us!<br>
        Powered by j&co. software solutions
      </div>
    `;

    window.print();
  }

  // -- 80mm Daily Sales Summary Thermal Receipt Report --
  window.printDailySummaryReport = function() {
    if (!dashboardData) {
      alert('Dashboard data not loaded yet.');
      return;
    }
    const printArea = document.getElementById('receipt-print-area');
    if (!printArea) return;

    const activeFilterBtn = document.querySelector('.filter-btn.active');
    const periodName = activeFilterBtn ? activeFilterBtn.textContent.trim() : 'Today';

    const now = new Date();
    const formattedDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const formattedTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    const currentUser = JSON.parse(localStorage.getItem('user'));
    const staffName = currentUser ? currentUser.username : 'Staff';

    const summary = dashboardData.summary || {};
    const totalIncome = Number(summary.totalIncome || 0);
    const totalOrders = Number(summary.totalOrders || 0);
    const totalCost = Number(summary.totalCost || 0);
    const grossProfit = Number(summary.grossProfit !== undefined ? summary.grossProfit : (totalIncome - totalCost));
    const grossMargin = summary.grossProfitMargin !== undefined ? Number(summary.grossProfitMargin) : (totalIncome > 0 ? (grossProfit / totalIncome) * 100 : 0);
    const totalExpenses = Number(summary.totalExpenses || 0);
    const netProfit = Number(summary.netProfit !== undefined ? summary.netProfit : (grossProfit - totalExpenses));
    const netMargin = summary.netProfitMargin !== undefined ? Number(summary.netProfitMargin) : (totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0);
    const dishes = dashboardData.dishes || [];

    // Group dishes by base name (removing variant like (5) or (10))
    // e.g. "TOFFEE (5)" -> "TOFFEE", "ICE CREAM (20)" -> "ICE CREAM"
    // Also we filter out items with 0 orders.
    const groupedDishes = {};
    dishes.forEach(dish => {
      const qty = dish.orders || 0;
      if (qty > 0) {
        // Extract base name by removing trailing parentheses and trimming
        const baseName = dish.name.replace(/\s*\([^)]*\)\s*$/g, '').trim();
        if (!groupedDishes[baseName]) {
          groupedDishes[baseName] = {
            name: baseName,
            category: dish.category,
            orders: 0,
            totalAmt: 0
          };
        }
        groupedDishes[baseName].orders += qty;
        groupedDishes[baseName].totalAmt += qty * Number(dish.price || 0);
      }
    });

    const soldDishes = Object.values(groupedDishes).sort((a, b) => b.orders - a.orders);

    // Compute total items/units sold based on grouped dishes
    const totalItemsSold = soldDishes.reduce((sum, d) => sum + d.orders, 0);

    const itemRowsHtml = soldDishes.length > 0 ? soldDishes.map(dish => {
      return `
        <tr>
          <td style="text-align: left; padding-right: 4px;">
            <strong>${dish.name}</strong><br>
            <span style="font-size: 9px; color: #555;">${dish.category}</span>
          </td>
          <td style="text-align: center; font-weight: 700; font-size: 11px;">${dish.orders}</td>
          <td style="text-align: right; font-size: 11px;">LKR ${dish.totalAmt.toFixed(2)}</td>
        </tr>
      `;
    }).join('') : `<tr><td colspan="3" style="text-align:center; padding: 6px 0;">No sales recorded</td></tr>`;

    printArea.innerHTML = `
      <div class="summary-report-receipt">
        <div style="text-align: center;">
          <img class="logo" src="${RECEIPT_LOGO}" alt="Logo">
          <div class="title" style="font-size: 15px; font-weight: 800; color: #000; margin-bottom: 2px;">MOCHIATO</div>
          <div class="info" style="font-size: 10px; color: #333; margin-bottom: 8px;">
            138B, Matara Para, Tangalle<br>
            Tel: 0768899324<br>
            Email: wanniarachchigelahirusampath@gmail.com
          </div>
        </div>

        <div class="divider-line">================================</div>
        <div class="report-title">DAILY SALES & PROFIT SUMMARY</div>
        <div class="divider-line">================================</div>

        <div class="report-meta">
          <div><strong>Report Period:</strong> ${periodName}</div>
          <div><strong>Date:</strong> ${formattedDate}</div>
          <div><strong>Time:</strong> ${formattedTime}</div>
          <div><strong>Staff / User:</strong> ${staffName}</div>
        </div>

        <div class="divider-dashed"></div>

        <div class="report-summary-box">
          <div class="report-row main-total">
            <span>GROSS SALES REVENUE:</span>
            <span>LKR ${totalIncome.toFixed(2)}</span>
          </div>
          <div class="report-row">
            <span>Total Orders Count:</span>
            <span><strong>${totalOrders.toLocaleString()}</strong> orders</span>
          </div>
          <div class="report-row">
            <span>Total Items Sold:</span>
            <span><strong>${totalItemsSold.toLocaleString()}</strong> units</span>
          </div>
        </div>

        <div class="divider-dashed"></div>
        <div class="section-title">PROFIT &amp; LOSS STATEMENT</div>
        <div class="divider-dashed"></div>

        <div class="report-row">
          <span>Gross Revenue:</span>
          <span>LKR ${totalIncome.toFixed(2)}</span>
        </div>
        <div class="report-row">
          <span>Cost of Goods (COGS):</span>
          <span>- LKR ${totalCost.toFixed(2)}</span>
        </div>
        <div class="report-row" style="font-weight: 700; border-top: 1px dotted #000; padding-top: 2px;">
          <span>Gross Profit (${grossMargin.toFixed(1)}%):</span>
          <span>LKR ${grossProfit.toFixed(2)}</span>
        </div>
        <div class="report-row">
          <span>Operating Expenses:</span>
          <span>- LKR ${totalExpenses.toFixed(2)}</span>
        </div>
        <div class="report-row main-total" style="font-size: 12px; margin-top: 4px;">
          <span>NET OPERATING PROFIT:</span>
          <span>LKR ${netProfit.toFixed(2)} (${netMargin.toFixed(1)}%)</span>
        </div>

        <div class="divider-dashed"></div>
        <div class="section-title">CATEGORY BREAKDOWN</div>
        <div class="divider-dashed"></div>

        <div class="report-row">
          <span>Food Revenue:</span>
          <span>LKR ${Number(summary.foodIncome || 0).toFixed(2)}</span>
        </div>
        <div class="report-row">
          <span>Drinks Revenue:</span>
          <span>LKR ${Number(summary.drinksIncome || 0).toFixed(2)}</span>
        </div>
        <div class="report-row">
          <span>Others Revenue:</span>
          <span>LKR ${Number(summary.othersIncome || 0).toFixed(2)}</span>
        </div>

        <div class="divider-dashed"></div>
        <div class="section-title">ITEM-WISE SALES BREAKDOWN</div>
        <div class="divider-dashed"></div>

        <table class="report-items-table">
          <thead>
            <tr style="border-bottom: 1px dashed #000;">
              <th style="text-align: left; padding-bottom: 4px;">Item / Category</th>
              <th style="text-align: center; padding-bottom: 4px;">Qty</th>
              <th style="text-align: right; padding-bottom: 4px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRowsHtml}
          </tbody>
        </table>

        <div class="divider-line">================================</div>
        <div class="report-footer">
          *** END OF SUMMARY REPORT ***<br>
          Powered by j&co. software solutions
        </div>
      </div>
    `;

    window.print();
  };

  const printSummaryBtn = document.getElementById('print-summary-btn');
  if (printSummaryBtn) {
    printSummaryBtn.addEventListener('click', () => {
      window.printDailySummaryReport();
    });
  }

  // -- Bill Preview Modal Logic --
  window.previewBill = function(billId) {
    if (!dashboardData || !dashboardData.bills) return;
    const bill = dashboardData.bills.find(b => b.id === billId);
    if (!bill) return;

    const modal = document.getElementById('bill-preview-modal');
    const content = document.getElementById('bill-preview-content');

    const itemsListHtml = bill.items && bill.items.length > 0
      ? bill.items.map(item => `
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem; font-size: 0.85rem; border-bottom: 1px dashed rgba(0,0,0,0.05); padding-bottom: 0.25rem;">
            <span>${item.name} <strong>x${item.quantity}</strong></span>
            <span>LKR ${(item.price * item.quantity).toFixed(2)}</span>
          </div>
        `).join('')
      : `
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem; font-size: 0.85rem;">
            <span>Cafe Service (Food & Drinks)</span>
            <span>LKR ${Number(bill.amount).toFixed(2)}</span>
          </div>
        `;

    const total = bill.items && bill.items.length > 0
      ? bill.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
      : Number(bill.amount);

    content.innerHTML = `
      <div style="text-align: center; margin-bottom: 1.25rem;">
        <h4 style="margin: 0; color: var(--primary); font-size: 1.1rem; font-weight: 700;">Mochiato</h4>
        <p style="font-size: 0.75rem; color: var(--text-muted); margin: 0.25rem 0 0 0;">138B, Matara Para, Tangalle<br>0768899324<br>wanniarachchigelahirusampath@gmail.com</p>
      </div>
      <div style="border-bottom: 1px dashed var(--border-color); padding-bottom: 0.75rem; margin-bottom: 0.75rem; font-size: 0.8rem; display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.4rem; line-height: 1.4;">
        <div><strong>Bill ID:</strong> ${bill.id}</div>
        <div style="text-align: right;"><strong>Date:</strong> ${bill.date}</div>
        <div><strong>Customer:</strong> ${bill.customer}</div>
        <div style="text-align: right;"><strong>Status:</strong> <span class="summary-badge positive">${bill.status}</span></div>
      </div>
      <div style="max-height: 150px; overflow-y: auto; margin-bottom: 0.75rem; padding-right: 0.25rem;">
        ${itemsListHtml}
      </div>
      <div style="border-top: 1px dashed var(--border-color); padding-top: 0.75rem; font-size: 0.85rem; line-height: 1.5;">
        <div style="display: flex; justify-content: space-between; font-weight: 700; color: var(--primary); font-size: 1.05rem; margin-top: 0.4rem;">
          <span>Total Paid:</span>
          <span>LKR ${total.toFixed(2)}</span>
        </div>
      </div>
    `;

    const reprintBtn = document.getElementById('print-preview-bill-btn');
    reprintBtn.onclick = () => {
      const printItems = bill.items && bill.items.length > 0 
        ? bill.items 
        : [{ name: 'Cafe Service', price: bill.amount * 0.9, quantity: 1 }];
      printReceipt(bill, printItems);
    };

    modal.classList.add('show');
  };

  const closePreviewModalBtns = [
    document.getElementById('close-preview-modal-btn'),
    document.getElementById('close-preview-modal-btn-2')
  ];
  closePreviewModalBtns.forEach(btn => {
    if (btn) btn.addEventListener('click', () => {
      document.getElementById('bill-preview-modal').classList.remove('show');
    });
  });

  // -- Shift Attendance Logic (Clock Icon) --
  const shiftModal = document.getElementById('shift-modal');
  const clockBtn = document.getElementById('header-clock-btn');
  const closeShiftModalBtn = document.getElementById('close-shift-modal-btn');
  const shiftToggleBtn = document.getElementById('shift-toggle-btn');
  const shiftTimerEl = document.getElementById('shift-timer');
  const shiftStatusEl = document.getElementById('shift-status');

  let shiftTimer = null;
  let elapsedSeconds = 4 * 3600 + 15 * 60 + 32;
  let isClockedIn = true;

  function formatTime(secs) {
    const hours = String(Math.floor(secs / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const seconds = String(secs % 60).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  function startShiftTimer() {
    if (shiftTimer) clearInterval(shiftTimer);
    shiftTimer = setInterval(() => {
      elapsedSeconds++;
      if (shiftTimerEl) shiftTimerEl.textContent = formatTime(elapsedSeconds);
    }, 1000);
  }

  function stopShiftTimer() {
    if (shiftTimer) clearInterval(shiftTimer);
  }

  startShiftTimer();

  if (clockBtn) {
    clockBtn.addEventListener('click', () => {
      const profileName = document.getElementById('profile-name').textContent;
      const profileRole = document.getElementById('profile-role').textContent.split(' • ')[0];
      
      document.getElementById('shift-emp-name').textContent = profileName;
      document.getElementById('shift-emp-role').textContent = profileRole;
      
      shiftModal.classList.add('show');
    });

    closeShiftModalBtn.addEventListener('click', () => shiftModal.classList.remove('show'));

    shiftToggleBtn.addEventListener('click', () => {
      const profileRoleEl = document.getElementById('profile-role');
      const profileRoleText = profileRoleEl.textContent.split(' • ')[0];

      if (isClockedIn) {
        isClockedIn = false;
        stopShiftTimer();
        shiftStatusEl.textContent = 'Clocked Out';
        shiftStatusEl.className = 'summary-badge negative';
        shiftToggleBtn.textContent = 'Clock In';
        profileRoleEl.textContent = `${profileRoleText} • Off Duty`;
      } else {
        isClockedIn = true;
        startShiftTimer();
        shiftStatusEl.textContent = 'Clocked In';
        shiftStatusEl.className = 'summary-badge positive';
        shiftToggleBtn.textContent = 'Clock Out';
        profileRoleEl.textContent = `${profileRoleText} • Active`;
      }
    });
  }

  // -- Notification Dropdown Logic (Bell Icon) --
  const notificationBtn = document.getElementById('header-notification-btn');
  const notificationDropdown = document.getElementById('notification-dropdown');
  const dropdownNotificationsList = document.getElementById('dropdown-notifications-list');
  const dropdownBadgeCount = document.getElementById('dropdown-badge-count');
  const clearNotificationsBtn = document.getElementById('clear-notifications-btn');
  const bellBadgeDot = document.querySelector('#header-notification-btn .dot');

  function renderNotifications() {
    // 1. Sidebar Badge Count
    const sidebarCountEl = document.getElementById('sidebar-notifications-count');
    if (sidebarCountEl) {
      sidebarCountEl.textContent = notificationsList.length;
      sidebarCountEl.style.display = notificationsList.length > 0 ? 'inline-block' : 'none';
    }

    // 2. Header Bell Badge Dot
    if (bellBadgeDot) {
      bellBadgeDot.style.display = notificationsList.length > 0 ? 'block' : 'none';
    }

    // 3. Header Dropdown Count
    if (dropdownBadgeCount) {
      dropdownBadgeCount.textContent = notificationsList.length;
    }

    // 4. Header Dropdown List
    if (dropdownNotificationsList) {
      if (notificationsList.length === 0) {
        dropdownNotificationsList.innerHTML = `
          <div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.8rem;">
            No new alerts
          </div>
        `;
      } else {
        dropdownNotificationsList.innerHTML = notificationsList.map(noti => `
          <div class="dropdown-item" onclick="window.removeNotification(${noti.id}, event)">
            <div class="dropdown-item-icon ${noti.type}">
              <i class="fa-solid ${noti.type === 'warning' ? 'fa-triangle-exclamation' : 'fa-bell'}"></i>
            </div>
            <div class="dropdown-item-content">
              <h5>${noti.title}</h5>
              <p>${noti.text}</p>
              <span class="dropdown-item-time"><i class="fa-regular fa-clock"></i> ${noti.time}</span>
            </div>
          </div>
        `).join('');
      }
    }

    // 5. Main Messages Tab Page List
    const messagesList = document.getElementById('messages-list');
    if (messagesList) {
      if (notificationsList.length === 0) {
        messagesList.innerHTML = `
          <div style="padding: 3rem; text-align: center; color: var(--text-muted); width: 100%;">
            <i class="fa-regular fa-bell-slash" style="font-size: 3rem; margin-bottom: 1rem; color: var(--border-color); display: block;"></i>
            <p>No new system notifications</p>
          </div>
        `;
      } else {
        messagesList.innerHTML = notificationsList.map(msg => `
          <div class="message-item" style="position: relative;">
            <button class="qty-btn-delete" onclick="window.removeNotification(${msg.id}, event)" style="position: absolute; right: 1.5rem; top: 1.5rem; background: none; border: none; font-size: 1.1rem; cursor: pointer; color: var(--text-muted); transition: color 0.2s;"><i class="fa-regular fa-trash-can"></i></button>
            <div class="message-icon ${msg.type}">
              <i class="fa-solid ${msg.type === 'warning' ? 'fa-triangle-exclamation' : 'fa-bell'}"></i>
            </div>
            <div class="message-content">
              <h4>${msg.title}</h4>
              <p>${msg.text}</p>
              <span class="message-time"><i class="fa-regular fa-clock"></i> ${msg.time}</span>
            </div>
          </div>
        `).join('');
      }
    }
  }

  window.removeNotification = function(id, event) {
    if (event) event.stopPropagation();
    notificationsList = notificationsList.filter(n => n.id !== id);
    renderNotifications();
  };

  if (notificationBtn) {
    notificationBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notificationDropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (notificationDropdown && !notificationDropdown.contains(e.target) && !notificationBtn.contains(e.target)) {
        notificationDropdown.classList.remove('show');
      }
    });

    if (clearNotificationsBtn) {
      clearNotificationsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        notificationsList = [];
        renderNotifications();
      });
    }
  }

});
