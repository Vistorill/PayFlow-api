-- Registra na transacao qual chave Pix foi usada para achar o destino.
-- Nullable: transacoes antigas e as que nao sao Pix nao tem chave.
ALTER TABLE `transacoes`
    ADD COLUMN `tipo_chave` ENUM('CPF', 'EMAIL', 'TELEFONE') NULL,
    ADD COLUMN `chave_destino` VARCHAR(180) NULL;
