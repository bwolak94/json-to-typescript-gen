#!/usr/bin/env node
/**
 * quick-mock-server benchmark harness
 *
 * Uses autocannon (must be installed: npm i -g autocannon) to measure
 * throughput and latency for common mock server scenarios.
 *
 * Exits 0 when all thresholds pass, 1 when any threshold is breached.
 *
 * Usage:
 *   node bench/run.mjs [--scenario static|crud|chaos]
 */

import autocannon from 'autocannon'
import { createMockServer } from '../packages/core/dist/index.js'

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const scenarioArg = args.indexOf('--scenario')
const selectedScenario = scenarioArg >= 0 ? args[scenarioArg + 1] : null

// ─── Thresholds ───────────────────────────────────────────────────────────────

const THRESHOLDS = {
  static: { p99Ms: 20, rps: 5_000 },
  crud:   { p99Ms: 30, rps: 2_000 },
  chaos:  { p99Ms: 500, rps: 500 },
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

const SCENARIOS = {
  async static() {
    const server = createMockServer({ port: 0 })
    server.use({
      method: 'GET',
      path: '/users',
      body: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` })),
    })
    const { url } = await server.start()
    return { url: `${url}/users`, server }
  },

  async crud() {
    const server = createMockServer({ port: 0 })
    server.use({ method: 'GET',    path: '/items',     status: 200, body: { items: [], total: 0 } })
    server.use({ method: 'POST',   path: '/items',     status: 201, body: { id: 1, name: 'test' } })
    server.use({ method: 'GET',    path: '/items/:id', status: 200, body: { id: 1, name: 'test' } })
    server.use({ method: 'DELETE', path: '/items/:id', status: 204 })
    const { url } = await server.start()
    return { url: `${url}/items`, server }
  },

  async chaos() {
    const server = createMockServer({
      port: 0,
      chaos: {
        enabled: true,
        errorRate: 0.1,
        errorStatus: [500, 503],
        latency: { min: 50, max: 200 },
      },
    })
    server.use({
      method: 'GET',
      path: '/data',
      body: { ok: true },
    })
    const { url } = await server.start()
    return { url: `${url}/data`, server }
  },
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runScenario(name, factory) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Scenario: ${name}`)
  console.log('─'.repeat(60))

  const { url, server } = await factory()

  const result = await new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url,
        connections: 10,
        duration: 5,
        pipelining: 1,
      },
      (err, result) => {
        if (err) reject(err)
        else resolve(result)
      },
    )
    autocannon.track(instance)
  })

  await server.stop()

  const p99 = result.latency.p99
  const rps  = result.requests.mean

  console.log(`\np99 latency : ${p99} ms`)
  console.log(`Requests/s  : ${Math.round(rps)}`)

  const threshold = THRESHOLDS[name]
  const failures  = []

  if (threshold.p99Ms !== undefined && p99 > threshold.p99Ms) {
    failures.push(`p99 ${p99} ms > threshold ${threshold.p99Ms} ms`)
  }
  if (threshold.rps !== undefined && rps < threshold.rps) {
    failures.push(`rps ${Math.round(rps)} < threshold ${threshold.rps}`)
  }

  if (failures.length > 0) {
    console.error(`\nTHRESHOLD BREACHED for "${name}":`)
    for (const f of failures) console.error(`  - ${f}`)
    return false
  }

  console.log(`\nAll thresholds passed for "${name}".`)
  return true
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const toRun = selectedScenario
    ? [[selectedScenario, SCENARIOS[selectedScenario]]]
    : Object.entries(SCENARIOS)

  if (selectedScenario && !SCENARIOS[selectedScenario]) {
    console.error(`Unknown scenario "${selectedScenario}". Choose: ${Object.keys(SCENARIOS).join(', ')}`)
    process.exit(1)
  }

  let allPassed = true
  for (const [name, factory] of toRun) {
    const passed = await runScenario(name, factory)
    if (!passed) allPassed = false
  }

  console.log('\n' + '═'.repeat(60))
  if (allPassed) {
    console.log('All benchmark thresholds passed.')
    process.exit(0)
  } else {
    console.error('One or more benchmark thresholds were breached.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
