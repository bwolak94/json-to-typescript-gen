# Benchmarks

Throughput and latency benchmarks for `quick-mock-server`.

## Running

```bash
# Install autocannon globally (or use npx)
npm i -g autocannon

# Build packages first
pnpm build

# Run all benchmarks
node bench/run.mjs

# Or run a single scenario
node bench/run.mjs --scenario static
node bench/run.mjs --scenario crud
node bench/run.mjs --scenario chaos
```

## Scenarios

| Scenario | Description |
|---|---|
| `static` | Simple `GET /users` returning a static JSON array |
| `crud` | Full CRUD collection: list + get + create + delete |
| `chaos` | Static route with 10% error injection + 50–200 ms latency |

## Thresholds (CI gates)

| Metric | Threshold |
|---|---|
| p99 latency (static) | < 20 ms |
| p99 latency (crud) | < 30 ms |
| Requests/sec (static) | > 5 000 rps |

These are checked at the end of `run.mjs` — the process exits 1 if any threshold is breached.
