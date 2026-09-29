-- CreateTable
CREATE TABLE `contas` (
    `id` CHAR(36) NOT NULL,
    `nome` VARCHAR(120) NOT NULL,
    `cpf_masked` VARCHAR(14) NOT NULL,
    `cpf_hash` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `contas_cpf_hash_key`(`cpf_hash`),
    INDEX `contas_nome_idx`(`nome`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usuarios` (
    `id` CHAR(36) NOT NULL,
    `conta_id` CHAR(36) NOT NULL,
    `email` VARCHAR(180) NOT NULL,
    `senha_hash` VARCHAR(60) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `usuarios_conta_id_key`(`conta_id`),
    UNIQUE INDEX `usuarios_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transacoes` (
    `id` CHAR(36) NOT NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `tipo` ENUM('PIX', 'BOLETO', 'CARTAO', 'SAQUE', 'CREDITO') NOT NULL,
    `status` ENUM('PENDENTE', 'CONCLUIDA', 'FALHA') NOT NULL DEFAULT 'PENDENTE',
    `valor` DECIMAL(15, 2) NOT NULL,
    `origem_id` CHAR(36) NOT NULL,
    `destino_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `transacoes_idempotency_key_key`(`idempotency_key`),
    INDEX `transacoes_origem_id_created_at_idx`(`origem_id`, `created_at`),
    INDEX `transacoes_destino_id_idx`(`destino_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lancamentos` (
    `id` CHAR(36) NOT NULL,
    `transacao_id` CHAR(36) NOT NULL,
    `conta_id` CHAR(36) NOT NULL,
    `tipo` ENUM('DEBITO', 'CREDITO') NOT NULL,
    `valor` DECIMAL(15, 2) NOT NULL,
    `descricao` VARCHAR(140) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lancamentos_conta_id_created_at_idx`(`conta_id`, `created_at`),
    INDEX `lancamentos_transacao_id_idx`(`transacao_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `usuarios` ADD CONSTRAINT `usuarios_conta_id_fkey` FOREIGN KEY (`conta_id`) REFERENCES `contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transacoes` ADD CONSTRAINT `transacoes_origem_id_fkey` FOREIGN KEY (`origem_id`) REFERENCES `contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transacoes` ADD CONSTRAINT `transacoes_destino_id_fkey` FOREIGN KEY (`destino_id`) REFERENCES `contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lancamentos` ADD CONSTRAINT `lancamentos_transacao_id_fkey` FOREIGN KEY (`transacao_id`) REFERENCES `transacoes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lancamentos` ADD CONSTRAINT `lancamentos_conta_id_fkey` FOREIGN KEY (`conta_id`) REFERENCES `contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

