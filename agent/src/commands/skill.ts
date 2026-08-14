import chalk from 'chalk';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillOptions {
  outputDir?: string;
  agents?: boolean;
}

const SKILL_CONTENT = `---
name: pw-cli-agent
description: Automated web testing workflow — explore, plan, test, and report using playwright-cli and opencode.
---

# pw-cli-agent

Automated end-to-end testing workflow for web applications.

## Workflow

1. **check** — Verify playwright-cli and opencode are installed, test site connectivity
2. **explore** — Open a browser, navigate to target URL, capture accessibility snapshot
3. **plan** — Send snapshot to opencode for structured test plan generation
4. **test** — Generate Playwright test code from plan, execute, and self-heal failures
5. **report** — Aggregate artifacts into a summary report

## Commands

\`\`\`bash
pwcli check                     # verify tools + site (uses TARGET_URL)
pwcli check --url <site>        # verify tools + specific site
pwcli check --url <site> --screenshot  # verify + capture screenshot
pwcli explore                   # capture page snapshot (uses TARGET_URL)
pwcli plan                      # generate test plan from latest snapshot
pwcli test --plan <file>        # generate + run tests from plan
pwcli test --generate           # interactive playwright codegen
pwcli test --execute <file>     # run existing test file
pwcli report                    # generate summary report
\`\`\`

## When to use

Use this skill when you need to:
- Generate end-to-end tests for a web application
- Explore a site and create structured test plans
- Run and self-heal Playwright tests
- Get a summary report of test results
`;

const AGENT_DEFINITIONS = [
  {
    name: 'pw-explorer',
    content: `---
name: pw-explorer
mode: subagent
description: Explores web pages via playwright-cli snapshots and identifies testable user flows.
---

You are a Playwright test explorer. You analyze accessibility snapshots captured by playwright-cli and identify testable user flows.

Your job:
1. Read the provided snapshot content
2. Identify interactive elements (buttons, forms, links, checkboxes)
3. Map out user journeys (login, search, form submission, navigation)
4. Output a numbered list of testable flows with element refs and action sequences

Focus on high-value user paths. Do not generate test code — only identify flows.`,
  },
  {
    name: 'pw-planner',
    content: `---
name: pw-planner
mode: subagent
description: Creates structured test plans from page snapshots for Playwright test generation.
---

You are a Playwright test planner. Given an accessibility snapshot, create a structured test plan.

For each test case include:
- Test name (descriptive)
- Preconditions
- Steps using element refs from the snapshot
- Expected results using Playwright assertions
- Priority (high/medium/low)

Group tests by feature. Use modern Playwright locator conventions (getByRole, getByText, etc.).`,
  },
  {
    name: 'pw-generator',
    content: `---
name: pw-generator
mode: subagent
description: Generates Playwright test code from structured test plans.
---

You are a Playwright test generator. Given a test plan, produce a complete .spec.ts file.

Requirements:
- Import from @playwright/test
- Use describe blocks for grouping
- Use modern locators (getByRole, getByText, getByTestId)
- Add proper async/await
- Include assertions for every test step
- Use page.goto() for navigation
- Follow Playwright best practices`,
  },
  {
    name: 'pw-healer',
    content: `---
name: pw-healer
mode: subagent
description: Diagnoses and fixes failing Playwright tests.
---

You are a Playwright test healer. A test has failed and you need to fix it.

1. Analyze the error output
2. Classify the failure: selector_changed | timing_issue | assertion_mismatch | app_bug
3. If it is an app bug, mark with test.fixme() and explain
4. Otherwise, provide the corrected test file

Do not delete valid assertions to make tests pass. Make minimal, targeted fixes.`,
  },
];

export function skillCommand(opts: SkillOptions): void {
  const baseDir = opts.outputDir ?? '.opencode/skills';
  const skillDir = join(baseDir, 'pw-cli-agent');

  if (!existsSync(skillDir)) {
    mkdirSync(skillDir, { recursive: true });
  }

  writeFileSync(join(skillDir, 'SKILL.md'), SKILL_CONTENT, 'utf-8');
  console.log(chalk.green(`Skill created: ${join(skillDir, 'SKILL.md')}`));

  if (opts.agents) {
    const agentsDir = join(baseDir, '..', 'agents');
    if (!existsSync(agentsDir)) {
      mkdirSync(agentsDir, { recursive: true });
    }

    for (const agent of AGENT_DEFINITIONS) {
      const agentFile = join(agentsDir, `${agent.name}.md`);
      writeFileSync(agentFile, agent.content, 'utf-8');
      console.log(chalk.green(`Agent created: ${agentFile}`));
    }
  }

  console.log(chalk.cyan('\nSkills installed. OpenCode agents can now discover the pw-cli-agent workflow.\n'));
}
