import { expect, test } from '@playwright/test';

test('cliente reporta dentro do portal e a equipe responde pelo painel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reportar' })).toBeHidden();
  await page.getByRole('button', { name: 'Entrar como cliente' }).click();
  await page.getByRole('button', { name: 'Reportar' }).click();
  const widget = page.getByRole('dialog', { name: 'Reportar' });
  const canvas = widget.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 7000 });
  await widget.getByLabel('Descreva o que aconteceu').fill('A confirmação do pedido não apareceu.');
  await widget.getByLabel('Incluir tamanho da tela, idioma e versão do sistema').check();
  await widget.getByRole('button', { name: 'Enviar relato' }).click();
  const result = widget.getByText(/Relato #\d+ registrado\./);
  await expect(result).toBeVisible();
  const number = (await result.textContent()).match(/#(\d+)/)[1];
  await widget.getByRole('button', { name: 'Fechar' }).click();
  await page.getByRole('button', { name: 'Reportar' }).click();
  await expect(widget.getByRole('button', { name: 'Enviar relato' })).toBeEnabled();
  await widget.getByRole('button', { name: 'Fechar' }).click();
  await page.getByRole('button', { name: 'Entrar como equipe' }).click();
  await page.getByRole('link', { name: 'Painel de relatos' }).click();
  await page.getByRole('button', { name: new RegExp(`#${number} A confirmação`) }).click();
  const image = page.getByRole('img', { name: 'Captura de tela anexada ao relato' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
  await page.locator('form').getByLabel('Situação').selectOption('DONE');
  await page.getByLabel('Resposta enviada ao autor').fill('Corrigimos a confirmação do pedido.');
  await page.getByLabel('Notas internas').fill('Somente para a equipe.');
  await page.getByRole('button', { name: 'Resolver e enfileirar e-mail' }).click();
  await expect(page.getByText('Relato resolvido. O e-mail está na fila.')).toBeVisible();
  await expect.poll(async () => {
    const response = await page.request.get('/demo/mailbox');
    const messages = await response.json();
    return messages.filter((message) => new RegExp(`#${number} `).test(message.subject));
  }).toEqual([
    expect.objectContaining({ to: 'cliente@example.test', subject: expect.stringMatching(/recebido$/) }),
    expect.objectContaining({ to: 'cliente@example.test', text: expect.stringContaining('Corrigimos a confirmação') }),
  ]);
  await page.getByRole('button', { name: 'Atualizar entregas' }).click();
  await expect(page.getByText('· Aceito pelo servidor de e-mail')).toHaveCount(2);
  const canScrollHorizontally = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(canScrollHorizontally).toBe(false);
});
