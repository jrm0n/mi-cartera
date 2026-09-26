const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function loadApp() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){} },
      addEventListener(){}, textContent: '', innerHTML: '', value: '',
    });
    return elements.get(id);
  };
  const context = {
    console, Date, Intl, URL, setTimeout: () => 0, clearTimeout(){},
    localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
    navigator: {},
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      documentElement: { dataset: {} },
    },
    addEventListener(){},
  };
  context.window = context;
  context.MI_CARTERA_CONFIG = { cloud: {} };
  vm.createContext(context);
  for (const file of ['version.js', 'core.js', 'analysis.js', 'operations.js', 'market.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}
const app = loadApp();
const evalInApp = expression => vm.runInContext(expression, app);

test('la versión y las funciones esenciales cargan con el orden publicado', () => {
  assert.equal(evalInApp('APP_VERSION'), '0.11.0');
  assert.equal(typeof app.exportBackup, 'function');
  assert.equal(typeof app.retryRefreshTarget, 'function');
});

test('XIRR: ganancia anual conocida y flujos sin solución', () => {
  const positive = evalInApp("xirrPercent([{date:'2024-01-01',amount:-100},{date:'2025-01-01',amount:110}])");
  assert.ok(Math.abs(positive - 9.97) < 0.1, positive);
  assert.equal(evalInApp("xirrPercent([{date:'2024-01-01',amount:-100},{date:'2025-01-01',amount:-110}])"), null);
});

test('la conciliación separa aportaciones y resultado', () => {
  assert.equal(evalInApp('performanceConsistencyDifference({opening:100,purchases:50,sales:20,pnl:10,closing:140})'), 0);
  assert.equal(evalInApp('performanceNetFlows({purchases:50,sales:20})'), 30);
  assert.equal(evalInApp('performancePatrimonialDifference({opening:100,closing:140})'), 40);
});

test('una cotización histórica insuficiente queda como N/D', () => {
  const result = evalInApp("returnBetween([{nav_date:'2025-01-01',nav:100}], '2024-01-01', 110, '2025-01-01')");
  assert.equal(result.value, null);
});
