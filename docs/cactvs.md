: é explícito sobre o domínio, o plural indica "muitos pagamentos" e soa como projeto real (não teste_db). Alternativas que eu descartaria: cactvs (genérico demais), banco (palavra reservada na maioria dos dialetos).
String de conexão:
mysql://root:SUA_SENHA@localhost:3306/cactvs_payments
Tabelas dentro dele (3, só):
Tabela	O que guarda	Regra importante
contas	Identidade: id, nome, cpf, email, senha_hash	Não tem coluna saldo
transacoes	A intenção: tipo, status, valor, idempotencyKey, origem, destino	idempotencyKey com UNIQUE
lancamentos	O fato contábil: conta_id, tipo (debito/credito), valor, transacao_id	Append-only. Nunca UPDATE nem DELETE
Por que 3 e não 2: contas é quem, transacoes é o que tentou acontecer, lancamentos é o que de fato aconteceu. Uma transação pode falhar (não gera lançamento). Um lançamento é a verdade contábil imutável.
2. A regra que define o sistema inteiro
saldo da conta = SUM(valor dos lancamentos com tipo='credito')
               - SUM(valor dos lancamentos com tipo='debito')
O saldo nunca é salvo. É sempre calculado. Se alguém te perguntar "e se ficar lento?", a resposta de entrevista é: "esse cálculo é um cache materializado, e eu posso reconstruí-lo do zero a partir do ledger, porque o ledger é a fonte da verdade."
Partida dobrada: toda transferência insere exatamente 2 lançamentos que somam zero.
Pix de R$50 da Ana para o Bruno:
  lancamento 1 → conta Ana   → debito  → 50,00
  lancamento 2 → conta Bruno → credito → 50,00
                 soma = 0,00  ✓  (própria conta, "dinheiro do sistema", sempre fechar)
Se a soma do par não der zero, o lançamento foi gravado errado. É por isso que dá pra auditar tudo.
3. A sequência do sistema (o fluxo de um Pix)
Esta é a parte que você vai narrar na entrevista. 11 passos:
Fase A — Entrada e validação (antes de tocar no dinheiro)
Front envia POST /pix/transferir com { chaveDestino, valor, idempotencyKey } + header Authorization: Bearer <jwt>
Guard valida o JWT e extrai o contaId do token — nunca do body. (Se vier do body, qualquer um faz Pix pela conta alheia.)
ValidationPipe rejeita: valor ≤ 0, campos vazios, body malformado
Regra: destino não pode ser a própria origem
Fase B — Idempotência (a barreira anti-duplicidade)
5. INSERT em transacoes com a idempotencyKey
Se o índice UNIQUE estourar → alguém já fez essa requisição → busca a transação existente e devolve ela com 200. Não é erro, é sucesso idempotente.
Isso acontece antes de debitar. É o que impede "R$50 cobrados 3 vezes" quando o app reenvia a requisição ou o usuário clica duas vezes.
Status da transação entra como pendente
Fase C — A transação contábil (o dinheiro propriamente dito)
7. BEGIN TRANSACTION
8. Trava a linha: SELECT ... FOR UPDATE nos lançamentos da conta origem. Isso impede que dois Pix simultâneos leiam o mesmo saldo e os dois passem. (Sem isso: saldo 100, dois Pix de 80 rodando ao mesmo tempo → os dois "passam" → saldo −60.)
9. Recalcula o saldo com base nos lançamentos
10. Regra de negócio: saldo ≥ valor?
    - Não → ROLLBACK, marca transação como falha, retorna 422 { codigo: "SALDO_INSUFICIENTE" }
    - Sim → segue
11. Insere os 2 lançamentos (débito + crédito) e marca a transação como concluida
12. COMMIT
Fase D — O que existe de verdade mas a gente não faz agora
13. Publica evento TRANSACAO_CONCLUIDA num event bus (Kafka)
14. Consumidores reagem: notificação push, atualização do extrato em cache, ETL pro data warehouse, feed de antifraude
Guarde o passo 13 na cabeça. É o que mostra que você sabe que ledger e liquidação são coisas separadas (o doc HTML insiste nisso: "conta ≠ ledger ≠ liquidação").
Fluxo de leitura (bem mais simples):
GET /contas/:id/saldo → SUM(credito) - SUM(debito)
GET /contas/:id/extrato → SELECT * FROM lancamentos WHERE conta_id = ? ORDER BY created_at DESC
4. Como vamos proceder (ordem de construção)
Você já tem o scaffold NestJS 11 em backend/. O que muda: trocamos TypeORM por Prisma 6 (já instalei o TypeORM na etapa anterior, ele sai).
Fase	O quê	Por que nessa ordem
0	Trocar deps: remover TypeORM, instalar prisma@6.19.3 + @prisma/client@6.19.3	—
1	prisma/schema.prisma com os 3 models + .env	O schema é a fonte da verdade. Código nasce depois
2	prisma migrate dev → cria o banco cactvs_payments e as tabelas	Valida o schema de verdade
3	prisma/seed.ts → cria 2 contas com R$ 1.000 cada	Você precisa de dados pra testar na mão
4	main.ts (ValidationPipe global, prefixo /api, Swagger em /docs)	Swagger é Argumento #1 de entrevista: o tester clica e vê a API
5	Módulo Auth — POST /auth/login → JWT	Antes de tudo, porque os outros endpoints são protegidos
6	Módulo Contas — criar conta, buscar, saldo, extrato	Leitura é fácil, serve pra você validar o schema
7	Módulo Pix — POST /pix/transferir	O coração. Só aqui tem lock e idempotência
8	Teste manual via Swagger: transferir 2x com a mesma chave	Prova de que a idempotência funciona
9	npm run lint + npm run build + npm test	Não entregue código que não compila
Depois disso é o front (React + Vite), mas é a parte fácil.
5. Três coisas do Prisma que vão te morder (já adianto)
Decimal não serializa bonito. Prisma mapeia Decimal(15,2) pra um objeto Decimal.js. Se você mandar direto no JSON da resposta, o front recebe {"valor":{"s":...}} em vez de 50.00. Solução: converta com .toFixed(2) (string) ou .toNumber() na borda (DTO/serializer).
Prisma não expõe lock de linha na API. findUnique não tem "com lock". Você precisa de SELECT ... FOR UPDATE via $queryRaw dentro de $transaction. Isso é normal, todo mundo que faz ledger com Prisma faz assim.
Fixe o isolation level. $transaction(async (tx) => {...}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }). No MySQL o default já é esse, mas declarar explicitamente mostra que você pensou nisso.
6. Bloqueios — preciso de você
Pergunta 1 (bloqueante): Qual é a senha do root do MySQL? Testei e root sem senha retorna Access denied (1045). Sem isso eu não consigo rodar prisma migrate dev nem criar o banco. Alternativa: me diga uma senha nova pra criar, ou rode você mesmo:
CREATE DATABASE cactvs_payments CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'cactvs'@'localhost' IDENTIFIED BY 'cactvs_dev';
GRANT ALL PRIVILEGES ON cactvs_payments.* TO 'cactvs'@'localhost';
FLUSH PRIVILEGES;
(usuário dedicado em vez de root — é o que se faz de verdade, e é um ponto a mais na entrevista)
Pergunta 2: o .env com a senha deve ficar no .gitignore? (recomendo sim, e commitamos um .env.example)
Me responda a senha e eu executo o plano das fases 0 a 9.