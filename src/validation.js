import { KINDS, RequestError, STATUSES } from './store.js';

export const MAX_IMAGE = 6 * 1024 * 1024;

export function string(value, label, max, min = 0) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || value.trim().length < min) {
    throw new RequestError(400, `${label} deve ter de ${min} a ${max} caracteres.`);
  }
  return value.trim();
}

export function number(value, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) {
    throw new RequestError(400, 'Número inválido.');
  }
  return Number(value);
}

export function oneOf(value, options, message) {
  if (!options.includes(value)) throw new RequestError(400, message);
  return value;
}

function pagePath(value, origin) {
  const path = string(value, 'A página', 1000, 1);
  try {
    const url = new URL(path, origin);
    if (url.origin === origin) return url.pathname;
  } catch {
    // Endereço inválido recebe a mesma resposta que uma origem externa.
  }
  throw new RequestError(400, 'Informe uma página deste sistema.');
}

function diagnosticContext(raw) {
  if (!raw) return null;
  let input;
  try {
    input = JSON.parse(string(raw, 'O contexto', 4096));
  } catch {
    throw new RequestError(400, 'Contexto técnico inválido.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RequestError(400, 'Contexto técnico inválido.');
  }
  const context = {};
  for (const key of ['width', 'height']) {
    if (Number.isInteger(input[key]) && input[key] >= 0 && input[key] <= 32000) context[key] = input[key];
  }
  if (typeof input.touch === 'boolean') context.touch = input.touch;
  if (typeof input.language === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/i.test(input.language)) {
    context.language = input.language;
  }
  if (typeof input.version === 'string' && /^[a-z0-9._-]{1,48}$/i.test(input.version)) {
    context.version = input.version;
  }
  return Object.keys(context).length ? JSON.stringify(context) : null;
}

function imageType(buffer) {
  if (!buffer) return null;
  if (buffer.length >= 12 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    buffer.toString('ascii', 12, 16) === 'IHDR') return 'image/png';
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff &&
    buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9) return 'image/jpeg';
  if (buffer.length >= 16 && buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16)) &&
    buffer.readUInt32LE(4) + 8 === buffer.length) return 'image/webp';
  throw new RequestError(415, 'Anexe uma imagem JPG, PNG ou WebP válida.');
}

export function createInput(body, file, origin) {
  if (!body) throw new RequestError(400, 'Envie os campos do relato.');
  const capture = file?.buffer ?? null;
  const requestId = string(body.requestId, 'O identificador', 36, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new RequestError(400, 'Use um UUID para o identificador do envio.');
  }
  return {
    requestId: requestId.toLowerCase(),
    kind: oneOf(body.kind, KINDS, 'Escolha o tipo do relato.'),
    message: string(body.message, 'A descrição', 5000, 3),
    page: pagePath(body.page, origin),
    context: diagnosticContext(body.context),
    capture,
    captureType: imageType(capture),
  };
}

export function listInput(query) {
  return {
    status: oneOf(query.status ?? 'ALL', [...STATUSES, 'PENDING', 'ALL'], 'Situação inválida.'),
    before: query.before === undefined ? Number.MAX_SAFE_INTEGER : number(query.before),
    limit: query.limit === undefined ? 30 : number(query.limit, 100),
  };
}

export function updateInput(body, resolve = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError(400, 'Envie os campos da atualização.');
  const devNotes = body.devNotes === undefined ? undefined : string(body.devNotes, 'As notas internas', 10000);
  if (resolve) return { devNotes, response: string(body.response, 'A resposta ao autor', 5000, 3) };
  const status = body.status === undefined
    ? undefined
    : oneOf(body.status, ['OPEN', 'IN_PROGRESS', 'WONT_FIX'], 'Use a ação Resolver para enviar a resposta ao autor.');
  if (!status && devNotes === undefined) throw new RequestError(400, 'Informe a situação ou as notas internas.');
  return { status, devNotes };
}
