// qms CLI — full implementation in feat/cli-binary (Task 4)
// This stub verifies the package builds and links correctly against @quick-mock-server/core.

import type { HttpAdapter } from '@quick-mock-server/core'

// Re-export for consumers who want the type without importing core directly
export type { HttpAdapter }

// Entry point placeholder
if (process.argv[1] && process.argv[1].endsWith('index')) {
  console.error('qms CLI not yet implemented. See: feat/cli-binary')
  process.exit(1)
}
