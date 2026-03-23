/**
 * GraphRAG query functions: ErrorChain, ImpactAnalysis, RootCauseAnalysis, etc.
 */
import type { ServiceStore, TraceStore, SignalStore, AnomalyStore } from "./store";
import type {
  SpanNode, ErrorChainResult, ImpactResult, AffectedEntry,
  RankedCause, CorrelatedSignalsResult, ServiceMapEntry, AnomalyNode,
} from "./schema";

export class GraphRAGQueries {
  constructor(
    private serviceStore: ServiceStore,
    private traceStore: TraceStore,
    private signalStore: SignalStore,
    private anomalyStore: AnomalyStore,
  ) {}

  errorChain(service: string, since: Date, limit: number = 10): ErrorChainResult[] {
    const errorSpans = this.traceStore.errorSpans(service, since);
    const limited = errorSpans.slice(0, limit);
    const results: ErrorChainResult[] = [];
    const seen = new Set<string>();

    for (const span of limited) {
      if (seen.has(span.traceId)) continue;
      seen.add(span.traceId);

      const chain = this.traceErrorChainUpstream(span);
      if (chain.length === 0) continue;

      const rootSpan = chain[chain.length - 1];
      const result: ErrorChainResult = {
        root_cause: {
          service: rootSpan.service,
          operation: rootSpan.operation,
          error_message: "",
          span_id: rootSpan.id,
          trace_id: rootSpan.traceId,
        },
        span_chain: chain,
        correlated_logs: [],
        anomalous_metrics: [],
        trace_id: span.traceId,
      };

      for (const s of chain) {
        if (s.isError) {
          const clusters = this.signalStore.logClustersForService(s.service);
          for (const lc of clusters) {
            if (lc.lastSeen > since) {
              result.correlated_logs.push(lc);
            }
          }
        }
      }

      results.push(result);
    }

    return results;
  }

  private traceErrorChainUpstream(span: SpanNode): SpanNode[] {
    const chain: SpanNode[] = [];
    const visited = new Set<string>();
    let current: SpanNode | undefined = span;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.push(current);
      if (!current.parentSpanId) break;
      current = this.traceStore.getSpan(current.parentSpanId);
    }

    return chain;
  }

  impactAnalysis(service: string, maxDepth: number = 5): ImpactResult {
    const result: ImpactResult = { service, affected_services: [], total_downstream: 0 };
    const visited = new Set<string>([service]);
    const queue: { svc: string; depth: number }[] = [{ svc: service, depth: 0 }];

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (item.depth >= maxDepth) continue;

      const edges = this.serviceStore.callEdgesFrom(item.svc);
      for (const e of edges) {
        if (visited.has(e.toId)) continue;
        visited.add(e.toId);

        const svc = this.serviceStore.getService(e.toId);
        const impact = svc ? 1.0 - svc.healthScore : 1.0;

        result.affected_services.push({
          service: e.toId,
          depth: item.depth + 1,
          call_count: e.callCount,
          impact_score: impact,
        });

        queue.push({ svc: e.toId, depth: item.depth + 1 });
      }
    }

    result.total_downstream = result.affected_services.length;
    return result;
  }

  rootCauseAnalysis(service: string, since: Date): RankedCause[] {
    const errorChains = this.errorChain(service, since, 20);
    const anomalies = this.anomalyStore.anomaliesForService(service, since);

    const causeScores = new Map<string, RankedCause>();

    for (const ec of errorChains) {
      if (!ec.root_cause) continue;
      const key = `${ec.root_cause.service}|${ec.root_cause.operation}`;
      let rc = causeScores.get(key);
      if (!rc) {
        rc = { service: ec.root_cause.service, operation: ec.root_cause.operation, score: 0, evidence: [], error_chain: [], anomalies: [] };
        causeScores.set(key, rc);
      }
      rc.score += 1.0;
      rc.evidence.push(`error chain from trace ${ec.trace_id}`);
      if (ec.span_chain.length > 0) rc.error_chain = ec.span_chain;
    }

    for (const a of anomalies) {
      const key = `${a.service}|`;
      for (const [k, rc] of causeScores) {
        if (k.startsWith(a.service)) {
          rc.score += 2.0;
          rc.anomalies.push(a);
          rc.evidence.push(`anomaly: ${a.evidence}`);
        }
      }
      if (!causeScores.has(key)) {
        causeScores.set(key, {
          service: a.service, operation: "", score: 2.0,
          anomalies: [a], evidence: [`anomaly: ${a.evidence}`], error_chain: [],
        });
      }
    }

    return Array.from(causeScores.values()).sort((a, b) => b.score - a.score);
  }

  dependencyChain(traceId: string): SpanNode[] {
    const spans = this.traceStore.spansForTrace(traceId);
    return [...spans].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  correlatedSignals(service: string, since: Date): CorrelatedSignalsResult {
    const result: CorrelatedSignalsResult = {
      service,
      error_logs: [],
      metrics: [],
      anomalies: [],
      error_chains: [],
    };

    const clusters = this.signalStore.logClustersForService(service);
    for (const lc of clusters) {
      if (lc.lastSeen > since) result.error_logs.push(lc);
    }

    result.metrics = this.signalStore.metricsForService(service);
    const anomalies = this.anomalyStore.anomaliesForService(service, since);
    result.anomalies = anomalies;
    result.error_chains = this.errorChain(service, since, 5);

    return result;
  }

  shortestPath(from: string, to: string): string[] {
    const adj = new Map<string, Map<string, number>>();
    for (const e of this.serviceStore.edges.values()) {
      if (e.type !== "CALLS") continue;
      const weight = e.callCount > 0 ? 1.0 / e.callCount : 1.0;
      if (!adj.has(e.fromId)) adj.set(e.fromId, new Map());
      adj.get(e.fromId)!.set(e.toId, weight);
      if (!adj.has(e.toId)) adj.set(e.toId, new Map());
      adj.get(e.toId)!.set(e.fromId, weight);
    }

    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const visited = new Set<string>();

    while (true) {
      let u = "";
      let minDist = Infinity;
      for (const [node, d] of dist) {
        if (!visited.has(node) && d < minDist) {
          u = node;
          minDist = d;
        }
      }
      if (!u || u === to) break;
      visited.add(u);

      const neighbors = adj.get(u);
      if (neighbors) {
        for (const [neighbor, weight] of neighbors) {
          const alt = dist.get(u)! + weight;
          if (!dist.has(neighbor) || alt < dist.get(neighbor)!) {
            dist.set(neighbor, alt);
            prev.set(neighbor, u);
          }
        }
      }
    }

    if (!dist.has(to)) return [];
    const path: string[] = [];
    for (let at: string | undefined = to; at; at = prev.get(at)) {
      path.unshift(at);
      if (at === from) break;
    }
    return path.length > 0 && path[0] === from ? path : [];
  }

  anomalyTimeline(since: Date): AnomalyNode[] {
    const anomalies = this.anomalyStore.anomaliesSince(since);
    return anomalies.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  serviceMap(depth: number = 3): ServiceMapEntry[] {
    const services = this.serviceStore.allServices();
    return services.map(svc => {
      const ops: any[] = [];
      for (const op of this.serviceStore.operations.values()) {
        if (op.service === svc.name) ops.push(op);
      }
      return {
        service: svc,
        operations: ops,
        calls_to: this.serviceStore.callEdgesFrom(svc.name),
        called_by: this.serviceStore.callEdgesTo(svc.name),
      };
    });
  }
}
