# Performance Optimization

## Profiling Before Optimizing

Never optimize without measurement:

- Profile to identify actual bottlenecks before changing code
- Establish baseline metrics before and after changes
- Optimize the critical path, not everything

## Algorithmic Complexity

- Prefer O(n) or O(n log n) over O(n^2) for data operations
- Use appropriate data structures (hash maps for lookups, sorted structures for range queries)
- Consider amortized cost for batch operations

## Memory Patterns

- Avoid unnecessary allocations in hot paths
- Prefer streaming/iterating over collecting entire datasets into memory
- Release large resources (file handles, buffers) as soon as possible
- Be conscious of memory leaks from retained references or event listeners

## I/O and Async

- Batch I/O operations where possible (bulk reads/writes over per-item)
- Use async I/O for file system and network operations
- Avoid blocking the main thread / UI thread with synchronous I/O
- Cache expensive I/O results when data doesn't change frequently

## Lazy Initialization

- Defer expensive computations until the result is needed
- Lazy-load modules, components, and data that aren't immediately visible
- Use pagination or virtual scrolling for large lists

## Caching

- Cache expensive computations (memoization) when inputs are stable
- Use LRU or time-based expiration to bound cache size
- Invalidate caches explicitly when source data changes

## Bundle and Binary Size

- Monitor bundle/binary size as part of the build process
- Remove unused dependencies
- Use tree-shaking and dead code elimination where available
- Prefer smaller, focused dependencies over large kitchen-sink libraries
