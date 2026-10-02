-- Upload capacity of a site's link to the central server, for link usage display
ALTER TABLE "sites" ADD COLUMN "uplink_mbps" DOUBLE PRECISION;
