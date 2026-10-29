const API_BASE = '/api';
const DEFAULT_SETTINGS = {
  cafe_name: 'Mochiato',
  notification_recipient: 'W.A Lahiru Sampath',
  notification_phone: '0768899324',
  notification_email: 'wanniarachchigelahirusampath@gmail.com',
  notification_channel: 'WhatsApp',
  address: '138B, Matara Para, Tangalle',
  auto_day_end_enabled: true,
  currency: 'LKR'
};

// Failover check: only static-hosting platforms with no backend (Netlify, GitHub Pages)
// go straight to localStorage. Any other host (including the real Railway deployment)
// talks to /api first and only falls back per-request if a fetch actually fails.
let useLocalDB = false;
if (window.location.hostname.includes('netlify.app') || window.location.hostname.includes('github.io')) {
  useLocalDB = true;
}

const LocalPOSDB = {
  getDb() {
    let db = localStorage.getItem('smartpos_db');
    if (!db) {
      db = this.initDb();
    } else {
      db = JSON.parse(db);
      // Migration: Inject users if missing (for returning visitors with old cache)
      if (!db.users) {
        db.users = [];
        this.saveDb(db);
      }
      if (!db.expenses) {
        db.expenses = [];
        this.saveDb(db);
      }
      const legacySettings = {
        cafe_name: ["Teen's Cafe", "Teen's Cafe - Anuradhapura", 'Mochiato - Anuradhapura'],
        notification_recipient: ['Cafe Owner'],
        notification_phone: ['0711853911', '0762043911', '+94 76 889 9324'],
        notification_email: [''],
        address: ['', 'Stage 3, Anuradhapura'],
        currency: ['LKR (Rs.)']
      };
      db.settings = db.settings || {};
      let settingsChanged = false;
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (db.settings[key] === undefined || (legacySettings[key] || []).includes(db.settings[key])) {
          db.settings[key] = value;
          settingsChanged = true;
        }
      }
      if (settingsChanged) this.saveDb(db);
    }
    return db;
  },
  saveDb(db) {
    localStorage.setItem('smartpos_db', JSON.stringify(db));
  },
  initDb() {
    const seed = {
      // No hardcoded accounts here — this local store only exists as a fallback
      // when the real API is genuinely unreachable, and login must still go
      // through the real server, not a known backdoor baked into the client JS.
      users: [],
      expenses: [],
      settings: { ...DEFAULT_SETTINGS },
      dishes: [
        { id: 1, name: 'Espresso', category: 'Drinks', orders: 124, price: 3.50, cost: 1.20, stock: 0, imageUrl: 'https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?w=500&q=80' },
        { id: 2, name: 'Avocado Toast', category: 'Food', orders: 98, price: 8.50, cost: 3.50, stock: 0, imageUrl: 'https://images.unsplash.com/photo-1541532713592-79a0317b6b77?w=500&q=80' },
        { id: 3, name: 'Cappuccino', category: 'Drinks', orders: 210, price: 4.50, cost: 1.50, stock: 0, imageUrl: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=500&q=80' },
        { id: 4, name: 'Blueberry Muffin', category: 'Food', orders: 85, price: 3.00, cost: 1.00, stock: 0, imageUrl: 'https://images.unsplash.com/photo-1607958996333-41aef7caefaa?w=500&q=80' },
        { id: 5, name: 'Latte', category: 'Drinks', orders: 185, price: 4.00, cost: 1.40, stock: 0, imageUrl: 'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=500&q=80' }
      ],
      employees: [
        { id: 1, name: 'Theresa Webb', role: 'Waiter', earnings: 450, shiftDuration: '08:00 AM - 04:00 PM', avatarUrl: 'https://i.pravatar.cc/100?img=1' },
        { id: 2, name: 'Albert Flores', role: 'Manager', earnings: 750, shiftDuration: '09:00 AM - 05:00 PM', avatarUrl: 'https://i.pravatar.cc/100?img=11' }
      ],
      messages: [
        { id: 1, title: 'Low Stock Alert', text: 'Coffee beans running low in storage.', time: '10 mins ago', type: 'warning' },
        { id: 2, title: 'Shift Updated', text: 'Your shift tomorrow has been changed to 09:00 AM.', time: '2 hours ago', type: 'info' }
      ],
      sales: [
        { timeLabel: '08:00 AM', amount: 35 },
        { timeLabel: '10:00 AM', amount: 75 },
        { timeLabel: '12:00 PM', amount: 120 },
        { timeLabel: '02:00 PM', amount: 95 },
        { timeLabel: '04:00 PM', amount: 45 },
        { timeLabel: '06:00 PM', amount: 110 }
      ],
      bills: [
        { id: 'ORD-1001', date: '2026-07-10', customer: 'Table 4', amount: 45.00, status: 'Paid', items: [{ id: 1, name: 'Espresso', category: 'Drinks', price: 3.50, quantity: 2 }, { id: 2, name: 'Avocado Toast', category: 'Food', price: 8.50, quantity: 2 }] },
        { id: 'ORD-1002', date: '2026-07-10', customer: 'Takeaway', amount: 15.00, status: 'Paid', items: [{ id: 4, name: 'Blueberry Muffin', category: 'Food', price: 3.00, quantity: 5 }] },
        { id: 'ORD-1003', date: '2026-07-10', customer: 'Table 1', amount: 120.00, status: 'Pending', items: [{ id: 5, name: 'Latte', category: 'Drinks', price: 4.00, quantity: 5 }, { id: 2, name: 'Avocado Toast', category: 'Food', price: 8.50, quantity: 6 }] },
        { id: 'ORD-0999', date: '2026-07-09', customer: 'Table 3', amount: 80.00, status: 'Paid', items: [{ id: 1, name: 'Espresso', category: 'Drinks', price: 3.50, quantity: 4 }, { id: 3, name: 'Cappuccino', category: 'Drinks', price: 4.50, quantity: 4 }] },
        { id: 'ORD-0998', date: '2026-07-09', customer: 'Takeaway', amount: 55.50, status: 'Paid', items: [{ id: 2, name: 'Avocado Toast', category: 'Food', price: 8.50, quantity: 5 }, { id: 3, name: 'Cappuccino', category: 'Drinks', price: 4.50, quantity: 3 }] },
        { id: 'ORD-0997', date: '2026-07-07', customer: 'Table 2', amount: 62.00, status: 'Paid', items: [{ id: 3, name: 'Cappuccino', category: 'Drinks', price: 4.50, quantity: 2 }, { id: 2, name: 'Avocado Toast', category: 'Food', price: 8.50, quantity: 3 }] },
        { id: 'ORD-0996', date: '2026-06-25', customer: 'Table 5', amount: 110.00, status: 'Paid', items: [{ id: 5, name: 'Latte', category: 'Drinks', price: 4.00, quantity: 10 }, { id: 4, name: 'Blueberry Muffin', category: 'Food', price: 3.00, quantity: 5 }] },
        { id: 'ORD-0995', date: '2026-06-12', customer: 'Takeaway', amount: 35.00, status: 'Paid', items: [{ id: 1, name: 'Espresso', category: 'Drinks', price: 3.50, quantity: 10 }] }
      ]
    };
    this.saveDb(seed);
    return seed;
  },
  login(username, password) {
    const db = this.getDb();
    const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
    if (user) {
      return { success: true, user: { id: user.id, username: user.username, role: user.role } };
    }
    return { success: false, message: 'Invalid credentials' };
  },
  addDish(dish) {
    const db = this.getDb();

    const isDuplicate = db.dishes.some(d => d.name.trim().toLowerCase() === String(dish.name).trim().toLowerCase());
    if (isDuplicate) {
      throw new Error(`"${dish.name}" already exists in the menu`);
    }

    const maxId = db.dishes.length > 0 ? Math.max(...db.dishes.map(d => d.id)) : 0;
    const newDish = {
      id: maxId + 1,
      name: dish.name,
      category: dish.category,
      price: Number(dish.price),
      cost: Number(dish.cost !== undefined ? dish.cost : (dish.costPrice || 0)),
      stock: Number(dish.stock || 0),
      imageUrl: dish.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&q=80',
      orders: 0
    };
    db.dishes.push(newDish);
    this.saveDb(db);
    return newDish;
  },
  importDishes(dishesList) {
    const added = [];
    let count = 0;
    let skipped = 0;
    dishesList.forEach(d => {
      if (!d || !d.name) return;
      try {
        const newDish = this.addDish({
          name: d.name,
          category: d.category || 'Others',
          price: Number(d.price) || 0,
          cost: Number(d.cost !== undefined ? d.cost : (d.costPrice || 0)),
          stock: Number(d.stock) || 0
        });
        added.push(newDish);
        count++;
      } catch (err) {
        skipped++;
      }
    });
    return { count, skipped, dishes: added };
  },
  deleteDish(dishId) {
    const db = this.getDb();
    const index = db.dishes.findIndex(d => d.id === Number(dishId));
    if (index === -1) return null;
    const deleted = db.dishes.splice(index, 1)[0];
    this.saveDb(db);
    return deleted;
  },
  checkout(orderData) {
    const db = this.getDb();
    let totalAmount = 0;
    
    orderData.items.forEach(item => {
      totalAmount += Number(item.price) * Number(item.quantity);
      const dbDish = db.dishes.find(d => d.id === Number(item.id));
      if (dbDish) {
        dbDish.orders = (dbDish.orders || 0) + Number(item.quantity);
        // Decrement stock — wire stock keeper → cashier
        if (dbDish.stock !== undefined && dbDish.stock !== null) {
          dbDish.stock = Math.max(0, dbDish.stock - Number(item.quantity));
        }
      }
    });

    const newBill = {
      id: 'ORD-' + (1000 + db.bills.length + 1),
      date: new Date().toISOString().split('T')[0],
      customer: orderData.customer || 'Takeaway',
      amount: totalAmount,
      status: 'Paid',
      items: orderData.items
    };

    db.bills.unshift(newBill);
    this.saveDb(db);
    return newBill;
  },
  updateEmployee(name, role, originalName) {
    const db = this.getDb();
    const emp = db.employees.find(e => e.name.toLowerCase() === originalName.toLowerCase());
    if (emp) {
      emp.name = name;
      emp.role = role;
      
      const user = db.users.find(u => u.username.toLowerCase() === originalName.toLowerCase().split(' ')[0]);
      if (user) {
        user.username = name.split(' ')[0].toLowerCase();
        user.role = role;
      }
      
      this.saveDb(db);
      return { success: true, employee: emp };
    }
    return { success: false, message: 'Employee not found' };
  },
  updateDish(dishId, updates) {
    const db = this.getDb();
    const dish = db.dishes.find(d => d.id === Number(dishId));
    if (!dish) return null;
    if (updates.price    !== undefined) dish.price    = Number(updates.price);
    if (updates.cost     !== undefined || updates.costPrice !== undefined) {
      dish.cost = Number(updates.cost !== undefined ? updates.cost : updates.costPrice);
    }
    if (updates.stock    !== undefined) dish.stock    = Number(updates.stock);
    if (updates.name     !== undefined) dish.name     = updates.name;
    if (updates.category !== undefined) dish.category = updates.category;
    if (updates.imageUrl !== undefined) dish.imageUrl = updates.imageUrl;
    this.saveDb(db);
    return dish;
  },
  getExpenses(period = 'month') {
    const db = this.getDb();
    if (!db.expenses) db.expenses = [];
    return db.expenses;
  },
  addExpense(data) {
    const db = this.getDb();
    if (!db.expenses) db.expenses = [];
    const maxId = db.expenses.length > 0 ? Math.max(...db.expenses.map(e => e.id)) : 0;
    const newExp = {
      id: maxId + 1,
      title: data.title.trim(),
      category: data.category || 'Other',
      amount: Number(data.amount),
      date: data.date || new Date().toISOString().split('T')[0],
      notes: data.notes || '',
      createdAt: new Date().toISOString()
    };
    db.expenses.unshift(newExp);
    this.saveDb(db);
    return newExp;
  },
  deleteExpense(id) {
    const db = this.getDb();
    if (!db.expenses) db.expenses = [];
    const idx = db.expenses.findIndex(e => e.id === Number(id));
    if (idx === -1) return null;
    const deleted = db.expenses.splice(idx, 1)[0];
    this.saveDb(db);
    return deleted;
  },
  getUsers() {
    const db = this.getDb();
    return db.users.map(u => ({ id: u.id, username: u.username, role: u.role }));
  },
  addUser(userData) {
    const db = this.getDb();
    const newId = db.users.length > 0 ? Math.max(...db.users.map(u => u.id)) + 1 : 1;
    const newUser = { id: newId, username: userData.username, password: userData.password, role: userData.role };
    db.users.push(newUser);
    this.saveDb(db);
    return { id: newUser.id, username: newUser.username, role: newUser.role };
  },
  updateUser(userId, updates) {
    const db = this.getDb();
    const user = db.users.find(u => u.id === Number(userId));
    if (!user) return null;
    if (updates.username !== undefined) user.username = updates.username;
    if (updates.password !== undefined && updates.password.trim() !== '') user.password = updates.password;
    if (updates.role !== undefined) user.role = updates.role;
    this.saveDb(db);
    return { id: user.id, username: user.username, role: user.role };
  },
  deleteUser(userId) {
    const db = this.getDb();
    const index = db.users.findIndex(u => u.id === Number(userId));
    if (index !== -1) {
      if (db.users[index].role === 'Admin' && db.users.filter(u => u.role === 'Admin').length <= 1) {
        throw new Error("Cannot delete the last Admin account");
      }
      const deleted = db.users.splice(index, 1)[0];
      this.saveDb(db);
      return { id: deleted.id, username: deleted.username, role: deleted.role };
    }
    return null;
  },
  getSettings() {
    const db = this.getDb();
    db.settings = { ...DEFAULT_SETTINGS, ...db.settings };
    return db.settings;
  },
  updateSettings(newSettings) {
    const db = this.getDb();
    if (!db.settings) db.settings = {};
    Object.assign(db.settings, newSettings);
    this.saveDb(db);
    return db.settings;
  },
  getAuditLogs({ category, search, limit = 150, offset = 0, startDate, endDate } = {}) {
    const db = this.getDb();
    if (!db.audit_logs || !Array.isArray(db.audit_logs)) {
      db.audit_logs = [
        {
          id: 1,
          timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
          username: 'system',
          role: 'System',
          action: 'SYSTEM_INIT',
          category: 'Settings',
          details: 'Mochiato system initialized with standard menu and default permissions.',
          metadata: { version: '1.0.0' }
        }
      ];
      this.saveDb(db);
    }

    let filtered = [...db.audit_logs];

    if (category && category !== 'All') {
      filtered = filtered.filter(l => l.category && l.category.toLowerCase() === category.toLowerCase());
    }

    if (search && search.trim() !== '') {
      const s = search.trim().toLowerCase();
      filtered = filtered.filter(l =>
        (l.username && l.username.toLowerCase().includes(s)) ||
        (l.role && l.role.toLowerCase().includes(s)) ||
        (l.action && l.action.toLowerCase().includes(s)) ||
        (l.details && l.details.toLowerCase().includes(s)) ||
        (l.category && l.category.toLowerCase().includes(s))
      );
    }

    if (startDate) {
      const startD = new Date(startDate);
      filtered = filtered.filter(l => new Date(l.timestamp) >= startD);
    }
    if (endDate) {
      const endD = new Date(endDate);
      endD.setHours(23, 59, 59, 999);
      filtered = filtered.filter(l => new Date(l.timestamp) <= endD);
    }

    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const totalCount = filtered.length;
    const paged = filtered.slice(offset, offset + limit);
    return { success: true, logs: paged, totalCount };
  },
  logAudit({ username = 'Admin', role = 'Admin', action, category = 'General', details, metadata = {} }) {
    const db = this.getDb();
    if (!db.audit_logs) db.audit_logs = [];
    const maxId = db.audit_logs.length > 0 ? Math.max(...db.audit_logs.map(l => l.id || 0)) : 0;
    const newLog = {
      id: maxId + 1,
      timestamp: new Date().toISOString(),
      username,
      role,
      action,
      category,
      details,
      metadata: metadata || {}
    };
    db.audit_logs.unshift(newLog);
    if (db.audit_logs.length > 1500) db.audit_logs = db.audit_logs.slice(0, 1500);
    this.saveDb(db);
    return newLog;
  },
  getDashboardStats(period = 'today') {
    const db = this.getDb();
    const now = new Date();
    let filteredBills = [];
    let startDate = new Date(now);
    
    if (period === 'today') {
      const todayStr = now.toISOString().split('T')[0];
      filteredBills = db.bills.filter(b => b.date === todayStr);
    } else if (period === 'yesterday') {
      const y = new Date(now); y.setDate(now.getDate() - 1);
      const yStr = y.toISOString().split('T')[0];
      filteredBills = db.bills.filter(b => b.date === yStr);
    } else if (period === 'week') {
      startDate.setDate(now.getDate() - 7);
      filteredBills = db.bills.filter(b => new Date(b.date) >= startDate);
    } else if (period === 'month') {
      startDate.setDate(now.getDate() - 30);
      filteredBills = db.bills.filter(b => new Date(b.date) >= startDate);
    } else if (period === 'year') {
      startDate.setDate(now.getDate() - 365);
      filteredBills = db.bills.filter(b => new Date(b.date) >= startDate);
    }

    const totalOrders = filteredBills.length;
    const totalIncome = filteredBills.reduce((sum, b) => sum + Number(b.amount), 0);
    
    const dishMap = {};
    (db.dishes || []).forEach(d => {
      dishMap[d.id] = { ...d, cost: Number(d.cost || 0), orders: 0 };
    });

    let foodIncome = 0;
    let drinksIncome = 0;
    let othersIncome = 0;
    let totalCost = 0;
    
    filteredBills.forEach(b => {
      if (b.items && b.items.length > 0) {
        b.items.forEach(item => {
          const itemVal = Number(item.price) * Number(item.quantity);
          if (item.category === 'Food') foodIncome += itemVal;
          else if (item.category === 'Drinks') drinksIncome += itemVal;
          else othersIncome += itemVal;

          const d = dishMap[item.id];
          const unitCost = d ? Number(d.cost || 0) : 0;
          totalCost += unitCost * Number(item.quantity || 1);
          if (d) d.orders += Number(item.quantity || 1);
        });
      } else {
        foodIncome += b.amount * 0.45;
        drinksIncome += b.amount * 0.50;
        othersIncome += b.amount * 0.05;
      }
    });

    const expensesList = db.expenses || [];
    const totalExpenses = expensesList.reduce((sum, e) => sum + Number(e.amount), 0);
    const grossProfit = Math.round((totalIncome - totalCost) * 100) / 100;
    const netProfit = Math.round((grossProfit - totalExpenses) * 100) / 100;
    const grossProfitMargin = totalIncome > 0 ? Number(((grossProfit / totalIncome) * 100).toFixed(1)) : 0;
    const netProfitMargin = totalIncome > 0 ? Number(((netProfit / totalIncome) * 100).toFixed(1)) : 0;

    let salesChartData = [];
    if (period === 'today' || period === 'yesterday') {
      salesChartData = db.sales.map(s => {
        const scale = totalIncome / 207.5;
        return { timeLabel: s.timeLabel, amount: Math.round(s.amount * (scale || 0.8)) };
      });
    } else if (period === 'week') {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const salesMap = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        salesMap[days[d.getDay()]] = 0;
      }
      filteredBills.forEach(b => {
        const d = new Date(b.date);
        const dayName = days[d.getDay()];
        if (salesMap[dayName] !== undefined) salesMap[dayName] += b.amount;
      });
      salesChartData = Object.keys(salesMap).map(day => ({ timeLabel: day.substring(0,3), amount: salesMap[day] }));
    } else if (period === 'month') {
      const salesMap = { 'Week 1': 0, 'Week 2': 0, 'Week 3': 0, 'Week 4': 0 };
      filteredBills.forEach(b => {
        const dateObj = new Date(b.date);
        const diffDays = Math.ceil(Math.abs(now - dateObj) / (1000 * 3600 * 24));
        if (diffDays <= 7) salesMap['Week 4'] += b.amount;
        else if (diffDays <= 14) salesMap['Week 3'] += b.amount;
        else if (diffDays <= 21) salesMap['Week 2'] += b.amount;
        else salesMap['Week 1'] += b.amount;
      });
      salesChartData = Object.keys(salesMap).map(w => ({ timeLabel: w, amount: salesMap[w] }));
    } else if (period === 'year') {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const salesMap = {};
      months.forEach(m => salesMap[m] = 0);
      filteredBills.forEach(b => {
        const d = new Date(b.date);
        salesMap[months[d.getMonth()]] += b.amount;
      });
      salesChartData = months.map(m => ({ timeLabel: m, amount: salesMap[m] }));
    }

    const dishes = Object.values(dishMap).map(d => {
      const unitProfit = Math.round((d.price - (d.cost || 0)) * 100) / 100;
      const totalProfit = Math.round(unitProfit * (d.orders || 0) * 100) / 100;
      const margin = d.price > 0 ? Number(((unitProfit / d.price) * 100).toFixed(1)) : 0;
      return {
        ...d,
        unitProfit,
        totalProfit,
        margin
      };
    });

    return {
      summary: {
        totalIncome: Math.round(totalIncome),
        totalCost: Math.round(totalCost),
        grossProfit: grossProfit,
        grossProfitMargin: grossProfitMargin,
        totalExpenses: Math.round(totalExpenses),
        netProfit: netProfit,
        netProfitMargin: netProfitMargin,
        foodIncome: Math.round(foodIncome),
        drinksIncome: Math.round(drinksIncome),
        othersIncome: Math.round(othersIncome),
        totalOrders: totalOrders,
        ordersGrowth: period === 'today' ? 12.5 : -2.3,
        newCustomers: Math.round(totalOrders * 0.4),
        customersGrowth: period === 'today' ? 8.2 : 5.1
      },
      sales: salesChartData,
      dishes: dishes,
      expenses: expensesList,
      employees: db.employees,
      bills: db.bills,
      messages: db.messages
    };
  }
};

function getAuthHeaders(extraHeaders = {}) {
  const token = localStorage.getItem('smartpos_token');
  const headers = { ...extraHeaders };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function parseApiResponse(response) {
  if (response.status === 401) {
    localStorage.removeItem('smartpos_token');
    localStorage.removeItem('user');
    window.dispatchEvent(new CustomEvent('smartpos:auth-expired'));
    const errData = await response.json().catch(() => ({}));
    return { success: false, message: errData.message || 'Session expired. Please log in again.' };
  }
  if (response.status === 403) {
    const errData = await response.json().catch(() => ({}));
    return { success: false, message: errData.message || 'Forbidden: Insufficient permissions.' };
  }
  return await response.json();
}

const API = {
  getToken() {
    return localStorage.getItem('smartpos_token');
  },

  logout() {
    localStorage.removeItem('smartpos_token');
    localStorage.removeItem('user');
  },

  async login(username, password) {
    if (useLocalDB) {
      const res = LocalPOSDB.login(username, password);
      if (res.success) {
        localStorage.setItem('smartpos_token', 'local_offline_token_' + Date.now());
      }
      return res;
    }
    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      // Parse the body regardless of status: a 401 for wrong credentials is an
      // authoritative answer from the real server, not a network failure — falling
      // back to local storage here would let stale/removed credentials bypass a
      // real rejection.
      const data = await response.json();
      if (data.success && data.token) {
        localStorage.setItem('smartpos_token', data.token);
      }
      return data;
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      const res = LocalPOSDB.login(username, password);
      if (res.success) {
        localStorage.setItem('smartpos_token', 'local_offline_token_' + Date.now());
      }
      return res;
    }
  },

  async getDashboardData(period = 'today') {
    if (useLocalDB) return LocalPOSDB.getDashboardStats(period);
    try {
      const response = await fetch(`${API_BASE}/dashboard?period=${period}`, {
        headers: getAuthHeaders()
      });
      if (response.status === 401 || response.status === 403) {
        const authRes = await parseApiResponse(response);
        alert(authRes.message || 'Session expired. Please log in again.');
        return null;
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.json();
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      return LocalPOSDB.getDashboardStats(period);
    }
  },

  async updateEmployee(name, role, originalName) {
    if (useLocalDB) return LocalPOSDB.updateEmployee(name, role, originalName);
    try {
      const response = await fetch(`${API_BASE}/employees/update`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name, role, originalName })
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      return LocalPOSDB.updateEmployee(name, role, originalName);
    }
  },

  async addDish(dishData) {
    if (useLocalDB) {
      try {
        const dish = LocalPOSDB.addDish(dishData);
        return { success: true, dish };
      } catch (err) {
        return { success: false, message: err.message };
      }
    }
    try {
      const response = await fetch(`${API_BASE}/dishes`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(dishData)
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      try {
        const dish = LocalPOSDB.addDish(dishData);
        return { success: true, dish };
      } catch (err) {
        return { success: false, message: err.message };
      }
    }
  },

  async importDishes(dishesList) {
    if (useLocalDB) {
      const res = LocalPOSDB.importDishes(dishesList);
      return { success: true, ...res };
    }
    try {
      const response = await fetch(`${API_BASE}/dishes/bulk`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ dishes: dishesList })
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      const res = LocalPOSDB.importDishes(dishesList);
      return { success: true, ...res };
    }
  },

  async deleteDish(dishId) {
    if (useLocalDB) {
      try {
        const dish = LocalPOSDB.deleteDish(dishId);
        return dish ? { success: true, dish } : { success: false, message: 'Dish not found' };
      } catch (err) {
        return { success: false, message: err.message };
      }
    }
    try {
      const response = await fetch(`${API_BASE}/dishes/${dishId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      try {
        const dish = LocalPOSDB.deleteDish(dishId);
        return dish ? { success: true, dish } : { success: false, message: 'Dish not found' };
      } catch (err) {
        return { success: false, message: err.message };
      }
    }
  },

  async checkout(orderData) {
    if (useLocalDB) {
      const bill = LocalPOSDB.checkout(orderData);
      return { success: true, bill };
    }
    try {
      const response = await fetch(`${API_BASE}/checkout`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(orderData)
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      const bill = LocalPOSDB.checkout(orderData);
      return { success: true, bill };
    }
  },

  async updateDish(dishId, updates) {
    if (useLocalDB) {
      const dish = LocalPOSDB.updateDish(dishId, updates);
      return dish ? { success: true, dish } : { success: false, message: 'Dish not found' };
    }
    try {
      const response = await fetch(`${API_BASE}/dishes/update`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ dishId, ...updates })
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      const dish = LocalPOSDB.updateDish(dishId, updates);
      return dish ? { success: true, dish } : { success: false, message: 'Dish not found' };
    }
  },

  // -- User (Role) Management Methods --
  async getUsers() {
    if (useLocalDB) return { success: true, users: LocalPOSDB.getUsers() };
    try {
      const response = await fetch(`${API_BASE}/users`, {
        headers: getAuthHeaders()
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      return { success: true, users: LocalPOSDB.getUsers() };
    }
  },
  async addUser(userData) {
    if (useLocalDB) {
      const user = LocalPOSDB.addUser(userData);
      return { success: true, user };
    }
    try {
      const response = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(userData)
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      const user = LocalPOSDB.addUser(userData);
      return { success: true, user };
    }
  },
  async updateUser(userId, updates) {
    if (useLocalDB) {
      const user = LocalPOSDB.updateUser(userId, updates);
      return user ? { success: true, user } : { success: false, message: 'User not found' };
    }
    try {
      const response = await fetch(`${API_BASE}/users/${userId}`, {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(updates)
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      const user = LocalPOSDB.updateUser(userId, updates);
      return user ? { success: true, user } : { success: false, message: 'User not found' };
    }
  },
  async deleteUser(userId) {
    if (useLocalDB) {
      try {
        const user = LocalPOSDB.deleteUser(userId);
        return user ? { success: true, user } : { success: false, message: 'User not found' };
      } catch (err) {
        return { success: false, message: err.message };
      }
    }
    try {
      const response = await fetch(`${API_BASE}/users/${userId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      try {
        const user = LocalPOSDB.deleteUser(userId);
        return user ? { success: true, user } : { success: false, message: 'User not found' };
      } catch (err) {
        return { success: false, message: err.message };
      }
    }
  },

  // -- Operating Expenses Methods --
  async getExpenses(period = 'month') {
    if (useLocalDB) return { success: true, expenses: LocalPOSDB.getExpenses(period) };
    try {
      const response = await fetch(`${API_BASE}/expenses?period=${period}`, {
        headers: getAuthHeaders()
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      return { success: true, expenses: LocalPOSDB.getExpenses(period) };
    }
  },

  async addExpense(expenseData) {
    if (useLocalDB) {
      const expense = LocalPOSDB.addExpense(expenseData);
      return { success: true, expense };
    }
    try {
      const response = await fetch(`${API_BASE}/expenses`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(expenseData)
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      const expense = LocalPOSDB.addExpense(expenseData);
      return { success: true, expense };
    }
  },

  async deleteExpense(expenseId) {
    if (useLocalDB) {
      const expense = LocalPOSDB.deleteExpense(expenseId);
      return expense ? { success: true, expense } : { success: false, message: 'Expense not found' };
    }
    try {
      const response = await fetch(`${API_BASE}/expenses/${expenseId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      const expense = LocalPOSDB.deleteExpense(expenseId);
      return expense ? { success: true, expense } : { success: false, message: 'Expense not found' };
    }
  },

  // -- System Settings & Day-End Summary Methods --
  async getSettings() {
    if (useLocalDB) return { success: true, settings: LocalPOSDB.getSettings() };
    try {
      const response = await fetch(`${API_BASE}/settings`, {
        headers: getAuthHeaders()
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      return { success: true, settings: LocalPOSDB.getSettings() };
    }
  },

  async updateSettings(settingsData) {
    if (useLocalDB) {
      const settings = LocalPOSDB.updateSettings(settingsData);
      return { success: true, settings };
    }
    try {
      const response = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(settingsData)
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      const settings = LocalPOSDB.updateSettings(settingsData);
      return { success: true, settings };
    }
  },

  async sendDayEndSummary(period = 'today', phone = null, recipient = null) {
    if (useLocalDB) {
      const settings = LocalPOSDB.getSettings();
      const stats = LocalPOSDB.getDashboardStats(period);
      const rawPhone = phone || settings.notification_phone || DEFAULT_SETTINGS.notification_phone;
      let cleanPhone = rawPhone.replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('0')) cleanPhone = '94' + cleanPhone.slice(1);
      else if (!cleanPhone.startsWith('94') && cleanPhone.length === 9) cleanPhone = '94' + cleanPhone;

      const summary = stats.summary || {};
      const totalRev = Number(summary.totalIncome || 0);
      const totalCost = Number(summary.totalCost || 0);
      const grossProfit = Number(summary.grossProfit || 0);
      const grossMargin = Number(summary.grossProfitMargin || 0);
      const totalExp = Number(summary.totalExpenses || 0);
      const netProfit = Number(summary.netProfit || 0);
      const netMargin = Number(summary.netProfitMargin || 0);

      const targetRecipient = recipient || settings.notification_recipient || DEFAULT_SETTINGS.notification_recipient;
      const message = 
`☕ *${(settings.cafe_name || DEFAULT_SETTINGS.cafe_name).toUpperCase()} - DAY END SUMMARY REPORT*
📅 *Date:* ${new Date().toLocaleDateString()}
📲 *Recipient:* ${targetRecipient}
📍 *Address:* ${settings.address || DEFAULT_SETTINGS.address}
☎️ *Contact:* ${rawPhone}
✉️ *Email:* ${settings.notification_email || DEFAULT_SETTINGS.notification_email}

━━━━━━━━━━━━━━━━━━━━━
📊 *FINANCIAL SUMMARY (${period.toUpperCase()})*
• *Gross Revenue:* LKR ${totalRev.toFixed(2)} (${summary.totalOrders || 0} orders)
• *Cost of Goods (COGS):* LKR ${totalCost.toFixed(2)}
• *Gross Profit:* LKR ${grossProfit.toFixed(2)} (${grossMargin.toFixed(1)}%)
• *Operating Expenses:* LKR ${totalExp.toFixed(2)}
• *NET OPERATING PROFIT:* LKR ${netProfit.toFixed(2)} (${netMargin.toFixed(1)}%)
━━━━━━━━━━━━━━━━━━━━━
✅ *Report generated via Mochiato*`;

      const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`;
      const smsUrl = `sms:${cleanPhone}?body=${encodeURIComponent(message)}`;
      return {
        success: true,
        settings,
        summary,
        recipient: { name: targetRecipient, phone: rawPhone, cleanPhone, channel: settings.notification_channel },
        message,
        whatsappUrl,
        smsUrl
      };
    }
    try {
      const response = await fetch(`${API_BASE}/reports/day-end-summary`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ period, phone, recipient })
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for this request only:", error);
      const settings = LocalPOSDB.getSettings();
      const stats = LocalPOSDB.getDashboardStats(period);
      const rawPhone = phone || settings.notification_phone || DEFAULT_SETTINGS.notification_phone;
      let cleanPhone = rawPhone.replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('0')) cleanPhone = '94' + cleanPhone.slice(1);
      else if (!cleanPhone.startsWith('94') && cleanPhone.length === 9) cleanPhone = '94' + cleanPhone;

      const summary = stats.summary || {};
      const totalRev = Number(summary.totalIncome || 0);
      const totalCost = Number(summary.totalCost || 0);
      const grossProfit = Number(summary.grossProfit || 0);
      const grossMargin = Number(summary.grossProfitMargin || 0);
      const totalExp = Number(summary.totalExpenses || 0);
      const netProfit = Number(summary.netProfit || 0);
      const netMargin = Number(summary.netProfitMargin || 0);

      const targetRecipient = recipient || settings.notification_recipient || DEFAULT_SETTINGS.notification_recipient;
      const message = 
`☕ *${(settings.cafe_name || DEFAULT_SETTINGS.cafe_name).toUpperCase()} - DAY END SUMMARY REPORT*
📅 *Date:* ${new Date().toLocaleDateString()}
📲 *Recipient:* ${targetRecipient}
📍 *Address:* ${settings.address || DEFAULT_SETTINGS.address}
☎️ *Contact:* ${rawPhone}
✉️ *Email:* ${settings.notification_email || DEFAULT_SETTINGS.notification_email}

━━━━━━━━━━━━━━━━━━━━━
📊 *FINANCIAL SUMMARY (${period.toUpperCase()})*
• *Gross Revenue:* LKR ${totalRev.toFixed(2)} (${summary.totalOrders || 0} orders)
• *Cost of Goods (COGS):* LKR ${totalCost.toFixed(2)}
• *Gross Profit:* LKR ${grossProfit.toFixed(2)} (${grossMargin.toFixed(1)}%)
• *Operating Expenses:* LKR ${totalExp.toFixed(2)}
• *NET OPERATING PROFIT:* LKR ${netProfit.toFixed(2)} (${netMargin.toFixed(1)}%)
━━━━━━━━━━━━━━━━━━━━━
✅ *Report generated via Mochiato*`;

      const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`;
      const smsUrl = `sms:${cleanPhone}?body=${encodeURIComponent(message)}`;
      return {
        success: true,
        settings,
        summary,
        recipient: { name: targetRecipient, phone: rawPhone, cleanPhone, channel: settings.notification_channel },
        message,
        whatsappUrl,
        smsUrl
      };
    }
  },

  // -- Audit Logs Methods (Requirement 3: Activity & Tamper-evident logging) --
  async getAuditLogs(params = {}) {
    if (useLocalDB) return LocalPOSDB.getAuditLogs(params);
    try {
      const q = new URLSearchParams();
      if (params.category && params.category !== 'All') q.append('category', params.category);
      if (params.search) q.append('search', params.search);
      if (params.limit) q.append('limit', params.limit);
      if (params.offset) q.append('offset', params.offset);
      if (params.startDate) q.append('startDate', params.startDate);
      if (params.endDate) q.append('endDate', params.endDate);

      const response = await fetch(`${API_BASE}/audit-logs?${q.toString()}`, {
        headers: getAuthHeaders()
      });
      return await parseApiResponse(response);
    } catch (error) {
      console.warn("API call failed, using local fallback for audit logs:", error);
      return LocalPOSDB.getAuditLogs(params);
    }
  },

  async logAudit(logData) {
    if (useLocalDB) {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      return { success: true, log: LocalPOSDB.logAudit({ username: user.username, role: user.role, ...logData }) };
    }
    try {
      const response = await fetch(`${API_BASE}/audit-logs/log`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(logData)
      });
      return await parseApiResponse(response);
    } catch (error) {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      return { success: true, log: LocalPOSDB.logAudit({ username: user.username, role: user.role, ...logData }) };
    }
  },

  async exportAuditLogs(params = {}) {
    try {
      const q = new URLSearchParams();
      if (params.category && params.category !== 'All') q.append('category', params.category);
      if (params.search) q.append('search', params.search);
      if (params.startDate) q.append('startDate', params.startDate);
      if (params.endDate) q.append('endDate', params.endDate);

      const response = await fetch(`${API_BASE}/audit-logs/export?${q.toString()}`, {
        headers: getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to export');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smartpos-audit-log-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      return { success: true };
    } catch (error) {
      console.warn("Direct CSV download failed, generating client-side export:", error);
      const res = await this.getAuditLogs({ ...params, limit: 1000 });
      const logs = (res && res.logs) || [];
      const headers = ['ID', 'Timestamp', 'Username', 'Role', 'Category', 'Action', 'Description', 'Metadata'];
      const rows = logs.map(l => {
        const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
        return [l.id, esc(l.timestamp), esc(l.username), esc(l.role), esc(l.category), esc(l.action), esc(l.details), esc(JSON.stringify(l.metadata || {}))].join(',');
      });
      const csv = [headers.join(','), ...rows].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smartpos-audit-log-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      return { success: true };
    }
  }
};
