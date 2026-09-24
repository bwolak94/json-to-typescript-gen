import { zodToJsonSchema } from 'zod-to-json-schema'
import { MockFileSchema } from '../config/schema.js'

/**
 * Generate a JSON Schema object from the QMS mock file schema.
 * The result can be serialised to `schema.json` and used by VS Code:
 *
 * ```yaml
 * # yaml-language-server: $schema=./node_modules/quick-mock-server/schema.json
 * ```
 */
export function generateJsonSchema(): object {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return zodToJsonSchema(MockFileSchema as any, {
    name: 'QmsMockFile',
    errorMessages: false,
  })
}
