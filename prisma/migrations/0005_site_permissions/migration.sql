-- CreateTable
CREATE TABLE "site_permissions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "can_view_live" BOOLEAN NOT NULL DEFAULT true,
    "can_view_playback" BOOLEAN NOT NULL DEFAULT true,
    "can_control_ptz" BOOLEAN NOT NULL DEFAULT false,
    "can_export_clips" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_permissions_site_id_idx" ON "site_permissions"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_permissions_user_id_site_id_key" ON "site_permissions"("user_id", "site_id");

-- AddForeignKey
ALTER TABLE "site_permissions" ADD CONSTRAINT "site_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_permissions" ADD CONSTRAINT "site_permissions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

