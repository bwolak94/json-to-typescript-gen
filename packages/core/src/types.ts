export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD'
  | 'ALL'

export type DelaySpec =
  | number
  | { min: number; max: number }
  | { p50: number; p99: number }

export interface CompiledRoute {
  id: string
  method: HttpMethod
  path: string
  source: { file: string; line?: number }
  priority: number
  responses: CompiledResponse[]
}

export interface CompiledResponse {
  when?: unknown // Predicate — implemented in feat/f3-conditional-matcher
  scenario?: string
  status: number
  headers: Record<string, string>
  delay?: DelaySpec
  body: unknown // BodyRenderer — implemented in feat/f2-template-engine
}

export interface MockRequest {
  method: string
  path: string
  params: Record<string, string>
  query: Record<string, string | string[]>
  headers: Record<string, string | string[]>
  body: unknown
}

export interface MockContext {
  req: MockRequest
  params: Record<string, string>
  query: Record<string, string | string[]>
  body: unknown
  state: unknown // StateStore — implemented in feat/f4-stateful-crud
  scenario: string
  faker: unknown // Faker — implemented in feat/f2-template-engine
}
