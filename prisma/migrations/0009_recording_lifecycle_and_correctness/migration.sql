-- CreateEnum
CREATE TYPE "SegmentStatus" AS ENUM ('DISCOVERED', 'VALIDATING', 'AVAILABLE', 'QUARANTINED', 'EXPIRED', 'DELETED');

-- CreateEnum
CREATE TYPE "RetentionTier" AS ENUM ('CONTINUOUS', 'EVENT', 'INCIDENT', 'PROTECTED');

-- CreateEnum
CREATE TYPE "StreamRole" AS ENUM ('PRIMARY', 'SUB');

-- AlterTable
ALTER TABLE "recordings" ADD COLUMN "stream_role" "StreamRole" NOT NULL DEFAULT 'PRIMARY';
ALTER TABLE "recordings" ADD COLUMN "status" "SegmentStatus" NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE "recordings" ADD COLUMN "retention_tier" "RetentionTier" NOT NULL DEFAULT 'CONTINUOUS';
ALTER TABLE "recordings" ADD COLUMN "is_protected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "recordings" ADD COLUMN "protection_reason" TEXT;
ALTER TABLE "recordings" ADD COLUMN "sha256" TEXT;
ALTER TABLE "recordings" ADD COLUMN "validated_at" TIMESTAMP(3);
ALTER TABLE "recordings" ADD COLUMN "storage_provider" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "recordings" ADD COLUMN "storage_key" TEXT;
ALTER TABLE "recordings" ADD COLUMN "video_codec" TEXT NOT NULL DEFAULT 'h264';
ALTER TABLE "recordings" ADD COLUMN "has_audio" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "recordings" ADD COLUMN "width" INTEGER;
ALTER TABLE "recordings" ADD COLUMN "height" INTEGER;
ALTER TABLE "recordings" ADD COLUMN "fps" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "recordings_status_retention_tier_is_protected_idx" ON "recordings"("status", "retention_tier", "is_protected");
