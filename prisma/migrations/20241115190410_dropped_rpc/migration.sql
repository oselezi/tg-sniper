/*
  Warnings:

  - You are about to alter the column `encodedPk` on the `Wallet` table. The data in that column could be lost. The data in that column will be cast from `VarChar(256)` to `VarChar(255)`.
  - Made the column `dexscreenerPaid` on table `Wallet` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `Wallet` DROP COLUMN `rpc`;