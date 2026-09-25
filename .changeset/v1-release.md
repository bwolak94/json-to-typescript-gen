---
"quick-mock-server": major
"@quick-mock-server/core": major
"@quick-mock-server/testing": major
---

# v1.0.0 — Initial stable release

`quick-mock-server` is a lightweight, config-driven mock HTTP server for local development and testing.

## Features

### Core

- **Declarative routes** — define HTTP routes in YAML, JSON, or TypeScript with `defineRoutes()`
- **Scenario switching** — activate response variants by name (`--scenario` flag, Admin API, or `server.scenario()`)
- **Conditional responses** — `when` clauses match request body fields, query params, headers, and path params
- **TypeScript handlers** — full `async (ctx) => ctx.reply(status, body)` handler support
- **Delay injection** — fixed ms, uniform random, or log-normal p50/p99 distributions
- **Hot reload** — `--watch` mode reloads mock files on change without restarting
- **Stateful CRUD** — `resources:` config generates full REST collections with pagination, filtering, sorting, nested ownership, and optional persistence
- **Proxy passthrough** — forward unmatched requests to an upstream server
- **Proxy record** — record upstream responses as YAML fixtures; replay-or-record mode
- **OpenAPI import** — `qms openapi import <spec>` converts OpenAPI 3.x paths to mock YAML files
- **X-Mock-Status header** — per-request status override without scenario switching
- **Chaos engineering** — error injection, latency, timeouts, socket drops, slow body streaming
- **Admin API** — runtime scenario/chaos/route/state management over HTTP
- **Request journal** — structured request log with query API
- **JSON Schema generation** — `qms openapi schema` for VS Code YAML autocomplete

### CLI (`quick-mock-server`)

- `qms start` — start mock server with hot reload, scenario, and port options
- `qms init` — scaffold config and example mock files
- `qms routes` — print compiled route table
- `qms validate` — validate config and mocks (CI-friendly exit code)
- `qms record` — proxy + record mode
- `qms openapi import` — OpenAPI spec import
- `qms openapi schema` — JSON Schema generation

### Testing (`@quick-mock-server/testing`)

- Vitest custom matchers: `toHaveReceived`, `toHaveReceivedWith`
- Jest `extendJest()` compatibility shim
- `createGlobalSetup` — shared server lifecycle for Vitest globalSetup
- `mockServerFixture` — Playwright per-test fixture
