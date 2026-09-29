-- Chave Pix de celular. Nullable: contas antigas continuam validas so com CPF/e-mail.
ALTER TABLE `contas` ADD COLUMN `telefone` VARCHAR(11) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `contas_telefone_key` ON `contas`(`telefone`);
