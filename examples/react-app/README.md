# Example: React App + Playwright + Scenario Switching

Demonstrates using `quick-mock-server` as the API backend in a React app during Playwright E2E tests.

## Architecture

```
Playwright test
  └─ starts mockServerFixture (fresh server per worker)
  └─ navigates React app (Vite dev server on :5173)
         └─ React fetches /users from mock server (:4001)
```

## Setup

```bash
# From the repo root
pnpm build

cd examples/react-app
npm install
npx playwright install --with-deps chromium
```

## Running

```bash
# Start Vite dev server in one terminal
npm run dev

# Run Playwright tests (starts its own mock server)
npm run test:e2e
```

## Manual demo

```bash
# Start the mock server
npm run mock

# Fetch users (default scenario)
curl http://localhost:4001/users

# Switch to empty scenario
curl -X PUT http://localhost:4001/__admin/scenario \
  -H 'Content-Type: application/json' \
  -d '{"name":"empty"}'

curl http://localhost:4001/users     # returns []

# Switch to error scenario
curl -X PUT http://localhost:4001/__admin/scenario \
  -H 'Content-Type: application/json' \
  -d '{"name":"error"}'

curl http://localhost:4001/users     # returns 500
```

## Key patterns

- `mockServerFixture` from `@quick-mock-server/testing` wires a fresh `MockServer` as a Playwright fixture
- `server.scenario()` switches scenarios between page loads in the same test
- No separate `qms` process needed — the server starts and stops automatically with each test
