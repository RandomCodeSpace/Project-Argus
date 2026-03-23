/**
 * TF-IDF search engine for semantic log search.
 * Only indexes ERROR/WARN logs. FIFO eviction at maxSize.
 */
interface LogVector {
  logId: number;
  serviceName: string;
  severity: string;
  body: string;
  vec: Map<string, number>; // TF sparse vector
}

export interface SearchResult {
  logId: number;
  serviceName: string;
  severity: string;
  body: string;
  score: number;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "was", "not", "with", "this", "that", "from",
  "has", "but", "have", "its", "been", "also", "than", "into",
]);

function shouldIndex(severity: string): boolean {
  const s = severity.toUpperCase();
  return s === "ERROR" || s === "WARN" || s === "WARNING" || s === "FATAL" || s === "CRITICAL";
}

function tokenize(text: string): string[] {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return words;
}

function computeTF(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) {
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const total = tokens.length;
  const tf = new Map<string, number>();
  for (const [term, count] of counts) {
    tf.set(term, count / total);
  }
  return tf;
}

function vecNorm(v: Map<string, number>): number {
  let sum = 0;
  for (const val of v.values()) {
    sum += val * val;
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(a: Map<string, number>, normA: number, b: Map<string, number>): number {
  const normB = vecNorm(b);
  if (normA === 0 || normB === 0) return 0;
  let dot = 0;
  for (const [term, va] of a) {
    const vb = b.get(term);
    if (vb !== undefined) {
      dot += va * vb;
    }
  }
  return dot / (normA * normB);
}

export class VectorIndex {
  private docs: LogVector[] = [];
  private idf = new Map<string, number>();
  private maxSize: number;
  private dirty = false;

  constructor(maxSize: number = 100000) {
    this.maxSize = maxSize;
  }

  add(logId: number, serviceName: string, severity: string, body: string): void {
    if (!shouldIndex(severity)) return;
    const tokens = tokenize(body);
    if (tokens.length === 0) return;
    const tf = computeTF(tokens);

    // FIFO eviction
    if (this.docs.length >= this.maxSize) {
      const keep = this.docs.slice(Math.floor(this.maxSize / 10));
      this.docs = keep;
      this.dirty = true;
    }

    this.docs.push({ logId, serviceName, severity, body, vec: tf });
    this.dirty = true;
  }

  search(query: string, k: number = 10): SearchResult[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const queryTF = computeTF(tokens);

    if (this.dirty) {
      this.recomputeIDF();
      this.dirty = false;
    }

    // Build TF-IDF query vector
    const queryVec = new Map<string, number>();
    for (const [term, tf] of queryTF) {
      queryVec.set(term, tf * (this.idf.get(term) || 0));
    }
    const queryNorm = vecNorm(queryVec);
    if (queryNorm === 0) return [];

    const results: { doc: LogVector; score: number }[] = [];
    for (const doc of this.docs) {
      const docVec = new Map<string, number>();
      for (const [term, tf] of doc.vec) {
        docVec.set(term, tf * (this.idf.get(term) || 0));
      }
      const score = cosineSimilarity(queryVec, queryNorm, docVec);
      if (score > 0) {
        results.push({ doc, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k).map(r => ({
      logId: r.doc.logId,
      serviceName: r.doc.serviceName,
      severity: r.doc.severity,
      body: r.doc.body,
      score: r.score,
    }));
  }

  size(): number {
    return this.docs.length;
  }

  private recomputeIDF(): void {
    const df = new Map<string, number>();
    for (const doc of this.docs) {
      for (const term of doc.vec.keys()) {
        df.set(term, (df.get(term) || 0) + 1);
      }
    }
    const n = this.docs.length;
    this.idf = new Map();
    for (const [term, count] of df) {
      this.idf.set(term, Math.log(n / count) + 1);
    }
  }
}
