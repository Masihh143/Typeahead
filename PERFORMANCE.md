# Benchmarking & Performance Analysis

This report documents the performance characteristics of the Node.js implementation of the Typeahead Search Engine, running against the full AOL query dataset (1.24M unique queries).

All metrics were gathered using `scripts/benchmark.sh` and generating load using `hey` (a HTTP load generator) at concurrency level 50 for 5000 requests.

---

## 1. Executive Performance Summary

| Metric | Measured Value | Architectural Impact |
|---|---|---|
| **p50 Latency (Cache Route)** | 0.5 ms | Sub-millisecond client response |
| **p95 Latency (Cache Route)** | 1.2 ms | Extremely stable tail profile |
| **p99 Latency (Cache Route)** | 3.2 ms | Smooth under high concurrent load |
| **p95 Latency (Trie Route)** | 1.2 ms | High-performance lock-free Trie lookup |
| **Trie Bootstrap Time** | 21.0 seconds | High-speed startup streaming 1.24M records |
| **Write IOPS Reduction** | 100x | Mitigates database lock contention |
| **Cache Hit Ratio (Hot Head)** | 99.9% | Protects memory index from repeated paths |

---

## 2. Latency Profiles: Cache vs. Trie Paths

End-to-end latency includes HTTP processing, Express routing, JSON serialization, and loop execution times.

```
Route 1: Cache-Hit Path (Highly repeated hot prefixes)
  p50: 0.5 ms    p95: 1.2 ms    p99: 3.2 ms

Route 2: Trie-Only Path (Bypasses caching, calculates live counts)
  p50: 0.4 ms    p95: 1.2 ms    p99: 1.8 ms
```

### Analysis
- **Flat Latency Profile**: The latency profiles of the cache path and the trie path are nearly identical at p95. Because the Trie caches pre-sorted `topK` arrays at each node, Trie traversal is a simple pointer-walking routine ($O(L)$) requiring a fraction of a millisecond.
- **Node.js Single-Threaded Advantage**: Unlike multi-threaded runtime environments that rely on locks or channel queues (introducing tail-latency spikes due to context switching and queue serialization under high concurrency), Node.js serves requests in a single-threaded loop. This results in highly stable and tight p99 latencies (1.8 ms for Trie lookups). 
- **Tail Latencies (p99)**: The slightly higher p99 tail for the cache route (3.2 ms) is attributed to asynchronous cache eviction bookkeeping and GC cycles rather than lock contention.

---

## 3. Cache Routing & Distribution Efficiency

Repeated requests against 4 distinct prefixes (`goog`, `map`, `ebay`, `yaho`) routed across 3 logical cache nodes:

```
Node 0: 398 Hits | 2 Misses  (Prefix Size: 2)
Node 1: 5200 Hits | 1 Miss  (Prefix Size: 1)
Node 2: 199 Hits | 1 Miss   (Prefix Size: 1)
---------------------------------------------
Aggregate Cache Hit Rate: 99.9% (5797 / 5801)
```

- **Consistent Hashing Load Split**: As expected with consistent hashing, keys are cleanly assigned to specific owners. Because `node1` owned the most popular prefix in the dataset sample, it handled the majority of the requests. In production, load distribution becomes highly uniform as the number of distinct query prefixes increases.

---

## 4. Write Reduction Performance

Measuring database flushes during the submission of 1,000 search queries across 5 distinct query terms:

```
Searches Received: 1000
Database Flushes:  2
Rows Written:      10
Write Reduction:   100x
```

- **Tally Consolidation**: Out of 1,000 requests, only 10 rows were updated in Postgres. Because identical terms are accumulated in-memory and collapsed into a single SQL command, write throughput is dictated by the number of *unique* terms searched per flush interval, rather than the raw search traffic.
- **Flushing Behavior**: The 10 rows represent the 5 unique queries flushing twice because the 5-second timer triggered once during the sequential load test.

---

## 5. Architectural Trade-offs

1. **Durability vs. DB Health**: By buffering writes in memory, database disk writing falls by 99%. The trade-off is a 5-second vulnerability window where un-flushed search increments would be lost in the event of a hard container termination.
2. **CPU Traversal vs. Memory Cache**: Storing the pre-sorted `topK` array directly on every TrieNode consumes more memory but keeps the read path lock-free and sub-millisecond, removing the need for local caching speedups.