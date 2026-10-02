-- Site-level events (site.offline / site.online)
ALTER TABLE "events" ADD COLUMN "site_id" TEXT;

CREATE INDEX "events_site_id_idx" ON "events"("site_id");
