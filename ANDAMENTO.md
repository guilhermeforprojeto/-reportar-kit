# Andamento

**28/11/2026, 03:14 (Brasília) · Codex · versão 1.0.0**

- O kit pode ser instalado em plataformas web com sessão existente. Inclui widget, fila administrativa, capturas privadas, API, fila de e-mails, opção de reenvio e um exemplo local com dados fictícios.
- Os quatro testes de integração HTTP e SQLite passaram, incluindo abertura, resolução concorrente, permissões, falha com reenvio e os dois e-mails de ponta a ponta em SMTP local descartável.
- O pacote gerado com `npm pack` foi instalado em um projeto consumidor isolado. A importação e a inicialização do roteador passaram.
- A suíte de navegador foi preparada para desktop e celular no GitHub Actions. A revisão visual local depende de uma conexão com o Chrome visível. A conexão local não estava disponível nesta entrega.
- Pronto para publicação no GitHub. Próximo passo em cada instalação é ligar os adaptadores da plataforma e executar a verificação de entrega com SMTP de teste, conforme o [README](README.md). O kit requer Node.js 24.15 ou superior e um arquivo SQLite persistente.
- Para reverter uma instalação, volte à versão anterior do pacote ou remova o roteador, o módulo do botão e o link do painel, mantendo o backup do banco.
