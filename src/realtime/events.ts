/**
 * Event hub for snapshot broadcasting — pushes data refresh events to connected WS clients.
 */
import type { ServerWebSocket } from "bun";

export class EventHub {
  private clients = new Set<ServerWebSocket<any>>();
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  start(intervalMs: number = 5000): void {
    this.refreshInterval = setInterval(() => {
      // Heartbeat/refresh to keep connections alive
      const msg = JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() });
      for (const ws of this.clients) {
        try { ws.send(msg); } catch { this.clients.delete(ws); }
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    for (const ws of this.clients) {
      try { ws.close(); } catch {}
    }
    this.clients.clear();
  }

  addClient(ws: ServerWebSocket<any>): void {
    this.clients.add(ws);
  }

  removeClient(ws: ServerWebSocket<any>): void {
    this.clients.delete(ws);
  }

  broadcast(data: any): void {
    const msg = JSON.stringify(data);
    for (const ws of this.clients) {
      try { ws.send(msg); } catch { this.clients.delete(ws); }
    }
  }
}
