# Integração e operação

## Onde montar

Aplicações Express podem montar `reportar.router` diretamente após os middlewares da sessão. Em NestJS com adaptador Express, use `app.use('/reportar', reportar.router)` depois de preparar a sessão no Express e antes do fallback. Guards do Nest pertencem às rotas do Nest. Implemente `authenticate(req)` com o mesmo serviço que verifica as credenciais no host.

Em outro backend, o ingress da aplicação pode encaminhar o prefixo escolhido para um processo Node interno. Preserve o prefixo, a origem e o cookie da aplicação quando o adaptador precisar lê-lo. O adaptador consulta a sessão existente por um canal autenticado no servidor ou verifica sua assinatura. Proteja o processo interno da rede pública. Os identificadores e permissões vêm do resultado dessa verificação.

O kit usa cookies de mesma origem quando a plataforma os disponibiliza. Em plataformas com login somente via bearer token no JavaScript, implemente uma sessão HTTP de integração, emitida pelo servidor após validar o token e guardada em cookie `HttpOnly`, `Secure` e `SameSite`. Isso permite autenticar a navegação para o painel e a abertura da captura. Vincule expiração e encerramento à sessão hospedeira.

Se o host usa CSP, permita carregar o módulo e o CSS da própria origem. A captura de DOM pode precisar de `data:` e `blob:` permitidos para imagens. Use `capture="off"` quando a política do host, uma tela sensível, iframes ou recursos externos tornarem a captura automática inadequada. O anexo manual continua disponível.

## Banco e privacidade

- Cada aplicação usa seu arquivo SQLite, em volume persistente local. O número do relato é sequencial por banco. Para plataformas multiempresa, isole instalações por ambiente ou empresa quando a equipe de uma empresa não puder consultar relatos da outra. O administrador vê toda a fila da instalação.
- O arquivo guarda relatos, capturas e a fila SMTP. Aplique as regras de retenção, acesso, criptografia de volume e backup da plataforma. Use um backup consistente do SQLite, como o comando `.backup`, e teste a restauração com os processos parados.
- A captura é um BLOB privado de até 6 MiB. Campos de formulário, iframes, regiões marcadas e o widget são excluídos da captura automática. Marque outras regiões sensíveis e use rotas parametrizadas no atributo `page` quando houver identificadores confidenciais. Consultas e fragmentos de URLs são descartados.
- O contexto opcional aceita tamanho da tela, capacidade de toque, idioma e versão. Captura, notas internas e contexto técnico ficam no painel.

## E-mail e recuperação

O worker verifica o endereço atual confirmado no momento do envio. A abertura confirma o número do relato. A resolução inclui a resposta escrita pela equipe.

Use a porta 587 com STARTTLS ou 465 com TLS implícito, conforme o provedor. Configure remetente autorizado no provedor. `allowInsecure` existe para testes SMTP em loopback.

O worker consulta a fila a cada três segundos por padrão. O kit faz até seis tentativas, com intervalos de 1, 2, 4, 8 e 16 minutos após as cinco primeiras falhas. Se o problema persistir, corrija o SMTP ou o cadastro e use **Reenfileirar** no painel.

O status **Aceito pelo servidor de e-mail** representa aceitação SMTP ou do adaptador. Consulte o provedor para entregas, bounces ou spam. Se o provedor aceitar o e-mail e o processo cair antes de registrar o sucesso, a retomada pode reenviar com o mesmo `Message-ID`. Use idempotência do provedor quando disponível.

Rode o roteador e o worker no mesmo host do SQLite. Em uma implantação com nós em máquinas diferentes, use uma instância para o kit e mantenha o banco no volume local. A fila recebe e-mails durante uma falha do worker. Para verificar a recuperação, confirme as transições de estado no painel depois da reinicialização.

Para reverter a integração, remova a montagem do roteador, o módulo de frontend e o link de administração. Preserve um backup do banco conforme a política de retenção do host.
