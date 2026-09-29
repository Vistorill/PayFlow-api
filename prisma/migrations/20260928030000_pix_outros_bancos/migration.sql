-- AlterTable
ALTER TABLE `contas` ADD COLUMN `sistema` VARCHAR(40) NULL;

-- AlterTable
ALTER TABLE `contatos_pix` ADD COLUMN `banco` VARCHAR(60) NULL,
    ADD COLUMN `nome_favorecido` VARCHAR(120) NULL,
    MODIFY `destino_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `transacoes` ADD COLUMN `favorecido_banco` VARCHAR(60) NULL,
    ADD COLUMN `favorecido_nome` VARCHAR(120) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `contas_sistema_key` ON `contas`(`sistema`);


-- Marca a tesouraria criada pelo seed (CPF reservado 000.000.000-00) como
-- conta de sistema. SHA2 do MySQL = mesmo hex do hashCpf do Node.
UPDATE `contas` SET `sistema` = 'TESOURARIA' WHERE `cpf_hash` = SHA2('00000000000', 256);
