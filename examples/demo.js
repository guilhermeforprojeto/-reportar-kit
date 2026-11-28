import express from 'express';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReportarKit } from '../src/index.js';

const port = Number(process.env.DEMO_PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
const mode = process.env.DEMO_DB ?? ':memory:';
if (mode !== ':memory:') mkdirSync(resolve(mode, '..'), { recursive: true });
const mailbox = [];
const users = {
  customer: { id: 'cliente-demo', canReport: true, isAdmin: false, email: 'cliente@example.test' },
  support: { id: 'suporte-demo', canReport: true, isAdmin: true, email: 'suporte@example.test' },
};
const identify = (req) => {
  const role = req.headers.cookie?.match(/(?:^|;\s*)reportar_demo=(customer|support)(?:;|$)/)?.[1];
  return users[role] ?? null;
};
const kit = createReportarKit({
  databasePath: mode, publicOrigin: origin, authenticate: identify,
  getRecipient: (id) => Object.values(users).find((user) => user.id === id)?.email,
  sendMail: async (mail) => { mailbox.push(mail); },
  appName: 'Portal de demonstração', intervalMs: 100,
});

const directory = fileURLToPath(new URL('./', import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (req.get('host') !== `127.0.0.1:${port}`) return res.sendStatus(403);
  next();
});
app.get('/', (_req, res) => res.sendFile('demo.html', { root: directory }));
app.get('/demo.css', (_req, res) => res.sendFile('demo.css', { root: directory }));
app.post('/demo/session', express.urlencoded({ extended: false, limit: '1kb' }), (req, res) => {
  if (req.get('origin') !== origin || !Object.hasOwn(users, req.body?.role)) return res.sendStatus(403);
  res.cookie('reportar_demo', req.body.role, { httpOnly: true, sameSite: 'strict' });
  res.redirect(303, '/');
});
app.get('/demo/mailbox', (req, res) => {
  if (!identify(req)?.isAdmin) return res.sendStatus(403);
  res.set('Cache-Control', 'no-store').json(mailbox);
});
app.use('/reportar', kit.router);

const server = app.listen(port, '127.0.0.1', () => {
  kit.worker.start();
  console.log(`Demonstração local em ${origin}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => kit.close().catch(console.error)));
}
