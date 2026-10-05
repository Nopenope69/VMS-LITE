-- AlterEnum
ALTER TYPE "SegmentStatus" ADD VALUE 'DELETE_PENDING';
ALTER TYPE "SegmentStatus" ADD VALUE 'GARBAGE';
ALTER TYPE "SegmentStatus" ADD VALUE 'MISSING';

-- AlterTable
ALTER TABLE "recordings" ADD COLUMN "error_reason" TEXT;
