import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'WONT_FIX'];
export const KINDS = ['BUG', 'AJUSTE', 'IDEIA', 'DUVIDA', 'CONTEUDO_INDEVIDO'];
export const MAX_ATTEMPTS = 6;

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const columns = `number, author_id AS authorId, kind, message, page, context,
  capture_type IS NOT NULL AS hasCapture, status, dev_notes AS devNotes,
  response, created_at AS createdAt, updated_at AS updatedAt`;

export function openStore(filename) {
  const db = new DatabaseSync(filename);
  let schemaVersion;
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
    if (schemaVersion > 1) throw new Error('Versão do banco incompatível com este kit.');
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS reports (
        number INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('BUG','AJUSTE','IDEIA','DUVIDA','CONTEUDO_INDEVIDO')),
        message TEXT NOT NULL,
        page TEXT NOT NULL,
        context TEXT,
        capture BLOB,
        capture_type TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','DONE','WONT_FIX')),
        dev_notes TEXT NOT NULL DEFAULT '',
        response TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (author_id, request_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS reports_status_number ON reports(status, number DESC);
      CREATE INDEX IF NOT EXISTS reports_author_number ON reports(author_id, number DESC);
      CREATE TABLE IF NOT EXISTS mail (
        id TEXT PRIMARY KEY,
        report_number INTEGER NOT NULL REFERENCES reports(number) ON DELETE CASCADE,
        event TEXT NOT NULL CHECK (event IN ('OPENED','RESOLVED')),
        state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','SENDING','RETRY','SENT','FAILED')),
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at INTEGER NOT NULL,
        lease TEXT,
        sent_at TEXT,
        error TEXT,
        UNIQUE (report_number, event)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS mail_ready ON mail(state, available_at);
      PRAGMA user_version = 1;
      COMMIT;
    `);
  } catch (error) {
    db.close();
    throw error;
  }

  const read = db.prepare(`SELECT ${columns} FROM reports WHERE number = ?`);
  const enqueue = db.prepare('INSERT INTO mail (id, report_number, event, available_at) VALUES (?, ?, ?, ?)');
  const insert = db.prepare(`
    INSERT INTO reports (author_id, request_id, kind, message, page, context, capture, capture_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING number
  `);

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function format(row, admin) {
    if (!row) return null;
    const { context, hasCapture, devNotes, authorId, ...report } = row;
    if (!admin) return report;
    const notifications = db.prepare(`
      SELECT event, state, attempts, sent_at AS sentAt, error
      FROM mail WHERE report_number = ? ORDER BY rowid
    `).all(report.number);
    return {
      ...report, context: context ? JSON.parse(context) : null,
      hasCapture: Boolean(hasCapture), devNotes, authorId, notifications,
    };
  }

  return {
    create(author, input) {
      return transaction(() => {
        const existing = db.prepare('SELECT number FROM reports WHERE author_id = ? AND request_id = ?')
          .get(author, input.requestId);
        if (existing) return { number: existing.number, created: false };
        const recent = db.prepare(`
          SELECT count(*) AS total FROM (
            SELECT created_at FROM reports WHERE author_id = ? ORDER BY number DESC LIMIT 10
          ) WHERE created_at >= ?
        `).get(author, new Date(Date.now() - 60_000).toISOString());
        if (recent.total >= 10) throw new RequestError(429, 'Limite de relatos atingido. Aguarde um minuto.');
        const now = new Date().toISOString();
        const { requestId, kind, message, page, context, capture, captureType } = input;
        const row = insert.get(author, requestId, kind, message, page, context, capture, captureType, now, now);
        enqueue.run(randomUUID(), row.number, 'OPENED', Date.now());
        return { number: row.number, created: true };
      });
    },
    list({ author, status, before, limit }) {
      const clauses = ['number < ?'];
      const values = [before];
      if (author) {
        clauses.push('author_id = ?');
        values.push(author);
      }
      if (status === 'PENDING') clauses.push("status IN ('OPEN', 'IN_PROGRESS')");
      else if (status !== 'ALL') {
        clauses.push('status = ?');
        values.push(status);
      }
      const rows = db.prepare(`
        SELECT number, kind, message, status, created_at AS createdAt, updated_at AS updatedAt
        FROM reports WHERE ${clauses.join(' AND ')} ORDER BY number DESC LIMIT ?
      `).all(...values, limit + 1);
      for (const row of rows) row.message = row.message.slice(0, 240);
      const items = rows.slice(0, limit);
      return { items, nextBefore: rows.length > limit ? items.at(-1).number : null };
    },
    detail(number, { admin = false, author } = {}) {
      const row = read.get(number);
      if (!row || (!admin && row.authorId !== author)) throw new RequestError(404, 'Relato não encontrado.');
      return format(row, admin);
    },
    capture(number) {
      const row = db.prepare('SELECT capture, capture_type AS type FROM reports WHERE number = ?').get(number);
      if (!row?.capture) throw new RequestError(404, 'Captura não encontrada.');
      return row;
    },
    update(number, { status, devNotes }) {
      return transaction(() => {
        const row = read.get(number);
        if (!row) throw new RequestError(404, 'Relato não encontrado.');
        if (row.status === 'DONE' && status && status !== 'DONE') {
          throw new RequestError(409, 'O relato já foi resolvido.');
        }
        db.prepare('UPDATE reports SET status = ?, dev_notes = ?, updated_at = ? WHERE number = ?')
          .run(status ?? row.status, devNotes ?? row.devNotes, new Date().toISOString(), number);
        return format(read.get(number), true);
      });
    },
    resolve(number, { response, devNotes }) {
      return transaction(() => {
        const row = read.get(number);
        if (!row) throw new RequestError(404, 'Relato não encontrado.');
        if (row.status === 'DONE') {
          if (row.response === response && (devNotes === undefined || devNotes === row.devNotes)) return format(row, true);
          throw new RequestError(409, 'O relato já foi resolvido. Consulte o histórico de e-mails.');
        }
        db.prepare("UPDATE reports SET status = 'DONE', response = ?, dev_notes = ?, updated_at = ? WHERE number = ?")
          .run(response, devNotes ?? row.devNotes, new Date().toISOString(), number);
        enqueue.run(randomUUID(), number, 'RESOLVED', Date.now());
        return format(read.get(number), true);
      });
    },
    retry(number, event) {
      const result = db.prepare(`
        UPDATE mail SET state = 'PENDING', attempts = 0, available_at = ?, lease = NULL, error = NULL
        WHERE report_number = ? AND event = ? AND state = 'FAILED'
      `).run(Date.now(), number, event);
      if (!result.changes) throw new RequestError(409, 'Somente e-mails com falha final podem ser reenfileirados.');
      return this.detail(number, { admin: true });
    },
    claim(now, leaseMs) {
      return transaction(() => {
        db.prepare(`
          UPDATE mail SET state = 'FAILED', lease = NULL, error = 'INTERRUPTED'
          WHERE state = 'SENDING' AND available_at <= ? AND attempts >= ?
        `).run(now, MAX_ATTEMPTS);
        const job = db.prepare(`
          UPDATE mail SET state = 'SENDING', attempts = attempts + 1, available_at = ?, lease = ?
          WHERE rowid = (
            SELECT m.rowid FROM mail m
            WHERE m.state IN ('PENDING', 'RETRY', 'SENDING') AND m.available_at <= ?
              AND NOT EXISTS (
                SELECT 1 FROM mail first
                WHERE m.event = 'RESOLVED' AND first.report_number = m.report_number
                  AND first.event = 'OPENED' AND first.state IN ('PENDING','RETRY','SENDING')
              )
            ORDER BY m.available_at, m.rowid LIMIT 1
          )
          RETURNING id, report_number AS number, event, attempts, lease
        `).get(now + leaseMs, randomUUID(), now);
        if (!job) return null;
        const { authorId, response } = read.get(job.number);
        return { ...job, authorId, response };
      });
    },
    finish(job, { now, error, retryDelay }) {
      const state = error ? (job.attempts >= MAX_ATTEMPTS ? 'FAILED' : 'RETRY') : 'SENT';
      db.prepare(`
        UPDATE mail SET state = ?, available_at = ?, sent_at = ?, error = ?, lease = NULL
        WHERE id = ? AND lease = ? AND state = 'SENDING'
      `).run(state, now + retryDelay, error ? null : new Date(now).toISOString(), error, job.id, job.lease);
    },
    close: () => db.close(),
  };
}
