# Example: OpenAPI Petstore

Demonstrates importing an OpenAPI 3.x spec and running contract tests against the generated mock.

## Setup

```bash
# From the repo root
pnpm build

# Import the spec to generate YAML mock files
cd examples/openapi-petstore
npx qms openapi import ./specs/petstore.yaml --out ./mocks

# Start the mock server
npx qms start --config ./qms.config.ts
```

## Running contract tests

```bash
pnpm test
```

The tests:
- Start a `createMockServer` instance programmatically
- Load routes from the inline spec via `specToRoutes()`
- Verify each endpoint returns the correct status and body
- Test `X-Mock-Status` header overrides for non-2xx responses
- Test scenario switching (`server.scenario('404')`)

## Switching to error scenarios

```bash
# All requests that have a 404 response return 404
curl -H 'x-mock-status: 404' http://localhost:4000/pets/1

# Activate the 500 scenario server-wide
curl -X PUT http://localhost:4000/__admin/scenario \
  -H 'Content-Type: application/json' \
  -d '{"name":"500"}'
```
