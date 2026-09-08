'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadEnvironment } = require('../env-config.js');

function fixture(t, { relative = false, commonName = '.git' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const primary = path.join(root, 'primary checkout');
  const worktree = path.join(root, 'copilot worktree');
  const commonDir = path.join(primary, commonName);
  const gitDir = path.join(commonDir, 'worktrees', 'session');
  fs.mkdirSync(gitDir, { recursive: true });
  fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(worktree, '.git'),
    `gitdir: ${relative ? path.relative(worktree, gitDir) : gitDir}\r\n`);
  fs.writeFileSync(path.join(gitDir, 'commondir'),
    `${relative ? path.relative(gitDir, commonDir) : commonDir}\r\n`);
  return { primary, worktree, gitDir };
}

test('environment loader reuses the primary checkout file across linked worktrees', t => {
  const { primary, worktree } = fixture(t);
  const sharedFile = path.join(primary, '.env');
  fs.writeFileSync(sharedFile, 'AZURE_CLIENT_ID=sample-client\nAZURE_TENANT_ID=sample-tenant\n');
  const env = {};
  assert.equal(loadEnvironment({ cwd: worktree, env }), sharedFile);
  assert.deepEqual(env, { AZURE_CLIENT_ID: 'sample-client', AZURE_TENANT_ID: 'sample-tenant' });
});

test('environment loader resolves relative Git metadata and paths with spaces', t => {
  const { primary, worktree } = fixture(t, { relative: true });
  const sharedFile = path.join(primary, '.env');
  fs.writeFileSync(sharedFile, 'AZURE_TENANT_ID="sample tenant"\n');
  const env = {};
  assert.equal(loadEnvironment({ cwd: worktree, env }), sharedFile);
  assert.equal(env.AZURE_TENANT_ID, 'sample tenant');
});

test('environment loader keeps process variables ahead of shared values', t => {
  const { primary, worktree } = fixture(t);
  fs.writeFileSync(path.join(primary, '.env'), 'HOST=0.0.0.0\nPORT=3000\n');
  const env = { HOST: '127.0.0.1', PORT: '3014' };
  loadEnvironment({ cwd: worktree, env });
  assert.deepEqual(env, { HOST: '127.0.0.1', PORT: '3014' });
});

test('environment loader selects the local file without mixing shared tenant credentials', t => {
  const { primary, worktree } = fixture(t);
  fs.writeFileSync(path.join(primary, '.env'),
    'AZURE_TENANT_ID=shared-tenant\nAZURE_CLIENT_ID=shared-client\n');
  const localFile = path.join(worktree, '.env');
  fs.writeFileSync(localFile, 'AZURE_TENANT_ID=local-tenant\nPORT=3000\n');
  const env = { PORT: '3014' };
  assert.equal(loadEnvironment({ cwd: worktree, env }), localFile);
  assert.deepEqual(env, { AZURE_TENANT_ID: 'local-tenant', PORT: '3014' });
});

test('environment loader treats an empty local file as an opt-out of shared credentials', t => {
  const { primary, worktree } = fixture(t);
  fs.writeFileSync(path.join(primary, '.env'), 'AZURE_TENANT_ID=shared-tenant\n');
  const localFile = path.join(worktree, '.env');
  fs.writeFileSync(localFile, '');
  const env = {};
  assert.equal(loadEnvironment({ cwd: worktree, env }), localFile);
  assert.deepEqual(env, {});
});

test('environment loader preserves normal checkout and non-Git local file loading', t => {
  const { primary, worktree } = fixture(t);
  for (const cwd of [primary, worktree]) {
    const envPath = path.join(cwd, '.env');
    fs.writeFileSync(envPath, 'AZURE_TENANT_ID=local-tenant\n');
    if (cwd === worktree) fs.unlinkSync(path.join(cwd, '.git'));
    const env = {};
    assert.equal(loadEnvironment({ cwd, env }), envPath);
    assert.equal(env.AZURE_TENANT_ID, 'local-tenant');
  }
});

test('environment loader allows missing configuration in worktrees, normal checkouts and deployment folders', t => {
  const { primary, worktree } = fixture(t);
  const deployment = path.join(primary, 'deployment');
  fs.mkdirSync(deployment);
  for (const cwd of [worktree, primary, deployment]) {
    const env = { HOST: '127.0.0.1' };
    assert.equal(loadEnvironment({ cwd, env }), null);
    assert.deepEqual(env, { HOST: '127.0.0.1' });
  }
});

test('environment loader does not search arbitrary parent folders for credentials', t => {
  const { primary } = fixture(t);
  fs.writeFileSync(path.join(primary, '.env'), 'AZURE_TENANT_ID=unrelated-tenant\n');
  const child = path.join(primary, 'unrelated-project');
  fs.mkdirSync(child);
  const env = {};
  assert.equal(loadEnvironment({ cwd: child, env }), null);
  assert.deepEqual(env, {});
});

test('environment loader does not inherit configuration from a bare repository or submodule', t => {
  const { primary, worktree, gitDir } = fixture(t, { commonName: 'repository.git' });
  fs.writeFileSync(path.join(primary, '.env'), 'AZURE_TENANT_ID=unrelated-tenant\n');
  const env = {};
  assert.equal(loadEnvironment({ cwd: worktree, env }), null);
  fs.unlinkSync(path.join(gitDir, 'commondir'));
  assert.equal(loadEnvironment({ cwd: worktree, env }), null);
  assert.deepEqual(env, {});
});

test('environment loader surfaces invalid Git metadata', t => {
  const { worktree, gitDir } = fixture(t);
  fs.writeFileSync(path.join(gitDir, 'commondir'), '\n');
  assert.throws(() => loadEnvironment({ cwd: worktree, env: {} }), /Invalid Git common directory/);
  fs.writeFileSync(path.join(worktree, '.git'), 'invalid metadata');
  assert.throws(() => loadEnvironment({ cwd: worktree, env: {} }), /Invalid Git worktree metadata/);
});

test('environment loader surfaces unreadable configuration instead of silently falling back', t => {
  const { primary, worktree } = fixture(t);
  fs.mkdirSync(path.join(primary, '.env'));
  assert.throws(() => loadEnvironment({ cwd: worktree, env: {} }));
  fs.mkdirSync(path.join(worktree, '.env'));
  assert.throws(() => loadEnvironment({ cwd: worktree, env: {} }));
});
