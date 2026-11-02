import assert from 'node:assert/strict';
import express from 'express';
import { request as httpRequest } from 'node:http';
import githubRouter from '../server/routes/github.ts';
import { githubSessions, pendingDevices } from '../server/github.ts';

const ORIGINAL_FETCH = globalThis.fetch;
const DEVICE_CODE = 'server-only-device-code';
const ACCESS_TOKEN = 'server-only-access-token';
const REFRESH_TOKEN = 'server-only-refresh-token';
const ACCESS_TOKEN_ROTATED = 'server-only-rotated-access-token';
const REFRESH_TOKEN_ROTATED = 'server-only-rotated-refresh-token';
const ACCESS_TOKEN_AFTER_DISCONNECT = 'must-not-be-stored-after-disconnect';
const REFRESH_TOKEN_AFTER_DISCONNECT = 'must-not-be-stored-after-disconnect-refresh';
const COMMIT_SHA = 'a'.repeat(40);
const TREE_SHA = 'b'.repeat(40);
const BASE_BLOB_SHA = 'c'.repeat(40);
const CHANGED_BLOB_SHA = 'd'.repeat(40);
const NEW_TREE_SHA = 'e'.repeat(40);
const NEW_COMMIT_SHA = 'f'.repeat(40);
const BRANCH = 'codepilot/20261102-0123456789abcdef';
const BASE_CONTENT = '<html><body>base</body></html>';
const mockCalls = [];
let devicePolls = 0;
let refreshCalls = 0;
let conflictMode = false;
let largeRepoMode = false;
let activeSessionId = '';

const repository = {
  id: 17001,
  full_name: 'acme/widget',
  private: true,
  default_branch: 'main',
  html_url: 'https://github.com/acme/widget',
  description: 'Private test project',
  permissions: { pull: true, push: true, admin: false },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function bodyObject(init) {
  if (typeof init.body === 'string') return JSON.parse(init.body);
  return {};
}

async function mockFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method ?? 'GET').toUpperCase();
  const path = `${url.pathname}${url.search}`;
  mockCalls.push({ host: url.hostname, method, path, body: bodyObject(init) });

  if (url.hostname === 'github.com' && url.pathname === '/login/device/code') {
    const form = new URLSearchParams(String(init.body));
    assert.equal(form.get('scope'), 'offline_access');
    return jsonResponse({ device_code: DEVICE_CODE, user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
  }

  if (url.hostname === 'github.com' && url.pathname === '/login/oauth/access_token') {
    const form = new URLSearchParams(String(init.body));
    if (form.get('grant_type') === 'refresh_token') {
      const previousRefreshToken = form.get('refresh_token');
      assert.ok([REFRESH_TOKEN, REFRESH_TOKEN_ROTATED].includes(previousRefreshToken));
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (previousRefreshToken === REFRESH_TOKEN) return jsonResponse({ access_token: ACCESS_TOKEN_ROTATED, refresh_token: REFRESH_TOKEN_ROTATED, expires_in: 28_800, refresh_token_expires_in: 2_592_000 });
      return jsonResponse({ access_token: ACCESS_TOKEN_AFTER_DISCONNECT, refresh_token: REFRESH_TOKEN_AFTER_DISCONNECT, expires_in: 28_800, refresh_token_expires_in: 2_592_000 });
    }
    assert.equal(form.get('device_code'), DEVICE_CODE);
    devicePolls += 1;
    if (devicePolls === 1) return jsonResponse({ error: 'authorization_pending' });
    return jsonResponse({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, expires_in: 28_800, refresh_token_expires_in: 2_592_000 });
  }

  if (url.hostname !== 'api.github.com') throw new Error(`Unexpected mocked host: ${url.hostname}`);
  const authorization = new Headers(init.headers).get('authorization');
  assert.ok(authorization?.startsWith('Bearer '), `GitHub API request missing server-side bearer token: ${path}`);

  if (path === '/user') return jsonResponse({ login: 'octo-test' });
  if (url.pathname === '/user/repos') {
    if (largeRepoMode) {
      const page = Number(url.searchParams.get('page') ?? 1);
      return jsonResponse(Array.from({ length: 100 }, (_, index) => {
        const id = (page - 1) * 100 + index + 1;
        return { id, full_name: `acme/repo-${id}`, private: true, default_branch: 'main', html_url: `https://github.com/acme/repo-${id}`, permissions: { pull: true, push: true } };
      }));
    }
    return jsonResponse([{
      id: repository.id,
      full_name: repository.full_name,
      private: repository.private,
      default_branch: repository.default_branch,
      html_url: repository.html_url,
      description: repository.description,
      permissions: repository.permissions,
    }]);
  }
  if (url.pathname === '/repos/acme/widget') return jsonResponse(repository);
  if (url.pathname === '/repos/acme/widget/git/ref/heads/main') return jsonResponse({ object: { sha: COMMIT_SHA, type: 'commit' } });
  if (url.pathname.startsWith('/repos/acme/widget/git/ref/heads/codepilot/')) return jsonResponse({ message: 'Not Found' }, 404);
  if (url.pathname === `/repos/acme/widget/git/commits/${COMMIT_SHA}`) return jsonResponse({ tree: { sha: TREE_SHA }, committer: { date: '2026-11-02T12:00:00Z' } });
  if (url.pathname === `/repos/acme/widget/git/trees/${TREE_SHA}`) {
    const sha = conflictMode ? CHANGED_BLOB_SHA : BASE_BLOB_SHA;
    return jsonResponse({ truncated: false, tree: [{ path: 'index.html', type: 'blob', mode: '100644', sha, size: Buffer.byteLength(BASE_CONTENT) }] });
  }
  if (url.pathname === `/repos/acme/widget/git/blobs/${BASE_BLOB_SHA}`) {
    return jsonResponse({ encoding: 'base64', content: Buffer.from(BASE_CONTENT, 'utf8').toString('base64') });
  }
  if (url.pathname === '/repos/acme/widget/git/trees' && method === 'POST') return jsonResponse({ sha: NEW_TREE_SHA });
  if (url.pathname === '/repos/acme/widget/git/commits' && method === 'POST') return jsonResponse({ sha: NEW_COMMIT_SHA });
  if (url.pathname === '/repos/acme/widget/git/refs' && method === 'POST') {
    assert.equal(bodyObject(init).ref, `refs/heads/${BRANCH}`);
    return jsonResponse({ ref: `refs/heads/${BRANCH}`, object: { sha: NEW_COMMIT_SHA } }, 201);
  }

  throw new Error(`Unexpected mocked GitHub request: ${method} ${path}`);
}

function request(port, method, path, body, sessionId) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const headers = {};
    if (payload) headers['Content-Type'] = 'application/json';
    if (sessionId) headers.Authorization = `Bearer ${sessionId}`;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const request = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        let parsed = {};
        try { parsed = text ? JSON.parse(text) : {}; } catch { /* preserve empty parsed body */ }
        resolve({ status: response.statusCode ?? 0, body: parsed });
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

const app = express();
app.use('/api/github/push', express.json({ limit: '4mb' }));
app.use(express.json({ limit: '128kb' }));
app.post('/api/github/body-limit-check', (_request, response) => response.status(200).json({ ok: true }));
app.use('/api/github', githubRouter);
app.use((error, _request, response, _next) => {
  if (error?.status === 413) return response.status(413).json({ error: 'Payload too large.' });
  return response.status(500).json({ error: 'Unexpected test-server error.' });
});
const server = app.listen(0, '127.0.0.1');

try {
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = server.address().port;
  globalThis.fetch = mockFetch;

  const largePayload = { padding: 'x'.repeat(200_000) };
  const largePushBody = await request(port, 'POST', '/api/github/push', largePayload);
  assert.equal(largePushBody.status, 401, 'the push-only 4 MB parser should accept larger payloads before authentication');
  const largeGeneralBody = await request(port, 'POST', '/api/github/body-limit-check', largePayload);
  assert.equal(largeGeneralBody.status, 413, 'the general parser should retain its 128 KB limit');

  const started = await request(port, 'POST', '/api/github/device/start', { clientId: 'Iv1.mock-client-id' });
  assert.equal(started.status, 200);
  assert.equal(started.body.userCode, 'ABCD-1234');
  assert.ok(started.body.transactionId);
  assert.ok(!JSON.stringify(started.body).includes(DEVICE_CODE), 'device code must never reach the browser');

  pendingDevices.get(started.body.transactionId).nextPollAt = 0;
  const pending = await request(port, 'POST', '/api/github/device/poll', { transactionId: started.body.transactionId });
  assert.equal(pending.status, 202);
  assert.equal(pending.body.status, 'pending');

  pendingDevices.get(started.body.transactionId).nextPollAt = 0;
  const authorized = await request(port, 'POST', '/api/github/device/poll', { transactionId: started.body.transactionId });
  assert.equal(authorized.status, 200);
  assert.equal(authorized.body.status, 'authorized');
  assert.equal(authorized.body.login, 'octo-test');
  activeSessionId = authorized.body.sessionId;
  assert.ok(activeSessionId);
  const authJson = JSON.stringify(authorized.body);
  for (const token of [ACCESS_TOKEN, REFRESH_TOKEN, DEVICE_CODE]) assert.ok(!authJson.includes(token), 'GitHub tokens and device codes must stay server-side');

  const session = githubSessions.get(activeSessionId);
  assert.ok(session);
  session.accessExpiresAt = Date.now() - 1;
  const [renewed, repositoriesDuringRefresh] = await Promise.all([
    request(port, 'GET', '/api/github/session', undefined, activeSessionId),
    request(port, 'GET', '/api/github/repositories', undefined, activeSessionId),
  ]);
  assert.equal(renewed.status, 200);
  assert.equal(repositoriesDuringRefresh.status, 200);
  assert.equal(refreshCalls, 1, 'overlapping API calls must share a single rotating refresh token request');
  assert.ok(!JSON.stringify(renewed.body).includes(ACCESS_TOKEN_ROTATED));
  assert.equal(githubSessions.get(activeSessionId).accessToken, ACCESS_TOKEN_ROTATED, 'server should rotate tokens in memory');

  const repositoryList = await request(port, 'GET', '/api/github/repositories', undefined, activeSessionId);
  assert.equal(repositoryList.status, 200);
  assert.equal(repositoryList.body.repositories[0].fullName, 'acme/widget');
  assert.equal(repositoryList.body.repositories[0].canPush, true);
  assert.equal(repositoryList.body.truncated, false);

  largeRepoMode = true;
  const largeRepositoryList = await request(port, 'GET', '/api/github/repositories', undefined, activeSessionId);
  largeRepoMode = false;
  assert.equal(largeRepositoryList.status, 200);
  assert.equal(largeRepositoryList.body.repositories.length, 1_000);
  assert.equal(largeRepositoryList.body.truncated, true, 'a capped repository list must disclose omitted results');

  const imported = await request(port, 'POST', '/api/github/import', { fullName: 'acme/widget' }, activeSessionId);
  assert.equal(imported.status, 200);
  assert.equal(imported.body.source, 'https://github.com/acme/widget');
  assert.equal(imported.body.remote.private, true);
  assert.equal(imported.body.remote.baselineShas['index.html'], BASE_BLOB_SHA);
  assert.equal(imported.body.files[0].content, BASE_CONTENT);

  const pushBody = {
    owner: 'acme', repo: 'widget', sourceBranch: 'main', baseCommitSha: COMMIT_SHA, baseTreeSha: TREE_SHA,
    branchName: BRANCH, commitMessage: 'Update landing page',
    changes: [{ path: 'index.html', content: '<html><body>updated</body></html>', baseSha: BASE_BLOB_SHA }],
  };
  conflictMode = true;
  const writesBeforeConflict = mockCalls.filter((call) => call.host === 'api.github.com' && call.method === 'POST').length;
  const conflict = await request(port, 'POST', '/api/github/push', pushBody, activeSessionId);
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body.conflicts, ['index.html']);
  const writesAfterConflict = mockCalls.filter((call) => call.host === 'api.github.com' && call.method === 'POST').length;
  assert.equal(writesAfterConflict, writesBeforeConflict, 'conflicts must stop before Git writes');

  const unsafe = await request(port, 'POST', '/api/github/push', { ...pushBody, changes: [{ path: '.env.local', content: 'SECRET=x', baseSha: null }] }, activeSessionId);
  assert.equal(unsafe.status, 400, 'credential-like paths must be rejected');

  conflictMode = false;
  const pushed = await request(port, 'POST', '/api/github/push', pushBody, activeSessionId);
  assert.equal(pushed.status, 201);
  assert.equal(pushed.body.branch, BRANCH);
  assert.equal(pushed.body.commitSha, NEW_COMMIT_SHA);
  assert.equal(pushed.body.treeSha, NEW_TREE_SHA);
  assert.equal(pushed.body.files[0], 'index.html');
  const createdRef = mockCalls.find((call) => call.host === 'api.github.com' && call.method === 'POST' && call.path === '/repos/acme/widget/git/refs');
  assert.equal(createdRef.body.ref, `refs/heads/${BRANCH}`);
  assert.ok(!mockCalls.some((call) => call.host === 'api.github.com' && ['PUT', 'PATCH'].includes(call.method)), 'no existing branch is updated or force-pushed');

  githubSessions.get(activeSessionId).accessExpiresAt = Date.now() - 1;
  const refreshDuringDisconnect = request(port, 'GET', '/api/github/session', undefined, activeSessionId);
  for (let attempt = 0; attempt < 50 && refreshCalls < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(refreshCalls, 2, 'disconnect race test must start a token refresh');
  const disconnected = await request(port, 'DELETE', '/api/github/session', undefined, activeSessionId);
  assert.equal(disconnected.status, 200);
  const disconnectedRefresh = await refreshDuringDisconnect;
  assert.equal(disconnectedRefresh.status, 401);
  assert.ok(!githubSessions.has(activeSessionId), 'an in-flight refresh must not restore a disconnected session');

  console.log('GitHub mock smoke passed: device flow, token privacy/rotation and concurrency, scoped body limits, private import/truncation, conflict stop, secret-path rejection, exact new-branch push, and disconnect race.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  globalThis.fetch = ORIGINAL_FETCH;
  if (activeSessionId) githubSessions.delete(activeSessionId);
  for (const id of pendingDevices.keys()) pendingDevices.delete(id);
  await new Promise((resolve) => server.close(resolve));
}
