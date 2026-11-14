-- AlterEnum
-- The client has opened the price bids (every bidder's rates are published) but has not
-- yet said who gets the order.
ALTER TYPE "TenderStatus" ADD VALUE 'PRICE_OPENED' BEFORE 'WON';
