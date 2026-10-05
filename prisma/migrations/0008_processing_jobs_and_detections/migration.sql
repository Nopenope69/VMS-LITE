-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'CLAIMED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "processing_jobs" (
    "id" TEXT NOT NULL,
    "recording_id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "model_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detections" (
    "id" TEXT NOT NULL,
    "recording_id" TEXT NOT NULL,
    "camera_id" TEXT NOT NULL,
    "site_id" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "bbox_x" DOUBLE PRECISION NOT NULL,
    "bbox_y" DOUBLE PRECISION NOT NULL,
    "bbox_w" DOUBLE PRECISION NOT NULL,
    "bbox_h" DOUBLE PRECISION NOT NULL,
    "track_id" TEXT,
    "model_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "detections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "processing_jobs_recording_id_job_type_key" ON "processing_jobs"("recording_id", "job_type");

-- CreateIndex
CREATE INDEX "processing_jobs_status_priority_available_at_idx" ON "processing_jobs"("status", "priority", "available_at");

-- CreateIndex
CREATE INDEX "detections_camera_id_label_timestamp_idx" ON "detections"("camera_id", "label", "timestamp");

-- CreateIndex
CREATE INDEX "detections_site_id_label_timestamp_idx" ON "detections"("site_id", "label", "timestamp");

-- CreateIndex
CREATE INDEX "detections_recording_id_idx" ON "detections"("recording_id");

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detections" ADD CONSTRAINT "detections_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
