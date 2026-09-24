import SwaggerParser from '@apidevtools/swagger-parser'
import { generateSync } from 'json-schema-faker'
import type { OpenAPIV3 } from 'openapi-types'
import type { RawRoute } from '../config/schema.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ImportOpenApiOptions {
  /** Seed for json-schema-faker RNG. Default: `42`. */
  seed?: number
}

// ─── HTTP methods present on path items ───────────────────────────────────────

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const
type HttpVerb = typeof HTTP_METHODS[number]

// ─── Path conversion ──────────────────────────────────────────────────────────

/** Convert an OpenAPI path template (`/users/{id}`) to QMS path (`:id`-style). */
export function convertPath(openApiPath: string): string {
  return openApiPath.replace(/\{([^}]+)\}/g, ':$1')
}

// ─── Response body helpers ────────────────────────────────────────────────────

/**
 * Pick the best example body for a media type object.
 * Priority: `example` > first key from `examples` > generate from `schema`.
 */
export function pickResponseBody(
  mediaType: OpenAPIV3.MediaTypeObject,
  seed = 42,
): unknown {
  // 1. Inline example
  const mt = mediaType as Record<string, unknown>
  if ('example' in mt && mt['example'] !== undefined) {
    return mt['example']
  }

  // 2. Named examples — pick first
  if (mediaType.examples) {
    const first = Object.values(mediaType.examples)[0]
    if (first && 'value' in first) {
      return (first as OpenAPIV3.ExampleObject).value as unknown
    }
  }

  // 3. Generate from schema
  if (mediaType.schema) {
    try {
      return generateSync(mediaType.schema as Record<string, unknown>, {
        seed,
        alwaysFakeOptionals: true,
      })
    } catch {
      return null
    }
  }

  return null
}

/** Find the first 2xx status code key in an operation's responses. */
export function getDefaultStatus(
  responses: Record<string, unknown>,
): string | undefined {
  return Object.keys(responses).find((s) => /^2/.test(s))
}

// ─── Core conversion ──────────────────────────────────────────────────────────

/** Convert a dereferenced OpenAPI 3.x document to an array of `RawRoute`s. */
export function specToRoutes(
  spec: OpenAPIV3.Document,
  options: ImportOpenApiOptions = {},
): RawRoute[] {
  const { seed = 42 } = options
  const routes: RawRoute[] = []

  for (const [rawPath, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem) continue
    const qmsPath = convertPath(rawPath)

    for (const verb of HTTP_METHODS) {
      const operation = (pathItem as Record<string, unknown>)[verb] as OpenAPIV3.OperationObject | undefined
      if (!operation) continue

      const method = verb.toUpperCase() as RawRoute['method']
      const responses = (operation.responses ?? {}) as OpenAPIV3.ResponsesObject
      const defaultStatusKey = getDefaultStatus(responses) ?? '200'

      const rawResponses: RawRoute['responses'] = []

      for (const [statusKey, responseOrRef] of Object.entries(responses)) {
        // Skip $ref (spec should be dereferenced already)
        if (!responseOrRef || '$ref' in (responseOrRef as unknown as Record<string, unknown>)) continue
        const response = responseOrRef as OpenAPIV3.ResponseObject

        const status = parseInt(statusKey, 10)
        if (isNaN(status)) continue

        const isDefault = statusKey === defaultStatusKey

        // Pick body from application/json content
        const jsonContent = response.content?.['application/json']
        const body = jsonContent ? pickResponseBody(jsonContent, seed) : undefined

        // Build response headers from spec headers
        const headers: Record<string, string> = {}
        if (body !== undefined && body !== null) {
          headers['Content-Type'] = 'application/json'
        }

        const rawResponse: RawRoute['responses'][number] = {
          status,
          headers,
          ...(body !== undefined ? { body } : {}),
        }

        // Non-default responses get a scenario equal to the status code.
        // This enables two switching mechanisms:
        //   1. Active scenario: server.scenario('404')
        //   2. X-Mock-Status header: X-Mock-Status: 404 (per-request override)
        if (!isDefault) {
          rawResponse.scenario = String(status)
        }

        // Put non-default responses first so they're evaluated before the default
        if (isDefault) {
          rawResponses.push(rawResponse)
        } else {
          rawResponses.unshift(rawResponse)
        }
      }

      if (rawResponses.length === 0) {
        rawResponses.push({ status: 200, headers: {} })
      }

      routes.push({
        method,
        path: qmsPath,
        responses: rawResponses,
      })
    }
  }

  return routes
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Load and dereference an OpenAPI 3.x spec, then convert it to `RawRoute[]`.
 * Accepts file paths and URLs.
 */
export async function importOpenApi(
  specPathOrUrl: string,
  options: ImportOpenApiOptions = {},
): Promise<RawRoute[]> {
  const api = await SwaggerParser.dereference(specPathOrUrl) as OpenAPIV3.Document
  return specToRoutes(api, options)
}
