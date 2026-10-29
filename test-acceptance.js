require('dotenv').config();

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const db = require('./database');

const checks = [];
const testOrder = {
  data: null,
  bill: null,
  statsAfterFirstOrder: null
};

async function runCheck(name, check) {
  try {
    await check();
    checks.push({ name, passed: true });
    console.log(`✅ ${name}`);
  } catch (error) {
    checks.push({ name, passed: false });
    console.log(`❌ ${name}: ${error.message}`);
  }
}

async function main() {
  await db.initDb();

  await runCheck('Admin login succeeds', async () => {
    const user = await db.login('admin', 'admin123');
    assert.ok(user, 'Expected db.login to authenticate the admin user');
    assert.equal(user.username.toLowerCase(), 'admin');
  });

  await runCheck('Daily Profit & Loss calculations are accurate', async () => {
    const { summary } = await db.getDashboardStats('today');
    assert.ok(summary, 'Expected dashboard statistics to include a summary');
    assert.equal(
      summary.netProfit,
      summary.grossProfit - summary.totalExpenses,
      'Net profit must equal gross profit minus total expenses'
    );
  });

  await runCheck('Sale reduces dish stock by the ordered quantity', async () => {
    const before = await db.getDashboardStats('today');
    const dish = before.dishes.find(item => Number(item.stock) > 0);
    assert.ok(dish, 'No dish has available stock to test a sale');

    const quantity = 1;
    testOrder.data = {
      client_order_uuid: randomUUID(),
      customer: 'Acceptance Test',
      items: [{
        id: dish.id,
        name: dish.name,
        category: dish.category,
        price: Number(dish.price),
        quantity
      }]
    };

    testOrder.bill = await db.createOrder(testOrder.data);
    testOrder.statsAfterFirstOrder = await db.getDashboardStats('today');
    const updatedDish = testOrder.statsAfterFirstOrder.dishes.find(item => item.id === dish.id);

    assert.ok(testOrder.bill && testOrder.bill.id, 'Expected the sale to return a bill');
    assert.equal(
      Number(updatedDish.stock),
      Number(dish.stock) - quantity,
      'Dish stock should decrease by the ordered quantity'
    );
    assert.equal(
      testOrder.statsAfterFirstOrder.summary.totalOrders,
      before.summary.totalOrders + 1,
      'The first sale should create exactly one bill'
    );
  });

  await runCheck('Duplicate order is idempotent and does not reduce stock twice', async () => {
    assert.ok(testOrder.data && testOrder.bill, 'The stock reduction test must create an order first');

    const beforeDuplicate = await db.getDashboardStats('today');
    const originalDishId = testOrder.data.items[0].id;
    const stockBeforeDuplicate = beforeDuplicate.dishes.find(item => item.id === originalDishId).stock;
    const duplicateBill = await db.createOrder(testOrder.data);
    const afterDuplicate = await db.getDashboardStats('today');
    const stockAfterDuplicate = afterDuplicate.dishes.find(item => item.id === originalDishId).stock;

    assert.equal(duplicateBill.id, testOrder.bill.id, 'Both calls should return the same bill ID');
    assert.equal(
      afterDuplicate.summary.totalOrders,
      beforeDuplicate.summary.totalOrders,
      'The duplicate call should not create another bill'
    );
    assert.equal(
      Number(stockAfterDuplicate),
      Number(stockBeforeDuplicate),
      'The duplicate call should not reduce stock again'
    );
  });

  const failedChecks = checks.filter(check => !check.passed);
  console.log(`\nAcceptance checks: ${checks.length - failedChecks.length}/${checks.length} passed.`);
  if (failedChecks.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`❌ Acceptance test setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}