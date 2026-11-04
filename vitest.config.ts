import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
// Share one React instance across DSH client packages and tests.
// AGD-PATCH(0004) begin: run tests of packages/agd-* and iflytek/aiyun/ ops; resolve dsh-superagent/sdk to source in tests.
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'], alias: { 'dsh-superagent/sdk': fileURLToPath(new URL('./src/sdk.ts', import.meta.url)) } },
  test: { include: ['tests/**/*.spec.{ts,tsx}', 'packages/**/tests/**/*.spec.{ts,tsx}', 'iflytek/aiyun/**/*.spec.{ts,tsx}'], exclude: ['**/node_modules/**', '**/lib/**'] },
})
// AGD-PATCH(0004) end
