# quick-mock-server

A lightweight, config-driven mock HTTP server for local development and testing.

Define routes in YAML/JSON/TypeScript, start the server with a single command, and get hot-reloading, stateful CRUD, scenario switching, chaos injection, proxy recording, and OpenAPI import — all with zero runtime dependencies beyond Node.js.

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [CLI Reference](#cli-reference)
- [Mock File Format](#mock-file-format)
  - [Routes](#routes)
  - [Responses](#responses)
  - [Scenarios](#scenarios)
  - [When Clauses](#when-clauses)
  - [TypeScript Handlers](#typescript-handlers)
  - [Delay](#delay)
  - [Stateful CRUD Resources](#stateful-crud-resources)
- [Config File](#config-file)
- [Admin API](#admin-api)
- [Proxy Passthrough & Recording](#proxy-passthrough--recording)
- [OpenAPI Import](#openapi-import)
- [Chaos Engineering](#chaos-engineering)
- [Programmatic API](#programmatic-api)
- [Testing Helpers](#testing-helpers)
- [VS Code Autocomplete](#vs-code-autocomplete)
- [Docker](#docker)

---

## Quick Start

```bash
npx quick-mock-server init   # scaffold qms.config.ts + example mocks
npx quick-mock-server start  # start on port 3999
```

Or install globally:

```bash
npm i -g quick-mock-server
qms init
qms start
```

---

## Installation

```bash
# CLI (global)
npm i -g quick-mock-server

# Programmatic API
npm i @quick-mock-server/core

# Testing helpers (Vitest / Jest / Playwright)
npm i -D @quick-mock-server/testing
```

---

## CLI Reference

```
qms [command] [options]
```

| Command | Description |
|---|---|
| `qms start` | Start the mock server |
| `qms init` | Scaffold `qms.config.ts` and example mock files |
| `qms routes` | Print a table of all compiled routes |
| `qms validate` | Validate config and mock files (exits 1 on error) |
| `qms record --target <url>` | Start proxy in record mode |
| `qms openapi import <spec>` | Import an OpenAPI 3.x spec and eject YAML mock files |
| `qms openapi schema` | Generate a JSON Schema for VS Code autocomplete |

### Start options

```
--port <port>       Port to listen on (overrides config, default: 3999)
--watch             Enable hot reload on mock file changes
--scenario <name>   Set the active scenario at startup
--config <path>     Path to qms config file
```

### Record options

```
--target <url>      Upstream base URL to forward requests to (required)
--port <port>       Port to listen on (default: OS-assigned)
--dir <path>        Directory to write recorded fixtures (default: mocks/recorded)
--mode <mode>       record | replay-or-record (default: record)
```

### OpenAPI import options

```
--out <dir>         Output directory for generated mock files (default: mocks/)
--seed <n>          RNG seed for body generation from JSON Schema (default: 42)
```

---

## Mock File Format

Mock files live in `mocksDir` (default `./mocks`) and can be `.yaml`, `.json`, or `.ts`.

### Routes

```yaml
# mocks/users.yaml
routes:
  - method: GET
    path: /users
    responses:
      - status: 200
        body:
          - id: 1
            name: Alice
          - id: 2
            name: Bob

  - method: POST
    path: /users
    responses:
      - status: 201
        body:
          id: 3
          name: Charlie
```

`method` accepts a single value or an array: `[GET, HEAD]`. Use `ALL` or `*` to match any method.

### Responses

Each route has an array of responses. The first response whose `when` clause and `scenario` match the request is served. If none match, the last response (the default) is served.

```yaml
responses:
  - status: 200
    headers:
      X-Custom: value
    body:
      id: 1
    delay: 200          # fixed ms
```

#### Body from file

```yaml
responses:
  - status: 200
    bodyFile: fixtures/user.json   # relative to the mock file
```

### Scenarios

Scenarios let you switch between different response sets without changing files.

```yaml
routes:
  - method: GET
    path: /users/:id
    responses:
      - scenario: not-found
        status: 404
        body:
          error: Not found
      - status: 200
        body:
          id: 1
          name: Alice
```

Switch the active scenario at runtime:

```bash
# Via CLI flag at startup
qms start --scenario not-found

# Via Admin API at runtime
curl -X PUT http://localhost:3999/__admin/scenario \
  -H 'Content-Type: application/json' \
  -d '{"name":"not-found"}'
```

#### X-Mock-Status header

Override the response status for a single request without changing the active scenario:

```bash
curl -H 'X-Mock-Status: 404' http://localhost:3999/users/1
# Returns the 404 response regardless of active scenario
```

### When Clauses

`when` clauses match against request properties. A response is only served when all specified conditions match.

```yaml
responses:
  - when:
      body.role: admin
    status: 200
    body:
      dashboard: true

  - status: 403
    body:
      error: Forbidden
```

Supported `when` keys:

| Key | Example | Description |
|---|---|---|
| `body.<field>` | `body.role: admin` | JSON body field equals value |
| `query.<param>` | `query.page: "2"` | Query string param equals value |
| `headers.<name>` | `headers.x-api-version: "2"` | Request header equals value |
| `params.<name>` | `params.id: "42"` | URL path param equals value |
| `method` | `method: POST` | HTTP method |

### TypeScript Handlers

For dynamic responses, define a handler in a `.ts` mock file:

```typescript
// mocks/users.ts
import { defineRoutes } from '@quick-mock-server/core'

export default defineRoutes([
  {
    method: 'GET',
    path: '/users/:id',
    handler: async (ctx) => {
      const id = ctx.params.id
      if (id === '0') return ctx.reply(404, { error: 'Not found' })
      return ctx.reply(200, { id: Number(id), name: 'Alice' })
    },
  },
])
```

The `ctx` object provides:

| Property | Type | Description |
|---|---|---|
| `ctx.params` | `Record<string, string>` | URL path parameters |
| `ctx.query` | `Record<string, string>` | Query string parameters |
| `ctx.headers` | `Record<string, string>` | Request headers |
| `ctx.body` | `unknown` | Parsed request body |
| `ctx.method` | `string` | HTTP method |
| `ctx.path` | `string` | Request path |
| `ctx.state` | `StateStore` | Shared in-memory state |
| `ctx.scenario` | `string` | Currently active scenario |
| `ctx.reply(status, body?, headers?)` | `ReplyData` | Build a response |

### Delay

Add latency to any response:

```yaml
responses:
  - status: 200
    delay: 300              # fixed 300 ms
    body: { ok: true }

  - status: 200
    delay:
      min: 100
      max: 500              # uniform random in [100, 500] ms

  - status: 200
    delay:
      p50: 100
      p99: 800              # log-normal distribution matching p50/p99
```

Global delay in config:

```typescript
// qms.config.ts
export default defineConfig({
  delay: { min: 50, max: 150 },
})
```

### Stateful CRUD Resources

Generate full REST CRUD endpoints backed by an in-memory collection:

```yaml
# mocks/api.yaml
resources:
  - name: users
    path: /users
    idField: id
    seed:
      count: 10
      fixture: seeds/user.json  # or use schema: { name: { type: string } }
    pagination:
      style: page        # page | offset | cursor
      pageParam: page
      sizeParam: limit
      default: 10
    filters:
      - name
      - role
    sort: true
    persist: true        # persists to .qms/state.json between restarts
```

This generates:

| Method | Path | Description |
|---|---|---|
| `GET` | `/users` | List (pagination, filter, sort) |
| `GET` | `/users/:id` | Get one |
| `POST` | `/users` | Create |
| `PUT` | `/users/:id` | Replace |
| `PATCH` | `/users/:id` | Partial update (deep merge) |
| `DELETE` | `/users/:id` | Delete |

#### Nested resources

```yaml
resources:
  - name: posts
    path: /posts
  - name: comments
    path: /comments
    belongsTo:
      parentPath: /posts
      foreignKey: postId
```

This constrains `GET /posts/:postId/comments` to return only comments whose `postId` matches.

---

## Config File

Create `qms.config.ts` (or `.js`, `.json`) in the project root:

```typescript
import { defineConfig } from '@quick-mock-server/core'

export default defineConfig({
  port: 3999,
  host: '0.0.0.0',
  mocksDir: './mocks',
  cors: true,                    // or { origins: ['http://localhost:5173'] }
  seed: 42,                      // RNG seed for faker templates
  delay: { min: 0, max: 0 },     // global delay override

  scenarios: {
    default: 'happy-path',
  },

  admin: {
    enabled: true,
    path: '/__admin',
    token: 'secret',             // require Bearer token for admin routes
  },

  proxy: {
    target: 'https://api.example.com',
    mode: 'passthrough',         // off | passthrough | record | replay-or-record
    pathRewrite: {
      '^/api': '',               // strip /api prefix before forwarding
    },
  },

  openapi: [
    './specs/petstore.yaml',     // auto-import OpenAPI specs on startup
  ],
})
```

### Config reference

| Key | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `3999` | Port to listen on |
| `host` | `string` | `'0.0.0.0'` | Bind address |
| `prefix` | `string` | `''` | URL prefix for all routes |
| `mocksDir` | `string` | `'./mocks'` | Directory with mock files |
| `cors` | `boolean \| CorsOptions` | `false` | CORS handling |
| `seed` | `number` | `42` | Global RNG seed |
| `delay` | `DelaySpec` | — | Global response delay |
| `proxy` | `ProxyConfig` | — | Upstream proxy settings |
| `openapi` | `string[]` | `[]` | OpenAPI spec files to auto-import |
| `scenarios.default` | `string` | — | Active scenario at startup |
| `admin.enabled` | `boolean` | `true` | Enable admin API |
| `admin.path` | `string` | `'/__admin'` | Admin endpoint prefix |
| `admin.token` | `string` | — | Bearer token to protect admin API |

---

## Admin API

When `admin.enabled` is `true` (the default), the following endpoints are available:

| Method | Path | Description |
|---|---|---|
| `GET` | `/__admin/health` | Health check + uptime |
| `GET` | `/__admin/routes` | List all compiled routes |
| `GET` | `/__admin/scenario` | Get active scenario |
| `PUT` | `/__admin/scenario` | Set active scenario `{ "name": "..." }` |
| `GET` | `/__admin/chaos` | Get current chaos config |
| `PUT` | `/__admin/chaos` | Update chaos config |
| `POST` | `/__admin/routes` | Inject a runtime route override |
| `GET` | `/__admin/state` | Dump in-memory collections |
| `POST` | `/__admin/state/snapshot` | Save a state snapshot |
| `POST` | `/__admin/state/restore/:id` | Restore a state snapshot |
| `GET` | `/__admin/journal` | Query request journal |
| `DELETE` | `/__admin/journal` | Clear the journal |

When `admin.token` is set, all admin requests must include `Authorization: Bearer <token>`.

---

## Proxy Passthrough & Recording

Forward unmatched requests to a real upstream server:

```typescript
export default defineConfig({
  proxy: {
    target: 'https://api.example.com',
    mode: 'passthrough',
  },
})
```

### Record mode

Automatically save responses as YAML fixture files:

```bash
qms record --target https://api.example.com --dir mocks/recorded
```

Or configure in `qms.config.ts`:

```typescript
proxy: {
  target: 'https://api.example.com',
  mode: 'record',
}
```

Fixtures are written to `mocks/recorded/<host>/<METHOD>-<slug>.yaml`. Existing files are never overwritten.

### Replay-or-record mode

Serve existing fixtures; record new ones for requests that have no fixture:

```bash
qms record --target https://api.example.com --mode replay-or-record
```

---

## OpenAPI Import

Import an OpenAPI 3.x spec and generate YAML mock files:

```bash
qms openapi import ./specs/petstore.yaml --out mocks/petstore/
```

Each path + method becomes one YAML file. Response bodies are sourced from:

1. `example` field (highest priority)
2. First entry in `examples`
3. Generated from JSON Schema via `json-schema-faker`

Non-2xx responses are assigned a scenario equal to their status code (`'404'`, `'500'`, etc.) so they can be activated via `--scenario` or `X-Mock-Status` header.

Auto-import specs on startup via config:

```typescript
openapi: ['./specs/petstore.yaml'],
```

### Generate JSON Schema for VS Code

```bash
qms openapi schema --out schema.json
```

Add the schema reference to your YAML mock files for autocomplete:

```yaml
# yaml-language-server: $schema=./schema.json
routes:
  - method: GET
    path: /users
```

---

## Chaos Engineering

Inject faults to test resilience. Configure globally, or per-request via the Admin API.

```typescript
export default defineConfig({
  // no top-level chaos — use admin API or programmatic API
})
```

Via Admin API:

```bash
curl -X PUT http://localhost:3999/__admin/chaos \
  -H 'Content-Type: application/json' \
  -d '{
    "enabled": true,
    "errorRate": 0.1,
    "errorStatus": [500, 503],
    "latency": { "min": 100, "max": 2000 }
  }'
```

### Chaos options

| Field | Type | Description |
|---|---|---|
| `enabled` | `boolean` | Master switch |
| `latency` | `DelaySpec` | Inject latency before response |
| `errorRate` | `number` | Probability [0, 1] to return an error status |
| `errorStatus` | `number[]` | Error statuses to choose from (default: `[500]`) |
| `timeout` | `boolean` | Never send a response (client timeout) |
| `drop` | `boolean` | Immediately destroy the socket |
| `slowBody` | `{ chunkSize, delayMs }` | Stream body in slow chunks |

---

## Programmatic API

Use `@quick-mock-server/core` directly in tests or scripts:

```typescript
import { createMockServer } from '@quick-mock-server/core'

const server = createMockServer({ port: 0 }) // 0 = OS-assigned port

// Register a route
server.use({
  method: 'GET',
  path: '/users',
  body: [{ id: 1, name: 'Alice' }],
})

// Start
const { url } = await server.start()
console.log(`Server at ${url}`)

// Switch scenario
server.scenario('error')

// Inspect requests
const entries = server.journal.query({ method: 'GET', path: '/users' })

// Access state
const users = server.state.collection('users').list()

// Stop
await server.stop()
```

### `createMockServer` options

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `0` | Port (`0` = OS-assigned) |
| `host` | `string` | `'127.0.0.1'` | Bind host |
| `defaultScenario` | `string` | `''` | Initial scenario |
| `chaos` | `ChaosConfig` | `{}` | Chaos config |
| `admin` | `Partial<AdminConfig>` | `{}` | Admin API settings |
| `proxy` | `ProxyConfig` | — | Proxy config |

### `server.use()` spec

```typescript
server.use({
  method: 'POST',        // default: 'GET'
  path: '/users',
  status: 201,           // shorthand for single response
  headers: {},
  body: { id: 1 },
  // or multi-response:
  responses: [
    { status: 201, body: { id: 1 } },
    { status: 422, body: { error: 'Validation failed' }, scenario: 'error' },
  ],
})
```

---

## Testing Helpers

Install `@quick-mock-server/testing` for Vitest, Jest, and Playwright integrations.

### Vitest custom matchers

```typescript
// vitest.setup.ts
import { expect } from 'vitest'
import { vitestMatchers } from '@quick-mock-server/testing'
expect.extend(vitestMatchers)
```

```typescript
// my.test.ts
import { createMockServer } from '@quick-mock-server/core'

const mock = createMockServer({ port: 0 })
mock.use({ method: 'POST', path: '/users', status: 201, body: { id: 1 } })
await mock.start()

await fetch(`${mock.url}/users`, { method: 'POST', body: '{"name":"Alice"}' })

expect(mock).toHaveReceived('POST', '/users')
expect(mock).toHaveReceivedWith('POST', '/users', {
  body: { name: 'Alice' },
  status: 201,
})

await mock.stop()
```

### Jest

```typescript
// jest.setup.ts
import { extendJest } from '@quick-mock-server/testing'
extendJest()
```

### Vitest global setup (shared server)

```typescript
// vitest.config.ts
export default {
  test: { globalSetup: ['./mock-setup.ts'] },
}

// mock-setup.ts
import { createMockServer } from '@quick-mock-server/core'
import { createGlobalSetup } from '@quick-mock-server/testing'

export const { setup, teardown } = createGlobalSetup(() =>
  createMockServer({ port: 3999 }),
)
```

### Playwright fixture

```typescript
// fixtures.ts
import { test as base } from '@playwright/test'
import { mockServerFixture } from '@quick-mock-server/testing'

export const test = base.extend({
  mockServer: mockServerFixture({ port: 0 }),
})

// my.spec.ts
test('shows user list', async ({ page, mockServer }) => {
  mockServer.use({ method: 'GET', path: '/users', body: [{ id: 1 }] })
  await page.goto('http://localhost:5173')
  await expect(page.locator('[data-testid="user"]')).toHaveCount(1)
})
```

---

## VS Code Autocomplete

Generate a JSON Schema for `.yaml` mock files:

```bash
qms openapi schema --out schema.json
```

Then add a schema comment to your YAML files:

```yaml
# yaml-language-server: $schema=./schema.json
routes:
  - method: GET
    path: /users
    responses:
      - status: 200
```

---

## Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY qms.config.ts ./
COPY mocks/ ./mocks/
EXPOSE 3999
CMD ["npx", "quick-mock-server", "start"]
```

Build and run:

```bash
docker build -t my-mock-server .
docker run -p 3999:3999 my-mock-server
```

Use `host: '0.0.0.0'` in `qms.config.ts` to bind to all interfaces inside the container.

### Docker Compose example

```yaml
services:
  mock:
    build: .
    ports:
      - "3999:3999"
    volumes:
      - ./mocks:/app/mocks     # hot-reload mocks without rebuilding
    environment:
      - NODE_ENV=development
```

---

## License

MIT
