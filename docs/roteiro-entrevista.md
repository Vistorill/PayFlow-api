# Roteiro de entrevista: Pix assíncrono com SPI, Kafka, webhooks e push

> Guia de estudo e roteiro de demo. Leia na ordem: **pitch → preparação → demo →
> código → conceitos → perguntas**. As partes marcadas com 🗣️ são falas sugeridas:
> não decore palavra por palavra, entenda a ideia e fale do seu jeito.
>
> Referências: desenho em [`../../mensageria.md`](../../mensageria.md), implementação e
> diagramas em [`mensageria-implementacao.md`](mensageria-implementacao.md).

---

## Sumário

1. [O pitch (30 segundos e 2 minutos)](#1-o-pitch)
2. [Preparação: checklist do dia](#2-preparação-checklist-do-dia)
3. [Demo ao vivo: 8 cenas](#3-demo-ao-vivo-8-cenas)
4. [Mapa do código: o que abrir se pedirem](#4-mapa-do-código)
5. [Conceitos que você precisa dominar](#5-conceitos-que-você-precisa-dominar)
6. [ISO 20022 e Pix: o mínimo que você precisa saber](#6-iso-20022-e-pix)
7. [Perguntas prováveis e respostas](#7-perguntas-prováveis-e-respostas)
8. [Limitações: como falar delas](#8-limitações-como-falar-delas)
9. [Plano B: se algo der errado na demo](#9-plano-b)
10. [Cola de 1 página](#10-cola-de-1-página)

---

## 1. O pitch

### 30 segundos (quando perguntarem "me fala do projeto")

🗣️ *"É um core de pagamentos Pix em NestJS com MySQL. O ledger é em partida dobrada:
não existe coluna de saldo, o saldo é sempre calculado dos lançamentos. Em cima disso
eu construí a parte assíncrona: o Pix para outro banco vira uma mensagem ISO 20022
pacs.008 que vai pelo Kafka até o SPI; a resposta pacs.002 volta, muda o estado do
pagamento, e o cliente é avisado por push no celular e por webhook assinado com HMAC.
Também tem devolução com pacs.004. O foco foi confiabilidade: outbox, idempotência,
retry, DLQ e reconciliação."*

### 2 minutos (quando pedirem mais detalhe)

Fale nesta ordem (é a ordem em que o dinheiro anda):

1. **O problema:** o Pix para outro banco depende de um sistema externo (o SPI do
   Banco Central). Não dá para segurar a requisição HTTP do app esperando o outro banco
   responder, e não dá para perder nem duplicar dinheiro se algo cair no meio.
2. **A resposta rápida:** a API debita o cliente, grava a intenção e responde **202
   Accepted** com o `endToEndId`. O app mostra "em processamento".
3. **O caminho assíncrono:** o evento foi gravado na **mesma transação** do débito
   (padrão outbox). Um relay publica no Kafka. O SPI Adapter transforma em XML pacs.008
   e envia.
4. **A volta:** o SPI responde pacs.002. `ACCC` = liquidado; `RJCT` = rejeitado, e aí o
   sistema faz o **estorno** automático no ledger.
5. **O aviso:** o evento de negócio (`pix.payment.settled`) gera push para o app e
   webhook para o sistema do cliente, com assinatura HMAC e retry.
6. **As redes de segurança:** consumidor idempotente (inbox), máquina de estados que só
   anda para frente, retry com backoff, DLQ, e um job de reconciliação para quando o SPI
   não responde.

🗣️ *"O SPI está simulado, porque só instituição participante tem acesso, mas ele está
atrás de uma interface. Trocar pelo real é escrever outra implementação dessa interface,
sem mexer no resto."*

---

## 2. Preparação: checklist do dia

Faça **tudo isto antes** da entrevista. Ensaie a demo pelo menos 2 vezes.

### 2.1 Subir o ambiente

```bash
# 1. MySQL rodando (serviço MySQL80 no Windows)
# 2. Backend
cd backend
npm run db:deploy          # garante a migração aplicada
npm run start:dev          # deixe ESTE terminal visível: os logs contam a história
```

Confira: http://localhost:3000/health → `{"status":"ok","database":"up"}`.

No `.env`, para a demo:

```ini
MENSAGERIA_DRIVER=memoria          # ou kafka, se o Docker estiver de pé (seção 3, cena 8)
SPI_SIMULADOR_ATRASO_MS=1500       # dá tempo de ver o 202 antes do resultado
WEBHOOK_PERMITIR_INSEGURO=true     # permite o receptor local em http://localhost
PUSH_PROVEDOR=log                  # o push aparece no log do terminal
RECONCILIACAO_APOS_SEGUNDOS=30
```

### 2.2 Organize a tela (4 janelas)

| Janela | Para quê |
|---|---|
| **Swagger** http://localhost:3000/docs | Fazer as chamadas |
| **Terminal do backend** (`npm run start:dev`) | Mostrar os logs: pacs saindo e chegando |
| **Terminal do receptor de webhook** | Mostrar os webhooks chegando com assinatura válida |
| **MySQL Workbench** com as consultas da 2.4 | Mostrar XML, outbox, inbox e ledger |

### 2.3 Login e cadastros (faça antes, mas saiba refazer ao vivo)

1. **Login** no Swagger: `POST /api/auth/login`
   ```json
   { "email": "ana@email.com", "senha": "senha1234" }
   ```
   Copie o `accessToken`, clique em **Authorize** (cadeado) e cole. Anote o
   `conta.id` da resposta (usado no extrato).
2. **Contato de outro banco** (Pix externo exige a chave salva): `POST /api/contatos`
   ```json
   { "tipoChave": "EMAIL", "chave": "joao@outrobanco.com", "nomeFavorecido": "Joao Externo", "banco": "Nubank" }
   ```
   Se responder **409 `CONTATO_JA_EXISTE`**, ótimo, já existe.
3. **Webhook**: `POST /api/webhooks/endpoints`
   ```json
   { "url": "http://localhost:4010/hook", "eventos": ["*"], "descricao": "Demo" }
   ```
   A resposta traz o `segredo` (`whsec_...`) **uma única vez**. Copie.
4. **Receptor** (outro terminal, dentro de `backend`):
   ```bash
   # Git Bash
   SEGREDO=whsec_COLE_AQUI node scripts/webhook-receptor.mjs
   # PowerShell
   $env:SEGREDO="whsec_COLE_AQUI"; node scripts/webhook-receptor.mjs
   ```
5. **Dispositivo de push** (simula o celular da Ana): `POST /api/notificacoes/dispositivos`
   ```json
   { "token": "ExponentPushToken[demo-ana]", "plataforma": "ANDROID" }
   ```

> 💡 **idempotencyKey:** cada Pix novo precisa de uma chave nova (8 a 100 caracteres).
> Use `demo-01`, `demo-02`, ... e anote qual usou em cada cena. A cena 6 reutiliza uma.

### 2.4 Consultas prontas no Workbench

```sql
-- A) Mensagens ISO 20022 (XML bruto) mais recentes
SELECT created_at, tipo, direcao, message_id, end_to_end_id, return_id, xml
  FROM pix_spi_mensagens ORDER BY created_at DESC LIMIT 6;

-- B) Outbox: eventos gravados junto com a regra de negócio
SELECT created_at, topico, tipo_evento, status, publicado_em
  FROM outbox_eventos ORDER BY created_at DESC LIMIT 10;

-- C) Inbox: o que cada consumidor já processou (idempotência)
SELECT consumidor, message_id, processado_em
  FROM inbox_eventos ORDER BY processado_em DESC LIMIT 10;

-- D) Estado SPI dos Pix entre bancos
SELECT created_at, tipo, status, status_spi, direcao_spi, end_to_end_id, valor, motivo_rejeicao, versao
  FROM transacoes WHERE end_to_end_id IS NOT NULL OR tipo IN ('ESTORNO','DEVOLUCAO')
 ORDER BY created_at DESC LIMIT 10;

-- E) Ledger: partida dobrada (cada transação = 2 linhas que somam zero)
SELECT l.created_at, t.tipo, l.tipo AS perna, l.valor, l.descricao
  FROM lancamentos l JOIN transacoes t ON t.id = l.transacao_id
 ORDER BY l.created_at DESC LIMIT 10;

-- F) Webhooks
SELECT created_at, tipo_evento, status, tentativa, ultimo_http_status, proxima_tentativa_em
  FROM webhook_entregas ORDER BY created_at DESC LIMIT 10;
```

---

## 3. Demo ao vivo: 8 cenas

Tempo total: ~8 minutos (cenas 1 a 6). As cenas 7 e 8 são bônus, se houver tempo ou
se perguntarem.

Estrutura de cada cena: **Faça** → **Mostre** → 🗣️ **Fale** → **Por dentro** (o que
acontece no código, para responder se perguntarem).

---

### Cena 1: Pix interno (a base síncrona) ⏱ 45s

**Faça:** `POST /api/pix/transferir`
```json
{ "tipoChave": "EMAIL", "chaveDestino": "bruno@email.com", "valor": "10.00", "idempotencyKey": "demo-01" }
```

**Mostre:** resposta **201**, `status: "CONCLUIDA"`, `statusSpi: null`, e os **2
lançamentos** (DEBITO na Ana, CREDITO no Bruno).

🗣️ *"Entre contas do mesmo banco o Pix liquida na hora: trava a linha da conta com
SELECT FOR UPDATE, recalcula o saldo a partir do ledger, grava dois lançamentos que
somam zero. Não existe coluna de saldo. Mas repare: mesmo aqui, na mesma transação,
eu gravo dois eventos no outbox, um para cada lado. É isso que alimenta push e
webhook."*

**Por dentro:** `PixService.movimentar` → `eventosPixInterno` grava
`pix.payment.settled` (Ana) e `pix.payment.received` (Bruno) no outbox. O receptor mostra
o `settled` porque o webhook é da Ana.

---

### Cena 2: Pix para outro banco, liquidado (pacs.008 → pacs.002 ACCC) ⏱ 2min

A cena principal. Vá devagar.

**Faça:** `POST /api/pix/transferir`
```json
{ "tipoChave": "EMAIL", "chaveDestino": "joao@outrobanco.com", "valor": "25.00", "idempotencyKey": "demo-02" }
```

**Mostre, em ordem:**

1. **A resposta: 202 Accepted**, `status: "PENDENTE"`, `statusSpi: "CRIADO"`,
   `endToEndId: "E12345678202609...` (32 caracteres). Copie o `id`.
2. **O terminal do backend** (a história em 4 linhas):
   ```
   [SpiAdapterService]  -> pacs.008 E1234...  enviado ao SPI
   [SpiSimulador]       <- pacs.008 E1234... R$ 25.00
   [SpiAdapterService]  <- pacs.002 E1234... recebido do SPI (ACCC)
   [PixSpiService]      Pix E1234... LIQUIDADO
   ```
3. **O receptor**: chegam `pix.payment.sent` e depois `pix.payment.settled`, com ✓ de
   assinatura válida.
4. `GET /api/transacoes/{id}` → `status: "CONCLUIDA"`, `statusSpi: "LIQUIDADO"`.
5. **Workbench, consulta A**: o XML do pacs.008 (SAIDA) e do pacs.002 (ENTRADA). Abra o
   XML e aponte `<EndToEndId>`, `<IntrBkSttlmAmt Ccy="BRL">25.00</...>` e `<TxSts>ACCC</TxSts>`.

🗣️ *"A API respondeu 202 em milissegundos: o dinheiro já saiu do saldo, mas o
pagamento ainda não está liquidado. O EndToEndId é gerado aqui, no formato do Banco
Central: E, ISPB, data e hora, e um sufixo aleatório. Ele é a chave de tudo: é a chave
de partição no Kafka, então pacs.008, pacs.002 e pacs.004 do mesmo pagamento caem na
mesma partição e são consumidos em ordem.*

*Na mesma transação do débito eu gravei um comando no outbox. O relay publica no tópico
pix.spi.outbound. O SPI Adapter, que é o único lugar do sistema que conhece XML, monta
o pacs.008 e envia. O pacs.002 volta, o adapter guarda o XML bruto, que é a prova em
auditoria, e publica em pix.spi.inbound. O core aplica na máquina de estados e gera o
evento de negócio, que vira webhook e push."*

**Por dentro (se perguntarem):**
- `PixService.registrarIntencao` gera o `endToEndId`; `movimentar` grava lançamentos +
  `statusSpi = CRIADO` + `enfileirarPacs008` (outbox) **na mesma transação**.
- `OutboxRelayService` lê com `FOR UPDATE SKIP LOCKED` e publica.
- `SpiAdapterService.enviar` → `gerarXml` → `gateway.enviar` → grava XML + evento
  `spi.mensagem.enviada`.
- `PixSpiService.statusDePagamento` → `transitarPix(..., 'LIQUIDADO')` com lock otimista
  (`WHERE versao = ?`).

---

### Cena 3: Pix rejeitado e estorno automático (pacs.002 RJCT) ⏱ 1min

**Faça:** anote o saldo (`GET /api/contas/{id}/saldo`), depois:
```json
{ "tipoChave": "EMAIL", "chaveDestino": "joao@outrobanco.com", "valor": "10.99", "idempotencyKey": "demo-03" }
```

**Mostre:**
1. 202 PENDENTE, igual à cena 2.
2. Terminal: `pacs.002 ... (RJCT)` e `Pix ... REJEITADO (AC03); valor estornado`.
3. `GET /api/transacoes/{id}` → `status: "FALHA"`, `statusSpi: "REJEITADO"`, `motivoRejeicao: "AC03"`.
4. Saldo **igual ao de antes**.
5. Workbench, **consulta E**: aparecem 4 lançamentos: o débito original e um
   **ESTORNO** (liquidação → Ana). Nada foi apagado.
6. Receptor: `pix.payment.rejected`.

🗣️ *"O simulador rejeita valores terminados em 99 com o código AC03, conta do recebedor
inválida. O ledger é append-only, então eu não apago o débito: gero uma transação de
estorno com dois lançamentos novos. O histórico conta exatamente o que aconteceu. E o
estorno tem uma chave de idempotência determinística, `estorno:<id da transação>`, com
índice único: nem uma mensagem reentregue consegue estornar duas vezes."*

---

### Cena 4: outro banco paga a Ana (pacs.008 de entrada + push) ⏱ 1min

**Faça:** `POST /api/spi/simulador/pix-recebido`
```json
{ "chave": "ana@email.com", "valor": "50.00", "pagadorNome": "Carlos Pereira", "mensagem": "Almoço" }
```

**Mostre:**
1. Terminal: `<- pacs.008 E87654321... recebido do SPI`, `Pix ... RECEBIDO por Ana Souza`,
   `-> pacs.002 ... enviado ao SPI` e a linha do push:
   ```
   [Push] [push -> 1 dispositivo(s)] Pix recebido: Voce recebeu R$ 50,00 de Carlos Pereira.
   ```
2. `GET /api/notificacoes` → a notificação com `dados.transacaoId`.
3. Receptor: `pix.payment.received`.
4. `GET /api/transacoes/{transacaoId}` → `origem.nome: "Carlos Pereira"`, `externo: true`,
   `statusSpi: "RECEBIDO"`. **Copie esse id para a cena 5.**

🗣️ *"Agora o sentido contrário. O pacs.008 chega com a chave Pix do recebedor. Eu
resolvo a chave numa conta, credito e respondo pacs.002 de aceite. Esse caminho é curto
de propósito: no SPI real o recebedor tem poucos segundos para responder. Se a chave não
existir, a resposta é pacs.002 RJCT AC03 e nada é creditado.*

*O push é um consumidor independente do mesmo evento. Ele grava na caixa de notificações
e só depois tenta o push. Se o push falhar, a notificação continua lá e o app mostra na
próxima vez que abrir."*

---

### Cena 5: devolução (pacs.004) ⏱ 1min

**Faça:** `POST /api/pix/transacoes/{id da cena 4}/devolucoes`
```json
{ "valor": "20.00", "motivo": "MD06", "infoAdicional": "Cobrança em duplicidade", "idempotencyKey": "dev-01" }
```

**Mostre:**
1. **202**, `status: "SOLICITADA"`, `returnId: "D12345678..."` (começa com **D**).
2. Terminal: `-> pacs.004 D1234... enviado ao SPI`, depois `pacs.002 ... (ACCC)`.
3. `GET /api/pix/transacoes/{id}/devolucoes` → `status: "LIQUIDADA"`.
4. `GET /api/transacoes/{id}` → `statusSpi: "DEVOLVIDO_PARCIAL"`.
5. **O erro de negócio:** tente devolver `"40.00"` (sobraram só 30,00) →
   **422 `VALOR_EXCEDE_DEVOLVIVEL`**, com o `devolvivel: "30.00"`.

🗣️ *"Devolução é uma mensagem própria, pacs.004, com identificador próprio, o ReturnId,
e que referencia o EndToEndId original. A regra principal é que a soma das devoluções
nunca passa do valor original. Para isso ser verdade com duas devoluções simultâneas, eu
travo a linha do Pix original com FOR UPDATE antes de somar. Sem esse lock, duas
requisições leriam o mesmo total e as duas passariam."*

> Bônus: `POST /api/spi/simulador/devolucao-recebida` com o `endToEndId` da cena 2
> simula o outro banco devolvendo o Pix que a Ana enviou (pacs.004 de entrada).

---

### Cena 6: idempotência (o botão clicado duas vezes) ⏱ 45s

**Faça:** repita **exatamente** a chamada da cena 2 (mesma `idempotencyKey: "demo-02"`).

**Mostre:** mesmo `id`, mesmo `endToEndId`. O saldo **não** mudou. Nenhum pacs.008 novo
no terminal.

🗣️ *"O app gera a chave de idempotência uma vez por transferência. Se a rede cair e ele
reenviar, o índice único do banco barra a segunda inserção e eu devolvo a transação que
já existe. Um SELECT antes do INSERT não resolveria: duas requisições simultâneas veriam
'não existe' e as duas gravariam. Quem serializa é o índice.*

*A mesma ideia aparece em todas as camadas: idempotencyKey na API, inbox nos
consumidores, MsgId único nas mensagens do SPI, chave determinística no estorno e
evento único por endpoint no webhook."*

---

### Cena 7 (bônus): reconciliação, quando o SPI não responde ⏱ 45s (+30s de espera)

**Faça:** Pix externo com `"valor": "5.98"`. O simulador **não responde**.

**Mostre:** logo depois, `statusSpi: "ENVIADO"`. Enquanto espera ~30–45s, explique. Depois:
- Terminal: `Pix ... sem pacs.002 ha 30s -> RECONCILIANDO` e `Pix ... reconciliado: LIQUIDADO`.
- `GET /api/transacoes/{id}` → `LIQUIDADO`.

🗣️ *"Timeout é o pior caso em pagamento: não sei se o dinheiro chegou. A regra de ouro
é nunca reenviar com um EndToEndId novo antes de confirmar, porque isso seria pagar duas
vezes. O job marca como RECONCILIANDO, consulta o status no SPI e só então liquida ou
estorna. Com 97 centavos o SPI diz que não conhece o pagamento, e depois de uma janela
de 2 minutos o sistema estorna."*

---

### Cena 8 (bônus): resiliência do webhook e Kafka ⏱ 1min

**Webhook falhando:**
1. Pare o receptor (Ctrl+C) e suba em modo falha:
   `SEGREDO=whsec_... FALHAR=1 node scripts/webhook-receptor.mjs`
2. Faça um Pix interno. O receptor responde 503.
3. `GET /api/webhooks/entregas` → `status: "RETENTANDO"`, `tentativa: 1`,
   `ultimoHttpStatus: 503`, `proximaTentativaEm` ≈ 1 minuto depois.
4. Suba o receptor normal e chame `POST /api/webhooks/entregas/{id}/replay` → entregue.

🗣️ *"4xx do cliente é erro dele e não adianta tentar de novo. 5xx, timeout, 408 e 429
eu retento com backoff: 1 minuto, 5, 30, 2 horas, 6, 24, com jitter de 20% para não
bombardear o cliente quando ele volta. Se ele mandar Retry-After, eu respeito. Depois de
7 tentativas vai para a DLQ, e o cliente pode pedir o replay. Com 20 falhas seguidas o
endpoint é suspenso, que é um circuit breaker."*

**Kafka (só se o Docker estiver de pé):**
`docker compose up -d`, `MENSAGERIA_DRIVER=kafka` no `.env`, reinicie a API e abra
http://localhost:8080 → Topics → `pix.spi.outbound` / `pix.spi.inbound` → Messages. Faça
um Pix e mostre a mensagem com a **key = EndToEndId** e os headers `event-type`,
`correlation-id`.

---

## 4. Mapa do código

Se pedirem para ver código, abra **nesta ordem** (vai do mais importante ao detalhe).

| # | Arquivo | O que destacar |
|---|---|---|
| 1 | `src/pix/pix.service.ts` → `movimentar` | Lock, saldo do ledger, 2 lançamentos e outbox **dentro do mesmo `$transaction`** |
| 2 | `src/mensageria/outbox.service.ts` e `outbox-relay.service.ts` | Recebe o `tx`; relay com `FOR UPDATE SKIP LOCKED` |
| 3 | `src/mensageria/inbox.service.ts` | INSERT na inbox + efeito na mesma transação; P2002 = já processado |
| 4 | `src/pix/spi/estados.ts` | Tabela de transições; só anda para frente |
| 5 | `src/pix/spi/pix-spi.service.ts` → `statusDePagamento` e `transitarPix` | ACCC vs RJCT, estorno, lock otimista por `versao` |
| 6 | `src/spi/iso20022/codec.ts` | XML ⇄ canônico; dinheiro em centavos sem float; `parseTagValue: false` |
| 7 | `src/spi/spi.gateway.ts` + `spi-simulador.ts` | A porta que permite trocar simulador por SPI real |
| 8 | `src/mensageria/consumidor.service.ts` | Retry com backoff e DLQ |
| 9 | `src/webhooks/webhook-dispatcher.service.ts` | Claim atômico, HMAC, classificação da resposta, circuit breaker |
| 10 | `src/webhooks/ssrf.ts` | Bloqueio de IP privado, checado no cadastro **e** no envio |

Testes para mostrar: `npm test` (98 testes em ~1s). Os mais interessantes:
`src/spi/iso20022/codec.spec.ts` (ida e volta do XML, `&` escapado, zeros à esquerda),
`src/pix/spi/estados.spec.ts`, `src/webhooks/webhooks.spec.ts` (HMAC, SSRF, retry).

---

## 5. Conceitos que você precisa dominar

Para cada conceito: **o que é**, **o problema que resolve** e **onde está no projeto**.

### 5.1 Transactional Outbox

- **Problema (dual write):** gravar no banco e publicar no Kafka são duas operações em
  dois sistemas. Se eu gravo e caio antes de publicar, o evento some. Se eu publico e o
  banco dá rollback, publiquei algo que não aconteceu.
- **Solução:** gravar o evento numa tabela (`outbox_eventos`) **na mesma transação** da
  regra de negócio. Um processo separado (relay) lê e publica. Ou os dois existem, ou
  nenhum.
- **Consequência:** o relay pode publicar duas vezes (publicou e caiu antes de marcar
  PUBLICADO). Por isso o consumidor precisa ser idempotente.
- **Alternativa:** CDC com Debezium, que lê o binlog do MySQL em vez de fazer polling.
  Menos latência e menos carga, mais infraestrutura. Comecei com polling por simplicidade.

### 5.2 Inbox e consumidor idempotente

- Tabela `inbox_eventos` com chave `(consumidor, message_id)`.
- O INSERT na inbox acontece **na mesma transação** do efeito. Se o efeito falhar, a
  inbox sai junto no rollback e a reentrega processa de novo. Se a mensagem vier
  duplicada, o INSERT estoura o índice único → sei que já foi feito.
- Cada consumidor tem sua própria linha: o webhook e o push processam o mesmo evento
  independentemente.

### 5.3 Semântica de entrega

| Semântica | Significado | Aqui |
|---|---|---|
| at-most-once | pode perder, nunca duplica | push (melhor esforço, depois do commit) |
| at-least-once | nunca perde, pode duplicar | Kafka + outbox + consumidores |
| exactly-once | nem perde nem duplica | **efeito** exatamente uma vez = at-least-once + idempotência |

🗣️ *"Exactly-once de ponta a ponta com sistemas externos não existe na prática. O que eu
garanto é o efeito exatamente uma vez: entrega pelo menos uma vez e processamento
idempotente."*

### 5.4 Kafka: o que você precisa saber

- **Tópico** dividido em **partições**. Ordem só é garantida **dentro** de uma partição.
- **Chave da mensagem** decide a partição (hash). Chave = EndToEndId → tudo do mesmo
  pagamento em ordem.
- **Consumer group:** cada grupo recebe todas as mensagens; dentro do grupo, cada partição
  vai para um consumidor só. Escala = mais partições + mais instâncias no grupo.
  Aqui: `spi-adapter`, `pix-core`, `webhooks`, `webhooks-dispatcher`, `notificacoes`.
- **Offset:** posição lida. Commit do offset **só depois** de processar = at-least-once.
- **Producer idempotente** (`acks=all`, `idempotent: true`): evita duplicar no retry do
  próprio producer.
- **Tópicos do projeto:** `pix.spi.outbound`, `pix.spi.inbound`, `pix.payments.events`,
  `pix.returns.events`, `pix.webhooks.dispatch`, e um `.dlq` para cada.
- **Por que não RabbitMQ?** Kafka guarda o log (dá para reprocessar desde um offset), tem
  ordem por chave e escala por partição. Para eventos de pagamento que vários sistemas
  consomem (webhook, push, BI, antifraude), o modelo de log com vários consumer groups
  encaixa melhor.

### 5.5 Máquina de estados + lock otimista

- Estados SPI: `CRIADO → ENVIADO → LIQUIDADO | REJEITADO | RECONCILIANDO`, depois
  `DEVOLVIDO_PARCIAL / DEVOLVIDO`. Recebido: `RECEBIDO → DEVOLVIDO*`.
- **Só anda para frente:** um pacs.002 atrasado ou duplicado para um estado final é ignorado.
- `CRIADO → LIQUIDADO` direto é permitido: o pacs.002 pode chegar antes de eu processar a
  confirmação de envio, e ele prova que o pacs.008 saiu.
- **Lock otimista:** `UPDATE ... WHERE id = ? AND versao = ?`. Se outra transação mudou
  antes, afeta 0 linhas → lanço erro transitório → o consumidor tenta de novo com o
  estado novo.
- **Lock pessimista** (`SELECT ... FOR UPDATE`) é usado onde há **dinheiro e soma**:
  saldo da conta e soma de devoluções.

🗣️ *"Otimista quando o conflito é raro e dá para tentar de novo; pessimista quando
preciso ler, decidir e escrever de forma atômica, como checar saldo."*

### 5.6 Ledger em partida dobrada

- Toda transação gera exatamente **2 lançamentos que somam zero** (débito e crédito).
- **Saldo não é coluna:** `saldo = SUM(créditos) - SUM(débitos)`. Não há como o saldo e
  o histórico divergirem.
- **Append-only:** nunca UPDATE, nunca DELETE. Correção = novo lançamento (estorno).
- **Conta de liquidação** (`LIQUIDACAO_PIX`): a contrapartida do Pix para outro banco. O
  cliente é debitado, a liquidação é creditada. O saldo dela = quanto o banco precisa
  acertar com os outros bancos.
- Dinheiro em `DECIMAL(15,2)` no banco e **centavos inteiros** nas mensagens. Nunca float:
  `0.1 + 0.2 = 0.30000000000000004`.

### 5.7 Retry, backoff, jitter e DLQ

- **Transitório** (deadlock, rede, "pacs.002 chegou antes do registro") → tenta de novo.
- **Permanente** (mensagem inválida) → DLQ direto; tentar de novo não resolve.
- **Backoff exponencial:** espera cresce (200ms, 400ms, 800ms...), para não martelar.
- **Jitter:** aleatoriedade na espera, para mil retries não baterem juntos.
- **DLQ (dead letter queue):** onde a mensagem que falhou de vez fica, com o motivo nos
  headers, para análise e reprocessamento. Não trava a partição (poison pill).

### 5.8 Segurança dos webhooks

- **HMAC-SHA256** do `timestamp + "." + corpo bruto` com um segredo só nosso e do
  cliente. Prova origem e integridade.
- **Timestamp com tolerância de 5 min:** impede replay de uma requisição capturada.
- **Comparação em tempo constante** (`timingSafeEqual`): evita timing attack.
- **Segredo cifrado em repouso** com AES-256-GCM (não é hash, porque preciso dele para
  assinar). Mostrado uma vez só.
- **Rotação:** durante 24h vão duas assinaturas, a nova e a antiga.
- **SSRF:** sem proteção, um cliente cadastraria `http://169.254.169.254` (metadados da
  nuvem) ou `localhost:3306` e usaria nosso servidor para atacar a rede interna. Bloqueio
  IPs privados, loopback, link-local; só https; sem seguir redirect; checo no cadastro e
  **no envio** (o DNS pode mudar depois do cadastro).

### 5.9 Reconciliação

- Rede de segurança para estado incerto. Nunca assumir sucesso nem falha sem confirmação.
- Aqui: job a cada 15s; `ENVIADO` há mais de 30s → `RECONCILIANDO` → consulta o SPI.
- Não reconcilio `CRIADO`: significa que o pacs.008 ainda está no outbox (Kafka fora?).
  Estornar ali seria perigoso, porque o relay ainda vai enviar.
- Em produção existe também a conciliação diária com o extrato do SPI (camt.052/053).

---

## 6. ISO 20022 e Pix

| Mensagem | Nome ISO | Quando |
|---|---|---|
| **pacs.008** | FIToFICustomerCreditTransfer | Ordem de pagamento (o Pix em si) |
| **pacs.002** | FIToFIPaymentStatusReport | Resposta de status a um pacs.008 ou pacs.004 |
| **pacs.004** | PaymentReturn | Devolução de um pagamento |

| Identificador | Formato (32 caracteres) | Exemplo |
|---|---|---|
| EndToEndId | `E` + ISPB(8) + `yyyyMMddHHmm` + 11 alfanuméricos | `E12345678202609291200A1B2C3D4E5F` |
| ReturnId (RtrId) | `D` + ISPB(8) + `yyyyMMddHHmm` + 11 | `D12345678202609291205X9Y8Z7W6V5U` |
| MsgId | `M` + ISPB(8) + 23 alfanuméricos | único por mensagem enviada |
| ISPB | 8 dígitos | identifica a instituição no SPB |

| TxSts (pacs.002) | Significado | Ação aqui |
|---|---|---|
| `ACSP` | Aceito, em processamento | mantém o estado |
| `ACCC` / `ACSC` | Liquidado | LIQUIDADO / CONCLUIDA |
| `RJCT` | Rejeitado (com motivo) | REJEITADO / FALHA + estorno |

Motivos que vale saber: **AC03** conta inválida, **AC06** bloqueada, **AM02** valor não
permitido, **AB03** timeout, **BE01** dados inconsistentes. Devolução: **MD06** pedido do
pagador, **SL02** pedido do recebedor, **BE08** erro, **FR01** fraude.

Outros termos: **SPI** (Sistema de Pagamentos Instantâneos, do BACEN), **DICT**
(diretório de chaves Pix), **RSFN** (rede do sistema financeiro), **MED** (mecanismo
especial de devolução, para fraude), **PSP** (prestador de serviço de pagamento).

🗣️ Se perguntarem sobre XML: *"O restante do sistema nunca vê XML. O adapter converte
para um modelo canônico em JSON. Se amanhã a integração for via um PSP parceiro que usa
JSON/REST, só o adapter muda."*

---

## 7. Perguntas prováveis e respostas

### Arquitetura

**"Por que não publicar direto no Kafka depois do commit?"**
Porque o processo pode cair entre o commit e a publicação, e o evento some. Com o
outbox, o evento é parte da transação. Chama-se problema do *dual write*.

**"E se o Kafka cair?"**
A API continua aceitando Pix: o evento fica em `outbox_eventos` como PENDENTE. Quando o
Kafka volta, o relay publica o acumulado. Os consumidores reconectam sozinhos com
backoff. A reconciliação ignora Pix em CRIADO justamente para não estornar algo que
ainda vai sair.

**"E se o MySQL cair?"**
A API retorna erro e nada é gravado. É o comportamento correto: sem banco não há ledger.
Os consumidores falham, fazem retry e, se passar do limite, a mensagem vai para a DLQ
sem perder nada. O offset só avança depois de processar ou mandar para a DLQ.

**"Isso é microsserviço?"**
É um monólito modular. Os módulos (Pix, SPI Adapter, webhooks, notificações) conversam
**por tópicos**, cada um com seu consumer group. Separar em serviços é questão de deploy.
Para um projeto deste tamanho, monólito modular é a escolha certa: sem custo de rede e
de operação antes de precisar.

**"Por que debitar antes de o SPI responder?"**
Para reservar o dinheiro. Se eu esperasse, o cliente poderia gastar o mesmo saldo em
outro Pix enquanto este está no SPI. Rejeitou → estorno.

**"Como escala?"**
Tópicos com 12 partições → até 12 consumidores por grupo. O relay usa `SKIP LOCKED`, então
várias instâncias da API dividem o outbox sem publicar em dobro. O gargalo passa a ser
o banco (lock por conta), o que é o comportamento desejado: serializar só por conta.

**"Como garante ordem?"**
Chave de partição = EndToEndId. Mas a ordem do **webhook** para o cliente não é
garantida (um retry pode atrasar um evento). Por isso o payload traz `status` e
`createdAt`, e o cliente deve usar isso, não a ordem de chegada.

### Consistência e concorrência

**"O que acontece se o pacs.002 chegar duplicado?"**
Primeira barreira: `UNIQUE(message_id, direcao)` em `pix_spi_mensagens`. Se passar (por
exemplo, reentrega do Kafka): a inbox barra. Se ainda assim chegar à máquina de estados,
LIQUIDADO → LIQUIDADO não é transição válida e é ignorado.

**"E se o pacs.002 chegar antes de eu gravar o envio?"**
Não acha o registro → `ErroTransitorio` → retry com backoff até o registro aparecer. E a
máquina de estados aceita CRIADO → LIQUIDADO direto.

**"Duas devoluções ao mesmo tempo podem passar do valor?"**
Não: `SELECT ... FOR UPDATE` na linha do Pix original antes de somar. A segunda espera a
primeira commitar e soma com ela incluída.

**"Por que o lock é na conta e não nos lançamentos?"**
A linha da conta sempre existe e é um ponto único de serialização. Um `FOR UPDATE` nos
lançamentos de uma conta sem lançamentos não trava nada, e duas transações passariam.

**"Qual o nível de isolamento?"**
REPEATABLE READ (padrão do MySQL), declarado explicitamente. Detalhe importante: o lock
vem **antes** do cálculo do saldo, porque o `FOR UPDATE` é uma leitura atual, e o
snapshot só abre no primeiro SELECT normal.

### Webhooks e push

**"Como o cliente sabe que o webhook veio de você?"**
Assinatura HMAC com o segredo compartilhado, timestamp para anti-replay, comparação em
tempo constante. Tem um exemplo de verificação na documentação.

**"E se o endpoint do cliente ficar fora do ar um dia inteiro?"**
Retry até 24h (7 tentativas). Depois vai para a DLQ, e ele pode pedir replay pela API.
Se falhar 20 vezes seguidas, o endpoint é suspenso; os eventos continuam registrados e
são reagendados quando ele reativa.

**"Push é garantido?"**
Não, e nenhum push é (o sistema operacional pode descartar). Por isso a notificação é
gravada antes, na caixa de notificações, e o app consulta ao abrir. O push é só o aviso.
A fonte da verdade é a API.

**"Por que o retry do webhook não é em tópicos Kafka de retry?"**
O desenho original sugere tópicos por atraso (1m, 5m...). Eu usei agenda em banco
(`proxima_tentativa_em`) + Kafka para distribuir o trabalho. É mais simples de consultar
("quais entregas estão pendentes?"), permite replay pela API, e o volume de retry é
baixo. É um trade-off consciente.

### Segurança e dados

**"E LGPD?"**
Webhook e push levam o mínimo: sem CPF, só nome da contraparte, valor e status. O cliente
busca o detalhe pela API autenticada. O `contaId` interno é removido do payload do webhook.

**"A conta de origem vem do body?"**
Nunca. Vem do JWT. Se viesse do body, qualquer um pagaria com a conta alheia trocando um
campo.

### Testes

**"Como você testou?"**
Unitários (98) no codec ISO 20022, máquina de estados, HMAC, cifra, SSRF e política de
retry. E um roteiro de ponta a ponta com 28 verificações contra a API rodando: cada
fluxo, idempotência, estorno com saldo conferido, devolução acima do permitido e
webhooks com assinatura válida.

**"O que faltou testar?"**
Seja honesto: integração automatizada com Testcontainers (Kafka + MySQL) e testes de caos
(derrubar o Kafka no meio do fluxo). Está no plano do documento de desenho.

---

## 8. Limitações: como falar delas

Regra: **diga antes que perguntem**, mostre que sabe o caminho. Limitação conhecida
conta a seu favor; limitação escondida conta contra.

| Limitação | Como falar |
|---|---|
| SPI simulado | *"Só participante do SPI tem acesso. Está atrás do `SpiGateway`; o real seria outra implementação: conexão via RSFN ou PSP parceiro."* |
| Sem XSD oficial e sem assinatura digital | *"O XML segue a estrutura, mas em produção eu validaria contra o XSD do manual do BACEN e assinaria com XMLDSig usando certificado ICP-Brasil guardado em HSM."* |
| DICT simplificado | *"A chave externa precisa estar nos contatos. O real consultaria o DICT para obter conta e ISPB do recebedor."* |
| Modo em memória perde mensagens em voo se o processo cair | *"Por isso ele é só para desenvolvimento. O outbox protege até a publicação; depois disso, quem garante é o Kafka."* |
| Monólito | *"Monólito modular: os módulos já só conversam por tópicos."* |
| Sem métricas | *"Os eventos já carregam `correlationId` e `causationId` para rastreio. O próximo passo seria Prometheus (lag, outbox pendente, DLQ) e OpenTelemetry."* |
| XML no banco | *"Em produção iria para storage de objetos criptografado, com retenção regulatória, e o banco guardaria só a referência."* |

---

## 9. Plano B

| Problema | O que fazer |
|---|---|
| Swagger responde **401** | Token expirou (1h): refaça o login e o Authorize |
| Pix externo dá **404 `CHAVE_NAO_ENCONTRADA`** | O contato `joao@outrobanco.com` não existe para esta conta: crie (seção 2.3) |
| **422 `SALDO_INSUFICIENTE`** | Use valores menores, ou receba um Pix pelo simulador (cena 4) |
| **422 `TRANSACAO_ANTERIOR_FALHOU`** ou resposta repetida | Você reutilizou a `idempotencyKey`: troque o sufixo |
| Webhook **400 `URL_WEBHOOK_INVALIDA`** | `WEBHOOK_PERMITIR_INSEGURO=true` não está no `.env`, ou a API não foi reiniciada depois |
| Receptor mostra **ASSINATURA INVALIDA** | O `SEGREDO` do receptor não é o do endpoint (ou houve rotate-secret) |
| Nada acontece depois do 202 | Olhe o terminal. Com `MENSAGERIA_DRIVER=kafka`, confira `docker compose ps` |
| Push não aparece no log | Registre o dispositivo (seção 2.3, passo 5) para a conta que **recebe** |
| Tudo falhou | Rode `npm test` (98 testes em 1s) e mostre o código pelo mapa da seção 4. Explicar bem o desenho vale mais que a demo |

---

## 10. Cola de 1 página

```
FLUXO:   App → API (debita + outbox, mesma TX) → 202 PENDENTE + E2E
         → Relay → pix.spi.outbound → Adapter (XML pacs.008) → SPI
         → pacs.002 → Adapter → pix.spi.inbound → Core (estado + ledger + outbox)
         → pix.payments.events → Webhook (HMAC) + Push (Expo)

PADRÕES: Outbox (dual write) · Inbox (idempotência) · Partição = EndToEndId (ordem)
         · Estado só avança + lock otimista (versao) · FOR UPDATE onde há saldo/soma
         · Retry backoff + DLQ · Reconciliação (nunca reenviar com E2E novo)

LEDGER:  2 lançamentos que somam zero · sem coluna de saldo · append-only
         · estorno = lançamento novo · DECIMAL e centavos, nunca float

ISO:     pacs.008 paga · pacs.002 responde (ACSP/ACCC/RJCT) · pacs.004 devolve
         E2E = E+ISPB+yyyyMMddHHmm+11 · RtrId = D... · MsgId = M+ISPB+23

SIMULA:  ,99 rejeita (AC03) · ,98 sem resposta → liquida na reconciliação
         · ,97 sem resposta → estorna após 120s · resto liquida

WEBHOOK: t=<ts>,v1=HMAC(segredo,"ts.corpo") · 5 min anti-replay · 7 tentativas
         1m 5m 30m 2h 6h 24h ±20% · 4xx=permanente · 20 falhas = suspenso · SSRF

FRASES:  "Efeito exatamente uma vez = at-least-once + idempotência"
         "Timeout não é falha: é estado desconhecido"
         "O SPI está atrás de uma interface; trocar é outra implementação"
```
