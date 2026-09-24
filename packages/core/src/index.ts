// Config
export {
  defineConfig,
  defineRoutes,
  loadConfig,
} from './config/index.js'
export type {
  QmsConfig,
  RawRoute,
  ResourceConfig,
  ResourceBelongsTo,
  LoadedRoute,
  RouteOrigin,
  LoadedFile,
  RouteCollision,
  MergeResult,
  LoadResult,
  LoadConfigOptions,
} from './config/index.js'
export { ConfigError } from './config/index.js'

// Watcher
export { RouteWatcher } from './watcher/index.js'
export type { ReloadHook, WatcherSnapshot, WatcherConfig } from './watcher/index.js'

// Template engine
export { renderBody, createSeededFaker } from './template/index.js'
export type { TemplateContext, RenderOptions } from './template/index.js'

// Matcher
export { compilePredicate, matchRequest, matchResponse } from './matcher/index.js'
export type { CompiledPredicate } from './matcher/index.js'

// Responders
export { reply, resolveFileReply, executeHandler, mockRouteHeader, diagnosticNotFound, levenshtein } from './responders/index.js'
export type { ReplyBuilder, ReplyData, BodyType, MockHandler, DiagnosticNotFoundBody, SimplifiedNotFoundBody } from './responders/index.js'

// Router
export { Trie, Router } from './router/index.js'
export type { Params, MatchResult, RouteEntry, FindResult } from './router/index.js'

// Server
export { HttpAdapter, handleSignals, createMockServer } from './server/index.js'
export type { RequestHandler, ServerConfig, StartResult, LifecycleHook, MockServer, MockServerOptions, MockServerStartResult, UseRouteSpec } from './server/index.js'

// State
export {
  Collection,
  CollectionError,
  StateStore,
  ScenarioManager,
  extractScenarioHeader,
  routeMatchesScenario,
  seedCollection,
  buildResourceRoutes,
  persistStore,
  loadPersistedStore,
  applyFilters,
  applySort,
  deepMerge,
} from './state/index.js'
export type {
  AnyRecord,
  ListOptions,
  ListResult,
  ResourceRoute,
} from './state/index.js'

// Proxy
export { proxyRequest, rewritePath, stripHopByHop } from './proxy/index.js'
export type { ProxyConfig } from './proxy/index.js'

// Admin API
export { createAdminHandler, isAdminPath } from './admin/index.js'
export type { AdminConfig, AdminDeps } from './admin/index.js'

// Journal
export { Journal, JournalAssertionError } from './journal/index.js'
export type {
  JournalEntry,
  JournalRequest,
  JournalResponse,
  JournalQueryOptions,
  EntryMatcher,
  BodyMatcher,
} from './journal/index.js'

// Chaos
export {
  resolveChaos,
  isChaosEnabled,
  sampleDelay,
  shouldInjectError,
  pickErrorStatus,
  applyDelay,
} from './chaos/index.js'
export type { ChaosConfig, SlowBodyConfig } from './chaos/index.js'
export { runChaosPre, wrapSlowBody } from './chaos/middleware.js'
export type { ChaosOutcome } from './chaos/middleware.js'

// Types
export type {
  HttpMethod,
  DelaySpec,
  CompiledRoute,
  CompiledResponse,
  MockRequest,
  MockContext,
} from './types.js'
