import { resolveConfig } from './dist/config.js';
import { planCommand } from './dist/commands/plan.js';

const config = resolveConfig({}, {});
await planCommand({
  snapshot: 'artifacts/explore/explore-1785740397362.yaml',
  url: 'http://mtpc_test',
  codegenFile: 'artifacts/tests/codegen-1785726050545.spec.ts',
  prompt: 'Test the style guide newsletter page loads and the newsletter signup form is present',
  output: 'plan-scratch-check.md',
  config,
});
