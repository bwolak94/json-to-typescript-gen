import http from 'node:http'
import { once } from 'node:events'
import type { AddressInfo, Socket } from 'node:net'

export type RequestHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void | Promise<void>

export interface ServerConfig {
  host?: string
  /** Milliseconds to wait for in-flight requests to complete before force-closing. Default: 10 000 */
  shutdownTimeoutMs?: number
}

export interface StartResult {
  url: string
  port: number
}

export type LifecycleHook = () => void | Promise<void>

/**
 * Thin wrapper around `node:http` with:
 * - Port 0 support (OS-assigned port)
 * - Graceful shutdown (drains in-flight requests, destroys idle keep-alive connections)
 * - Lifecycle hooks (onStart / onStop)
 */
export class HttpAdapter {
  private readonly server: http.Server
  /** All open sockets */
  private readonly sockets = new Set<Socket>()
  /** Sockets with an in-flight request */
  private readonly activeSockets = new Set<Socket>()
  private closing = false
  private started = false
  private readonly startHooks: LifecycleHook[] = []
  private readonly stopHooks: LifecycleHook[] = []

  constructor(
    handler: RequestHandler,
    private readonly config: ServerConfig = {},
  ) {
    this.server = http.createServer((req, res) => {
      const socket = req.socket
      this.activeSockets.add(socket)

      const done = () => {
        this.activeSockets.delete(socket)
        // If shutdown is in progress, destroy this connection once it goes idle
        if (this.closing) socket.destroy()
      }
      res.once('finish', done)
      res.once('close', done)

      // Use Promise constructor so synchronous throws are also caught
      new Promise<void>((resolve) => resolve(handler(req, res))).catch((err: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500)
          res.end('Internal Server Error')
        }
        console.error('[qms] Unhandled request handler error:', err)
      })
    })

    this.server.on('connection', (socket: Socket) => {
      this.sockets.add(socket)
      socket.once('close', () => {
        this.sockets.delete(socket)
        this.activeSockets.delete(socket)
      })
    })
  }

  onStart(hook: LifecycleHook): this {
    this.startHooks.push(hook)
    return this
  }

  onStop(hook: LifecycleHook): this {
    this.stopHooks.push(hook)
    return this
  }

  async start(port: number, host?: string): Promise<StartResult> {
    if (this.started) throw new Error('Server already started')

    const bindHost = host ?? this.config.host ?? '127.0.0.1'
    this.server.listen(port, bindHost)
    await once(this.server, 'listening')
    this.started = true

    for (const hook of this.startHooks) await hook()

    const addr = this.server.address() as AddressInfo
    const displayHost = bindHost === '0.0.0.0' ? 'localhost' : bindHost

    return {
      port: addr.port,
      url: `http://${displayHost}:${addr.port}`,
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return

    this.closing = true

    for (const hook of this.stopHooks) await hook()

    // Stop accepting new connections
    this.server.close()

    // Immediately destroy idle (keep-alive) connections
    for (const socket of this.sockets) {
      if (!this.activeSockets.has(socket)) {
        socket.destroy()
      }
    }

    const timeoutMs = this.config.shutdownTimeoutMs ?? 10_000
    let forceCloseTimer: ReturnType<typeof setTimeout> | undefined

    const forceClose = new Promise<void>((resolve) => {
      forceCloseTimer = setTimeout(() => {
        for (const socket of this.sockets) socket.destroy()
        resolve()
      }, timeoutMs)
    })

    await Promise.race([once(this.server, 'close'), forceClose])
    clearTimeout(forceCloseTimer)

    this.started = false
    this.closing = false
  }

  get isRunning(): boolean {
    return this.started
  }
}

/**
 * Registers SIGINT and SIGTERM handlers that gracefully stop the adapter.
 * Call this from your CLI entry point, not from library code.
 */
export function handleSignals(adapter: HttpAdapter): void {
  const shutdown = async () => {
    try {
      await adapter.stop()
    } finally {
      process.exit(0)
    }
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
