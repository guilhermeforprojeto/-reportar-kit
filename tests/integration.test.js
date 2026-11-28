import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import express from 'express';
import { SMTPServer } from 'smtp-server';
import { createReportarKit, createSmtpSender } from '../src/index.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf2sAAAAASUVORK5CYII=', 'base64');
const users = {
  alice: { id: 'author-a', canReport: true, isAdmin: false },
  bob: { id: 'author-b', canReport: true, isAdmin: false },
  disabled: { id: 'blocked', canReport: false, isAdmin: false },
  admin: { id: 'support', canReport: false, isAdmin: true },
};

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'reportar-test-'));
  const databasePath = join(directory, 'reports.sqlite');
  const mail = [];
  const db = () => new DatabaseSync(databasePath);
  const app = express();
  const listening = app.listen(0, '127.0.0.1');
  await once(listening, 'listening');
  const origin = `http://127.0.0.1:${listening.address().port}`;
  const mount = '/support/tools/reportar';
  const kitOptions = {
    databasePath, publicOrigin: origin,
    authenticate: (req) => Object.hasOwn(users, req.get('x-test-user')) ? users[req.get('x-test-user')] : null,
    getRecipient: (id) => `${id}@example.test`,
    sendMail: async (item) => { mail.push(item); },
    appName: 'Plataforma de teste', onError: (error) => assert.fail(error),
    ...options,
  };
  const kit = createReportarKit(kitOptions);
  app.use(mount, kit.router);
  t.after(async () => {
    await new Promise((resolve) => listening.close(resolve));
    await kit.close();
    await rm(directory, { recursive: true, force: true });
  });
  function api(path, { user = 'alice', method = 'GET', body, write = true } = {}) {
    const headers = { 'x-test-user': user };
    if (write && method !== 'GET') {
      headers.origin = origin;
      headers['x-reportar-request'] = '1';
    }
    if (body && !(body instanceof FormData)) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(body);
    }
    return fetch(origin + mount + path, { method, headers, body });
  }
  function forceReady() {
    const connection = db();
    try { connection.exec("UPDATE mail SET available_at = 0 WHERE state IN ('RETRY', 'SENDING')"); }
    finally { connection.close(); }
  }
  return { api, kit, kitOptions, mail, forceReady, db };
}

function form(overrides = {}, image = png) {
  const body = new FormData();
  const fields = {
    requestId: randomUUID(), kind: 'BUG', message: 'O botão não confirma o pedido.',
    page: '/pedidos?token=simulado#segredo-simulado',
    context: JSON.stringify({ width: 390, touch: true, language: 'pt-BR', password: 'IGNORAR' }),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  if (image) body.set('screenshot', new Blob([image], { type: 'image/png' }), 'teste.png');
  return body;
}

async function create(api, body = form()) {
  const res = await api('/api/reports', { method: 'POST', body });
  assert.equal(res.status, 201);
  return (await res.json()).number;
}

const asAdmin = { user: 'admin' };
const view = (number = 1) => `/api/admin/reports/${number}`;

test('abertura, captura privada, resolução concorrente e duas notificações persistentes', async (t) => {
  const { api, kit, kitOptions, mail } = await fixture(t);
  const body = form();
  const number = await create(api, body);
  const duplicate = await api('/api/reports', { method: 'POST', body });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { number });
  const publicReport = await (await api(`/api/reports/${number}`)).json();
  assert.equal(publicReport.page, '/pedidos');
  assert.equal(publicReport.devNotes, undefined);
  assert.equal(publicReport.context, undefined);
  assert.equal((await api(`/api/reports/${number}`, { user: 'bob' })).status, 404);
  assert.equal((await api(`${view(number)}/capture`)).status, 403);
  const capture = await api(`${view(number)}/capture`, asAdmin);
  assert.equal(capture.headers.get('content-type'), 'image/png');
  assert.equal(capture.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await capture.arrayBuffer()), png);
  const exported = await api(`${view(number)}/export`, asAdmin);
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  const detail = await exported.json();
  assert.deepEqual(detail.context, { width: 390, touch: true, language: 'pt-BR' });
  assert.equal(detail.notifications[0].state, 'PENDING');
  assert.equal((await api(view(), { ...asAdmin, method: 'PATCH', body: { status: 'DONE' } })).status, 400);
  await api(view(), { ...asAdmin, method: 'PATCH', body: { status: 'IN_PROGRESS', devNotes: 'Somente equipe' } });
  const update = { ...asAdmin, method: 'POST', body: { response: 'Corrigimos a confirmação do pedido.' } };
  const resolved = await Promise.all([api(`${view()}/resolve`, update), api(`${view()}/resolve`, update)]);
  for (const res of resolved) {
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'DONE');
  }
  assert.equal((await api(`${view()}/resolve`, { ...update, body: { response: 'Uma resposta diferente.' } })).status, 409);
  const reopened = createReportarKit(kitOptions);
  try {
    await Promise.all([kit.worker.runOnce(), reopened.worker.runOnce()]);
  } finally {
    await reopened.close();
  }
  assert.equal(mail.length, 2);
  for (const message of mail) {
    assert.equal(message.to, 'author-a@example.test');
    assert.doesNotMatch(message.text, /Somente equipe|token|captura|botão não confirma/i);
  }
  assert.match(mail[0].subject, /recebido$/);
  assert.match(mail[1].subject, /resolvido$/);
  assert.match(mail[1].text, /Corrigimos a confirmação/);
  assert.equal(new Set(mail.map((item) => item.messageId)).size, 2);
  const sent = (await (await api(view(), asAdmin)).json()).notifications;
  assert.deepEqual(sent.map((item) => item.state), ['SENT', 'SENT']);
  assert.deepEqual(sent.map((item) => item.attempts), [1, 1]);
});

test('sessão, permissão, origem, validação, paginação e limite por autor', async (t) => {
  const { api } = await fixture(t);
  assert.equal((await api('/api/status', { user: 'no-session' })).status, 401);
  assert.equal((await api('/admin')).status, 403);
  assert.equal((await api('/admin', asAdmin)).status, 200);
  assert.equal((await api('/assets/widget.js', { user: 'no-session' })).status, 200);
  assert.equal((await api('/assets/admin.css', { user: 'no-session' })).status, 200);
  assert.equal((await api('/assets/capture.mjs', { user: 'no-session' })).status, 200);
  assert.equal((await api('/api/reports', { user: 'disabled', method: 'POST', body: form() })).status, 403);
  assert.equal((await api('/api/reports', { method: 'POST', body: form(), write: false })).status, 403);
  assert.equal((await api('/api/reports', { method: 'POST', body: form({ page: 'https://externo.example.test' }) })).status, 400);
  assert.equal((await api('/api/reports', { method: 'POST', body: form({}, Buffer.from('texto')) })).status, 415);
  assert.equal((await api('/api/reports', { method: 'POST', body: form({}, Buffer.alloc(6 * 1024 * 1024 + 1)) })).status, 413);
  for (let i = 0; i < 10; i++) await create(api, form({}, null));
  assert.equal((await api('/api/reports', { method: 'POST', body: form({}, null) })).status, 429);
  assert.equal((await api('/api/reports', { user: 'bob', method: 'POST', body: form({}, null) })).status, 201);
  const first = await (await api('/api/reports?limit=2')).json();
  assert.deepEqual(first.items.map((item) => item.number), [10, 9]);
  const second = await (await api(`/api/reports?limit=2&before=${first.nextBefore}`)).json();
  assert.deepEqual(second.items.map((item) => item.number), [8, 7]);
  assert.equal((await api('/api/reports?limit=101')).status, 400);
});

test('SMTP temporariamente indisponível, falha final e reenvio com o destinatário atual', async (t) => {
  const delivered = [];
  let recipient = 'antigo@example.test';
  let unavailable = true;
  const { api, kit, forceReady } = await fixture(t, {
    getRecipient: () => recipient,
    sendMail: async (message) => {
      delivered.push(message);
      if (unavailable) throw new Error('mensagem sensível do provedor');
    },
  });
  await create(api);
  for (let attempt = 0; attempt < 6; attempt++) {
    await kit.worker.runOnce();
    forceReady();
  }
  const failed = (await (await api(view(), asAdmin)).json()).notifications[0];
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.error, 'DELIVERY_ERROR');
  assert.equal(failed.attempts, 6);
  recipient = 'atual@example.test';
  unavailable = false;
  const retry = `${view()}/notifications/OPENED/retry`;
  assert.equal((await api(retry, { ...asAdmin, method: 'POST' })).status, 200);
  assert.equal((await api(retry, { ...asAdmin, method: 'POST' })).status, 409);
  await kit.worker.runOnce();
  assert.equal(delivered.at(-1).to, 'atual@example.test');
  assert.equal(delivered.at(-1).messageId, delivered[0].messageId);
  assert.equal((await (await api(view(), asAdmin)).json()).notifications[0].state, 'SENT');
});

test('transporta os dois e-mails por SMTP em um servidor local descartável', async (t) => {
  const messages = [];
  const smtp = new SMTPServer({
    authOptional: true, disabledCommands: ['STARTTLS', 'AUTH'],
    onData(stream, session, callback) {
      let raw = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => { raw += chunk; });
      stream.once('error', callback);
      stream.once('end', () => {
        messages.push({ raw, to: session.envelope.rcptTo[0].address });
        callback();
      });
    },
  });
  await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => smtp.close(resolve)));
  const sendMail = createSmtpSender({
    host: '127.0.0.1', port: smtp.server.address().port, from: 'suporte@example.test', allowInsecure: true,
  });
  const { api, kit } = await fixture(t, { sendMail, appName: 'Portal teste' });
  const number = await create(api);
  await api(`${view(number)}/resolve`, { ...asAdmin, method: 'POST', body: { response: 'Alteracao concluida.' } });
  await kit.worker.runOnce();
  assert.equal(messages.length, 2);
  assert.ok(messages.every((message) => message.to === 'author-a@example.test'));
  assert.match(messages[0].raw, /Subject: \[Portal teste\] Relato #1 recebido/);
  assert.match(messages[1].raw, /Alteracao concluida\./);
});
