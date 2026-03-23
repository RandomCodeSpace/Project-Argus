/**
 * Daily hot/cold archival — query old records, serialize to JSONL, compress with gzip.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { gzipSync } from "fflate";
import type { Repository } from "../db/repository";
import type { Config } from "../config";

interface Manifest {
  date: string;
  archived_at: string;
  trace_count: number;
  log_count: number;
  metric_count: number;
  trace_bytes: number;
  log_bytes: number;
  metric_bytes: number;
  trace_sha256: string;
  log_sha256: string;
  metric_sha256: string;
}

export class Archiver {
  private repo: Repository;
  private cfg: Config;
  private interval: ReturnType<typeof setInterval> | null = null;
  private recordsMoved = 0;

  constructor(repo: Repository, cfg: Config) {
    this.repo = repo;
    this.cfg = cfg;
  }

  start(): void {
    // Check every hour if it's time to archive
    this.interval = setInterval(() => {
      const now = new Date();
      if (now.getUTCHours() === this.cfg.archiveScheduleHour && now.getMinutes() < 5) {
        this.runOnce().catch(e => console.error("Archive run failed:", e));
      }
    }, 5 * 60 * 1000); // check every 5 min
    console.log(`Archive worker started (schedule hour: ${this.cfg.archiveScheduleHour} UTC, retention: ${this.cfg.hotRetentionDays} days)`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getRecordsMoved(): number { return this.recordsMoved; }

  async runOnce(): Promise<void> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - this.cfg.hotRetentionDays);
    cutoff.setUTCHours(0, 0, 0, 0);
    const cutoffStr = cutoff.toISOString();

    const dates = this.repo.getArchivedDateRange(cutoffStr);
    for (const dateStr of dates) {
      await this.archiveDay(dateStr);
    }

    this.enforceSizeLimit();
  }

  private async archiveDay(dateStr: string): Promise<void> {
    const dayStart = new Date(dateStr + "T00:00:00.000Z");
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const dir = this.coldDir(dayStart);
    fs.mkdirSync(dir, { recursive: true });

    const manifest: Manifest = {
      date: dateStr,
      archived_at: new Date().toISOString(),
      trace_count: 0, log_count: 0, metric_count: 0,
      trace_bytes: 0, log_bytes: 0, metric_bytes: 0,
      trace_sha256: "", log_sha256: "", metric_sha256: "",
    };

    // Archive traces
    const { count: tc, bytes: tb, hash: th } = this.archiveRecords(
      dir, "traces.jsonl.gz",
      () => this.repo.getTracesForArchive(dayStart.toISOString(), dayEnd.toISOString(), this.cfg.archiveBatchSize, 0),
      (ids: number[]) => this.repo.deleteTracesByIDs(ids),
    );
    manifest.trace_count = tc;
    manifest.trace_bytes = tb;
    manifest.trace_sha256 = th;

    // Archive logs
    const { count: lc, bytes: lb, hash: lh } = this.archiveRecords(
      dir, "logs.jsonl.gz",
      () => this.repo.getLogsForArchive(dayStart.toISOString(), dayEnd.toISOString(), this.cfg.archiveBatchSize, 0),
      (ids: number[]) => this.repo.deleteLogsByIDs(ids),
    );
    manifest.log_count = lc;
    manifest.log_bytes = lb;
    manifest.log_sha256 = lh;

    // Archive metrics
    const { count: mc, bytes: mb, hash: mh } = this.archiveRecords(
      dir, "metrics.jsonl.gz",
      () => this.repo.getMetricsForArchive(dayStart.toISOString(), dayEnd.toISOString(), this.cfg.archiveBatchSize, 0),
      (ids: number[]) => this.repo.deleteMetricsByIDs(ids),
    );
    manifest.metric_count = mc;
    manifest.metric_bytes = mb;
    manifest.metric_sha256 = mh;

    // Write manifest
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    this.recordsMoved += tc + lc + mc;
  }

  private archiveRecords(
    dir: string, filename: string,
    fetchFn: () => any[],
    deleteFn: (ids: number[]) => void,
  ): { count: number; bytes: number; hash: string } {
    const records = fetchFn();
    if (records.length === 0) return { count: 0, bytes: 0, hash: "" };

    const lines: string[] = [];
    const ids: number[] = [];
    for (const r of records) {
      lines.push(JSON.stringify(r));
      if (r.id) ids.push(r.id);
    }

    const data = new TextEncoder().encode(lines.join("\n") + "\n");
    const compressed = gzipSync(data);
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, Buffer.from(compressed));

    if (ids.length > 0) deleteFn(ids);

    const hash = crypto.createHash("sha256").update(compressed).digest("hex");
    return { count: records.length, bytes: compressed.length, hash };
  }

  private coldDir(t: Date): string {
    return path.join(
      this.cfg.coldStoragePath,
      t.getUTCFullYear().toString().padStart(4, "0"),
      (t.getUTCMonth() + 1).toString().padStart(2, "0"),
      t.getUTCDate().toString().padStart(2, "0"),
    );
  }

  private enforceSizeLimit(): void {
    const maxBytes = this.cfg.coldStorageMaxGB * 1024 * 1024 * 1024;
    if (!fs.existsSync(this.cfg.coldStoragePath)) return;

    // Collect all day dirs with sizes
    const days: { path: string; size: number }[] = [];
    let totalSize = 0;

    try {
      const years = fs.readdirSync(this.cfg.coldStoragePath);
      for (const year of years) {
        const yearPath = path.join(this.cfg.coldStoragePath, year);
        if (!fs.statSync(yearPath).isDirectory()) continue;
        const months = fs.readdirSync(yearPath);
        for (const month of months) {
          const monthPath = path.join(yearPath, month);
          if (!fs.statSync(monthPath).isDirectory()) continue;
          const dayEntries = fs.readdirSync(monthPath);
          for (const day of dayEntries) {
            const dayPath = path.join(monthPath, day);
            if (!fs.statSync(dayPath).isDirectory()) continue;
            const size = this.dirSize(dayPath);
            days.push({ path: dayPath, size });
            totalSize += size;
          }
        }
      }
    } catch {}

    days.sort(); // lexicographic = chronological
    while (totalSize > maxBytes && days.length > 0) {
      const oldest = days.shift()!;
      try { fs.rmSync(oldest.path, { recursive: true }); } catch {}
      totalSize -= oldest.size;
    }
  }

  private dirSize(dirPath: string): number {
    let size = 0;
    try {
      const entries = fs.readdirSync(dirPath);
      for (const e of entries) {
        const stat = fs.statSync(path.join(dirPath, e));
        size += stat.isFile() ? stat.size : 0;
      }
    } catch {}
    return size;
  }
}
