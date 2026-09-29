-- CreateTable
CREATE TABLE `contatos_pix` (
    `id` CHAR(36) NOT NULL,
    `conta_id` CHAR(36) NOT NULL,
    `destino_id` CHAR(36) NOT NULL,
    `apelido` VARCHAR(60) NULL,
    `tipo_chave` ENUM('CPF', 'EMAIL', 'TELEFONE') NOT NULL,
    `chave` VARCHAR(180) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `contatos_pix_destino_id_idx`(`destino_id`),
    UNIQUE INDEX `contatos_pix_conta_id_tipo_chave_chave_key`(`conta_id`, `tipo_chave`, `chave`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `contatos_pix` ADD CONSTRAINT `contatos_pix_conta_id_fkey` FOREIGN KEY (`conta_id`) REFERENCES `contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contatos_pix` ADD CONSTRAINT `contatos_pix_destino_id_fkey` FOREIGN KEY (`destino_id`) REFERENCES `contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

