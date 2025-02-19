-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `telegramId` INTEGER NOT NULL,
    `verifySignature` VARCHAR(191) NOT NULL,
    `verifyWallet` VARCHAR(191) NOT NULL,
    `verified` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastCheck` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_telegramId_key`(`telegramId`),
    UNIQUE INDEX `User_verifyWallet_key`(`verifyWallet`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Wallet` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `label` VARCHAR(20) NULL,
    `address` VARCHAR(191) NOT NULL,
    `encodedPk` VARCHAR(256) NOT NULL,
    `rpc` VARCHAR(191) NULL,
    `buyAmount` DOUBLE NOT NULL DEFAULT '1',
    `buySlippage` INTEGER NOT NULL DEFAULT 10,
    `sellSlippage` INTEGER NOT NULL DEFAULT 10,
    `minMcap` INTEGER NOT NULL DEFAULT 100,
    `maxMcap` INTEGER NOT NULL DEFAULT 100,
    `minLiquidity` INTEGER NOT NULL DEFAULT 100,
    `maxLiquidity` INTEGER NOT NULL DEFAULT 100,
    `agScore` INTEGER NOT NULL DEFAULT 0,
    `deployerAge` INTEGER NOT NULL DEFAULT 0,
    `dexscreenerPaid` BOOLEAN NULL,
    `startHour` INTEGER NULL,
    `endHour` INTEGER NULL,
    `priorityFee` INTEGER NOT NULL DEFAULT 10000,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isMev` BOOLEAN NOT NULL DEFAULT false,
    `tipMev` INTEGER NOT NULL DEFAULT 10000,
    `triggerMode` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Wallet_address_key`(`address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Transaction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `walletId` INTEGER NOT NULL,
    `signature` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `amountIn` DOUBLE NOT NULL,
    `amountOut` DOUBLE NOT NULL,
    `tokenId` VARCHAR(191) NOT NULL,
    `poolId` VARCHAR(191) NOT NULL,
    `buyTxId` INTEGER NULL,
    `timestamp` INTEGER NULL,
    `blockId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Transaction_signature_key`(`signature`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Wallet` ADD CONSTRAINT `Wallet_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_walletId_fkey` FOREIGN KEY (`walletId`) REFERENCES `Wallet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
