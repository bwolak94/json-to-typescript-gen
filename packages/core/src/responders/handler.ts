import type { MockContext } from '../types.js'
import { reply, resolveFileReply } from './reply.js'
import type { ReplyBuilder } from './reply.js'

// ─── Public types ─────────────────────────────────────────────────────────────

/** A TypeScript handler function that produces a reply given a MockContext. */
export type MockHandler = (ctx: MockContext) => ReplyBuilder | Promise<ReplyBuilder>

// ─── Handler executor ─────────────────────────────────────────────────────────

/**
 * Execute a TypeScript handler function with full error isolation.
 *
 * - Any synchronous or asynchronous exception is caught.
 * - Returns a 500 reply with the error message; includes stack trace when
 *   `dev === true`.
 * - Logs the error with the route id for easy debugging.
 */
export async function executeHandler(
  handler: MockHandler,
  ctx: MockContext,
  routeId: string,
  dev: boolean,
): Promise<ReplyBuilder> {
  try {
    const result = await handler(ctx)
    // Materialise file bodies after successful handler execution
    if (result.bodyType === 'file') {
      return await resolveFileReply(result)
    }
    return result
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error(`[qms] Handler error in route ${routeId}: ${message}`)
    const body: Record<string, unknown> = {
      error: 'Internal Server Error',
      routeId,
    }
    if (dev && stack) {
      body['stack'] = stack
    }
    return reply(500).json(body)
  }
}

// ─── X-Mock-Route header ──────────────────────────────────────────────────────

/**
 * Build the value for the `X-Mock-Route` response header.
 * Format: `<sourceFile>#<routeId>` — identifies the exact route definition.
 */
export function mockRouteHeader(sourceFile: string, routeId: string): string {
  return `${sourceFile}#${routeId}`
}
