# Integração do Reportar Kit

- Leia o [README](README.md), o [guia de integração](docs/integracao.md) e o [contrato HTTP](docs/api.md).
- No projeto hospedeiro, localize a autenticação, a fonte de permissões, a consulta do e-mail confirmado e o serviço de envio. Monte o roteador após a sessão e antes do fallback da SPA.
- Preserve o login existente. `authenticate(req)` deriva `id`, `canReport` e `isAdmin` da conta validada no servidor. `getRecipient(id)` devolve o e-mail atual confirmado ou `null`.
- Coloque o botão no layout existente e o painel no menu de suporte. Use o mesmo domínio para página, assets e API. Teste com conta comum autorizada, conta restrita e conta administrativa.
- Use `/resolve` para mudar a situação para `DONE`, pois a mesma transação enfileira o e-mail de resolução. Aguarde o worker e confirme as notificações `OPENED` e `RESOLVED`.
- Código do pacote em `src/`, componente e painel em `public/`, dados fictícios em `examples/` e testes em `tests/`. `src/index.d.ts` descreve os adaptadores para TypeScript.
- Execute `npm ci`, `npm test` e a suíte de navegador quando o ambiente permitir. Use dados sintéticos e registre em [ANDAMENTO](ANDAMENTO.md) o que foi validado.
- Mantenha o kit genérico. Dados, credenciais, marca e regras específicas da aplicação pertencem ao projeto hospedeiro.
