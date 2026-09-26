const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('la página carga los scripts en el orden requerido y la PWA los incluye', () => {
  const html = read('index.html');
  const worker = read('sw.js');
  const scripts = ['version.js', 'config.js', 'core.js', 'analysis.js', 'operations.js', 'market.js', 'app.js'];
  let previous = -1;
  for (const script of scripts) {
    const index = html.indexOf(`<script src="${script}"></script>`);
    assert.ok(index > previous, `${script} falta o está fuera de orden`);
    assert.ok(worker.includes(`'./${script}'`), `${script} falta en la caché PWA`);
    previous = index;
  }
  assert.equal(JSON.parse(read('version.json')).appVersion, '0.12.0');
  assert.ok(read('supabase/functions/resolve-fund/index.ts').includes('from "./providers.ts"'));
  assert.ok(fs.existsSync(path.join(root, 'supabase/functions/resolve-fund/providers.ts')));
  assert.ok(read('016_restore_user_backup_v0.12.0.sql').includes('create or replace function public.restore_user_backup_v1'));
  assert.ok(html.includes('id="restoreBackupBtn"'));
});
