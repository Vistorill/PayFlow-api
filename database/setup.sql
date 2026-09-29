-- ============================================================================
--  Setup do banco Cactvs Payments
--  Rode UMA vez. Depois disso o Prisma cuida do resto via migrations.
--
--  Como rodar (escolha uma):
--   1) MySQL Workbench -> abra um schema -> abra este arquivo -> Execute
--   2) No terminal, logado como root:
--        mysql -u root -p < database\setup.sql
-- ============================================================================

-- 1. O banco
CREATE DATABASE IF NOT EXISTS cactvs_payments
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 2. O usuario da aplicacao (dedicado, nunca root)
CREATE USER IF NOT EXISTS 'cactvs'@'localhost' IDENTIFIED BY '12345678';
CREATE USER IF NOT EXISTS 'cactvs'@'127.0.0.1' IDENTIFIED BY '12345678';

-- 3. Permissoes: SOMENTE no banco do projeto, e somente o necessario
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON cactvs_payments.* TO 'cactvs'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON cactvs_payments.* TO 'cactvs'@'127.0.0.1';

FLUSH PRIVILEGES;

-- 4. Comprovacao
SELECT
  user,
  host,
  plugin
FROM mysql.user
WHERE user = 'cactvs';

SHOW GRANTS FOR 'cactvs'@'localhost';
