# Mensageria Pix — implementação (pacs.008 / pacs.002 / pacs.004 + Kafka + Webhooks + Push)

> Implementa o desenho de [`../../mensageria.md`](../../mensageria.md) sobre o backend
> existente (NestJS + Prisma + **MySQL 8**). Este documento descreve **o que foi
> construído**, como rodar e como o app mobile se integra.
>
> ⚠️ O SPI é **simulado**. XML ISO 20022 simplificado, sem XSD oficial, sem assinatura
> XMLDSig/ICP-Brasil e sem DICT real. Ver [§10](#10-o-que-falta-para-produção).

---

## 1. Caso de uso: cliente no app mobile

```mermaid
flowchart LR
  U(["👤 Cliente<br/>(app mobile)"])
  ERP(["🏢 Sistema do cliente<br/>(ERP / loja)"])
  BANCO(["🏦 Outro banco<br/>(via SPI)"])

  subgraph CACTVS["Cactvs Payments"]
    UC1(["Enviar Pix para outro banco<br/>(pacs.008)"])
    UC2(["Acompanhar status do Pix<br/>(pacs.002)"])
    UC3(["Receber Pix de outro banco<br/>(pacs.008 de entrada)"])
    UC4(["Devolver Pix recebido<br/>(pacs.004)"])
    UC5(["Receber devolução<br/>(pacs.004 de entrada)"])
    UC6(["Receber notificação push"])
    UC7(["Cadastrar webhook"])
    UC8(["Receber webhook assinado (HMAC)"])
  end

  U --> UC1
  U --> UC2
  U --> UC4
  U --> UC6
  ERP --> UC7
  UC8 --> ERP
  BANCO --> UC3
  BANCO --> UC5
  UC1 -. "include" .-> UC2
  UC2 -. "gera" .-> UC6
  UC2 -. "gera" .-> UC8
  UC3 -. "gera" .-> UC6
  UC3 -. "gera" .-> UC8
  UC4 -. "gera" .-> UC6
  UC5 -. "gera" .-> UC6
```

**Fluxo principal:** o app envia o Pix → recebe **202 PENDENTE** na hora (o valor já saiu
do saldo) → o `pacs.008` segue assíncrono pelo Kafka até o SPI → o `pacs.002` volta →
o status muda → o cliente recebe **push** no celular e o ERP recebe **webhook**.

---

## 2. Arquitetura implementada

```mermaid
flowchart LR
  subgraph APP["Clientes"]
    MOB["📱 App mobile"]
    ERP["🏢 Endpoint webhook<br/>do cliente"]
  end

  subgraph API["Backend NestJS (um processo, módulos separados)"]
    PIXC["PixController<br/>POST /pix/transferir<br/>POST /pix/transacoes/:id/devolucoes"]
    PIXS["PixService / DevolucoesService<br/>(ledger + outbox na MESMA tx)"]
    RELAY["OutboxRelay<br/>(polling, SKIP LOCKED)"]
    ADP["SpiAdapterService<br/>(único que conhece XML)"]
    CORE["PixSpiService<br/>(máquina de estados)"]
    REC["ReconciliacaoService"]
    FAN["WebhookFanout"]
    DISP["WebhookDispatcher<br/>(HMAC, retry, DLQ)"]
    NOT["NotificacoesService"]
  end

  subgraph DB["MySQL"]
    T[("transacoes / lancamentos")]
    OB[("outbox_eventos")]
    IB[("inbox_eventos")]
    PD[("pix_devolucoes")]
    SM[("pix_spi_mensagens<br/>(XML bruto)")]
    WE[("webhook_endpoints / entregas")]
    NT[("notificacoes / dispositivos_push")]
  end

  subgraph K["Kafka"]
    K1["pix.spi.outbound"]
    K2["pix.spi.inbound"]
    K3["pix.payments.events"]
    K4["pix.returns.events"]
    K5["pix.webhooks.dispatch"]
    KD["*.dlq"]
  end

  SPI["🏛️ SPI / BACEN<br/>(SpiSimulador)"]
  PUSH["Expo Push<br/>(FCM / APNs)"]

  MOB -->|HTTPS + JWT| PIXC --> PIXS --> T
  PIXS --> OB
  OB --> RELAY
  RELAY --> K1 & K2 & K3 & K4
  K1 --> ADP -->|"pacs.008 / pacs.004 / pacs.002 (XML)"| SPI
  SPI -->|"pacs.002 / pacs.008 / pacs.004 (XML)"| ADP
  ADP --> SM
  ADP -->|outbox| K2
  K2 --> CORE --> T & PD
  CORE -->|outbox| K1 & K3 & K4
  REC -->|consulta| SPI
  REC --> CORE
  K3 & K4 --> FAN --> WE
  FAN --> K5 --> DISP -->|"POST + X-Webhook-Signature"| ERP
  DISP --> KD
  K3 & K4 --> NOT --> NT
  NOT --> PUSH --> MOB
  CORE --> IB
```

### Onde está cada peça

| Pasta | Responsabilidade |
|---|---|
| `src/mensageria/` | `Barramento` (porta) com `BarramentoKafka` e `BarramentoMemoria`; `OutboxService`, `OutboxRelayService`, `InboxService`, `ConsumidorService` (retry + DLQ), tópicos e envelope |
| `src/spi/iso20022/` | Modelo canônico, codec XML ⇄ canônico (pacs.008/002/004), geração de `EndToEndId` / `ReturnId` / `MsgId` |
| `src/spi/` | `SpiGateway` (porta), `SpiSimulador`, `SpiAdapterService`, endpoints do simulador |
| `src/pix/` | `PixService` (envio), `DevolucoesService` (pacs.004 de saída), `eventos-pix.ts` (catálogo) |
| `src/pix/spi/` | `PixSpiService` (consome `pix.spi.inbound`), máquina de estados, ledger (estorno/devolução), reconciliação |
| `src/webhooks/` | CRUD de endpoints, fan-out, dispatcher, HMAC, SSRF, política de retry |
| `src/notificacoes/` | Caixa de notificações, registro de dispositivos, provedores de push (Expo / log) |

---

## 3. Sequência: app mobile envia Pix para outro banco (pacs.008 → pacs.002)

```mermaid
sequenceDiagram
  autonumber
  participant App as 📱 App mobile
  participant API as PixController/Service
  participant DB as MySQL
  participant R as OutboxRelay
  participant K as Kafka
  participant AD as SPI Adapter
  participant SPI as SPI (simulador)
  participant PS as PixSpiService
  participant WH as Webhooks
  participant NT as Notificações
  participant ERP as Endpoint do cliente

  App->>API: POST /api/pix/transferir (idempotencyKey)
  API->>DB: TX: intenção (E2E gerado) + lock conta + saldo<br/>+ 2 lançamentos + statusSpi=CRIADO<br/>+ outbox(spi.comando.enviar pacs.008)
  API-->>App: 202 PENDENTE { endToEndId, statusSpi: CRIADO }
  R->>DB: SELECT ... FOR UPDATE SKIP LOCKED
  R->>K: pix.spi.outbound (key = E2E)
  K->>AD: comando pacs.008
  AD->>AD: canônico → XML ISO 20022
  AD->>SPI: pacs.008
  AD->>DB: TX: inbox + XML bruto + outbox(spi.mensagem.enviada)
  R->>K: pix.spi.inbound
  K->>PS: enviada → CRIADO→ENVIADO + evento pix.payment.sent
  SPI-->>AD: pacs.002 ACCC (ou RJCT)
  AD->>DB: TX: XML bruto (dedupe MsgId) + outbox(spi.mensagem.recebida)
  R->>K: pix.spi.inbound
  K->>PS: pacs.002
  alt ACCC
    PS->>DB: TX: inbox + LIQUIDADO/CONCLUIDA + outbox(pix.payment.settled)
  else RJCT
    PS->>DB: TX: inbox + REJEITADO/FALHA + ESTORNO no ledger + outbox(pix.payment.rejected)
  end
  R->>K: pix.payments.events
  par push
    K->>NT: evento
    NT->>DB: notificação (1 por evento)
    NT-->>App: 🔔 "Pix enviado" / "Pix não concluído"
  and webhook
    K->>WH: evento → entrega por endpoint inscrito
    WH->>ERP: POST + X-Webhook-Signature (HMAC)
    ERP-->>WH: 2xx
  end
  App->>API: GET /api/transacoes/:id (ao abrir o push)
```

---

## 4. Sequência: outro banco paga nosso cliente (pacs.008 de entrada)

```mermaid
sequenceDiagram
  autonumber
  participant SPI as SPI (outro banco)
  participant AD as SPI Adapter
  participant K as Kafka
  participant PS as PixSpiService
  participant DB as MySQL
  participant NT as Notificações
  participant App as 📱 App do recebedor

  SPI->>AD: pacs.008 (Cdtr ISPB = nosso, chave DICT)
  AD->>AD: valida XML / formato de IDs
  AD->>DB: TX: pix_spi_mensagens (UNIQUE MsgId) + outbox
  AD->>K: pix.spi.inbound (via relay)
  K->>PS: pacs.008
  PS->>DB: resolve chave → conta
  alt conta encontrada
    PS->>DB: TX: inbox + transação RECEBIDO (liquidação → cliente)<br/>+ outbox(pacs.002 ACSP) + outbox(pix.payment.received)
  else chave/conta inválida
    PS->>DB: TX: inbox + outbox(pacs.002 RJCT AC03)
  end
  K->>AD: pacs.002 → XML → SPI
  K->>NT: pix.payment.received
  NT-->>App: 🔔 "Você recebeu R$ 7,00 de Carlos"
```

---

## 5. Sequência: devoluções (pacs.004)

### 5.1 Nosso cliente devolve um Pix recebido

```mermaid
sequenceDiagram
  autonumber
  participant App as 📱 App
  participant API as DevolucoesService
  participant DB as MySQL
  participant K as Kafka
  participant AD as SPI Adapter
  participant SPI as SPI
  participant PS as PixSpiService

  App->>API: POST /api/pix/transacoes/:id/devolucoes {valor, motivo, idempotencyKey}
  API->>DB: TX: lock Pix original + soma devoluções ≤ valor<br/>+ lock conta + saldo + DEVOLUCAO no ledger<br/>+ pix_devolucoes SOLICITADA + outbox(pacs.004)
  API-->>App: 202 { returnId: D..., status: SOLICITADA }
  K->>AD: pacs.004 → XML → SPI
  AD->>K: spi.mensagem.enviada → SOLICITADA→ENVIADA
  SPI-->>AD: pacs.002 (OrgnlEndToEndId = RtrId)
  K->>PS: pacs.002 da devolução
  alt ACCC
    PS->>DB: LIQUIDADA + Pix original DEVOLVIDO_PARCIAL/DEVOLVIDO + pix.return.settled
  else RJCT
    PS->>DB: REJEITADA + ESTORNO ao cliente + pix.return.rejected
  end
```

### 5.2 Outro banco devolve um Pix que enviamos

```mermaid
sequenceDiagram
  participant SPI as SPI
  participant AD as SPI Adapter
  participant PS as PixSpiService
  participant DB as MySQL
  participant App as 📱 App do pagador

  SPI->>AD: pacs.004 (OrgnlEndToEndId)
  AD->>PS: via pix.spi.inbound
  PS->>DB: Pix original ENVIADO + LIQUIDADO? soma ≤ valor?
  PS->>DB: TX: DEVOLUCAO (liquidação → cliente) + pix_devolucoes RECEBIDA<br/>+ status DEVOLVIDO* + outbox(pacs.002 ACSP) + pix.return.received
  PS-->>App: 🔔 "Joao devolveu R$ 2,50 do seu Pix"
```

---

## 6. Máquinas de estado

`transacoes.status` continua sendo o contrato do front (`PENDENTE`/`CONCLUIDA`/`FALHA`).
O estado SPI fica em `transacoes.status_spi` (só em Pix que cruza instituições).

```mermaid
stateDiagram-v2
  [*] --> CRIADO: POST /pix/transferir (202)
  CRIADO --> ENVIADO: spi.mensagem.enviada
  CRIADO --> LIQUIDADO: pacs.002 antes do "enviada"
  CRIADO --> REJEITADO: pacs.002 RJCT
  ENVIADO --> LIQUIDADO: pacs.002 ACCC/ACSC
  ENVIADO --> REJEITADO: pacs.002 RJCT (+ estorno)
  ENVIADO --> RECONCILIANDO: sem pacs.002 em 30s
  RECONCILIANDO --> LIQUIDADO: consulta = liquidado
  RECONCILIANDO --> REJEITADO: consulta = rejeitado / não encontrado
  LIQUIDADO --> DEVOLVIDO_PARCIAL: pacs.004
  LIQUIDADO --> DEVOLVIDO: pacs.004 total
  DEVOLVIDO_PARCIAL --> DEVOLVIDO
  [*] --> RECEBIDO: pacs.008 de entrada
  RECEBIDO --> DEVOLVIDO_PARCIAL
  RECEBIDO --> DEVOLVIDO
  REJEITADO --> [*]
  DEVOLVIDO --> [*]
```

| statusSpi | status (front) |
|---|---|
| `CRIADO`, `ENVIADO`, `RECONCILIANDO` | `PENDENTE` |
| `LIQUIDADO`, `RECEBIDO`, `DEVOLVIDO*` | `CONCLUIDA` |
| `REJEITADO` | `FALHA` (valor estornado) |

Regras: transições **só avançam** (mensagem atrasada/duplicada é ignorada), toda
transição é `UPDATE ... WHERE versao = ?` (lock otimista), e `pacs.002` que chega antes
do registro local lança `ErroTransitorio` → retry com backoff.

---

## 7. Garantias de entrega

```mermaid
flowchart TD
  A["Regra de negócio + evento<br/>na MESMA transação (outbox)"] --> B["Relay publica<br/>(at-least-once)"]
  B --> C{"Consumidor"}
  C -->|"inbox: (consumidor, eventId) já existe"| D["ignora (idempotente)"]
  C -->|novo| E["efeito + inbox na mesma TX"]
  E -->|erro transitório| F["retry backoff 200ms·2ⁿ<br/>(5 tentativas)"]
  F --> C
  E -->|erro permanente / esgotou| G["topico.dlq + log de alerta"]
  E -->|ok| H["commit do offset"]
```

- **Chave de partição = EndToEndId** → pacs.008, pacs.002 e pacs.004 do mesmo pagamento em ordem.
- **Ledger idempotente por chave determinística**: `estorno:<id>`, `devolucao:<returnId>`,
  `spi:<e2e>` no `UNIQUE(idempotency_key)` — nem uma reentrega consegue lançar duas vezes.
- **XML bruto** de toda mensagem em `pix_spi_mensagens` (`UNIQUE(message_id, direcao)` descarta reentrega do SPI).

### Webhooks

```mermaid
flowchart TD
  A["pix.payments.events / pix.returns.events"] --> B["Fan-out: 1 entrega por endpoint inscrito<br/>UNIQUE(endpoint, evento)"]
  B --> C["pix.webhooks.dispatch (key = endpointId)"]
  C --> D["claim atômico da entrega"]
  D --> E{"POST (timeout 5s, sem redirect)<br/>SSRF checado no envio"}
  E -->|2xx| F["ENTREGUE; falhas = 0"]
  E -->|"4xx (≠408/429)"| G["FALHA_PERMANENTE → DLQ"]
  E -->|410| H["endpoint SUSPENSO → DLQ"]
  E -->|"5xx / timeout / 408 / 429"| I{"tentativa < 7?"}
  I -->|sim| J["RETENTANDO: 1m, 5m, 30m, 2h, 6h, 24h ±20%<br/>(respeita Retry-After)"]
  J -->|varredura a cada 5s| C
  I -->|não| K["ESGOTADO → DLQ"]
  G & H & K --> L["POST /api/webhooks/entregas/:id/replay"]
  F -.-> M["20 falhas seguidas → endpoint SUSPENSO"]
```

Cabeçalhos: `X-Webhook-Id`, `X-Webhook-Delivery`, `X-Webhook-Attempt`,
`X-Webhook-Timestamp`, `X-Webhook-Signature: t=<ts>,v1=<hmac>` com
`HMAC-SHA256(segredo, "<ts>.<corpo bruto>")`. Após `rotate-secret`, vão **dois** `v1=` por 24h.

Verificação no cliente (Node):

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function webhookValido(segredo, cabecalho, corpoBruto) {
  const partes = cabecalho.split(',').map((p) => p.split('='));
  const t = Number(partes.find(([k]) => k === 't')?.[1]);
  if (Math.abs(Date.now() / 1000 - t) > 300) return false; // anti-replay
  const esperado = createHmac('sha256', segredo).update(`${t}.${corpoBruto}`).digest();
  return partes
    .filter(([k]) => k === 'v1')
    .some(([, v]) => {
      const b = Buffer.from(v, 'hex');
      return b.length === esperado.length && timingSafeEqual(b, esperado);
    });
}
// E deduplique por X-Webhook-Id: a entrega é at-least-once e pode vir fora de ordem.
```

---

## 8. Integração do app mobile

### 8.1 Rotas

| Método | Rota | Uso no app |
|---|---|---|
| `POST` | `/api/pix/transferir` | Pix interno → **201 CONCLUIDA**; outro banco → **202 PENDENTE** + `endToEndId` |
| `GET` | `/api/transacoes/:id` | Status atual (`status`, `statusSpi`, `motivoRejeicao`, `endToEndId`) |
| `POST` | `/api/pix/transacoes/:id/devolucoes` | Devolver Pix recebido de outro banco (202) |
| `GET` | `/api/pix/transacoes/:id/devolucoes` | Devoluções de um Pix |
| `POST` | `/api/notificacoes/dispositivos` | Registrar token de push (a cada abertura do app) |
| `DELETE` | `/api/notificacoes/dispositivos/:token` | Logout |
| `GET` | `/api/notificacoes?naoLidas=true` | Caixa de notificações + contador `naoLidas` |
| `PATCH` | `/api/notificacoes/:id/lida` · `POST /api/notificacoes/lidas` | Marcar lida(s) |
| `POST/GET/PATCH/DELETE` | `/api/webhooks/endpoints[/:id]` | Webhooks do cliente (+ `rotate-secret`, `test`) |
| `GET` · `POST` | `/api/webhooks/entregas` · `/entregas/:id/replay` | Histórico e reprocessamento |
| `POST` | `/api/spi/simulador/pix-recebido` · `/devolucao-recebida` | **Só dev:** outro banco manda pacs.008 / pacs.004 |

### 8.2 Expo (React Native)

```ts
import * as Notifications from 'expo-notifications';

// Depois do login:
const { data: token } = await Notifications.getExpoPushTokenAsync();
await api.post('/notificacoes/dispositivos', { token, plataforma: Platform.OS === 'ios' ? 'IOS' : 'ANDROID' });

// Tocar no push abre o comprovante:
Notifications.addNotificationResponseReceivedListener((r) => {
  const { transacaoId } = r.notification.request.content.data;
  navigation.navigate('Comprovante', { transacaoId }); // GET /api/transacoes/:id
});
```

Padrão recomendado para o Pix externo: mostrar "Em processamento" com o 202, e
atualizar a tela pelo push **ou** por polling curto de `GET /api/transacoes/:id` enquanto
a tela estiver aberta (o push pode atrasar ou não chegar; a caixa de notificações e o
GET são a fonte da verdade).

---

## 9. Como rodar

### 9.1 Sem Kafka (padrão; nada para instalar)

```bash
# .env
MENSAGERIA_DRIVER=memoria
npm run db:deploy      # aplica a migração 20260929000000_mensageria_spi
npm run start:dev
```

O barramento em memória tem a mesma semântica (grupos, ordem, reentrega). O outbox
continua no MySQL, então nada se perde num restart.

### 9.2 Com Kafka (Docker Desktop)

```bash
docker compose up -d           # Kafka (localhost:9092) + Kafka UI (localhost:8080)
docker compose ps              # aguarde kafka = healthy
```

No `.env`: `MENSAGERIA_DRIVER=kafka` e `KAFKA_BROKERS=localhost:9092`; reinicie a API.
Os tópicos (e as DLQs) são criados na subida. Veja as mensagens em http://localhost:8080.

### 9.3 Simulador do SPI: regras pelos centavos do valor

| Centavos | Pix enviado (pacs.008) | Devolução enviada (pacs.004) |
|---|---|---|
| `,99` | `pacs.002 RJCT AC03` → estorno | `pacs.002 RJCT AM02` → estorno |
| `,98` | não responde → reconciliação acha **liquidado** | ACCC |
| `,97` | não responde e consulta não acha → reconciliação **rejeita** (AB03) após 120s | ACCC |
| demais | `pacs.002 ACCC` após `SPI_SIMULADOR_ATRASO_MS` | ACCC |

Pix para outro banco exige a chave salva nos contatos (`POST /api/contatos` com
`nomeFavorecido` e `banco`), como já era antes.

### 9.4 Variáveis de ambiente

| Variável | Default | |
|---|---|---|
| `MENSAGERIA_DRIVER` | `memoria` | `kafka` \| `memoria` |
| `KAFKA_BROKERS` | `localhost:9092` | lista separada por vírgula |
| `KAFKA_CLIENT_ID` / `KAFKA_REPLICACAO` | `cactvs-backend` / `1` | RF=3 em produção |
| `OUTBOX_INTERVALO_MS` / `OUTBOX_LOTE` | `500` / `100` | polling do relay |
| `CONSUMIDOR_MAX_TENTATIVAS` / `CONSUMIDOR_BACKOFF_MS` | `5` / `200` | antes da DLQ |
| `PIX_ISPB` / `SPI_ISPB_CONTRAPARTE` | `12345678` / `87654321` | |
| `SPI_SIMULADOR_ATRASO_MS` | `1500` | latência simulada do SPI |
| `RECONCILIACAO_APOS_SEGUNDOS` / `_JANELA_SEGUNDOS` / `_INTERVALO_MS` | `30` / `120` / `15000` | |
| `WEBHOOK_CHAVE_CIFRA` | derivada do `JWT_SECRET` | 32 bytes base64 (AES-256-GCM dos segredos) |
| `WEBHOOK_PERMITIR_INSEGURO` | `false` | **só dev**: aceita `http://localhost` |
| `WEBHOOK_VARREDURA_MS` | `5000` | agenda de retry |
| `PUSH_PROVEDOR` / `EXPO_ACCESS_TOKEN` | `log` / — | `expo` para push real |

### 9.5 Testes

- `npm test` — codec ISO 20022 (ida e volta, IDs, dinheiro, validação), máquina de
  estados, HMAC, cifra dos segredos, SSRF e política de retry.
- Cenários E2E validados contra a API rodando: Pix interno com push; pacs.008 → ACCC;
  pacs.008 → RJCT com estorno; reenvio idempotente; pacs.008 de entrada; pacs.004 de saída
  parcial e recusa acima do devolvível; pacs.004 de entrada; 10 webhooks com HMAC válido;
  reconciliação (`,98`).

---

## 10. O que falta para produção

| Item | Situação |
|---|---|
| Conexão real com o SPI (RSFN ou PSP parceiro) | Implementar outro `SpiGateway` |
| XSD oficial do BACEN + assinatura XMLDSig (ICP-Brasil, HSM) | `assinaturaValida` hoje é sempre `true` |
| DICT real (resolver chave → conta/ISPB do recebedor) | Hoje usa o contato salvo |
| XML bruto em storage de objetos criptografado | Hoje em `pix_spi_mensagens.xml` (MEDIUMTEXT) |
| Kafka com TLS/SASL, ACLs, RF=3, `min.insync.replicas=2` | Compose é single-node sem auth |
| Schema Registry (Avro/Protobuf) | Envelope JSON versionado (`eventVersion`) |
| Serviços separados (deploy independente) | Módulos já isolados, comunicando só por tópicos |
| Métricas Prometheus / OpenTelemetry (§13 do desenho) | `correlationId`/`causationId` já propagados no envelope |
| Conciliação diária camt.052/053 | Não implementado |
| Alerta de DLQ, lag e outbox parado | Hoje só log de erro |
