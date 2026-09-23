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

// Router
export { Trie, Router } from './router/index.js'
export type { Params, MatchResult, RouteEntry, FindResult } from './router/index.js'

// Server
export { HttpAdapter, handleSignals } from './server/index.js'
export type { RequestHandler, ServerConfig, StartResult, LifecycleHook } from './server/index.js'

// Types
export type {
  HttpMethod,
  DelaySpec,
  CompiledRoute,
  CompiledResponse,
  MockRequest,
  MockContext,
} from './types.js'
