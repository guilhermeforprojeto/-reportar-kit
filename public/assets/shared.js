export const kinds = {
  BUG: 'Erro', AJUSTE: 'Ajuste', IDEIA: 'Ideia', DUVIDA: 'Dúvida', CONTEUDO_INDEVIDO: 'Conteúdo indevido',
};
export const states = { OPEN: 'Aberto', IN_PROGRESS: 'Em andamento', DONE: 'Resolvido', WONT_FIX: 'Arquivado' };

export const endpoint = (path) => new URL(`../api/${path}`, import.meta.url);

export async function request(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-Reportar-Request'] = '1';
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(endpoint(path), { method, headers, body, signal, credentials: 'same-origin' });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Não foi possível concluir. Tente novamente.');
  return result;
}
