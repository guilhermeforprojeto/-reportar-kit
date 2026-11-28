# Reportar Kit

Componente para instalar em plataformas web existentes. A plataforma hospedeira fornece a sessão, as permissões e o e-mail confirmado de cada conta. O kit acrescenta o botão **Reportar**, a fila administrativa e os e-mails de abertura e resolução no mesmo domínio.

- Usuários autorizados enviam relatos numerados, com categoria, descrição e captura opcional. Podem anexar um print ou marcar na captura onde está o problema.
- A equipe organiza a fila, guarda notas internas, consulta a captura privada, exporta o relato em JSON e envia uma resposta ao resolver.
- A fila de e-mails persiste no banco. A equipe vê quando o SMTP aceitou a mensagem, quando há nova tentativa e quando o envio precisa ser reenfileirado.
- O frontend é um Web Component. Funciona com HTML, Angular, React, Vue ou outro frontend web. A referência de backend é um roteador Express para Node.js 24.15 ou superior.

## Instalar na plataforma

Use um clone com acesso ao GitHub e instale a versão marcada na aplicação. O acesso SSH, inclusive em CI, deve ter permissão de leitura deste repositório.

```sh
npm install 'git+ssh://git@github.com/guilhermeforprojeto/reportar-kit.git#v1.0.0'
```

Também é possível empacotar o clone com `npm ci && npm pack` e instalar o `.tgz` no projeto hospedeiro.

### 1. Conectar à sessão e ao envio de e-mail

Registre o middleware de sessão existente antes do kit. Adapte `accounts` e `req.session` aos serviços da sua aplicação. O mesmo usuário precisa ter um identificador estável em ambos os adaptadores.

```js
import { createReportarKit } from 'reportar-kit';

const reportar = createReportarKit({
  databasePath: process.env.REPORTAR_DB,
  publicOrigin: process.env.REPORTAR_ORIGIN, // Exemplo https://portal.example.test
  appName: 'Portal',
  async authenticate(req) {
    const user = await accounts.findActiveById(req.session?.userId);
    if (!user) return null;
    return {
      id: String(user.id),
      canReport: user.permissions.includes('report:create'),
      isAdmin: user.permissions.includes('report:manage'),
    };
  },
  async getRecipient(id) {
    const user = await accounts.findActiveById(id);
    return user?.emailVerified ? user.email : null;
  },
  smtp: {
    host: process.env.REPORTAR_SMTP_HOST,
    port: Number(process.env.REPORTAR_SMTP_PORT ?? 587),
    secure: process.env.REPORTAR_SMTP_SECURE === 'true',
    user: process.env.REPORTAR_SMTP_USER || undefined,
    pass: process.env.REPORTAR_SMTP_PASS || undefined,
    from: process.env.REPORTAR_SMTP_FROM,
  },
});

app.use('/reportar', reportar.router);
reportar.worker.start();
// No encerramento, pare de aceitar requisições e aguarde reportar.close().
```

Se a plataforma já tem um provedor de e-mail, troque `smtp` pelo adaptador `sendMail({ to, subject, text, messageId })`. A função assíncrona deve lançar erro se o provedor não aceitar a mensagem. Encaminhe o `messageId` para preservar o identificador nas novas tentativas.

Use um arquivo SQLite em diretório privado e persistente. Crie o diretório antes de montar o kit. Consulte o guia para [Express, NestJS e outros backends](docs/integracao.md).

### 2. Inserir o botão e o painel

No layout autenticado, insira o componente e carregue o módulo uma vez.

```html
<script type="module" src="/reportar/assets/widget.js"></script>
<reportar-widget page="/pedidos/:id" version="2026.11"></reportar-widget>
```

Em uma SPA, atualize `page` com o padrão da rota ao navegar, ou omita o atributo se o caminho atual puder ser armazenado sem dados pessoais. Use `capture="off"` para áreas sensíveis e `data-reportar-private` para excluir regiões da captura automática. O autor pode remover a captura antes do envio. Personalize o botão pelas variáveis CSS `--reportar-accent`, `--reportar-bottom` e `--reportar-z-index`.

Inclua no menu de suporte da plataforma um link para **`/reportar/admin`**. O roteador protege o painel, os dados e as capturas pela permissão administrativa. Se mudar o prefixo, atualize o endereço do módulo e o link do menu.

### 3. Validar com contas de teste

1. Abra um relato com uma conta autorizada e confirme a chegada do e-mail de recebimento.
2. Com uma conta administrativa, confira a captura e selecione **Resolvido**. Escreva a resposta e use **Resolver e enfileirar e-mail**.
3. Confira os dois envios em **E-mails ao autor** e valide que uma conta comum não abre a fila nem a captura.

## Demonstração e testes

```sh
npm ci
npm test
npm run demo
```

Abra `http://127.0.0.1:4173`. Entre como cliente de teste, abra um relato, troque para equipe e resolva. A caixa da demonstração recebe as mensagens em memória. O servidor de demonstração aceita conexões apenas do loopback, usa dados fictícios e fica fora do pacote instalado.

Para a suíte de navegador em CI, rode `npx playwright install chromium` e `npm run test:browser`.

- [Guia de integração e operação](docs/integracao.md)
- [Contrato HTTP](docs/api.md)
- [Instruções para integração assistida por IA](AGENTS.md)
- [Modelo de configuração](.env.example)
