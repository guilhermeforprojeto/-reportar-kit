# Contrato HTTP

Todos os endereços abaixo são relativos ao prefixo do kit, por exemplo `/reportar`. A autenticação vem de `authenticate(req)`. Operações de escrita exigem `Origin` igual ao `publicOrigin` configurado e `X-Reportar-Request: 1`. Erros devolvem `{ "error": "mensagem" }`.

| Método e caminho | Permissão | Corpo e resposta |
| --- | --- | --- |
| `GET /api/status` | Conta autenticada | `{ enabled, admin }` |
| `POST /api/reports` | Conta autorizada a reportar | Multipart com `requestId` (UUID), `kind`, `message` (3–5.000), `page` (rota da própria plataforma), `context` (JSON opcional) e `screenshot` (JPG, PNG ou WebP, até 6 MiB, opcional). Retorna `201 { number }`, ou `200 { number }` para repetição do mesmo UUID pela mesma conta. |
| `GET /api/reports` | Conta autenticada | Lista os próprios relatos, com `{ items, nextBefore }`. |
| `GET /api/reports/:number` | Autor | Leitura de situação, descrição, resposta pública, rota e datas. |
| `GET /admin` | Admin | Painel HTML para colocar no menu da plataforma. |
| `GET /api/admin/reports` | Admin | Lista a fila toda, com `{ items, nextBefore }`. |
| `GET /api/admin/reports/:number` | Admin | Detalhe com `authorId`, `hasCapture`, `devNotes`, `context` e `notifications`. |
| `GET /api/admin/reports/:number/capture` | Admin | Imagem privada. |
| `GET /api/admin/reports/:number/export` | Admin | Detalhe JSON para download. |
| `PATCH /api/admin/reports/:number` | Admin | JSON com `status` e/ou `devNotes` (até 10.000). Retorna o detalhe. |
| `POST /api/admin/reports/:number/resolve` | Admin | JSON `{ response, devNotes? }` com resposta pública de 3–5.000 caracteres. Retorna o detalhe com `DONE` e a notificação de resolução. |
| `POST /api/admin/reports/:number/notifications/:event/retry` | Admin | Reenfileira uma notificação em `FAILED`. Retorna o detalhe. |

- **Categorias** `BUG`, `AJUSTE`, `IDEIA`, `DUVIDA`, `CONTEUDO_INDEVIDO`.
- **Situações** `OPEN`, `IN_PROGRESS`, `DONE`, `WONT_FIX`. O estado `DONE` é definitivo. A ação `/resolve` é idempotente quando repetida com os mesmos dados.
- **Paginação** `status=ALL|PENDING|OPEN|IN_PROGRESS|DONE|WONT_FIX`. Use `limit=1..100` (padrão 30) e passe `nextBefore` como o parâmetro `before` na próxima página.
- **Eventos** `OPENED` e `RESOLVED`. Cada item de `notifications` tem `event`, `state`, `attempts`, `sentAt` e `error`. Os estados são `PENDING`, `SENDING`, `RETRY`, `SENT` e `FAILED`.
- **Limites** Dez relatos novos por autor em 60 segundos. O reenvio de uma requisição cuja primeira confirmação se perdeu deve reutilizar o mesmo `requestId`.
