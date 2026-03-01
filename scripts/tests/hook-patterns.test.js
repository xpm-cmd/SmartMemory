/**
 * Tests for hook regex patterns — noise filtering, error detection, success detection.
 * Run: node --test scripts/tests/hook-patterns.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Copy patterns from hook-post-tool.js (kept in sync manually) ──

const NOISE_COMMANDS = [
  /^(ls|pwd|echo|cat|wc|which|whoami|date|true|false)\b/,
  /^cd\s/,
  /^(npm|yarn|pnpm)\s+(install|ci|i)$/,
  /^git\s+(status|diff|log|branch|remote|fetch|pull)\b/,
  /^(node|python|ruby)\s+--version$/,
  /^(mkdir|touch|chmod|chown)\s/,
];

const STRICT_ERROR_PATTERNS = /\b(TypeError|SyntaxError|ReferenceError|AssertionError|RangeError|URIError):/;
const STACK_TRACE = /\n\s+at\s+/;
const EXIT_ERROR = /\b(exit(ed)?\s+(with\s+)?(code|status)\s+[1-9]|error TS\d{4}|FATAL)\b|npm ERR!|panic:/;
const TEST_BUILD_CMD = /^(npm\s+(test|run\s+(build|test|lint|check))|npx\s+(jest|vitest|mocha|tsc)|pytest|cargo\s+(test|build|check)|go\s+(test|build)|make|bun\s+(test|build)|pnpm\s+(test|run\s+(build|test))|yarn\s+(test|build))\b/;
const TEST_FAILURE = /\b(FAIL|FAILED|failures?:\s*[1-9])\b/i;
const SUCCESS_PATTERNS = /\b(passed|✓|Tests?:\s*\d+\s*passed|BUILD SUCCESS|Successfully compiled)\b/i;

function isNoise(cmd) {
  return NOISE_COMMANDS.some(re => re.test(cmd.trim()));
}

// ── Noise filtering ──────────────────────────────────────────

describe('NOISE_COMMANDS', () => {
  const shouldFilter = [
    'ls',
    'ls -la',
    'pwd',
    'echo hello',
    'cat file.txt',
    'cd /tmp',
    'cd src',
    'npm install',
    'yarn ci',
    'pnpm i',
    'git status',
    'git diff --cached',
    'git log --oneline',
    'git branch -a',
    'git remote -v',
    'git fetch origin',
    'git pull',
    'node --version',
    'python --version',
    'mkdir -p /tmp/test',
    'touch file.txt',
    'chmod 755 script.sh',
  ];

  for (const cmd of shouldFilter) {
    it(`filters: "${cmd}"`, () => {
      assert.ok(isNoise(cmd), `Expected "${cmd}" to be filtered as noise`);
    });
  }

  const shouldKeep = [
    'npm test',
    'npm run build',
    'git commit -m "test"',
    'node server.js',
    'python manage.py migrate',
    'cargo build',
    'go test ./...',
    'docker compose up',
    'curl https://api.example.com',
    'npm run dev',
    'git push origin main',
    'git rebase main',
  ];

  for (const cmd of shouldKeep) {
    it(`keeps: "${cmd}"`, () => {
      assert.ok(!isNoise(cmd), `Expected "${cmd}" to NOT be filtered`);
    });
  }
});

// ── Error detection ──────────────────────────────────────────

describe('Error detection (strict)', () => {
  const trueErrors = [
    'TypeError: Cannot read properties of undefined',
    'SyntaxError: Unexpected token }',
    'ReferenceError: foo is not defined',
    'RangeError: Maximum call stack size exceeded',
  ];

  for (const output of trueErrors) {
    it(`detects: "${output.slice(0, 50)}"`, () => {
      assert.ok(STRICT_ERROR_PATTERNS.test(output));
    });
  }

  const falsePositives = [
    'Error handling configured successfully',
    'No errors found',
    'error-boundary component loaded',
    'Loaded Error page template',
  ];

  for (const output of falsePositives) {
    it(`ignores: "${output.slice(0, 50)}"`, () => {
      assert.ok(!STRICT_ERROR_PATTERNS.test(output), `Should NOT match: "${output}"`);
    });
  }
});

describe('Stack trace detection', () => {
  it('detects Node.js stack traces', () => {
    const output = 'Error: ENOENT\n    at Object.openSync (node:fs:123)';
    assert.ok(STACK_TRACE.test(output));
  });

  it('ignores normal indented text', () => {
    const output = 'Results:\n  - item 1\n  - item 2';
    assert.ok(!STACK_TRACE.test(output));
  });
});

describe('Exit code detection', () => {
  it('detects "exited with code 1"', () => {
    assert.ok(EXIT_ERROR.test('Process exited with code 1'));
  });
  it('detects "exit code 2"', () => {
    assert.ok(EXIT_ERROR.test('Command exit code 2'));
  });
  it('detects "npm ERR!"', () => {
    assert.ok(EXIT_ERROR.test('npm ERR! code ELIFECYCLE'));
  });
  it('detects TypeScript errors', () => {
    assert.ok(EXIT_ERROR.test('error TS2304: Cannot find name'));
  });
  it('detects panic', () => {
    assert.ok(EXIT_ERROR.test('panic: runtime error'));
  });
  it('ignores "exit code 0" (success)', () => {
    assert.ok(!EXIT_ERROR.test('Process exited with code 0'));
  });
});

// ── Test/build command detection ─────────────────────────────

describe('TEST_BUILD_CMD', () => {
  const shouldMatch = [
    'npm test',
    'npm run build',
    'npm run test',
    'npm run lint',
    'npm run check',
    'npx jest',
    'npx vitest',
    'npx mocha',
    'npx tsc',
    'pytest',
    'pytest -v tests/',
    'cargo test',
    'cargo build',
    'cargo check',
    'go test ./...',
    'go build .',
    'make',
    'make build',
    'bun test',
    'bun build',
    'pnpm test',
    'pnpm run build',
    'yarn test',
    'yarn build',
  ];

  for (const cmd of shouldMatch) {
    it(`matches: "${cmd}"`, () => {
      assert.ok(TEST_BUILD_CMD.test(cmd), `Expected "${cmd}" to match TEST_BUILD_CMD`);
    });
  }

  const shouldNotMatch = [
    'npm install',
    'npm start',
    'npm run dev',
    'node server.js',
    'git commit -m "test"',
    'docker build .',
    'curl localhost',
  ];

  for (const cmd of shouldNotMatch) {
    it(`skips: "${cmd}"`, () => {
      assert.ok(!TEST_BUILD_CMD.test(cmd), `Expected "${cmd}" to NOT match TEST_BUILD_CMD`);
    });
  }
});

// ── Test failure patterns ────────────────────────────────────

describe('TEST_FAILURE', () => {
  it('detects "FAIL src/test.js"', () => {
    assert.ok(TEST_FAILURE.test('FAIL src/test.js'));
  });
  it('detects "FAILED"', () => {
    assert.ok(TEST_FAILURE.test('Tests FAILED'));
  });
  it('detects "failures: 2"', () => {
    assert.ok(TEST_FAILURE.test('1 passed, failures: 2'));
  });
  it('ignores "failures: 0"', () => {
    assert.ok(!TEST_FAILURE.test('failures: 0'));
  });
});

// ── Success patterns ─────────────────────────────────────────

describe('SUCCESS_PATTERNS', () => {
  it('detects "Tests: 5 passed"', () => {
    assert.ok(SUCCESS_PATTERNS.test('Tests: 5 passed, 5 total'));
  });
  it('detects checkmark', () => {
    assert.ok(SUCCESS_PATTERNS.test('✓ all tests passed'));
  });
  it('detects "BUILD SUCCESS"', () => {
    assert.ok(SUCCESS_PATTERNS.test('BUILD SUCCESS'));
  });
  it('detects "Successfully compiled"', () => {
    assert.ok(SUCCESS_PATTERNS.test('Successfully compiled 42 modules'));
  });
});
