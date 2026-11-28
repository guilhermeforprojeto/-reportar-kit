import express from 'express';
import multer from 'multer';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMailWorker, createSmtpSender } from './mail.js';
import { openStore, RequestError } from './store.js';
import { createInput, listInput, MAX_IMAGE, number, oneOf, string, updateInput } from './validation.js';

export { createSmtpSender };

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const assetsDir = fileURLToPath(new URL('../public/assets/', import.meta.url));
const require = createRequire(import.meta.url);
const captureDir = dirname(require.resolve('modern-screenshot'));
const publicAssets = ['widget.js', 'widget.css', 'shared.js', 'admin.js', 'admin.css'];

export function createReportarKit({
  databasePath, publicOrigin, authenticate, getRecipient, sendMail, smtp,
  appName = 'Suporte', intervalMs = 3000, onError = () => console.error('[reportar-kit] Falha interna.'),
} = {}) {
  if (typeof databasePath !== 'string' || !databasePath ||
    typeof authenticate !== 'function' || typeof getRecipient !== 'function' ||
    (sendMail !== undefined && typeof sendMail !== 'function') || typeof onError !== 'function' ||
    !Number.isInteger(intervalMs) || intervalMs < 100) {
    throw new TypeError('Informe databasePath, authenticate e getRecipient. Verifique as opções do worker.');
  }
  const origin = new URL(publicOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== publicOrigin) {
    throw new TypeError('publicOrigin deve conter protocolo e domínio, com porta se necessário.');
  }
  appName = string(appName, 'O nome do sistema', 80, 1);
  if (/[\r\n]/.test(appName)) throw new TypeError('O nome do sistema deve ter apenas uma linha.');
  const mailer = sendMail ?? createSmtpSender(smtp);
  const store = openStore(databasePath);
  const worker = createMailWorker({
    store, getRecipient, sendMail: mailer, appName, messageIdDomain: origin.hostname, intervalMs, onError,
  });
  const router = express.Router({ strict: true });
  const json = express.json({ limit: '32kb' });
  const upload = multer({
    limits: { files: 1, fields: 5, parts: 7, fileSize: MAX_IMAGE, fieldSize: 6000,
      fieldNameSize: 32, fieldNestingDepth: 0, fieldArrayIndexLimit: 0 },
  }).single('screenshot');
  let uploads = 0;

  router.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  for (const name of publicAssets) {
    router.get(`/assets/${name}`, (_req, res) => res.sendFile(name, { root: assetsDir }));
  }
  router.get('/assets/capture.mjs', (_req, res) => {
    res.type('application/javascript').sendFile('index.mjs', { root: captureDir });
  });

  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Cross-Origin-Resource-Policy', 'same-origin');
    const actor = await authenticate(req);
    if (!actor || typeof actor.id !== 'string' || !actor.id.trim() || actor.id.length > 200) {
      throw new RequestError(401, 'Entre no sistema para acessar os relatos.');
    }
    res.locals.actor = actor;
    next();
  });
  router.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) &&
      (req.get('origin') !== origin.origin || req.get('x-reportar-request') !== '1')) {
      throw new RequestError(403, 'Origem da solicitação recusada.');
    }
    next();
  });
  const admin = (_req, res, next) => {
    if (res.locals.actor.isAdmin !== true) throw new RequestError(403, 'Acesso restrito à equipe.');
    next();
  };

  router.get('/api/status', (_req, res) => {
    const actor = res.locals.actor;
    res.json({ enabled: actor.canReport === true, admin: actor.isAdmin === true });
  });

  router.post('/api/reports', (req, res, next) => {
    if (res.locals.actor.canReport !== true) throw new RequestError(403, 'Sua conta não pode enviar relatos.');
    if (!req.is('multipart/form-data')) throw new RequestError(415, 'Use multipart/form-data.');
    if (uploads >= 8) throw new RequestError(503, 'Há muitos envios simultâneos. Tente novamente.');
    uploads++;
    res.once('close', () => uploads--);
    next();
  }, upload, (req, res) => {
    const result = store.create(res.locals.actor.id, createInput(req.body, req.file, origin.origin));
    res.status(result.created ? 201 : 200).json({ number: result.number });
  });
  router.get('/api/reports', (req, res) => {
    res.json(store.list({ ...listInput(req.query), author: res.locals.actor.id }));
  });
  router.get('/api/reports/:number', (req, res) => {
    res.json(store.detail(number(req.params.number), { author: res.locals.actor.id }));
  });

  router.get('/admin', admin, (_req, res) => {
    res.set('Content-Security-Policy', [
      "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'",
      "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
    ].join('; '));
    res.sendFile('admin.html', { root: publicDir });
  });
  router.use('/api/admin', admin);
  router.get('/api/admin/reports', (req, res) => res.json(store.list(listInput(req.query))));
  router.get('/api/admin/reports/:number', (req, res) => {
    res.json(store.detail(number(req.params.number), { admin: true }));
  });
  router.get('/api/admin/reports/:number/export', (req, res) => {
    const report = store.detail(number(req.params.number), { admin: true });
    res.attachment(`relato-${report.number}.json`).json(report);
  });
  router.get('/api/admin/reports/:number/capture', (req, res) => {
    const file = store.capture(number(req.params.number));
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
    res.set('Content-Disposition', `inline; filename="captura-${req.params.number}.${extension}"`);
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.type(file.type).send(Buffer.from(file.capture));
  });
  router.patch('/api/admin/reports/:number', json, (req, res) => {
    res.json(store.update(number(req.params.number), updateInput(req.body)));
  });
  router.post('/api/admin/reports/:number/resolve', json, (req, res) => {
    res.json(store.resolve(number(req.params.number), updateInput(req.body, true)));
  });
  router.post('/api/admin/reports/:number/notifications/:event/retry', (req, res) => {
    const event = oneOf(req.params.event, ['OPENED', 'RESOLVED'], 'Tipo de e-mail inválido.');
    res.json(store.retry(number(req.params.number), event));
  });

  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof RequestError) return res.status(error.status).json({ error: error.message });
    if (error instanceof multer.MulterError) {
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Envio inválido. Use uma imagem de até 6 MiB.' });
    }
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      return res.status(error.status).json({ error: 'JSON inválido ou acima do tamanho permitido.' });
    }
    if (error.message === 'Unexpected end of form' || error.message === 'Multipart: Boundary not found') {
      return res.status(400).json({ error: 'Formulário incompleto.' });
    }
    onError(error);
    res.status(500).json({ error: 'Não foi possível processar o relato agora.' });
  });

  let closed = false;
  return {
    router,
    worker,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await worker.stop();
      } finally {
        store.close();
      }
    },
  };
}
