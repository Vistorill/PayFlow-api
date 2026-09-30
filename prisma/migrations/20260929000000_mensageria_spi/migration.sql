-- AlterTable
ALTER TABLE `transacoes` ADD COLUMN `direcao_spi` ENUM('ENVIADO', 'RECEBIDO') NULL,
    ADD COLUMN `end_to_end_id` VARCHAR(32) NULL,
    ADD COLUMN `motivo_rejeicao` VARCHAR(8) NULL,
    ADD COLUMN `pagador_banco` VARCHAR(60) NULL,
    ADD COLUMN `pagador_nome` VARCHAR(120) NULL,
    ADD COLUMN `status_spi` ENUM('CRIADO', 'ENVIADO', 'LIQUIDADO', 'REJEITADO', 'RECONCILIANDO', 'RECEBIDO', 'DEVOLVIDO_PARCIAL', 'DEVOLVIDO') NULL,
    ADD COLUMN `versao` INTEGER NOT NULL DEFAULT 0,
    MODIFY `tipo` ENUM('PIX', 'BOLETO', 'CARTAO', 'SAQUE', 'CREDITO', 'ESTORNO', 'DEVOLUCAO') NOT NULL;

-- CreateTable
CREATE TABLE `pix_devolucoes` (
    `id` CHAR(36) NOT NULL,
    `return_id` VARCHAR(32) NOT NULL,
    `idempotency_key` VARCHAR(100) NULL,
    `transacao_original_id` CHAR(36) NOT NULL,
    `transacao_ledger_id` CHAR(36) NULL,
    `direcao` ENUM('ENVIADA', 'RECEBIDA') NOT NULL,
    `status` ENUM('SOLICITADA', 'ENVIADA', 'LIQUIDADA', 'REJEITADA') NOT NULL,
    `valor` DECIMAL(15, 2) NOT NULL,
    `motivo` VARCHAR(8) NOT NULL,
    `info_adicional` VARCHAR(140) NULL,
    `motivo_rejeicao` VARCHAR(8) NULL,
    `versao` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pix_devolucoes_return_id_key`(`return_id`),
    UNIQUE INDEX `pix_devolucoes_idempotency_key_key`(`idempotency_key`),
    UNIQUE INDEX `pix_devolucoes_transacao_ledger_id_key`(`transacao_ledger_id`),
    INDEX `pix_devolucoes_transacao_original_id_idx`(`transacao_original_id`),
    INDEX `pix_devolucoes_status_updated_at_idx`(`status`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pix_spi_mensagens` (
    `id` CHAR(36) NOT NULL,
    `message_id` VARCHAR(32) NOT NULL,
    `tipo` VARCHAR(16) NOT NULL,
    `direcao` VARCHAR(8) NOT NULL,
    `end_to_end_id` VARCHAR(32) NULL,
    `return_id` VARCHAR(32) NULL,
    `xml` MEDIUMTEXT NOT NULL,
    `assinatura_valida` BOOLEAN NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pix_spi_mensagens_end_to_end_id_idx`(`end_to_end_id`),
    INDEX `pix_spi_mensagens_return_id_idx`(`return_id`),
    UNIQUE INDEX `pix_spi_mensagens_message_id_direcao_key`(`message_id`, `direcao`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_eventos` (
    `id` CHAR(36) NOT NULL,
    `aggregate_id` VARCHAR(64) NOT NULL,
    `topico` VARCHAR(128) NOT NULL,
    `chave` VARCHAR(64) NOT NULL,
    `tipo_evento` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDENTE',
    `tentativas` INTEGER NOT NULL DEFAULT 0,
    `ultimo_erro` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `publicado_em` DATETIME(3) NULL,

    INDEX `outbox_eventos_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inbox_eventos` (
    `consumidor` VARCHAR(64) NOT NULL,
    `message_id` VARCHAR(64) NOT NULL,
    `processado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`consumidor`, `message_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_endpoints` (
    `id` CHAR(36) NOT NULL,
    `conta_id` CHAR(36) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `descricao` VARCHAR(140) NULL,
    `segredo_cifrado` VARCHAR(255) NOT NULL,
    `segredo_anterior_cifrado` VARCHAR(255) NULL,
    `segredo_anterior_ate` DATETIME(3) NULL,
    `eventos` JSON NOT NULL,
    `status` ENUM('ATIVO', 'SUSPENSO', 'DESATIVADO') NOT NULL DEFAULT 'ATIVO',
    `falhas_consecutivas` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `webhook_endpoints_conta_id_idx`(`conta_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_entregas` (
    `id` CHAR(36) NOT NULL,
    `endpoint_id` CHAR(36) NOT NULL,
    `evento_id` VARCHAR(64) NOT NULL,
    `tipo_evento` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDENTE', 'ENTREGUE', 'RETENTANDO', 'ESGOTADO', 'FALHA_PERMANENTE') NOT NULL DEFAULT 'PENDENTE',
    `tentativa` INTEGER NOT NULL DEFAULT 0,
    `ultimo_http_status` INTEGER NULL,
    `ultimo_erro` VARCHAR(500) NULL,
    `proxima_tentativa_em` DATETIME(3) NULL,
    `entregue_em` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `webhook_entregas_status_proxima_tentativa_em_idx`(`status`, `proxima_tentativa_em`),
    UNIQUE INDEX `webhook_entregas_endpoint_id_evento_id_key`(`endpoint_id`, `evento_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dispositivos_push` (
    `id` CHAR(36) NOT NULL,
    `conta_id` CHAR(36) NOT NULL,
    `token` VARCHAR(255) NOT NULL,
    `plataforma` ENUM('ANDROID', 'IOS', 'WEB') NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dispositivos_push_token_key`(`token`),
    INDEX `dispositivos_push_conta_id_ativo_idx`(`conta_id`, `ativo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notificacoes` (
    `id` CHAR(36) NOT NULL,
    `conta_id` CHAR(36) NOT NULL,
    `evento_id` VARCHAR(64) NOT NULL,
    `tipo` VARCHAR(64) NOT NULL,
    `titulo` VARCHAR(120) NOT NULL,
    `corpo` VARCHAR(255) NOT NULL,
    `dados` JSON NOT NULL,
    `lida_em` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notificacoes_conta_id_created_at_idx`(`conta_id`, `created_at`),
    UNIQUE INDEX `notificacoes_conta_id_evento_id_key`(`conta_id`, `evento_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `transacoes_end_to_end_id_key` ON `transacoes`(`end_to_end_id`);

-- CreateIndex
CREATE INDEX `transacoes_status_spi_updated_at_idx` ON `transacoes`(`status_spi`, `updated_at`);

-- AddForeignKey
ALTER TABLE `pix_devolucoes` ADD CONSTRAINT `pix_devolucoes_transacao_original_id_fkey` FOREIGN KEY (`transacao_original_id`) REFERENCES `transacoes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pix_devolucoes` ADD CONSTRAINT `pix_devolucoes_transacao_ledger_id_fkey` FOREIGN KEY (`transacao_ledger_id`) REFERENCES `transacoes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_endpoints` ADD CONSTRAINT `webhook_endpoints_conta_id_fkey` FOREIGN KEY (`conta_id`) REFERENCES `contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_entregas` ADD CONSTRAINT `webhook_entregas_endpoint_id_fkey` FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dispositivos_push` ADD CONSTRAINT `dispositivos_push_conta_id_fkey` FOREIGN KEY (`conta_id`) REFERENCES `contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notificacoes` ADD CONSTRAINT `notificacoes_conta_id_fkey` FOREIGN KEY (`conta_id`) REFERENCES `contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

