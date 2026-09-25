/**
 * End-to-end tests for the React user list component.
 *
 * Each test gets a fresh mock server. Scenarios are switched via
 * server.scenario() and the Admin API to demonstrate both approaches.
 */
import { test, expect } from './fixtures.js'

const APP_URL = 'http://localhost:5173'

test.describe('User list', () => {
  test('shows users when API returns a list', async ({ page, mockServer }) => {
    mockServer.use({
      method: 'GET',
      path: '/users',
      body: [
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob',   role: 'user' },
      ],
    })

    await page.goto(APP_URL)
    await expect(page.locator('[data-testid="user-list"]')).toBeVisible()
    await expect(page.locator('[data-testid="user"]')).toHaveCount(2)
    await expect(page.locator('[data-testid="user"]').first()).toContainText('Alice')
  })

  test('shows empty state when API returns []', async ({ page, mockServer }) => {
    mockServer.use({
      method: 'GET',
      path: '/users',
      status: 200,
      body: [],
    })

    await page.goto(APP_URL)
    await expect(page.locator('[data-testid="empty"]')).toBeVisible()
    await expect(page.locator('[data-testid="user-list"]')).not.toBeVisible()
  })

  test('shows error when API returns 500', async ({ page, mockServer }) => {
    mockServer.use({
      method: 'GET',
      path: '/users',
      status: 500,
      body: { error: 'Internal server error' },
    })

    await page.goto(APP_URL)
    await expect(page.locator('[data-testid="error"]')).toBeVisible()
  })

  test('scenario switching via server.scenario()', async ({ page, mockServer }) => {
    // Register responses for multiple scenarios
    mockServer.use({
      method: 'GET',
      path: '/users',
      responses: [
        { status: 200, body: [],                         scenario: 'empty' },
        { status: 500, body: { error: 'Server error' },  scenario: 'error' },
        { status: 200, body: [{ id: 1, name: 'Alice', role: 'admin' }] },
      ],
    })

    // Default scenario — shows users
    await page.goto(APP_URL)
    await expect(page.locator('[data-testid="user"]')).toHaveCount(1)

    // Switch to empty scenario
    mockServer.scenario('empty')
    await page.reload()
    await expect(page.locator('[data-testid="empty"]')).toBeVisible()

    // Switch to error scenario
    mockServer.scenario('error')
    await page.reload()
    await expect(page.locator('[data-testid="error"]')).toBeVisible()
  })
})
