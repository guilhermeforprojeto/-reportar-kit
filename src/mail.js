import nodemailer from 'nodemailer';

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(value);
}

export function createSmtpSender({
  host, port = 587, secure = false, user, pass, from, allowInsecure = false,
} = {}) {
  if (!host || !isEmail(from) || Boolean(user) !== Boolean(pass) ||
    !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('SMTP requer host, porta válida, endereço remetente e, quando exigido, usuário e senha.');
  }
  const transport = nodemailer.createTransport({
    host, port, secure, requireTLS: !secure && !allowInsecure,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return async (message) => {
    const info = await transport.sendMail({ ...message, from });
    if (!info.accepted?.length) throw new Error('SMTP não aceitou o destinatário.');
  };
}

export function createMailWorker({ store, getRecipient, sendMail, appName, messageIdDomain, intervalMs, onError }) {
  let timer;
  let running;

  async function deliver(job) {
    let error = null;
    try {
      const to = await getRecipient(job.authorId);
      if (!isEmail(to)) {
        error = 'RECIPIENT_UNAVAILABLE';
      } else {
        const opened = job.event === 'OPENED';
        await sendMail({
          to,
          messageId: `<reportar-${job.id}@${messageIdDomain}>`,
          subject: `[${appName}] Relato #${job.number} ${opened ? 'recebido' : 'resolvido'}`,
          text: opened
            ? `Olá! Recebemos seu relato #${job.number}. Nossa equipe vai analisá-lo e você receberá um e-mail quando ele for resolvido.\n\nEquipe ${appName}`
            : `Olá! Seu relato #${job.number} foi resolvido.\n\nResposta da equipe:\n${job.response}\n\nEquipe ${appName}`,
        });
      }
    } catch {
      error = 'DELIVERY_ERROR';
    }
    store.finish(job, { now: Date.now(), error, retryDelay: 60_000 * 2 ** (job.attempts - 1) });
  }

  async function drain() {
    for (let count = 0; count < 25; count++) {
      const job = store.claim(Date.now(), 5 * 60_000);
      if (!job) break;
      await deliver(job);
    }
  }

  function runOnce() {
    running ??= drain().finally(() => { running = undefined; });
    return running;
  }

  return {
    runOnce,
    start() {
      if (timer) return;
      const run = () => { runOnce().catch(onError); };
      timer = setInterval(run, intervalMs);
      timer.unref();
      run();
    },
    async stop() {
      clearInterval(timer);
      timer = undefined;
      await running;
    },
  };
}
