/**
 * WebSocket hub — buffered broadcast. Accumulates logs/metrics, flushes at 100 entries or 500ms.
 */
import type { ServerWebSocket } from "bun";

export interface LogEntry {
  id: number;
  trace_id: string;
  span_id: string;
  severity: string;
  body: string;
  service_name: string;
  attributes_json: string;
  ai_insight?: string;
  timestamp: string;
}

export interface MetricEntry {
  name: string;
  service_name: string;
  value: number;
  timestamp: Date;
  attributes: Record<string, any>;
}

interface HubBatch {
  type: string;
  data: any;
}

export class WebSocketHub {
  private clients = new Set<ServerWebSocket<any>>();
  private logBuffer: LogEntry[] = [];
  private metricBuffer: MetricEntry[] = [];
  private maxBufferSize = 100;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private onConnectionChange?: (count: number) => void;

  constructor(onConnectionChange?: (count: number) => void) {
    this.onConnectionChange = onConnectionChange;
  }

  start(): void {
    this.flushInterval = setInterval(() => this.flush(), 500);
  }

  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
    for (const ws of this.clients) {
      try { ws.close(); } catch {}
    }
    this.clients.clear();
  }

  addClient(ws: ServerWebSocket<any>): void {
    this.clients.add(ws);
    if (this.onConnectionChange) this.onConnectionChange(this.clients.size);
  }

  removeClient(ws: ServerWebSocket<any>): void {
    this.clients.delete(ws);
    if (this.onConnectionChange) this.onConnectionChange(this.clients.size);
  }

  broadcastLog(entry: LogEntry): void {
    this.logBuffer.push(entry);
    if (this.logBuffer.length >= this.maxBufferSize) this.flush();
  }

  broadcastMetric(entry: MetricEntry): void {
    this.metricBuffer.push(entry);
    if (this.metricBuffer.length >= this.maxBufferSize) this.flush();
  }

  clientCount(): number {
    return this.clients.size;
  }

  private flush(): void {
    if (this.logBuffer.length === 0 && this.metricBuffer.length === 0) return;

    if (this.logBuffer.length > 0) {
      const batch: HubBatch = { type: "logs", data: this.logBuffer };
      this.broadcastBatch(batch);
      this.logBuffer = [];
    }

    if (this.metricBuffer.length > 0) {
      const batch: HubBatch = { type: "metrics", data: this.metricBuffer };
      this.broadcastBatch(batch);
      this.metricBuffer = [];
    }
  }

  private broadcastBatch(batch: HubBatch): void {
    const data = JSON.stringify(batch);
    const slow: ServerWebSocket<any>[] = [];

    for (const ws of this.clients) {
      try {
        const sent = ws.send(data);
        if (sent === 0) slow.push(ws); // backpressure
      } catch {
        slow.push(ws);
      }
    }

    for (const ws of slow) {
      this.clients.delete(ws);
      try { ws.close(); } catch {}
      if (this.onConnectionChange) this.onConnectionChange(this.clients.size);
    }
  }
}
