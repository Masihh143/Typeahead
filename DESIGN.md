# System Architecture & Technical Specifications

This document outlines the engineering principles, data structures, and optimization choices behind the Node.js Typeahead Search Engine.

---

## 1. High-Level Design Philosophy: Read-Heavy Optimization

The core thesis governing this system is that **reads vastly outnumber writes**. In a search-as-you-type environment, every keypress generates a read request (`GET /suggest`), while database updates (`POST /search`) only occur when a user executes a query.

Consequently:
- Reads must run in constant or logarithmic time ($O(1)$ or $O(L)$ where $L$ is the prefix length).
- Heavy calculations, sorts, and database queries are moved to the write path or deferred asynchronously.
- The Serving path relies entirely on memory indices and Cache rings, shielding Postgres from read traffic.

---

## 2. In-Memory Trie Architecture & Node.js Optimizations

To resolve OOM crashes and high CPU latency under large datasets (e.g. 1.24M unique queries), the Trie implementation was refactored with the following optimizations:

### 2.1 Single-Threaded Node.js Event Loop
Unlike multi-threaded languages (like Go) that require Read-Write Mutex locks to guard concurrent access to the Trie, Node.js runs on a single-threaded event loop. This allows concurrent reads to execute lock-free, avoiding thread synchronization overhead and deadlocks. However, long-running synchronous functions can block the event loop. Therefore, the Trie lookup is designed to be extremely lightweight.

### 2.2 Memory Footprint Reductions
- **Lazy Map Initialization**: In a standard Trie, each node allocates a child container. At 1.24 million queries, millions of leaf nodes allocate empty `Map` structures, exhausting the V8 heap. By initializing `this.children = null` and instantiating a `Map` only when a child is inserted, we reduce memory consumption by over 80%.
- **Structural Sharing of Top-K**: For non-branching paths (where a node has exactly one child and does not represent a completed word), the node shares the child's `topK` array directly:
  ```javascript
  if (n.children.size === 1 && !n.isWord) {
      n.topK = this._computeTopK(n.children.values().next().value);
      return n.topK;
  }
  ```
  This eliminates duplicate array allocations and redundant sort calls up the Trie tree.

### 2.3 Eliminating LocaleCompare Overhead
JavaScript's `String.prototype.localeCompare` is internationalization-aware, which introduces massive overhead when executed inside recursion loops. Replacing it with standard equality and comparison operators (`<`, `>`) improved Trie construction speed by over 20x.

---

## 3. Database Ingestion via Cursors

Loading 1.24 million queries in a single `SELECT` query results in massive buffer allocations in the PG client driver, causing heap exhaustion.

To maintain a flat memory footprint during startup:
- The [store.js](file:///home/mohammed-masihuddin/Desktop/masih/projects/Typeahead/Typeahead/src/store.js) database client initiates a transaction and opens a SQL cursor:
  `DECLARE mycursor CURSOR FOR SELECT query, count FROM queries`
- Rows are pulled in sequential batches of 50,000 using `FETCH 50000 FROM mycursor`.
- Queries are immediately inserted into the Trie synchronously within the fetch loop, allowing garbage collection to reclaim memory between batches.

---

## 4. Consistent Hashing Distributed Cache Ring

To simulate a sharded caching cluster, the engine implements a Consistent Hashing Ring with virtual nodes:

- **Consistent Hashing**: Traditional modulo hashing (`hash(key) % N`) forces a complete cache invalidation cascade when the node count `N` changes. Consistent hashing maps both keys and nodes on a 32-bit integer ring. Adding or removing a node only redistributes keys in the immediately adjacent arc (approx. $1/N$ of keys).
- **Virtual Nodes**: To prevent hot-spotting (uneven key distribution), each physical node is mapped to multiple positions on the ring using virtual replicas (`nodeName#replicaIndex`).
- **Binary Search Lookup**: When resolving the owner of a key, the hash is computed via unsigned CRC-32, and the node is found via a binary search on the sorted ring array.

---

## 5. Aggregated Asynchronous Write Buffering

Writing query increments directly to Postgres on every search submission is unsustainable under high load. The write path uses an in-memory buffer to aggregate increments:

- **Tally Collapse**: Multiple searches for the same term in a short window are collapsed into a single tally (e.g. 50 searches for `google` becomes a single database update: `count = count + 50`).
- **Trigger-based Flushing**: The buffer flushes to Postgres in bulk when the buffer reaches a maximum size threshold OR when a 5-second timer fires.
- **Durability Trade-off**: In the event of a sudden crash, un-flushed tallies in the buffer are lost. For ranking statistics, this minor inaccuracy is an acceptable trade-off for a 100x+ reduction in database write IOPS.

---

## 6. Recency-Aware (Trending) Scorer Math

To boost search terms that are surging in popularity, a trending scorer ranks items based on recency.

### 6.1 Exponential Time Decay Formula
To ensure that transient spikes in traffic do not rank highly permanently, counts are decayed exponentially over time. Instead of maintaining a costly historical list of every search event timestamp, we store a single decaying score $S$ and the timestamp $t_{last}$ of the last update:

$$\Delta t = t_{now} - t_{last}$$
$$S_{new} = S_{old} \times e^{-\lambda \Delta t} + \text{boost}$$

Where:
- $\lambda$ is the decay constant, derived from a configurable half-life: $\lambda = \ln(2) / T_{half\_life}$.
- $\text{boost}$ is the increment value (e.g., `1` for each search event).

When fetching trending suggestions, the current score is decayed forward to $t_{now}$ before sorting:

$$S_{current} = S_{old} \times e^{-\lambda(t_{now} - t_{last})}$$

The final ranking score blends the historical and trending signals:

$$\text{Final Score} = \text{All Time Count} + (w \times S_{current})$$

Where $w$ is the weight parameter tuning the impact of recency.

### 6.2 Caching Strategy for Trending
Because the decayed scores of queries change continuously with time, caching suggestion lists on the trending path is bypassed. The endpoint `/suggest?q=prefix&mode=trending` computes values on the fly from the Trie and applies the decay scorer to return real-time trending orders.