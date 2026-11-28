import { kinds, request } from './shared.js';

const maxImage = 6 * 1024 * 1024;
const stylesheet = new URL('./widget.css', import.meta.url);

class ReportarWidget extends HTMLElement {
  #ui;
  #base;
  #session = 0;
  #drawing;
  #id;

  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <link rel="stylesheet" href="${stylesheet}">
      <button type="button" class="launcher" hidden>Reportar</button>
      <dialog aria-labelledby="reportar-title">
        <form>
          <header>
            <h2 id="reportar-title">Reportar</h2>
            <button type="button" class="quiet" data-close>Fechar</button>
          </header>
          <label>Tipo de relato<select name="kind" required></select></label>
          <label>Descreva o que aconteceu
            <textarea name="message" minlength="3" maxlength="5000" rows="4" required autofocus></textarea>
          </label>
          <details open>
            <summary>Captura de tela <span>(opcional)</span></summary>
            <p class="hint" data-capture-status role="status"></p>
            <canvas aria-label="Captura de tela para marcar o problema" hidden></canvas>
            <div class="controls">
              <button type="button" class="quiet" data-clear hidden>Limpar marcações</button>
              <button type="button" class="quiet" data-remove hidden>Remover captura</button>
              <button type="button" class="quiet" data-attach>Anexar imagem</button>
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden>
            </div>
          </details>
          <label class="check"><input type="checkbox" name="diagnostics"> Incluir tamanho da tela, idioma e versão do sistema</label>
          <p class="result" data-result role="status"></p>
          <footer><button type="submit" class="primary">Enviar relato</button></footer>
        </form>
      </dialog>`;
    const find = (selector) => root.querySelector(selector);
    const form = find('form');
    const dialog = find('dialog');
    const launch = find('.launcher');
    const canvas = find('canvas');
    const file = find('input[type=file]');
    this.#ui = {
      form, dialog, launch, canvas, file, captureStatus: find('[data-capture-status]'),
      result: find('[data-result]'), clear: find('[data-clear]'), remove: find('[data-remove]'),
      submit: find('[type=submit]'),
    };
    for (const [value, label] of Object.entries(kinds)) form.elements.kind.add(new Option(label, value));
    launch.addEventListener('click', () => this.#open());
    find('[data-close]').addEventListener('click', () => dialog.close());
    find('[data-attach]').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      if (file.files[0]) this.#attach(file.files[0]);
      file.value = '';
    });
    this.#ui.clear.addEventListener('click', () => this.#paint(this.#base));
    this.#ui.remove.addEventListener('click', () => {
      this.#session++;
      this.#paint(null);
      this.#ui.captureStatus.textContent = 'O relato será enviado sem imagem.';
    });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      this.#session++;
      this.#drawing = undefined;
      launch.focus();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#send();
    });
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.#drawing) return;
      canvas.setPointerCapture(event.pointerId);
      this.#drawing = { id: event.pointerId, ...this.#point(event) };
    });
    canvas.addEventListener('pointermove', (event) => this.#draw(event));
    canvas.addEventListener('pointerup', (event) => this.#draw(event));
    canvas.addEventListener('lostpointercapture', () => { this.#drawing = undefined; });
    request('status').then(({ enabled }) => { launch.hidden = !enabled; }).catch(() => {});
  }

  #open() {
    const { form, dialog, result, submit, captureStatus } = this.#ui;
    this.#id = crypto.randomUUID();
    form.reset();
    for (const field of [form.elements.kind, form.elements.message, form.elements.diagnostics, this.#ui.file]) {
      field.disabled = false;
    }
    result.textContent = '';
    submit.disabled = submit.hidden = false;
    form.querySelector('details').open = true;
    this.#paint(null);
    const session = ++this.#session;
    const capture = this.getAttribute('capture') !== 'off';
    captureStatus.textContent = capture ? 'Preparando a captura…' : 'Anexe um print se quiser incluir a tela.';
    if (capture) this.#capture(session);
    dialog.showModal();
  }

  async #capture(session) {
    const { captureStatus } = this.#ui;
    const { innerWidth: width, innerHeight: height, scrollX, scrollY } = window;
    let timer;
    try {
      const capture = (async () => {
        const { domToCanvas } = await import('./capture.mjs');
        return domToCanvas(document.documentElement, {
          width, height, scale: Math.min(1, 1600 / Math.max(width, height)),
          style: { transform: `translate(${-scrollX}px, ${-scrollY}px)`, transformOrigin: 'top left' },
          filter: (node) => !(node instanceof Element && node.matches(
            'reportar-widget, [data-reportar-private], input, textarea, select, [contenteditable], iframe, video',
          )),
          timeout: 2500,
        });
      })();
      const bitmap = await Promise.race([capture, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Captura demorou demais')), 4000);
      })]);
      if (session !== this.#session) return;
      this.#paint(bitmap);
      captureStatus.textContent = 'Confira a imagem. Arraste sobre ela para marcar o problema ou remova-a.';
    } catch {
      if (session === this.#session) captureStatus.textContent = 'A captura automática falhou. Você pode anexar um print.';
    } finally {
      clearTimeout(timer);
    }
  }

  async #attach(file) {
    const { captureStatus } = this.#ui;
    if (file.size > maxImage || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      captureStatus.textContent = 'Escolha um JPG, PNG ou WebP de até 6 MiB.';
      return;
    }
    const session = ++this.#session;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      if (session !== this.#session) return;
      const copy = document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      copy.width = Math.max(1, Math.round(bitmap.width * scale));
      copy.height = Math.max(1, Math.round(bitmap.height * scale));
      copy.getContext('2d').drawImage(bitmap, 0, 0, copy.width, copy.height);
      this.#paint(copy);
      captureStatus.textContent = 'Confira a imagem. Arraste sobre ela para marcar o problema ou remova-a.';
    } catch {
      if (session === this.#session) captureStatus.textContent = 'Não foi possível abrir essa imagem.';
    } finally {
      bitmap?.close();
    }
  }

  #paint(base) {
    this.#base = base;
    const { canvas, clear, remove } = this.#ui;
    canvas.hidden = clear.hidden = remove.hidden = !base;
    this.#drawing = undefined;
    if (!base) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    canvas.width = base.width;
    canvas.height = base.height;
    canvas.getContext('2d').drawImage(base, 0, 0);
  }

  #point(event) {
    const { canvas } = this.#ui;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
  }

  #draw(event) {
    if (this.#drawing?.id !== event.pointerId) return;
    const { canvas } = this.#ui;
    const point = this.#point(event);
    const pen = canvas.getContext('2d');
    pen.strokeStyle = '#c52341';
    pen.lineWidth = Math.max(4, canvas.width / 180);
    pen.lineCap = 'round';
    pen.beginPath();
    pen.moveTo(this.#drawing.x, this.#drawing.y);
    pen.lineTo(point.x, point.y);
    pen.stroke();
    this.#drawing = { id: event.pointerId, ...point };
  }

  async #send() {
    const { form, result, submit, canvas, dialog } = this.#ui;
    if (submit.disabled) return;
    const id = this.#id;
    submit.disabled = true;
    result.textContent = 'Enviando…';
    try {
      const body = new FormData();
      body.set('requestId', id);
      body.set('kind', form.elements.kind.value);
      body.set('message', form.elements.message.value);
      body.set('page', this.getAttribute('page') || location.pathname);
      if (form.elements.diagnostics.checked) {
        body.set('context', JSON.stringify({
          width: innerWidth, height: innerHeight, touch: navigator.maxTouchPoints > 0,
          language: navigator.language, version: this.getAttribute('version'),
        }));
      }
      if (this.#base) {
        const image = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        if (!image) throw new Error('A imagem não pôde ser preparada. Remova-a ou tente novamente.');
        body.set('screenshot', image, 'captura.jpg');
      }
      const { number } = await request('reports', { method: 'POST', body });
      if (this.#id !== id || !dialog.open) return;
      this.#session++;
      this.#paint(null);
      result.textContent = `Relato #${number} registrado.`;
      for (const field of [form.elements.kind, form.elements.message, form.elements.diagnostics, this.#ui.file]) {
        field.disabled = true;
      }
      form.querySelector('details').open = false;
      this.#ui.submit.hidden = true;
      form.querySelector('[data-close]').focus();
    } catch (error) {
      if (this.#id !== id || !dialog.open) return;
      result.textContent = error.message;
      submit.disabled = false;
    }
  }
}

if (!customElements.get('reportar-widget')) customElements.define('reportar-widget', ReportarWidget);
