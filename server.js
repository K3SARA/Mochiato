require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./database');
const { syncOfflineOrders } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'smartpos-secret-token-cafe-2026';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Authentication & Authorization Middlewares
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
    if (err) {
      return res.status(401).json({ success: false, message: 'Session expired or invalid. Please log in again.' });
    }
    req.user = decodedUser;
    next();
  });
}

function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (req.user.role === 'Admin' || allowedRoles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions for this action.' });
  };
}

// Routes
// Authentication
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.login(username, password);
    if (user) {
      await db.logAudit({
        username: user.username,
        role: user.role,
        action: 'LOGIN_SUCCESS',
        category: 'Auth',
        details: `User "${user.username}" logged in successfully (${user.role})`,
        metadata: { role: user.role }
      });
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      res.json({
        success: true,
        token,
        user: { id: user.id, username: user.username, role: user.role }
      });
    } else {
      await db.logAudit({
        username: username || 'Unknown',
        role: 'Anonymous',
        action: 'LOGIN_FAILED',
        category: 'Auth',
        details: `Failed authentication attempt for username "${username || ''}"`,
        metadata: { username }
      });
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to log in' });
  }
});

// Dashboard Data
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const period = req.query.period || 'today';
    const data = await db.getDashboardStats(period);
    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load dashboard data' });
  }
});

app.post('/api/employees/update', authenticateToken, async (req, res) => {
  try {
    const { name, role, originalName } = req.body;
    const updated = await db.updateEmployee(name, role, originalName);
    if (updated) {
      return res.json({ success: true, employee: updated });
    }
    res.status(404).json({ success: false, message: 'Employee not found' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update employee profile' });
  }
});

// Uploaded images are stored as base64 data URLs directly in Postgres —
// Railway's filesystem is ephemeral, so writing to disk would lose files on every redeploy.
function resolveImage(reqBody) {
  return reqBody.imageBase64 || reqBody.imageUrl;
}

app.post('/api/dishes', authenticateToken, requireRoles('Admin', 'StockKeeper'), async (req, res) => {
  try {
    const dishData = { ...req.body };
    dishData.imageUrl = resolveImage(req.body) || dishData.imageUrl;
    const newDish = await db.addDish(dishData, req.user);
    res.json({ success: true, dish: newDish });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Failed to add dish' });
  }
});

app.post('/api/dishes/bulk', authenticateToken, requireRoles('Admin', 'StockKeeper'), async (req, res) => {
  try {
    const { dishes } = req.body;
    if (!Array.isArray(dishes)) {
      return res.status(400).json({ success: false, message: 'Invalid dishes list' });
    }
    const result = await db.addDishesBulk(dishes, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to import menu items' });
  }
});

app.delete('/api/dishes/:id', authenticateToken, requireRoles('Admin', 'StockKeeper'), async (req, res) => {
  try {
    const deleted = await db.deleteDish(req.params.id, req.user);
    if (deleted) {
      res.json({ success: true, dish: deleted });
    } else {
      res.status(404).json({ success: false, message: 'Dish not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to delete dish' });
  }
});

app.post('/api/dishes/update', authenticateToken, requireRoles('Admin', 'StockKeeper'), async (req, res) => {
  try {
    const { dishId, id, price, cost, stock, name, category } = req.body;
    const targetId = dishId !== undefined ? dishId : id;
    const imageUrl = resolveImage(req.body);
    const updated = await db.updateDish(targetId, { price, cost, stock, name, category, imageUrl }, req.user);
    if (updated) {
      res.json({ success: true, dish: updated });
    } else {
      res.status(404).json({ success: false, message: 'Dish not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update dish' });
  }
});

// Expenses Management Routes
app.get('/api/expenses', authenticateToken, requireRoles('Admin'), async (req, res) => {
  try {
    const period = req.query.period || 'month';
    const expenses = await db.getExpenses(period);
    res.json({ success: true, expenses });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch expenses' });
  }
});

app.post('/api/expenses', authenticateToken, requireRoles('Admin'), async (req, res) => {
  try {
    const expense = await db.addExpense(req.body, req.user);
    res.json({ success: true, expense });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Failed to add expense' });
  }
});

app.delete('/api/expenses/:id', authenticateToken, requireRoles('Admin'), async (req, res) => {
  try {
    const deleted = await db.deleteExpense(req.params.id, req.user);
    if (deleted) {
      res.json({ success: true, expense: deleted });
    } else {
      res.status(404).json({ success: false, message: 'Expense not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to delete expense' });
  }
});

app.post('/api/checkout', authenticateToken, requireRoles('Admin', 'Cashier'), async (req, res) => {
  try {
    const newBill = await db.createOrder(req.body, req.user);
    res.json({ success: true, bill: newBill });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to process checkout' });
  }
});

app.post('/api/orders/sync', authenticateToken, requireRoles('Admin', 'Cashier'), async (req, res) => {
  try {
    const orders = Array.isArray(req.body) ? req.body : req.body.orders;
    const result = await syncOfflineOrders(orders, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to sync offline orders' });
  }
});

// User (Role) Management Routes
app.get('/api/users', authenticateToken, requireRoles('Admin'), async (req, res) => {
  try {
    const users = await db.getUsers();
    // Do not return passwords for security
    const safeUsers = users.map(u => ({ id: u.id, username: u.username, role: u.role }));
    res.json({ success: true, users: safeUsers });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

app.post('/api/users', authenticateToken, requireRoles('Admin'), async (req, res) => {
  try {
    const newUser = await db.addUser(req.body, req.user);
    res.json({ success: true, user: { id: newUser.id, username: newUser.username, role: newUser.role } });
  } catch (error) {
    if (error.code === '23505') {
      return res.json({ success: false, message: 'Username already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to add user' });
  }
});

app.put('/api/users/:id', authenticateToken, requireRoles('Admin'), async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const updated = await db.updateUser(req.params.id, { username, password, role }, req.user);
    if (updated) {
      res.json({ success: true, user: { id: updated.id, username: updated.username, role: updated.role } });
    } else {
      res.status(404).json({ success: false, message: 'User not found' });
    }
  } catch (error) {
    if (error.code === '23505') {
      return res.json({ success: false, message: 'Username already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', authenticateToken, requireRoles('Admin'), async (req, res) => {
  try {
    const deleted = await db.deleteUser(req.params.id, req.user);
    if (deleted) {
      res.json({ success: true, user: { id: deleted.id, username: deleted.username, role: deleted.role } });
    } else {
      res.status(404).json({ success: false, message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to delete user' });
  }
});


// System Settings Routes (Notification Phone & Channel Configuration)
app.get('/api/settings', authenticateToken, async (req, res) => {
  try {
    const settings = await db.getSettings();
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch settings' });
  }
});

app.post('/api/settings', authenticateToken, requireRoles('Admin', 'Cashier'), async (req, res) => {
  try {
    const updated = await db.updateSettings(req.body, req.user);
    res.json({ success: true, settings: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
});

// Day-End Report Dispatch (WhatsApp & SMS Summary generation)
app.post('/api/reports/day-end-summary', authenticateToken, async (req, res) => {
  try {
    const period = req.body && req.body.period ? req.body.period : 'today';
    const staffUser = (req.user && req.user.username) || 'Staff';
    const overridePhone = req.body && req.body.phone ? req.body.phone : null;
    const overrideRecipient = req.body && req.body.recipient ? req.body.recipient : null;
    const report = await db.generateDayEndReport(period, staffUser, overridePhone, overrideRecipient);
    res.json(report);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate day-end summary' });
  }
});

// System Audit Logs Routes (Requirement 3: Tamper-evident activity logging)
app.get('/api/audit-logs', authenticateToken, requireRoles('Admin'), async (req, res) => {
  try {
    const { category, search, limit, offset, startDate, endDate } = req.query;
    const result = await db.getAuditLogs({ category, search, limit, offset, startDate, endDate });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs' });
  }
});

app.post('/api/audit-logs/log', authenticateToken, async (req, res) => {
  try {
    const { action, category, details, metadata } = req.body;
    const username = (req.user && req.user.username) || 'Anonymous';
    const role = (req.user && req.user.role) || 'Staff';
    const log = await db.logAudit({ username, role, action, category, details, metadata });
    res.json({ success: true, log });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to record audit log' });
  }
});

app.get('/api/audit-logs/export', authenticateToken, requireRoles('Admin'), async (req, res) => {
  try {
    const { category, search, startDate, endDate } = req.query;
    const result = await db.getAuditLogs({ category, search, limit: 1000, offset: 0, startDate, endDate });
    const logs = result.logs || [];

    const headers = ['ID', 'Timestamp', 'Username', 'Role', 'Category', 'Action', 'Description', 'Metadata'];
    const rows = logs.map(l => {
      const escape = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
      return [
        l.id,
        escape(l.timestamp),
        escape(l.username),
        escape(l.role),
        escape(l.category),
        escape(l.action),
        escape(l.details),
        escape(JSON.stringify(l.metadata || {}))
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="smartpos-audit-log-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to export audit logs' });
  }
});

// Start Server
db.initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Mochiato server is running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
