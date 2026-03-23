import { describe, it, expect } from "bun:test";
import { ServiceStore, TraceStore, SignalStore, AnomalyStore } from "../graphrag/store";
import { GraphRAGQueries } from "../graphrag/queries";

describe("GraphRAG", () => {
  it("should upsert services and compute health", () => {
    const store = new ServiceStore();
    const now = new Date();

    store.upsertService("svc-a", 100, false, now);
    store.upsertService("svc-a", 200, false, now);
    store.upsertService("svc-a", 150, true, now);

    const svc = store.getService("svc-a");
    expect(svc).toBeDefined();
    expect(svc!.callCount).toBe(3);
    expect(svc!.errorCount).toBe(1);
    expect(svc!.errorRate).toBeCloseTo(1 / 3, 2);
    expect(svc!.avgLatency).toBeCloseTo(150, 0);
    expect(svc!.healthScore).toBeGreaterThanOrEqual(0);
    expect(svc!.healthScore).toBeLessThanOrEqual(1);
  });

  it("should track CALLS edges", () => {
    const store = new ServiceStore();
    const now = new Date();

    store.upsertCallEdge("svc-a", "svc-b", 50, false, now);
    store.upsertCallEdge("svc-a", "svc-b", 100, false, now);

    const edges = store.callEdgesFrom("svc-a");
    expect(edges.length).toBe(1);
    expect(edges[0].callCount).toBe(2);
    expect(edges[0].toId).toBe("svc-b");
  });

  it("should perform impact analysis (BFS)", () => {
    const ss = new ServiceStore();
    const ts = new TraceStore(3600000);
    const sig = new SignalStore();
    const as = new AnomalyStore();
    const queries = new GraphRAGQueries(ss, ts, sig, as);
    const now = new Date();

    ss.upsertService("gateway", 10, false, now);
    ss.upsertService("auth", 10, false, now);
    ss.upsertService("users", 10, false, now);

    ss.upsertCallEdge("gateway", "auth", 10, false, now);
    ss.upsertCallEdge("auth", "users", 10, false, now);

    const impact = queries.impactAnalysis("gateway", 5);
    expect(impact.total_downstream).toBe(2);
    expect(impact.affected_services.map(a => a.service)).toContain("auth");
    expect(impact.affected_services.map(a => a.service)).toContain("users");
  });

  it("should find shortest path (Dijkstra)", () => {
    const ss = new ServiceStore();
    const ts = new TraceStore(3600000);
    const sig = new SignalStore();
    const as = new AnomalyStore();
    const queries = new GraphRAGQueries(ss, ts, sig, as);
    const now = new Date();

    ss.upsertCallEdge("a", "b", 10, false, now);
    ss.upsertCallEdge("b", "c", 10, false, now);
    ss.upsertCallEdge("a", "c", 10, false, now);

    const path = queries.shortestPath("a", "c");
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toBe("a");
    expect(path[path.length - 1]).toBe("c");
  });

  it("should return empty path for disconnected nodes", () => {
    const ss = new ServiceStore();
    const queries = new GraphRAGQueries(ss, new TraceStore(3600000), new SignalStore(), new AnomalyStore());

    const path = queries.shortestPath("x", "y");
    expect(path.length).toBe(0);
  });

  it("should track anomalies", () => {
    const as = new AnomalyStore();
    const now = new Date();

    as.addAnomaly({
      id: "anom_1", type: "error_spike", severity: "critical",
      service: "svc-a", evidence: "error rate 50%", timestamp: now,
    });

    const anomalies = as.anomaliesSince(new Date(now.getTime() - 60000));
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].service).toBe("svc-a");
  });

  it("should produce service map", () => {
    const ss = new ServiceStore();
    const queries = new GraphRAGQueries(ss, new TraceStore(3600000), new SignalStore(), new AnomalyStore());
    const now = new Date();

    ss.upsertService("svc-a", 100, false, now);
    ss.upsertService("svc-b", 50, false, now);
    ss.upsertCallEdge("svc-a", "svc-b", 50, false, now);

    const map = queries.serviceMap();
    expect(map.length).toBe(2);
  });
});
