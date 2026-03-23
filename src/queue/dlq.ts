/**
 * File-based Dead Letter Queue. On failed DB batch: JSON serialize to disk.
 * Replay worker with exponential backoff.
 */
import * as fs from "fs";
import * as path from "path";

export class DeadLetterQueue {
  private dir: string;
  private intervalMs: number;
  private replayFn: (data: Buffer) => void;
  private replayInterval: ReturnType<typeof setInterval> | null = null;
  private maxFiles: number;
  private maxDiskMB: number;
  private maxRetries: number;
  private retries = new Map<string, number>();

  constructor(
    dir: string,
    intervalMs: number,
    replayFn: (data: Buffer) => void,
    maxFiles: number = 0,
    maxDiskMB: number = 0,
    maxRetries: number = 0,
  ) {
    this.dir = dir;
    this.intervalMs = intervalMs;
    this.replayFn = replayFn;
    this.maxFiles = maxFiles;
    this.maxDiskMB = maxDiskMB;
    this.maxRetries = maxRetries;

    fs.mkdirSync(dir, { recursive: true });
  }

  start(): void {
    this.replayInterval = setInterval(() => this.processFiles(), this.intervalMs);
    console.log(`DLQ replay worker started (dir=${this.dir}, interval=${this.intervalMs}ms)`);
  }

  stop(): void {
    if (this.replayInterval) {
      clearInterval(this.replayInterval);
      this.replayInterval = null;
    }
  }

  enqueue(batch: any): void {
    const data = JSON.stringify(batch);
    this.enforceLimits(data.length);
    const filename = `batch_${Date.now()}_${Math.random().toString(36).slice(2)}.json`;
    const filePath = path.join(this.dir, filename);
    fs.writeFileSync(filePath, data);
    console.warn(`DLQ: batch written to ${filename} (${data.length} bytes)`);
  }

  size(): number {
    try {
      const entries = fs.readdirSync(this.dir);
      return entries.filter(e => e.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }

  diskBytes(): number {
    try {
      const entries = fs.readdirSync(this.dir);
      let total = 0;
      for (const e of entries) {
        if (e.endsWith(".json")) {
          try {
            const stat = fs.statSync(path.join(this.dir, e));
            total += stat.size;
          } catch {}
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  private enforceLimits(incomingBytes: number): void {
    if (this.maxFiles === 0 && this.maxDiskMB === 0) return;

    try {
      const entries = fs.readdirSync(this.dir)
        .filter(e => e.endsWith(".json"))
        .sort();

      let totalBytes = 0;
      const files: { name: string; size: number }[] = [];
      for (const e of entries) {
        try {
          const stat = fs.statSync(path.join(this.dir, e));
          files.push({ name: e, size: stat.size });
          totalBytes += stat.size;
        } catch {}
      }

      const maxBytes = this.maxDiskMB * 1024 * 1024;
      let i = 0;
      while (i < files.length) {
        const overFiles = this.maxFiles > 0 && files.length - i >= this.maxFiles;
        const overDisk = maxBytes > 0 && totalBytes + incomingBytes > maxBytes;
        if (!overFiles && !overDisk) break;

        fs.unlinkSync(path.join(this.dir, files[i].name));
        totalBytes -= files[i].size;
        this.retries.delete(files[i].name);
        i++;
      }
    } catch {}
  }

  private processFiles(): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.dir).filter(e => e.endsWith(".json")).sort();
    } catch {
      return;
    }

    for (const name of entries) {
      const retries = this.retries.get(name) || 0;
      if (this.maxRetries > 0 && retries >= this.maxRetries) {
        try { fs.unlinkSync(path.join(this.dir, name)); } catch {}
        this.retries.delete(name);
        console.error(`DLQ: max retries exceeded, dropping ${name}`);
        continue;
      }

      // Exponential backoff
      if (retries > 0) {
        const backoffMs = Math.min(Math.pow(2, retries - 1) * this.intervalMs, 30 * 60 * 1000);
        try {
          const stat = fs.statSync(path.join(this.dir, name));
          if (Date.now() - stat.mtimeMs < backoffMs) continue;
        } catch { continue; }
      }

      const filePath = path.join(this.dir, name);
      let data: Buffer;
      try {
        data = fs.readFileSync(filePath) as unknown as Buffer;
      } catch {
        continue;
      }

      try {
        this.replayFn(data);
        fs.unlinkSync(filePath);
        this.retries.delete(name);
      } catch (e) {
        this.retries.set(name, retries + 1);
        // Touch file
        try {
          const now = new Date();
          fs.utimesSync(filePath, now, now);
        } catch {}
      }
    }
  }
}
