# Sub-Project C Design Specification: Storage Reliability & Drive Telemetry

**Version:** 1.0  
**Date:** 2026-10-01  
**Scope:** VMS-Lite Post-MVP Production Elevation (Sub-Project C)  
**Branch:** `feature-storage-reliability`

## Overview

**Sub-Project C (Storage Reliability & Drive Telemetry)** provides hardware-level storage visibility and reliability controls essential for CCTV appliances operating 24/7 on N100 / embedded hardware:
1. **S.M.A.R.T. Drive Health & Temperature Telemetry**: Real-time parsing of drive health status (`PASSED` vs `FAILED`), disk temperature (°C), power-on hours, reallocated sector count, and wear percentage via `smartctl` JSON mode (with graceful dev fallback).
2. **Thermal & Predictive Failure Alerts**: Emits high-severity `storage.drive_degraded` events across the `EventBus` when disk temperatures exceed safe limits (>55°C) or SMART flags predictive failure, delivering alerts via WebSocket & logging audit records.
3. **Secondary / USB Storage Auto-Detection**: Discovers connected external/removable block devices (via `lsblk -J`) mounted under `/media` or `/mnt`, exposing mount targets for secondary storage or evidence backups.
4. **Dashboard Drive Telemetry UI**: Real-time drive status badges, temperature gauges, SMART health indicators, and secondary mount paths in the operator Dashboard.

## Locked Architectural Decisions

1. **Query Mechanism**: `smartctl --json=c -a /dev/...` executed via `child_process.execFile`. Block device roster discovered via `lsblk -J -b -o NAME,PATH,MODEL,SIZE,ROTA,TYPE,MOUNTPOINT,RM,HOTPLUG`. Graceful dev fallback if `smartctl`/`lsblk` are missing.
2. **Architecture**: Dedicated `StorageTelemetryService` with periodic background polling (default: 60s), decoupled from recording FIFO deletion logic in `StorageController`. Exposes REST API `GET /api/system/storage/drives`.
3. **Thermal & Failure Alerts**: When drive status is `FAILED` or temperature > 55°C (warning) / > 60°C (critical), emit `storage.drive_degraded` event via `EventBus` with deduplication cooldown (15m per drive) to avoid alert flooding.
4. **Secondary / USB Storage Auto-Discovery**: Identifies removable/hotplug drives (`RM=true` or `HOTPLUG=true`) and mounts under `/media` or `/mnt`. Reports mount path, capacity, and usable state.

## Global Constraints

- **100% Permissive Licensing**: Pure Node.js child_process integration; zero GPL/copyleft libraries.
- **Fail-Loud Runtime**: Explicit error messages on failure, while handling non-Linux dev environments gracefully via structured fallback mock metadata.
- **Recording Invariant**: Monitoring tasks must never lock or block video segment streaming/writing IO operations.
