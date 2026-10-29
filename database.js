const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const dbJsonPath = path.join(__dirname, 'db.json');
let isPgConnected = false;
let fileDb = null;
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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
  connectionTimeoutMillis: 3000
});

const DEFAULT_DISH_IMAGE = 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=100&q=80';

function loadFileDb() {
  if (fileDb) return fileDb;
  if (!fs.existsSync(dbJsonPath)) {
    const seedStructure = {
      users: [
        { id: 1, username: 'admin', password: 'admin123', role: 'Admin' },
        { id: 2, username: 'stockkeeper', password: 'stock123', role: 'StockKeeper' },
        { id: 3, username: 'cashier', password: 'cashier123', role: 'Cashier' }
      ],
      dishes: [],
      employees: [],
      bills: [],
      sales: [],
      messages: [],
      expenses: []
    };
    fs.writeFileSync(dbJsonPath, JSON.stringify(seedStructure, null, 2));
  }
  const raw = fs.readFileSync(dbJsonPath, 'utf8');
  fileDb = JSON.parse(raw);
  if (!fileDb.expenses) fileDb.expenses = [];
  if (!fileDb.audit_logs || !Array.isArray(fileDb.audit_logs)) {
    fileDb.audit_logs = [
      {
        id: 1,
        timestamp: new Date(Date.now() - 3600000 * 3).toISOString(),
        username: 'system',
        role: 'System',
        action: 'SYSTEM_INIT',
        category: 'Settings',
        details: 'Mochiato system initialized with standard menu and default permissions.',
        metadata: { version: '1.0.0', cafe: 'Mochiato' }
      },
      {
        id: 2,
        timestamp: new Date(Date.now() - 3600000 * 1.5).toISOString(),
        username: 'admin',
        role: 'Admin',
        action: 'SETTINGS_UPDATED',
        category: 'Settings',
        details: 'Configured Day-End notification phone to 0768899324 (Recipient: W.A Lahiru Sampath)',
        metadata: { notification_phone: '0768899324', notification_channel: 'WhatsApp' }
      }
    ];
  }
  const legacySettings = {
    cafe_name: ["Teen's Cafe", "Teen's Cafe - Anuradhapura", 'Mochiato - Anuradhapura'],
    notification_recipient: ['Cafe Owner'],
    notification_phone: ['0711853911', '0762043911', '+94 76 889 9324'],
    notification_email: [''],
    address: ['', 'Stage 3, Anuradhapura'],
    currency: ['LKR (Rs.)']
  };
  if (!fileDb.settings) fileDb.settings = {};
  let settingsChanged = false;
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (fileDb.settings[key] === undefined || (legacySettings[key] || []).includes(fileDb.settings[key])) {
      fileDb.settings[key] = value;
      settingsChanged = true;
    }
  }
  if (settingsChanged) saveFileDb();
  return fileDb;
}

function saveFileDb() {
  if (fileDb) {
    try {
      const tempPath = dbJsonPath + '.tmp';
      // Write synchronously to a temporary file
      fs.writeFileSync(tempPath, JSON.stringify(fileDb, null, 2));
      // Atomically replace the old db.json with the new one
      fs.renameSync(tempPath, dbJsonPath);
    } catch (err) {
      console.error('Failed to save db.json safely:', err);
    }
  }
}

function toISODate(d) {
  return d.toISOString().split('T')[0];
}

function mapDish(row) {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    cost: Number(row.cost_price !== undefined ? row.cost_price : (row.cost || 0)),
    stock: row.stock,
    orders: row.orders,
    imageUrl: row.image_url || row.imageUrl
  };
}

function mapExpense(row) {
  if (!row) return row;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    amount: Number(row.amount),
    date: typeof row.date === 'string' ? row.date.split('T')[0] : toISODate(new Date(row.date)),
    notes: row.notes || '',
    createdAt: row.created_at
  };
}

function mapUser(row) {
  if (!row) return row;
  return { id: row.id, username: row.username, password: row.password, role: row.role };
}

function mapEmployee(row) {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    earnings: Number(row.earnings),
    shiftDuration: row.shift_duration,
    avatarUrl: row.avatar_url
  };
}

function mapBill(row) {
  if (!row) return row;
  return {
    id: row.id,
    date: row.date,
    customer: row.customer,
    amount: Number(row.amount),
    status: row.status,
    items: row.items || []
  };
}

function mapMessage(row) {
  if (!row) return row;
  return { id: row.id, title: row.title, text: row.text, time: row.time, type: row.type };
}

function mapAuditLog(row) {
  if (!row) return row;
  let meta = row.metadata;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch (e) { meta = {}; }
  }
  return {
    id: row.id,
    timestamp: typeof row.timestamp === 'string' ? row.timestamp : (row.timestamp ? new Date(row.timestamp).toISOString() : new Date().toISOString()),
    username: row.username,
    role: row.role || 'Staff',
    action: row.action,
    category: row.category || 'General',
    details: row.details,
    metadata: meta || {}
  };
}


async function initDb() {
  try {
    const client = await pool.connect();
    client.release();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dishes (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price NUMERIC(10,2) NOT NULL DEFAULT 0,
        cost_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0,
        orders INTEGER NOT NULL DEFAULT 0,
        image_url TEXT
      );
      ALTER TABLE dishes ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2) NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        earnings NUMERIC(10,2) NOT NULL DEFAULT 0,
        shift_duration TEXT,
        avatar_url TEXT
      );
      CREATE TABLE IF NOT EXISTS bills (
        id TEXT PRIMARY KEY,
        date DATE NOT NULL,
        customer TEXT,
        amount NUMERIC(10,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'Paid',
        items JSONB NOT NULL DEFAULT '[]',
        client_order_uuid TEXT UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE bills ADD COLUMN IF NOT EXISTS client_order_uuid TEXT UNIQUE;
      CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        time_label TEXT NOT NULL,
        amount NUMERIC(10,2) NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        time TEXT,
        type TEXT
      );
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
        username TEXT NOT NULL,
        role TEXT,
        action TEXT NOT NULL,
        category TEXT NOT NULL,
        details TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs (timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs (category);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs (username);
      CREATE SEQUENCE IF NOT EXISTS bill_number_seq START WITH 5;
    `);

    const { rows: currentSettings } = await pool.query('SELECT key, value FROM system_settings');
    const currentSettingsMap = new Map(currentSettings.map(row => {
      let value = row.value;
      try { value = JSON.parse(value); } catch (e) { /* Stored plain text. */ }
      return [row.key, value];
    }));
    const legacySettings = {
      cafe_name: ["Teen's Cafe", "Teen's Cafe - Anuradhapura", 'Mochiato - Anuradhapura'],
      notification_recipient: ['Cafe Owner'],
      notification_phone: ['0711853911', '0762043911', '+94 76 889 9324'],
      notification_email: [''],
      address: ['', 'Stage 3, Anuradhapura'],
      currency: ['LKR (Rs.)'],
      auto_day_end_enabled: [false]
    };
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      const currentValue = currentSettingsMap.get(key);
      if (!currentSettingsMap.has(key) || (legacySettings[key] || []).includes(currentValue)) {
        await pool.query(
          `INSERT INTO system_settings (key, value, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, typeof value === 'string' ? value : JSON.stringify(value)]
        );
      }
    }

    const { rows } = await pool.query('SELECT COUNT(*) FROM users');
    if (Number(rows[0].count) === 0) {
      await seed();
      console.log('Database initialized with seed data in PostgreSQL.');
    }
    isPgConnected = true;
    console.log('PostgreSQL database connected successfully.');
  } catch (err) {
    isPgConnected = false;
    console.warn('\n----------------------------------------------------------------');
    console.warn(`⚠️  PostgreSQL unavailable (${err.code || err.message}).`);
    console.warn('📁  Fallback: Mochiato running in local File Database mode (db.json).');
    console.warn('----------------------------------------------------------------\n');
    loadFileDb();
  }
}

async function seed() {
  const [adminHash, stockHash, cashierHash] = await Promise.all([
    bcrypt.hash('admin123', 10),
    bcrypt.hash('stock123', 10),
    bcrypt.hash('cashier123', 10)
  ]);
  await pool.query(
    `INSERT INTO users (username, password, role) VALUES
      ('admin', $1, 'Admin'),
      ('stock', $2, 'StockKeeper'),
      ('cashier', $3, 'Cashier')`,
    [adminHash, stockHash, cashierHash]
  );

  await pool.query(
    `INSERT INTO dishes (name, category, orders, price, stock, image_url) VALUES
      ('Espresso', 'Drinks', 124, 3.50, 0, 'https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?w=500&q=80'),
      ('Avocado Toast', 'Food', 98, 8.50, 0, 'https://images.unsplash.com/photo-1541532713592-79a0317b6b77?w=500&q=80'),
      ('Cappuccino', 'Drinks', 210, 4.50, 0, 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=500&q=80'),
      ('Blueberry Muffin', 'Food', 85, 3.00, 0, 'https://images.unsplash.com/photo-1607958996333-41aef7caefaa?w=500&q=80'),
      ('Latte', 'Drinks', 185, 4.00, 0, 'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=500&q=80')`
  );

  await pool.query(
    `INSERT INTO employees (name, role, earnings, shift_duration, avatar_url) VALUES
      ('Theresa Webb', 'Waiter', 450, '08:00 AM - 04:00 PM', 'https://i.pravatar.cc/100?img=1'),
      ('Albert Flores', 'Manager', 750, '09:00 AM - 05:00 PM', 'https://i.pravatar.cc/100?img=11'),
      ('Dianne Russell', 'Courier', 320, '10:00 AM - 06:00 PM', 'https://i.pravatar.cc/100?img=5')`
  );

  await pool.query(
    `INSERT INTO sales (time_label, amount) VALUES
      ('09:00', 45), ('10:00', 80), ('11:00', 110), ('12:00', 205), ('13:00', 180),
      ('14:00', 120), ('15:00', 90), ('16:00', 65), ('17:00', 130), ('18:00', 160)`
  );

  await pool.query(
    `INSERT INTO messages (title, text, time, type) VALUES
      ('Low Stock Alert', 'Coffee beans running low in storage.', '10 mins ago', 'warning'),
      ('Shift Updated', 'Your shift tomorrow has been changed to 09:00 AM.', '2 hours ago', 'info')`
  );

  const seedBills = [
    { id: 'ORD-1001', date: '2026-07-10', customer: 'Table 4', amount: 45.00, status: 'Paid', items: [{ id: 1, name: 'Espresso', category: 'Drinks', price: 3.50, quantity: 2 }, { id: 2, name: 'Avocado Toast', category: 'Food', price: 8.50, quantity: 2 }] },
    { id: 'ORD-1002', date: '2026-07-10', customer: 'Takeaway', amount: 18.50, status: 'Paid', items: [{ id: 3, name: 'Cappuccino', category: 'Drinks', price: 4.50, quantity: 2 }, { id: 4, name: 'Blueberry Muffin', category: 'Food', price: 3.00, quantity: 3 }] },
    { id: 'ORD-1003', date: '2026-07-10', customer: 'Table 1', amount: 120.00, status: 'Pending', items: [{ id: 5, name: 'Latte', category: 'Drinks', price: 4.00, quantity: 5 }, { id: 2, name: 'Avocado Toast', category: 'Food', price: 8.50, quantity: 6 }] }
  ];

  for (const b of seedBills) {
    await pool.query(
      `INSERT INTO bills (id, date, customer, amount, status, items) VALUES ($1,$2,$3,$4,$5,$6)`,
      [b.id, b.date, b.customer, b.amount, b.status, JSON.stringify(b.items)]
    );
  }
}

async function login(username, password) {
  if (!isPgConnected) {
    const dbData = loadFileDb();
    const user = dbData.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return null;
    const match = (user.password.startsWith('$2a$') || user.password.startsWith('$2b$'))
      ? await bcrypt.compare(password, user.password)
      : password === user.password;
    return match ? { id: user.id, username: user.username, role: user.role } : null;
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  if (rows.length === 0) return null;
  const match = await bcrypt.compare(password, rows[0].password);
  return match ? mapUser(rows[0]) : null;
}

async function addDish(dish, actor = null) {
  const cost = Number(dish.cost !== undefined ? dish.cost : (dish.costPrice || 0));
  if (!isPgConnected) {
    const dbData = loadFileDb();
    const dup = dbData.dishes.some(d => d.name.trim().toLowerCase() === String(dish.name).trim().toLowerCase());
    if (dup) {
      throw new Error(`"${dish.name}" already exists in the menu`);
    }
    const maxId = dbData.dishes.length > 0 ? Math.max(...dbData.dishes.map(d => d.id)) : 0;
    const newDish = {
      id: maxId + 1,
      name: dish.name,
      category: dish.category,
      price: Number(dish.price),
      cost: cost,
      stock: Number(dish.stock || 0),
      orders: 0,
      imageUrl: dish.imageUrl || DEFAULT_DISH_IMAGE
    };
    dbData.dishes.push(newDish);
    saveFileDb();

    await logAudit({
      username: (actor && actor.username) || 'StockKeeper',
      role: (actor && actor.role) || 'StockKeeper',
      action: 'ITEM_CREATED',
      category: 'Inventory',
      details: `Added new dish "${newDish.name}" (Selling: LKR ${newDish.price.toFixed(2)}, Cost: LKR ${newDish.cost.toFixed(2)}, Stock: ${newDish.stock})`,
      metadata: { id: newDish.id, name: newDish.name, price: newDish.price, cost: newDish.cost, stock: newDish.stock }
    });

    return newDish;
  }

  const dup = await pool.query('SELECT 1 FROM dishes WHERE LOWER(name) = LOWER($1)', [String(dish.name).trim()]);
  if (dup.rows.length > 0) {
    throw new Error(`"${dish.name}" already exists in the menu`);
  }
  const { rows } = await pool.query(
    `INSERT INTO dishes (name, category, price, cost_price, stock, orders, image_url)
     VALUES ($1, $2, $3, $4, $5, 0, $6) RETURNING *`,
    [dish.name, dish.category, Number(dish.price), cost, Number(dish.stock || 0), dish.imageUrl || DEFAULT_DISH_IMAGE]
  );
  const savedDish = mapDish(rows[0]);

  await logAudit({
    username: (actor && actor.username) || 'StockKeeper',
    role: (actor && actor.role) || 'StockKeeper',
    action: 'ITEM_CREATED',
    category: 'Inventory',
    details: `Added new dish "${savedDish.name}" (Selling: LKR ${savedDish.price.toFixed(2)}, Cost: LKR ${savedDish.cost.toFixed(2)}, Stock: ${savedDish.stock})`,
    metadata: { id: savedDish.id, name: savedDish.name, price: savedDish.price, cost: savedDish.cost, stock: savedDish.stock }
  });

  return savedDish;
}

async function addDishesBulk(dishesList, actor = null) {
  const added = [];
  let count = 0;
  let skipped = 0;
  for (const d of dishesList) {
    if (!d || !d.name) continue;
    try {
      const newDish = await addDish({
        name: d.name,
        category: d.category || 'Others',
        price: Number(d.price) || 0,
        cost: Number(d.cost !== undefined ? d.cost : (d.costPrice || 0)),
        stock: Number(d.stock) || 0,
        imageUrl: d.imageUrl || DEFAULT_DISH_IMAGE
      }, actor);
      if (newDish) {
        added.push(newDish);
        count++;
      }
    } catch (err) {
      skipped++;
    }
  }

  if (count > 0) {
    await logAudit({
      username: (actor && actor.username) || 'StockKeeper',
      role: (actor && actor.role) || 'StockKeeper',
      action: 'BULK_MENU_IMPORT',
      category: 'Inventory',
      details: `Bulk imported ${count} menu items (${skipped} skipped/duplicates)`,
      metadata: { importedCount: count, skippedCount: skipped }
    });
  }

  return { count, skipped, dishes: added };
}

async function deleteDish(dishId, actor = null) {
  if (!isPgConnected) {
    const dbData = loadFileDb();
    const idx = dbData.dishes.findIndex(d => d.id === Number(dishId));
    if (idx === -1) return null;
    const deleted = dbData.dishes.splice(idx, 1)[0];
    saveFileDb();

    await logAudit({
      username: (actor && actor.username) || 'Admin',
      role: (actor && actor.role) || 'Admin',
      action: 'ITEM_DELETED',
      category: 'Inventory',
      details: `Deleted dish "${deleted.name}" (ID: ${dishId})`,
      metadata: { id: Number(dishId), name: deleted.name }
    });

    return deleted;
  }

  const { rows } = await pool.query('DELETE FROM dishes WHERE id = $1 RETURNING *', [Number(dishId)]);
  const del = rows[0] ? mapDish(rows[0]) : null;
  if (del) {
    await logAudit({
      username: (actor && actor.username) || 'Admin',
      role: (actor && actor.role) || 'Admin',
      action: 'ITEM_DELETED',
      category: 'Inventory',
      details: `Deleted dish "${del.name}" (ID: ${dishId})`,
      metadata: { id: Number(dishId), name: del.name }
    });
  }
  return del;
}

async function updateDish(dishId, updates, actor = null) {
  if (!isPgConnected) {
    const dbData = loadFileDb();
    const dish = dbData.dishes.find(d => d.id === Number(dishId));
    if (!dish) return null;
    if (updates.price !== undefined) dish.price = Number(updates.price);
    if (updates.cost !== undefined || updates.costPrice !== undefined) {
      dish.cost = Number(updates.cost !== undefined ? updates.cost : updates.costPrice);
    }
    if (updates.stock !== undefined) dish.stock = Number(updates.stock);
    if (updates.name !== undefined) dish.name = updates.name;
    if (updates.category !== undefined) dish.category = updates.category;
    if (updates.imageUrl !== undefined) dish.imageUrl = updates.imageUrl;
    saveFileDb();

    await logAudit({
      username: (actor && actor.username) || 'StockKeeper',
      role: (actor && actor.role) || 'StockKeeper',
      action: 'ITEM_UPDATED',
      category: 'Inventory',
      details: `Updated dish "${dish.name}" (Selling: LKR ${dish.price.toFixed(2)}, Cost: LKR ${dish.cost.toFixed(2)}, Stock: ${dish.stock})`,
      metadata: { id: Number(dishId), name: dish.name, updates }
    });

    return dish;
  }

  const fields = [];
  const values = [];
  let i = 1;
  if (updates.price !== undefined) { fields.push(`price = $${i++}`); values.push(Number(updates.price)); }
  if (updates.cost !== undefined || updates.costPrice !== undefined) {
    fields.push(`cost_price = $${i++}`);
    values.push(Number(updates.cost !== undefined ? updates.cost : updates.costPrice));
  }
  if (updates.stock !== undefined) { fields.push(`stock = $${i++}`); values.push(Number(updates.stock)); }
  if (updates.name !== undefined) { fields.push(`name = $${i++}`); values.push(updates.name); }
  if (updates.category !== undefined) { fields.push(`category = $${i++}`); values.push(updates.category); }
  if (updates.imageUrl !== undefined) { fields.push(`image_url = $${i++}`); values.push(updates.imageUrl); }

  if (fields.length === 0) {
    const { rows } = await pool.query('SELECT * FROM dishes WHERE id = $1', [Number(dishId)]);
    return rows[0] ? mapDish(rows[0]) : null;
  }

  values.push(Number(dishId));
  const { rows } = await pool.query(
    `UPDATE dishes SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  const updatedDish = rows[0] ? mapDish(rows[0]) : null;
  if (updatedDish) {
    await logAudit({
      username: (actor && actor.username) || 'StockKeeper',
      role: (actor && actor.role) || 'StockKeeper',
      action: 'ITEM_UPDATED',
      category: 'Inventory',
      details: `Updated dish "${updatedDish.name}" (Selling: LKR ${updatedDish.price.toFixed(2)}, Cost: LKR ${updatedDish.cost.toFixed(2)}, Stock: ${updatedDish.stock})`,
      metadata: { id: Number(dishId), name: updatedDish.name, updates }
    });
  }
  return updatedDish;
}


async function createOrder(orderData, actor = null) {
  const clientOrderUuid = orderData && orderData.client_order_uuid;

  if (!isPgConnected) {
    const dbData = loadFileDb();
    const existingBill = clientOrderUuid && (dbData.bills || []).find(
      bill => bill.client_order_uuid === clientOrderUuid
    );
    if (existingBill) return mapBill(existingBill);
  } else if (clientOrderUuid) {
    const { rows } = await pool.query(
      `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, customer, amount, status, items
       FROM bills
       WHERE client_order_uuid = $1`,
      [clientOrderUuid]
    );
    if (rows.length > 0) return mapBill(rows[0]);
  }

  if (!orderData || !Array.isArray(orderData.items) || orderData.items.length === 0) {
    throw new Error('Order must contain at least one item');
  }

  let totalAmount = 0;
  for (const item of orderData.items) {
    totalAmount += Number(item.price) * Number(item.quantity);
  }

  if (!isPgConnected) {
    const dbData = loadFileDb();

    for (const item of orderData.items) {
      const d = dbData.dishes.find(x => x.id === Number(item.id));
      if (d) {
        d.orders = (d.orders || 0) + Number(item.quantity);
        d.stock = Math.max(0, (d.stock || 0) - Number(item.quantity));
      }
    }

    const billId = 'ORD-' + (1000 + (dbData.bills ? dbData.bills.length : 0) + 1);
    const dateStr = toISODate(new Date());

    const newBill = {
      id: billId,
      date: dateStr,
      customer: orderData.customer || 'Takeaway',
      amount: totalAmount,
      status: 'Paid',
      items: orderData.items,
      ...(clientOrderUuid ? { client_order_uuid: clientOrderUuid } : {})
    };

    if (!dbData.bills) dbData.bills = [];
    dbData.bills.unshift(newBill);
    saveFileDb();

    await logAudit({
      username: (actor && actor.username) || (orderData && orderData.cashier) || 'Cashier',
      role: (actor && actor.role) || 'Cashier',
      action: 'ORDER_CHECKOUT',
      category: 'Sales',
      details: `Completed order #${newBill.id} for LKR ${totalAmount.toFixed(2)} (${orderData.items.length} items, Customer: ${orderData.customer || 'Takeaway'})`,
      metadata: {
        billId: newBill.id,
        amount: totalAmount,
        customer: orderData.customer || 'Takeaway',
        itemCount: orderData.items.length,
        items: orderData.items.map(i => ({ name: i.name, quantity: i.quantity, price: i.price }))
      }
    });

    return mapBill(newBill);
  }

  const client = await pool.connect();
  try {
    // 1. Begin atomic transaction
    await client.query('BEGIN');

    // 2. Obtain next sequential bill number and save bill record before changing stock.
    const { rows: seqRows } = await client.query("SELECT nextval('bill_number_seq') AS n");
    const billId = 'ORD-' + (1000 + Number(seqRows[0].n));
    const dateStr = toISODate(new Date());

    const { rows } = await client.query(
      `INSERT INTO bills (id, date, customer, amount, status, items, client_order_uuid)
       VALUES ($1, $2, $3, $4, 'Paid', $5, $6)
       ON CONFLICT (client_order_uuid) DO NOTHING
       RETURNING id, to_char(date, 'YYYY-MM-DD') AS date, customer, amount, status, items`,
      [
        billId,
        dateStr,
        orderData.customer || 'Takeaway',
        totalAmount,
        JSON.stringify(orderData.items),
        clientOrderUuid || null
      ]
    );

    if (rows.length === 0) {
      const { rows: existingRows } = await client.query(
        `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, customer, amount, status, items
         FROM bills
         WHERE client_order_uuid = $1`,
        [clientOrderUuid]
      );
      if (existingRows.length === 0) {
        throw new Error('Order could not be saved because its client UUID already exists');
      }
      await client.query('COMMIT');
      return mapBill(existingRows[0]);
    }

    // 3. Decrement stock and increment order counts for all items.
    for (const item of orderData.items) {
      await client.query(
        'UPDATE dishes SET orders = orders + $1, stock = GREATEST(0, stock - $1) WHERE id = $2',
        [Number(item.quantity), Number(item.id)]
      );
    }

    // 4. Commit all changes permanently.
    await client.query('COMMIT');
    const bill = mapBill(rows[0]);

    await logAudit({
      username: (actor && actor.username) || (orderData && orderData.cashier) || 'Cashier',
      role: (actor && actor.role) || 'Cashier',
      action: 'ORDER_CHECKOUT',
      category: 'Sales',
      details: `Completed order #${bill.id} for LKR ${totalAmount.toFixed(2)} (${orderData.items.length} items, Customer: ${orderData.customer || 'Takeaway'})`,
      metadata: {
        billId: bill.id,
        amount: totalAmount,
        customer: orderData.customer || 'Takeaway',
        itemCount: orderData.items.length,
        items: orderData.items.map(i => ({ name: i.name, quantity: i.quantity, price: i.price }))
      }
    });

    return bill;
  } catch (err) {
    // 5. If anything fails, rollback any stock changes
    await client.query('ROLLBACK');
    throw err;
  } finally {
    // 6. Always release client back to pool
    client.release();
  }
}

async function syncOfflineOrders(ordersArray, actor) {
  const results = [];
  for (const order of ordersArray) {
    results.push(await createOrder(order, actor));
  }
  return { synced: results.length, results };
}

async function getExpenses(period = 'month') {
  if (!isPgConnected) {
    const dbData = loadFileDb();
    if (!dbData.expenses) dbData.expenses = [];
    const now = new Date();
    let startDate = new Date(now);

    let filtered = dbData.expenses;
    if (period === 'today') {
      const todayStr = toISODate(now);
      filtered = dbData.expenses.filter(e => e.date === todayStr);
    } else if (period === 'yesterday') {
      const y = new Date(now); y.setDate(now.getDate() - 1);
      const yStr = toISODate(y);
      filtered = dbData.expenses.filter(e => e.date === yStr);
    } else if (period === 'week') {
      startDate.setDate(now.getDate() - 7);
      filtered = dbData.expenses.filter(e => new Date(e.date) >= startDate);
    } else if (period === 'month') {
      startDate.setDate(now.getDate() - 30);
      filtered = dbData.expenses.filter(e => new Date(e.date) >= startDate);
    } else if (period === 'year') {
      startDate.setDate(now.getDate() - 365);
      filtered = dbData.expenses.filter(e => new Date(e.date) >= startDate);
    }
    return filtered.map(mapExpense);
  }

  const now = new Date();
  let whereClause = '';
  let params = [];

  if (period === 'today') {
    whereClause = 'WHERE date = $1';
    params = [toISODate(now)];
  } else if (period === 'yesterday') {
    const y = new Date(now); y.setDate(now.getDate() - 1);
    whereClause = 'WHERE date = $1';
    params = [toISODate(y)];
  } else if (period === 'week') {
    const start = new Date(now); start.setDate(now.getDate() - 7);
    whereClause = 'WHERE date >= $1';
    params = [toISODate(start)];
  } else if (period === 'month') {
    const start = new Date(now); start.setDate(now.getDate() - 30);
    whereClause = 'WHERE date >= $1';
    params = [toISODate(start)];
  } else if (period === 'year') {
    const start = new Date(now); start.setDate(now.getDate() - 365);
    whereClause = 'WHERE date >= $1';
    params = [toISODate(start)];
  }

  const { rows } = await pool.query(
    `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, title, category, amount, notes, created_at
     FROM expenses ${whereClause} ORDER BY date DESC, id DESC`,
    params
  );
  return rows.map(mapExpense);
}

async function addExpense(data, actor = null) {
  if (!data || !data.title || !data.amount) {
    throw new Error('Title and Amount are required for an expense');
  }
  const dateStr = data.date ? toISODate(new Date(data.date)) : toISODate(new Date());

  if (!isPgConnected) {
    const dbData = loadFileDb();
    if (!dbData.expenses) dbData.expenses = [];
    const maxId = dbData.expenses.length > 0 ? Math.max(...dbData.expenses.map(e => e.id)) : 0;
    const newExp = {
      id: maxId + 1,
      title: data.title.trim(),
      category: data.category || 'Other',
      amount: Number(data.amount),
      date: dateStr,
      notes: data.notes || '',
      created_at: new Date().toISOString()
    };
    dbData.expenses.unshift(newExp);
    saveFileDb();
    const mapped = mapExpense(newExp);

    await logAudit({
      username: (actor && actor.username) || 'Admin',
      role: (actor && actor.role) || 'Admin',
      action: 'EXPENSE_CREATED',
      category: 'Expenses',
      details: `Recorded expense "${data.title.trim()}" for LKR ${Number(data.amount).toFixed(2)} [Category: ${data.category || 'Other'}]`,
      metadata: { id: mapped.id, title: data.title.trim(), amount: Number(data.amount), category: data.category || 'Other', notes: data.notes || '' }
    });

    return mapped;
  }

  const { rows } = await pool.query(
    `INSERT INTO expenses (title, category, amount, date, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, to_char(date, 'YYYY-MM-DD') AS date, title, category, amount, notes, created_at`,
    [data.title.trim(), data.category || 'Other', Number(data.amount), dateStr, data.notes || '']
  );
  const savedExp = mapExpense(rows[0]);

  await logAudit({
    username: (actor && actor.username) || 'Admin',
    role: (actor && actor.role) || 'Admin',
    action: 'EXPENSE_CREATED',
    category: 'Expenses',
    details: `Recorded expense "${data.title.trim()}" for LKR ${Number(data.amount).toFixed(2)} [Category: ${data.category || 'Other'}]`,
    metadata: { id: savedExp.id, title: data.title.trim(), amount: Number(data.amount), category: data.category || 'Other', notes: data.notes || '' }
  });

  return savedExp;
}

async function deleteExpense(id, actor = null) {
  if (!isPgConnected) {
    const dbData = loadFileDb();
    if (!dbData.expenses) dbData.expenses = [];
    const idx = dbData.expenses.findIndex(e => e.id === Number(id));
    if (idx === -1) return null;
    const deleted = dbData.expenses.splice(idx, 1)[0];
    saveFileDb();
    const mapped = mapExpense(deleted);

    await logAudit({
      username: (actor && actor.username) || 'Admin',
      role: (actor && actor.role) || 'Admin',
      action: 'EXPENSE_DELETED',
      category: 'Expenses',
      details: `Deleted expense "${mapped.title}" (Amount: LKR ${Number(mapped.amount).toFixed(2)})`,
      metadata: { id: Number(id), title: mapped.title, amount: Number(mapped.amount) }
    });

    return mapped;
  }

  const { rows } = await pool.query('DELETE FROM expenses WHERE id = $1 RETURNING *', [Number(id)]);
  const del = rows[0] ? mapExpense(rows[0]) : null;
  if (del) {
    await logAudit({
      username: (actor && actor.username) || 'Admin',
      role: (actor && actor.role) || 'Admin',
      action: 'EXPENSE_DELETED',
      category: 'Expenses',
      details: `Deleted expense "${del.title}" (Amount: LKR ${Number(del.amount).toFixed(2)})`,
      metadata: { id: Number(id), title: del.title, amount: Number(del.amount) }
    });
  }
  return del;
}

async function getDashboardStats(period = 'today') {
  if (!isPgConnected) {
    const dbData = loadFileDb();
    const now = new Date();
    let filteredBills = [];
    let filteredExpenses = [];
    let startDate = new Date(now);

    const expensesList = dbData.expenses || [];

    if (period === 'today') {
      const todayStr = toISODate(now);
      filteredBills = (dbData.bills || []).filter(b => b.date === todayStr);
      filteredExpenses = expensesList.filter(e => e.date === todayStr);
    } else if (period === 'yesterday') {
      const y = new Date(now); y.setDate(now.getDate() - 1);
      const yStr = toISODate(y);
      filteredBills = (dbData.bills || []).filter(b => b.date === yStr);
      filteredExpenses = expensesList.filter(e => e.date === yStr);
    } else if (period === 'week') {
      startDate.setDate(now.getDate() - 7);
      filteredBills = (dbData.bills || []).filter(b => new Date(b.date) >= startDate);
      filteredExpenses = expensesList.filter(e => new Date(e.date) >= startDate);
    } else if (period === 'month') {
      startDate.setDate(now.getDate() - 30);
      filteredBills = (dbData.bills || []).filter(b => new Date(b.date) >= startDate);
      filteredExpenses = expensesList.filter(e => new Date(e.date) >= startDate);
    } else if (period === 'year') {
      startDate.setDate(now.getDate() - 365);
      filteredBills = (dbData.bills || []).filter(b => new Date(b.date) >= startDate);
      filteredExpenses = expensesList.filter(e => new Date(e.date) >= startDate);
    }

    const totalOrders = filteredBills.length;
    const totalIncome = filteredBills.reduce((sum, b) => sum + Number(b.amount), 0);

    // Build dishes map with cost
    const dishMap = {};
    (dbData.dishes || []).forEach(d => {
      dishMap[d.id] = { ...mapDish(d), orders: 0 };
    });

    let foodIncome = 0, drinksIncome = 0, othersIncome = 0;
    let totalCost = 0; // Cost of Goods Sold (COGS)

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

    // Expenses calculations
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const grossProfit = Math.round((totalIncome - totalCost) * 100) / 100;
    const netProfit = Math.round((grossProfit - totalExpenses) * 100) / 100;
    const grossProfitMargin = totalIncome > 0 ? Number(((grossProfit / totalIncome) * 100).toFixed(1)) : 0;
    const netProfitMargin = totalIncome > 0 ? Number(((netProfit / totalIncome) * 100).toFixed(1)) : 0;

    // Expenses by category
    const expenseCategories = {};
    filteredExpenses.forEach(e => {
      const cat = e.category || 'Other';
      expenseCategories[cat] = (expenseCategories[cat] || 0) + Number(e.amount);
    });

    let salesChartData = [];
    if (period === 'today' || period === 'yesterday') {
      const scale = totalIncome / 207.5;
      salesChartData = (dbData.sales || []).map(s => ({
        timeLabel: s.timeLabel || s.time_label,
        amount: Math.round(Number(s.amount) * (scale || 0.8))
      }));
    } else if (period === 'week') {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const salesMap = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(now.getDate() - i);
        salesMap[days[d.getDay()]] = 0;
      }
      filteredBills.forEach(b => {
        const d = new Date(b.date);
        const dayName = days[d.getUTCDay()];
        if (salesMap[dayName] !== undefined) salesMap[dayName] += Number(b.amount);
      });
      salesChartData = Object.keys(salesMap).map(day => ({ timeLabel: day.substring(0, 3), amount: salesMap[day] }));
    } else if (period === 'month') {
      const salesMap = { 'Week 1': 0, 'Week 2': 0, 'Week 3': 0, 'Week 4': 0 };
      filteredBills.forEach(b => {
        const dateObj = new Date(b.date);
        const diffDays = Math.ceil(Math.abs(now - dateObj) / (1000 * 60 * 60 * 24));
        if (diffDays <= 7) salesMap['Week 4'] += Number(b.amount);
        else if (diffDays <= 14) salesMap['Week 3'] += Number(b.amount);
        else if (diffDays <= 21) salesMap['Week 2'] += Number(b.amount);
        else salesMap['Week 1'] += Number(b.amount);
      });
      salesChartData = Object.keys(salesMap).map(w => ({ timeLabel: w, amount: salesMap[w] }));
    } else if (period === 'year') {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const salesMap = {};
      months.forEach(m => salesMap[m] = 0);
      filteredBills.forEach(b => {
        const d = new Date(b.date);
        const mName = months[d.getUTCMonth()];
        if (salesMap[mName] !== undefined) salesMap[mName] += Number(b.amount);
      });
      salesChartData = months.map(m => ({ timeLabel: m, amount: salesMap[m] }));
    }

    const dishes = Object.values(dishMap).map(d => {
      const unitProfit = Math.round((d.price - d.cost) * 100) / 100;
      const totalProfit = Math.round(unitProfit * (d.orders || 0) * 100) / 100;
      const margin = d.price > 0 ? Number(((unitProfit / d.price) * 100).toFixed(1)) : 0;
      return {
        id: d.id,
        name: d.name,
        category: d.category,
        orders: d.orders || 0,
        imageUrl: d.imageUrl,
        price: d.price,
        cost: d.cost || 0,
        unitProfit,
        totalProfit,
        margin,
        stock: d.stock
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
      expenseCategories,
      expenses: filteredExpenses.map(mapExpense),
      sales: salesChartData,
      dishes: dishes,
      employees: dbData.employees || [],
      bills: (dbData.bills || []).slice(0, 100),
      messages: dbData.messages || []
    };
  }

  // PostgreSQL Mode
  const now = new Date();
  let whereClause = 'date = $1';
  let params = [toISODate(now)];

  if (period === 'yesterday') {
    const y = new Date(now); y.setDate(now.getDate() - 1);
    params = [toISODate(y)];
  } else if (period === 'week') {
    const start = new Date(now); start.setDate(now.getDate() - 7);
    whereClause = 'date >= $1';
    params = [toISODate(start)];
  } else if (period === 'month') {
    const start = new Date(now); start.setDate(now.getDate() - 30);
    whereClause = 'date >= $1';
    params = [toISODate(start)];
  } else if (period === 'year') {
    const start = new Date(now); start.setDate(now.getDate() - 365);
    whereClause = 'date >= $1';
    params = [toISODate(start)];
  }

  const { rows: filteredRows } = await pool.query(
    `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, customer, amount, status, items
     FROM bills WHERE ${whereClause}`,
    params
  );
  const filteredBills = filteredRows.map(mapBill);

  const { rows: expRows } = await pool.query(
    `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, title, category, amount, notes, created_at
     FROM expenses WHERE ${whereClause} ORDER BY date DESC, id DESC`,
    params
  );
  const filteredExpenses = expRows.map(mapExpense);

  const totalOrders = filteredBills.length;
  const totalIncome = filteredBills.reduce((sum, b) => sum + Number(b.amount), 0);

  const { rows: dishRows } = await pool.query('SELECT * FROM dishes ORDER BY id');
  const dishMap = {};
  dishRows.forEach(d => {
    dishMap[d.id] = { ...mapDish(d), orders: 0 };
  });

  let foodIncome = 0, drinksIncome = 0, othersIncome = 0;
  let totalCost = 0; // COGS

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

  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const grossProfit = Math.round((totalIncome - totalCost) * 100) / 100;
  const netProfit = Math.round((grossProfit - totalExpenses) * 100) / 100;
  const grossProfitMargin = totalIncome > 0 ? Number(((grossProfit / totalIncome) * 100).toFixed(1)) : 0;
  const netProfitMargin = totalIncome > 0 ? Number(((netProfit / totalIncome) * 100).toFixed(1)) : 0;

  const expenseCategories = {};
  filteredExpenses.forEach(e => {
    const cat = e.category || 'Other';
    expenseCategories[cat] = (expenseCategories[cat] || 0) + Number(e.amount);
  });

  let salesChartData = [];
  if (period === 'today' || period === 'yesterday') {
    const { rows: salesRows } = await pool.query('SELECT time_label, amount FROM sales ORDER BY id');
    const scale = totalIncome / 207.5;
    salesChartData = salesRows.map(s => ({
      timeLabel: s.time_label,
      amount: Math.round(Number(s.amount) * (scale || 0.8))
    }));
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
      const dayName = days[d.getUTCDay()];
      if (salesMap[dayName] !== undefined) salesMap[dayName] += b.amount;
    });
    salesChartData = Object.keys(salesMap).map(day => ({ timeLabel: day.substring(0, 3), amount: salesMap[day] }));
  } else if (period === 'month') {
    const salesMap = { 'Week 1': 0, 'Week 2': 0, 'Week 3': 0, 'Week 4': 0 };
    filteredBills.forEach(b => {
      const dateObj = new Date(b.date);
      const diffDays = Math.ceil(Math.abs(now - dateObj) / (1000 * 60 * 60 * 24));
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
      const mName = months[d.getUTCMonth()];
      if (salesMap[mName] !== undefined) salesMap[mName] += b.amount;
    });
    salesChartData = months.map(m => ({ timeLabel: m, amount: salesMap[m] }));
  }

  const dishes = Object.values(dishMap).map(d => {
    const unitProfit = Math.round((d.price - d.cost) * 100) / 100;
    const totalProfit = Math.round(unitProfit * (d.orders || 0) * 100) / 100;
    const margin = d.price > 0 ? Number(((unitProfit / d.price) * 100).toFixed(1)) : 0;
    return {
      id: d.id,
      name: d.name,
      category: d.category,
      orders: d.orders || 0,
      imageUrl: d.imageUrl,
      price: d.price,
      cost: d.cost || 0,
      unitProfit,
      totalProfit,
      margin,
      stock: d.stock
    };
  });

  const { rows: allBillRows } = await pool.query(
    `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, customer, amount, status, items
     FROM bills ORDER BY created_at DESC LIMIT 100`
  );
  const { rows: employeeRows } = await pool.query('SELECT * FROM employees ORDER BY id');
  const { rows: messageRows } = await pool.query('SELECT * FROM messages ORDER BY id');

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
    expenseCategories,
    expenses: filteredExpenses,
    sales: salesChartData,
    dishes: dishes,
    employees: employeeRows.map(mapEmployee),
    bills: allBillRows.map(mapBill),
    messages: messageRows.map(mapMessage)
  };
}


async function updateEmployee(name, role, originalName) {
  if (!isPgConnected) {
    const dbData = loadFileDb();
    const emp = dbData.employees.find(e => e.name.toLowerCase() === originalName.toLowerCase());
    if (emp) {
      emp.name = name;
      emp.role = role;
      const originalUsername = originalName.toLowerCase().split(' ')[0];
      const newUsername = name.split(' ')[0].toLowerCase();
      const u = dbData.users.find(x => x.username.toLowerCase() === originalUsername);
      if (u) {
        u.username = newUsername;
        u.role = role;
      }
      saveFileDb();
      return emp;
    }
    return null;
  }

  const { rows } = await pool.query('SELECT * FROM employees WHERE LOWER(name) = LOWER($1)', [originalName]);
  if (rows.length === 0) return null;

  const { rows: updated } = await pool.query(
    'UPDATE employees SET name = $1, role = $2 WHERE id = $3 RETURNING *',
    [name, role, rows[0].id]
  );

  const originalUsername = originalName.toLowerCase().split(' ')[0];
  const newUsername = name.split(' ')[0].toLowerCase();
  await pool.query(
    'UPDATE users SET username = $1, role = $2 WHERE LOWER(username) = LOWER($3)',
    [newUsername, role, originalUsername]
  );

  return mapEmployee(updated[0]);
}

async function getUsers() {
  if (!isPgConnected) {
    const dbData = loadFileDb();
    return (dbData.users || []).map(u => ({ id: u.id, username: u.username, role: u.role }));
  }

  const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
  return rows.map(mapUser);
}

async function addUser(userData, actor = null) {
  if (!isPgConnected) {
    const dbData = loadFileDb();
    const dup = dbData.users.some(u => u.username.toLowerCase() === userData.username.toLowerCase());
    if (dup) {
      const err = new Error('Username already exists');
      err.code = '23505';
      throw err;
    }
    const hashed = await bcrypt.hash(userData.password, 10);
    const newId = dbData.users.length > 0 ? Math.max(...dbData.users.map(u => u.id)) + 1 : 1;
    const newUser = { id: newId, username: userData.username, password: hashed, role: userData.role };
    dbData.users.push(newUser);
    saveFileDb();

    await logAudit({
      username: (actor && actor.username) || 'Admin',
      role: (actor && actor.role) || 'Admin',
      action: 'USER_CREATED',
      category: 'Users',
      details: `Created new staff user "${userData.username}" with role "${userData.role}"`,
      metadata: { username: userData.username, role: userData.role }
    });

    return { id: newUser.id, username: newUser.username, role: newUser.role };
  }

  const hashed = await bcrypt.hash(userData.password, 10);
  const { rows } = await pool.query(
    'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING *',
    [userData.username, hashed, userData.role]
  );
  const savedUser = mapUser(rows[0]);

  await logAudit({
    username: (actor && actor.username) || 'Admin',
    role: (actor && actor.role) || 'Admin',
    action: 'USER_CREATED',
    category: 'Users',
    details: `Created new staff user "${savedUser.username}" with role "${savedUser.role}"`,
    metadata: { username: savedUser.username, role: savedUser.role }
  });

  return savedUser;
}

async function updateUser(userId, updates, actor = null) {
  if (!isPgConnected) {
    const dbData = loadFileDb();
    const user = dbData.users.find(u => u.id === Number(userId));
    if (!user) return null;
    if (updates.username !== undefined) {
      const dup = dbData.users.some(u => u.id !== Number(userId) && u.username.toLowerCase() === updates.username.toLowerCase());
      if (dup) {
        const err = new Error('Username already exists');
        err.code = '23505';
        throw err;
      }
      user.username = updates.username;
    }
    if (updates.password !== undefined && updates.password.trim() !== '') {
      user.password = await bcrypt.hash(updates.password, 10);
    }
    if (updates.role !== undefined) user.role = updates.role;
    saveFileDb();

    await logAudit({
      username: (actor && actor.username) || 'Admin',
      role: (actor && actor.role) || 'Admin',
      action: 'USER_UPDATED',
      category: 'Users',
      details: `Updated staff user account "${user.username}" (Role: "${user.role}")`,
      metadata: { userId, updates: { username: updates.username, role: updates.role } }
    });

    return { id: user.id, username: user.username, role: user.role };
  }

  const fields = [];
  const values = [];
  let i = 1;
  if (updates.username !== undefined) { fields.push(`username = $${i++}`); values.push(updates.username); }
  if (updates.password !== undefined && updates.password.trim() !== '') {
    const hashed = await bcrypt.hash(updates.password, 10);
    fields.push(`password = $${i++}`); values.push(hashed);
  }
  if (updates.role !== undefined) { fields.push(`role = $${i++}`); values.push(updates.role); }

  if (fields.length === 0) {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [Number(userId)]);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  values.push(Number(userId));
  const { rows } = await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  const updatedUser = rows[0] ? mapUser(rows[0]) : null;
  if (updatedUser) {
    await logAudit({
      username: (actor && actor.username) || 'Admin',
      role: (actor && actor.role) || 'Admin',
      action: 'USER_UPDATED',
      category: 'Users',
      details: `Updated staff user account "${updatedUser.username}" (Role: "${updatedUser.role}")`,
      metadata: { userId, updates: { username: updates.username, role: updates.role } }
    });
  }
  return updatedUser;
}

async function deleteUser(userId, actor = null) {
  if (!isPgConnected) {
    const dbData = loadFileDb();
    const idx = dbData.users.findIndex(u => u.id === Number(userId));
    if (idx === -1) return null;
    if (dbData.users[idx].role === 'Admin' && dbData.users.filter(u => u.role === 'Admin').length <= 1) {
      throw new Error('Cannot delete the last Admin account');
    }
    const deleted = dbData.users.splice(idx, 1)[0];
    saveFileDb();

    await logAudit({
      username: (actor && actor.username) || 'Admin',
      role: (actor && actor.role) || 'Admin',
      action: 'USER_DELETED',
      category: 'Users',
      details: `Deleted staff user account "${deleted.username}" (Role: "${deleted.role}")`,
      metadata: { userId, username: deleted.username, role: deleted.role }
    });

    return { id: deleted.id, username: deleted.username, role: deleted.role };
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [Number(userId)]);
  if (rows.length === 0) return null;

  if (rows[0].role === 'Admin') {
    const { rows: adminRows } = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'Admin'");
    if (Number(adminRows[0].count) <= 1) {
      throw new Error('Cannot delete the last Admin account');
    }
  }

  const { rows: deleted } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [Number(userId)]);
  const del = deleted[0] ? mapUser(deleted[0]) : null;
  if (del) {
    await logAudit({
      username: (actor && actor.username) || 'Admin',
      role: (actor && actor.role) || 'Admin',
      action: 'USER_DELETED',
      category: 'Users',
      details: `Deleted staff user account "${del.username}" (Role: "${del.role}")`,
      metadata: { userId, username: del.username, role: del.role }
    });
  }
  return del;
}

async function getSettings() {
  if (!isPgConnected) {
    const dbData = loadFileDb();
    return { ...DEFAULT_SETTINGS, ...dbData.settings };
  }

  const { rows } = await pool.query('SELECT key, value FROM system_settings');
  const settings = { ...DEFAULT_SETTINGS };
  rows.forEach(r => {
    try {
      settings[r.key] = JSON.parse(r.value);
    } catch (e) {
      settings[r.key] = r.value;
    }
  });
  return settings;
}

async function updateSettings(newSettings, actor = null) {
  if (!newSettings || typeof newSettings !== 'object') return null;

  if (!isPgConnected) {
    const dbData = loadFileDb();
    if (!dbData.settings) dbData.settings = {};
    Object.keys(newSettings).forEach(k => {
      dbData.settings[k] = newSettings[k];
    });
    saveFileDb();
    const updated = await getSettings();
    await logAudit({
      username: (actor && actor.username) || 'Admin',
      role: (actor && actor.role) || 'Admin',
      action: 'SETTINGS_UPDATED',
      category: 'Settings',
      details: `Updated system settings: Phone=${updated.notification_phone || 'Unchanged'}, Recipient=${updated.notification_recipient || 'Unchanged'}, Channel=${updated.notification_channel || 'Unchanged'}`,
      metadata: newSettings
    });
    return updated;
  }

  for (const [k, v] of Object.entries(newSettings)) {
    const valStr = typeof v === 'string' ? v : JSON.stringify(v);
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) 
       VALUES ($1, $2, now()) 
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [k, valStr]
    );
  }
  const updated = await getSettings();
  await logAudit({
    username: (actor && actor.username) || 'Admin',
    role: (actor && actor.role) || 'Admin',
    action: 'SETTINGS_UPDATED',
    category: 'Settings',
    details: `Updated system settings: Phone=${updated.notification_phone || 'Unchanged'}, Recipient=${updated.notification_recipient || 'Unchanged'}, Channel=${updated.notification_channel || 'Unchanged'}`,
    metadata: newSettings
  });
  return updated;
}

async function generateDayEndReport(period = 'today', staffUser = 'Admin', overridePhone = null, overrideRecipient = null) {
  const stats = await getDashboardStats(period);
  const settings = await getSettings();

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  const summary = stats.summary || {};
  const totalRev = Number(summary.totalIncome || 0);
  const totalCost = Number(summary.totalCost || 0);
  const grossProfit = Number(summary.grossProfit || 0);
  const grossMargin = Number(summary.grossProfitMargin || 0);
  const totalExp = Number(summary.totalExpenses || 0);
  const netProfit = Number(summary.netProfit || 0);
  const netMargin = Number(summary.netProfitMargin || 0);
  const orders = Number(summary.totalOrders || 0);

  const rawPhone = overridePhone || settings.notification_phone || DEFAULT_SETTINGS.notification_phone;
  let cleanPhone = rawPhone.replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '94' + cleanPhone.slice(1);
  } else if (!cleanPhone.startsWith('94') && cleanPhone.length === 9) {
    cleanPhone = '94' + cleanPhone;
  }

  const cafeName = (settings.cafe_name || DEFAULT_SETTINGS.cafe_name).toUpperCase();
  const recipient = overrideRecipient || settings.notification_recipient || DEFAULT_SETTINGS.notification_recipient;

  const message = 
`☕ *${cafeName} - DAY END SUMMARY REPORT*
📅 *Date:* ${dateStr} (${timeStr})
👤 *Prepared By:* ${staffUser}
📲 *Recipient:* ${recipient}
📍 *Address:* ${settings.address || DEFAULT_SETTINGS.address}
☎️ *Contact:* ${rawPhone}
✉️ *Email:* ${settings.notification_email || DEFAULT_SETTINGS.notification_email}

━━━━━━━━━━━━━━━━━━━━━
📊 *FINANCIAL SUMMARY (${period.toUpperCase()})*
• *Gross Revenue:* LKR ${totalRev.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${orders} orders)
• *Cost of Goods (COGS):* LKR ${totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
• *Gross Profit:* LKR ${grossProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${grossMargin.toFixed(1)}%)
• *Operating Expenses:* LKR ${totalExp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
• *NET OPERATING PROFIT:* LKR ${netProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${netMargin.toFixed(1)}%)

━━━━━━━━━━━━━━━━━━━━━
🍴 *CATEGORY BREAKDOWN*
• Food: LKR ${Number(summary.foodIncome || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
• Drinks: LKR ${Number(summary.drinksIncome || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
• Others: LKR ${Number(summary.othersIncome || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
━━━━━━━━━━━━━━━━━━━━━
✅ *Report generated via Mochiato*`;

  const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`;
  const smsUrl = `sms:${cleanPhone}?body=${encodeURIComponent(message)}`;

  await logAudit({
    username: staffUser || 'Admin',
    role: 'Staff',
    action: 'DAY_END_REPORT_SENT',
    category: 'Reports',
    details: `Dispatched ${period} Day-End financial summary to ${recipient} (${rawPhone}) via ${settings.notification_channel || 'WhatsApp'}`,
    metadata: {
      period,
      recipient,
      phone: rawPhone,
      revenue: totalRev,
      cogs: totalCost,
      grossProfit,
      expenses: totalExp,
      netProfit,
      orders
    }
  });

  return {
    success: true,
    settings,
    summary,
    recipient: {
      name: recipient,
      phone: rawPhone,
      cleanPhone,
      channel: settings.notification_channel || 'WhatsApp'
    },
    message,
    whatsappUrl,
    smsUrl
  };
}

async function logAudit({ username = 'System', role = 'System', action, category = 'General', details, metadata = {} }) {
  try {
    const timestamp = new Date().toISOString();
    const metaObj = (metadata && typeof metadata === 'object') ? metadata : {};

    if (!isPgConnected) {
      const dbData = loadFileDb();
      if (!dbData.audit_logs) dbData.audit_logs = [];
      const maxId = dbData.audit_logs.length > 0 ? Math.max(...dbData.audit_logs.map(l => l.id || 0)) : 0;
      const newLog = {
        id: maxId + 1,
        timestamp,
        username: String(username || 'System'),
        role: String(role || 'Staff'),
        action: String(action || 'ACTION'),
        category: String(category || 'General'),
        details: String(details || ''),
        metadata: metaObj
      };
      dbData.audit_logs.unshift(newLog);
      if (dbData.audit_logs.length > 2500) {
        dbData.audit_logs = dbData.audit_logs.slice(0, 2500);
      }
      saveFileDb();
      return newLog;
    }

    const { rows } = await pool.query(
      `INSERT INTO audit_logs (timestamp, username, role, action, category, details, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [timestamp, username, role, action, category, details, JSON.stringify(metaObj)]
    );
    return mapAuditLog(rows[0]);
  } catch (err) {
    console.error('Audit logging error:', err);
    return null;
  }
}

async function getAuditLogs({ category, search, limit = 150, offset = 0, startDate, endDate } = {}) {
  const lim = Math.min(Math.max(1, Number(limit) || 150), 1000);
  const off = Math.max(0, Number(offset) || 0);

  if (!isPgConnected) {
    const dbData = loadFileDb();
    if (!dbData.audit_logs) dbData.audit_logs = [];

    let filtered = [...dbData.audit_logs];

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
    const paged = filtered.slice(off, off + lim).map(mapAuditLog);
    return { logs: paged, totalCount };
  }

  const conditions = [];
  const values = [];
  let i = 1;

  if (category && category !== 'All') {
    conditions.push(`LOWER(category) = LOWER($${i++})`);
    values.push(category);
  }

  if (search && search.trim() !== '') {
    conditions.push(`(LOWER(username) LIKE $${i} OR LOWER(role) LIKE $${i} OR LOWER(action) LIKE $${i} OR LOWER(details) LIKE $${i} OR LOWER(category) LIKE $${i})`);
    values.push(`%${search.trim().toLowerCase()}%`);
    i++;
  }

  if (startDate) {
    conditions.push(`timestamp >= $${i++}`);
    values.push(new Date(startDate).toISOString());
  }

  if (endDate) {
    const endD = new Date(endDate);
    endD.setHours(23, 59, 59, 999);
    conditions.push(`timestamp <= $${i++}`);
    values.push(endD.toISOString());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await pool.query(`SELECT COUNT(*) FROM audit_logs ${whereClause}`, values);
  const totalCount = Number(countRes.rows[0].count);

  values.push(lim);
  const limitIndex = i++;
  values.push(off);
  const offsetIndex = i++;

  const { rows } = await pool.query(
    `SELECT * FROM audit_logs ${whereClause} ORDER BY timestamp DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values
  );

  return { logs: rows.map(mapAuditLog), totalCount };
}

module.exports = {
  initDb,
  login,
  addDish,
  addDishesBulk,
  updateDish,
  deleteDish,
  createOrder,
  syncOfflineOrders,
  getDashboardStats,
  getExpenses,
  addExpense,
  deleteExpense,
  updateEmployee,
  getUsers,
  addUser,
  updateUser,
  deleteUser,
  getSettings,
  updateSettings,
  generateDayEndReport,
  logAudit,
  getAuditLogs
};
