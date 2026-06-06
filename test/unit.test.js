'use strict';

/**
 * Unit tests for secenv-cli.
 * Uses Node.js built-in test runner (no dependencies).
 *
 * Run: node --test test/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Set up isolated HOME before requiring the lib
const SANDBOX = path.join(os.tmpdir(), 'secenv-test-' + Date.now());
fs.mkdirSync(SANDBOX, { recursive: true });
process.env.USERPROFILE = SANDBOX;
process.env.HOME = SANDBOX;

const {
  parseEnvFile,
  loadSecrets,
  saveSecrets,
  resolveEnv,
  addSecret,
  rotateSharedSecret,
  writeEnvFile,
  paths,
} = require('../lib');

test.after(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

// ── parseEnvFile ──────────────────────────────

test('parseEnvFile: returns empty object for missing file', () => {
  const result = parseEnvFile(path.join(SANDBOX, 'nope.env'));
  assert.deepEqual(result, {});
});

test('parseEnvFile: parses basic keys', () => {
  const f = path.join(SANDBOX, '.env.example');
  fs.writeFileSync(
    f,
    'FOO=bar\nBAZ=qux\n# comment\n\nKEY2=value2\n'
  );
  const result = parseEnvFile(f);
  assert.equal(result.FOO, 'bar');
  assert.equal(result.BAZ, 'qux');
  assert.equal(result.KEY2, 'value2');
});

test('parseEnvFile: strips quotes', () => {
  const f = path.join(SANDBOX, '.env.example');
  fs.writeFileSync(
    f,
    'A="double"\nB=\'single\'\nC=unquoted\n'
  );
  const result = parseEnvFile(f);
  assert.equal(result.A, 'double');
  assert.equal(result.B, 'single');
  assert.equal(result.C, 'unquoted');
});

test('parseEnvFile: handles keys without values (schema-only)', () => {
  const f = path.join(SANDBOX, '.env.example');
  fs.writeFileSync(f, 'KEY1=\nKEY2=value\nKEY3\n');
  const result = parseEnvFile(f);
  assert.equal(result.KEY1, '');
  assert.equal(result.KEY2, 'value');
  assert.equal(result.KEY3, '');
});

test('parseEnvFile: handles CRLF line endings', () => {
  const f = path.join(SANDBOX, '.env.example');
  fs.writeFileSync(f, 'A=1\r\nB=2\r\n');
  const result = parseEnvFile(f);
  assert.equal(result.A, '1');
  assert.equal(result.B, '2');
});

test('parseEnvFile: handles values with = signs', () => {
  const f = path.join(SANDBOX, '.env.example');
  fs.writeFileSync(f, 'URL=postgres://user:pass@host/db?opt=1\n');
  const result = parseEnvFile(f);
  assert.equal(result.URL, 'postgres://user:pass@host/db?opt=1');
});

// ── loadSecrets / saveSecrets ─────────────────

test('loadSecrets: returns empty structure for missing file', () => {
  // After setup, secrets file doesn't exist yet
  fs.rmSync(paths.SECRETS_FILE, { force: true });
  const cfg = loadSecrets();
  assert.deepEqual(cfg.shared, {});
  assert.deepEqual(cfg.projects, {});
});

test('saveSecrets + loadSecrets: round-trip', () => {
  const cfg = {
    shared: { OPENAI: 'sk-x' },
    projects: { foo: { K: 'shared.OPENAI' } },
  };
  saveSecrets(cfg);
  const loaded = loadSecrets();
  assert.equal(loaded.shared.OPENAI, 'sk-x');
  assert.equal(loaded.projects.foo.K, 'shared.OPENAI');
});

test('loadSecrets: throws on invalid JSON', () => {
  fs.writeFileSync(paths.SECRETS_FILE, '{ invalid json');
  assert.throws(() => loadSecrets(), /Failed to parse/);
});

test('loadSecrets: tolerates missing keys', () => {
  fs.writeFileSync(paths.SECRETS_FILE, JSON.stringify({
    shared: { A: '1' },
  }));
  const cfg = loadSecrets();
  assert.deepEqual(cfg.projects, {});
  assert.equal(cfg.shared.A, '1');
});

// ── resolveEnv ────────────────────────────────

test('resolveEnv: resolves direct project values', () => {
  const cfg = {
    shared: {},
    projects: { myapp: { API: 'direct-value' } },
  };
  const { resolved, missing, missingShared } = resolveEnv(
    { API: '' }, 'myapp', cfg
  );
  assert.equal(resolved.API, 'direct-value');
  assert.equal(missing.length, 0);
  assert.equal(missingShared.length, 0);
});

test('resolveEnv: resolves shared references', () => {
  const cfg = {
    shared: { KEY: 'shared-value' },
    projects: { myapp: { API: 'shared.KEY' } },
  };
  const { resolved, missing, missingShared } = resolveEnv(
    { API: '' }, 'myapp', cfg
  );
  assert.equal(resolved.API, 'shared-value');
  assert.equal(missing.length, 0);
});

test('resolveEnv: detects missing project values', () => {
  const cfg = { shared: {}, projects: { myapp: {} } };
  const { resolved, missing, missingShared } = resolveEnv(
    { API: '', DB: '' }, 'myapp', cfg
  );
  assert.equal(missing.length, 2);
  assert.ok(missing.includes('API'));
  assert.ok(missing.includes('DB'));
});

test('resolveEnv: detects missing shared references', () => {
  const cfg = {
    shared: {},
    projects: { myapp: { API: 'shared.MISSING' } },
  };
  const { resolved, missing, missingShared } = resolveEnv(
    { API: '' }, 'myapp', cfg
  );
  assert.equal(missingShared.length, 1);
  assert.equal(missingShared[0], 'MISSING');
  assert.equal(resolved.API, undefined);
});

test('resolveEnv: handles missing project', () => {
  const cfg = { shared: {}, projects: {} };
  const { missing } = resolveEnv(
    { API: '' }, 'nonexistent', cfg
  );
  assert.equal(missing.length, 1);
  assert.equal(missing[0], 'API');
});

test('resolveEnv: mixed direct and shared', () => {
  const cfg = {
    shared: { KEY: 'sh' },
    projects: {
      myapp: {
        A: 'direct',
        B: 'shared.KEY',
        C: 'shared.MISSING',
      },
    },
  };
  const { resolved, missing, missingShared } = resolveEnv(
    { A: '', B: '', C: '' }, 'myapp', cfg
  );
  assert.equal(resolved.A, 'direct');
  assert.equal(resolved.B, 'sh');
  assert.equal(missingShared[0], 'MISSING');
  assert.equal(missing.length, 0);
});

// ── addSecret ─────────────────────────────────

test('addSecret: creates new project', () => {
  const cfg = { shared: {}, projects: {} };
  addSecret(cfg, 'newapp', 'KEY', 'val');
  assert.equal(cfg.projects.newapp.KEY, 'val');
});

test('addSecret: updates existing project', () => {
  const cfg = {
    shared: {},
    projects: { myapp: { A: '1' } },
  };
  addSecret(cfg, 'myapp', 'B', '2');
  assert.equal(cfg.projects.myapp.A, '1');
  assert.equal(cfg.projects.myapp.B, '2');
});

test('addSecret: can store shared reference', () => {
  const cfg = { shared: {}, projects: {} };
  addSecret(cfg, 'myapp', 'API', 'shared.OPENAI');
  assert.equal(cfg.projects.myapp.API, 'shared.OPENAI');
});

// ── rotateSharedSecret ────────────────────────

test('rotateSharedSecret: updates value and reports affected', () => {
  const cfg = {
    shared: { KEY: 'old' },
    projects: {
      app1: { A: 'shared.KEY' },
      app2: { B: 'shared.KEY' },
      app3: { C: 'shared.OTHER' },
    },
  };
  const result = rotateSharedSecret(cfg, 'KEY', 'new');
  assert.equal(result.shared.KEY, 'new');
  assert.equal(result.affected.length, 2);
  assert.ok(result.affected.includes('app1'));
  assert.ok(result.affected.includes('app2'));
  assert.ok(!result.affected.includes('app3'));
});

test('rotateSharedSecret: handles no projects referencing', () => {
  const cfg = {
    shared: { KEY: 'old' },
    projects: { app1: { A: 'other' } },
  };
  const result = rotateSharedSecret(cfg, 'KEY', 'new');
  assert.equal(result.affected.length, 0);
});

test('rotateSharedSecret: handles missing project', () => {
  const cfg = { shared: {}, projects: {} };
  const result = rotateSharedSecret(cfg, 'NEW', 'val');
  assert.equal(result.shared.NEW, 'val');
  assert.equal(result.affected.length, 0);
});

// ── writeEnvFile ──────────────────────────────

test('writeEnvFile: writes to cwd by default', () => {
  const cwd = process.cwd();
  const target = path.join(SANDBOX, 'proj1');
  fs.mkdirSync(target);
  process.chdir(target);
  try {
    const f = writeEnvFile({ A: '1', B: '2' });
    const content = fs.readFileSync(f, 'utf-8');
    assert.ok(content.includes('A=1'));
    assert.ok(content.includes('B=2'));
    assert.ok(content.includes('Generated by secenv'));
  } finally {
    process.chdir(cwd);
  }
});

test('writeEnvFile: writes to specified dir', () => {
  const target = path.join(SANDBOX, 'proj2');
  fs.mkdirSync(target);
  const f = writeEnvFile({ X: 'y' }, target);
  assert.equal(f, path.join(target, '.env'));
  assert.ok(fs.existsSync(f));
});

test('writeEnvFile: quotes values with special chars', () => {
  const target = path.join(SANDBOX, 'proj3');
  fs.mkdirSync(target);
  const f = writeEnvFile(
    { SPECIAL: 'has space and "quote"' },
    target
  );
  const content = fs.readFileSync(f, 'utf-8');
  assert.ok(
    content.includes('SPECIAL="has space and \\"quote\\""'),
    'should quote value with space and double-quote'
  );
});

test('writeEnvFile: quotes values with shell metachars', () => {
  const target = path.join(SANDBOX, 'proj3a');
  fs.mkdirSync(target);
  const f = writeEnvFile(
    { DOLLAR: 'has $var' },
    target
  );
  const content = fs.readFileSync(f, 'utf-8');
  assert.ok(
    content.includes('DOLLAR="has $var"'),
    'should quote value with dollar sign'
  );
});

test('writeEnvFile: does not quote safe URL values', () => {
  const target = path.join(SANDBOX, 'proj3b');
  fs.mkdirSync(target);
  const f = writeEnvFile(
    { URL: 'postgres://user:pass@host/db' },
    target
  );
  const content = fs.readFileSync(f, 'utf-8');
  assert.ok(
    content.includes('URL=postgres://user:pass@host/db\n'),
    'URLs do not need quoting'
  );
});

test('writeEnvFile: quotes empty values', () => {
  const target = path.join(SANDBOX, 'proj4');
  fs.mkdirSync(target);
  const f = writeEnvFile({ EMPTY: '' }, target);
  const content = fs.readFileSync(f, 'utf-8');
  assert.ok(content.includes('EMPTY=""'));
});

test('writeEnvFile: includes header', () => {
  const target = path.join(SANDBOX, 'proj5');
  fs.mkdirSync(target);
  const f = writeEnvFile({ K: 'v' }, target);
  const content = fs.readFileSync(f, 'utf-8');
  assert.ok(content.startsWith('# Generated by secenv'));
  assert.ok(content.includes('Last updated:'));
});
