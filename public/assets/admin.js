import { endpoint, kinds, request, states } from './shared.js';

const get = (id) => document.getElementById(id);
const queue = get('queue');
const filter = get('filter');
const queueStatus = get('queue-status');
const detailStatus = get('detail-status');
const form = get('edit');
const fields = form.elements;
const save = get('save');
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const labels = {
  PENDING: 'Na fila', SENDING: 'Enviando', RETRY: 'Nova tentativa agendada',
  SENT: 'Aceito pelo servidor de e-mail', FAILED: 'Falha no envio',
};
const errors = {
  RECIPIENT_UNAVAILABLE: 'Endereço confirmado indisponível.',
  DELIVERY_ERROR: 'O serviço de e-mail recusou ou interrompeu o envio.',
  INTERRUPTED: 'O processo foi interrompido durante o envio.',
};

let listRequest, detailRequest, before, current, selected;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function markSelected() {
  for (const row of queue.querySelectorAll('button')) row.setAttribute('aria-current', row.dataset.number === String(selected));
}

async function loadQueue(more = false) {
  listRequest?.abort();
  const controller = listRequest = new AbortController();
  queueStatus.textContent = 'Carregando a fila…';
  get('more').disabled = true;
  try {
    const query = new URLSearchParams({ status: filter.value });
    if (more && before) query.set('before', before);
    const result = await request(`admin/reports?${query}`, { signal: controller.signal });
    if (controller.signal.aborted) return;
    if (!more) queue.replaceChildren();
    for (const report of result.items) {
      const row = node('button', undefined, 'row');
      row.type = 'button';
      row.dataset.number = report.number;
      row.append(node('strong', `#${report.number}`), node('span', report.message),
        node('span', `${kinds[report.kind]} · ${states[report.status]}`, 'muted'));
      row.addEventListener('click', () => openReport(report.number));
      const item = node('li');
      item.append(row);
      queue.append(item);
    }
    before = result.nextBefore;
    get('more').hidden = !before;
    queueStatus.textContent = queue.children.length ? '' : 'Nenhum relato nesta fila.';
    markSelected();
  } catch (error) {
    if (!controller.signal.aborted) queueStatus.textContent = error.message;
  } finally {
    if (!controller.signal.aborted) get('more').disabled = false;
  }
}

function renderMail(report) {
  const list = get('mail');
  list.replaceChildren();
  for (const delivery of report.notifications) {
    const title = delivery.event === 'OPENED' ? 'Abertura' : 'Resolução';
    const item = node('li');
    item.append(node('strong', title), node('span', ` · ${labels[delivery.state]}`));
    if (delivery.sentAt) item.append(node('p', date.format(new Date(delivery.sentAt)), 'muted'));
    if (delivery.error) item.append(node('p', errors[delivery.error], 'muted'));
    if (delivery.state === 'FAILED') {
      const retry = node('button', 'Reenfileirar');
      retry.type = 'button';
      retry.setAttribute('aria-label', `Reenfileirar e-mail de ${title.toLowerCase()}`);
      retry.addEventListener('click', () => changeMail(report.number, delivery.event, retry));
      item.append(retry);
    }
    list.append(item);
  }
}

function showReply() {
  const visible = fields.status.value === 'DONE';
  get('reply-field').hidden = !visible;
  fields.reply.required = visible && current?.status !== 'DONE';
  save.textContent = fields.reply.required ? 'Resolver e enfileirar e-mail' : 'Salvar alterações';
}

function showReport(report) {
  current = report;
  get('detail-heading').textContent = `Relato #${report.number}`;
  get('badge').textContent = states[report.status];
  get('badge').dataset.state = report.status;
  get('meta').textContent = [
    kinds[report.kind], date.format(new Date(report.createdAt)), report.page, `Conta ${report.authorId}`,
  ].join(' · ');
  get('message').textContent = report.message;
  get('figure').hidden = !report.hasCapture;
  const captureLink = get('capture-link');
  captureLink.replaceChildren();
  if (report.hasCapture) {
    const imageUrl = endpoint(`admin/reports/${report.number}/capture`).href;
    const image = document.createElement('img');
    image.alt = 'Captura de tela anexada ao relato';
    image.src = imageUrl;
    captureLink.href = imageUrl;
    captureLink.append(image);
  } else {
    captureLink.removeAttribute('href');
  }
  get('technical').hidden = !report.context;
  get('technical').open = false;
  get('context').textContent = report.context ? JSON.stringify(report.context, null, 2) : '';
  fields.status.value = report.status;
  fields.status.disabled = report.status === 'DONE';
  fields.reply.value = report.response ?? '';
  fields.reply.readOnly = report.status === 'DONE';
  fields.notes.value = report.devNotes;
  save.disabled = false;
  showReply();
  renderMail(report);
  get('export').href = endpoint(`admin/reports/${report.number}/export`).href;
  get('report').hidden = false;
}

async function openReport(number) {
  detailRequest?.abort();
  const controller = detailRequest = new AbortController();
  selected = number;
  markSelected();
  detailStatus.textContent = 'Carregando o relato…';
  get('report').hidden = true;
  try {
    const report = await request(`admin/reports/${number}`, { signal: controller.signal });
    if (controller.signal.aborted) return;
    detailStatus.textContent = '';
    showReport(report);
    get('detail-heading').focus();
  } catch (error) {
    if (!controller.signal.aborted) detailStatus.textContent = error.message;
  }
}

async function changeMail(number, event, button) {
  button.disabled = true;
  try {
    const path = `admin/reports/${number}`;
    const report = event
      ? await request(`${path}/notifications/${event}/retry`, { method: 'POST' })
      : await request(path);
    if (selected !== number) return;
    renderMail(report);
    if (event) get('refresh-mail').focus();
    detailStatus.textContent = event ? 'E-mail reenfileirado.' : 'Entregas atualizadas.';
  } catch (error) {
    if (selected === number) detailStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const { number, status } = current;
  const resolve = fields.status.value === 'DONE' && status !== 'DONE';
  const body = { devNotes: fields.notes.value };
  if (resolve) body.response = fields.reply.value;
  else if (status !== 'DONE') body.status = fields.status.value;
  save.disabled = true;
  try {
    const path = `admin/reports/${number}`;
    const result = await request(resolve ? `${path}/resolve` : path, { method: resolve ? 'POST' : 'PATCH', body });
    if (selected === number) {
      showReport(result);
      detailStatus.textContent = resolve ? 'Relato resolvido. O e-mail está na fila.' : 'Alterações salvas.';
    }
    loadQueue();
  } catch (error) {
    if (selected === number) detailStatus.textContent = error.message;
  } finally {
    if (selected === number) save.disabled = false;
  }
});

fields.status.addEventListener('change', showReply);
get('refresh-mail').addEventListener('click', (event) => changeMail(current.number, null, event.currentTarget));
get('reload').addEventListener('click', () => loadQueue());
get('more').addEventListener('click', () => loadQueue(true));
filter.addEventListener('change', () => loadQueue());
loadQueue();
