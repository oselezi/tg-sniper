/*
  Warnings:

  - You are about to drop the column `ttc` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `User` DROP COLUMN `ttc`;

-- AlterTable
ALTER TABLE `Wallet` ADD COLUMN `ttc` INTEGER NULL;
