const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');

function loadApp(config={cloud:{}},skipInit=false) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){} },
      addEventListener(){}, textContent: '', innerHTML: '', value: '',
    });
    return elements.get(id);
  };
  const context = {
    console, Date, Intl, URL, TextEncoder, crypto: webcrypto, setTimeout: () => 0, clearTimeout(){},
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
  context.MI_CARTERA_CONFIG = config;
  vm.createContext(context);
  for (const file of ['version.js', 'core.js', 'analysis.js', 'operations.js', 'market.js', 'app.js']) {
    let source=fs.readFileSync(path.join(root, file), 'utf8');
    if(file==='app.js'&&skipInit)source=source.replace(/\ninit\(\);\s*$/, '\n');
    vm.runInContext(source, context, { filename: file });
  }
  return context;
}
const app = loadApp();
const evalInApp = expression => vm.runInContext(expression, app);

test('la versión y las funciones esenciales cargan con el orden publicado', () => {
  assert.equal(evalInApp('APP_VERSION'), '0.12.0');
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

test('las operaciones se leen por páginas y el límite no devuelve datos truncados', async () => {
  app.__rows = Array.from({length:5}, (_,id)=>({id}));
  evalInApp('rest=async (_path,options)=>{const [a,b]=options.headers.Range.split("-").map(Number);return __rows.slice(a,b+1)}');
  const complete = await evalInApp('selectPaged("operations","order=id.asc",2,10)');
  assert.equal(complete.length, 5);
  await assert.rejects(evalInApp('selectPaged("operations","order=id.asc",2,4)'), /supera el límite/);
});

test('la comprobación detecta una copia alterada y referencias huérfanas', async () => {
  const tables = {
    portfolios:[{id:'p'}], accounts:[{id:'a',portfolio_id:'p'}],
    operations:[{id:'o',account_id:'a'}],transfers:[],recurring_operations:[],
  };
  app.__tables = tables;
  app.__backup = {app:'Mi Cartera',formatVersion:2,schemaVersion:10,ownerId:'u',cloudProject:'project',tables};
  app.__backup.payloadSha256 = await evalInApp('backupDigest(__backup)');
  const checked = await evalInApp('validateBackupPayload(__backup)');
  assert.equal(checked.counts.operations,1);
  tables.operations[0].account_id='desconocida';
  await assert.rejects(evalInApp('validateBackupPayload(__backup)'), /huella SHA-256/);
  const {payloadSha256,...content}=app.__backup;
  app.__content=content;
  app.__backup.payloadSha256=await evalInApp('backupDigest(__content)');
  await assert.rejects(evalInApp('validateBackupPayload(__backup)'), /sin cuenta/);
});

test('la restauración comprueba primero y exige las dos confirmaciones antes de escribir', async () => {
  const target=loadApp({cloud:{url:'https://project.supabase.co',publishableKey:'public'}},true);
  target.__backup={
    app:'Mi Cartera',formatVersion:2,schemaVersion:10,ownerId:'u',cloudProject:'https://project.supabase.co',
    tables:{portfolios:[{id:'p',user_id:'u'}],accounts:[],operations:[],transfers:[],recurring_operations:[]},
  };
  target.__backup.payloadSha256=await vm.runInContext('backupDigest(__backup)',target);
  vm.runInContext('session={user:{id:"u"}}',target);
  target.__calls=[];
  const counts={portfolios:1,accounts:0,operations:0,transfers:0,recurring_operations:0};
  target.__preflight={ready:true,dry_run:true,counts};
  target.__actual={ready:true,dry_run:false,counts};
  vm.runInContext('rest=async (_path,options)=>{const args=JSON.parse(options.body);__calls.push(args.p_dry_run);return args.p_dry_run?__preflight:__actual};syncFromCloud=async()=>true',target);
  const input={files:[{text:async()=>JSON.stringify(target.__backup)}],value:'backup.json'};
  target.confirm=()=>false;
  await target.restoreBackupFile(input);
  assert.deepEqual(target.__calls,[true]);
  target.__calls.length=0;
  target.confirm=()=>true;
  target.prompt=()=> 'RESTAURAR';
  await target.restoreBackupFile(input);
  assert.deepEqual(target.__calls,[true,false]);
});
