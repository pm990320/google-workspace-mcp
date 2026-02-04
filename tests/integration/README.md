# Integration Tests

Agent-based integration tests using the Claude CLI.

## How It Works

1. Tests spawn `claude -p "prompt" --output-format json` with isolated MCP config
2. Tests define **WHAT** to achieve, not **HOW** - Claude figures out how
3. If Claude can't figure it out, the tool descriptions need improvement

## Running Tests

```bash
# Run all integration tests (uses 'personal' account by default)
npm run test:integration

# Run with a specific account
TEST_ACCOUNT=myaccount npm run test:integration

# Run a specific test file
npx tsx --test tests/integration/markdown-docs.test.ts
```

## Requirements

- Claude CLI installed and authenticated (`claude --version`)
- A configured Google account (`npx google-workspace-mcp accounts list`)
- `ANTHROPIC_API_KEY` or Claude CLI authentication

## Writing Tests

Tests use Vitest with the harness:

```typescript
import { describe, it, beforeAll, afterAll, afterEach, expect } from 'vitest';
import { setupTest, deleteFile, assertOutputContains, type TestContext } from './harness.js';

const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'personal';

describe('My Feature', () => {
  let ctx: TestContext;
  let createdDocIds: string[] = [];

  beforeAll(async () => {
    ctx = await setupTest({ account: TEST_ACCOUNT });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    // Clean up any documents created during the test
    for (const docId of createdDocIds) {
      await deleteFile(ctx.drive, docId);
    }
    createdDocIds = [];
  });

  it('should do something', async () => {
    const result = await ctx.runPrompt(`
      Create a document called "Test Doc".
      Do something with it.
      Report the document ID.
    `);

    expect(result.success).toBe(true);

    // Extract and track doc ID for cleanup
    const docId = extractDocId(result.output);
    if (docId) createdDocIds.push(docId);

    assertOutputContains(result, 'worked');
  });
});
```

## Test Harness API

### `setupTest(options)`

Creates a test context with isolated MCP config.

```typescript
const ctx = await setupTest({
  account: 'personal',        // Required: Google account to use
  model: 'sonnet',           // Optional: Claude model (default: sonnet)
  systemPrompt: '...',       // Optional: Custom system prompt
  timeout: 120_000,          // Optional: Timeout in ms (default: 2 min)
});
```

### `ctx.runPrompt(prompt)`

Runs a prompt through Claude with MCP tools. Returns:

```typescript
{
  success: boolean,          // Did Claude complete without errors?
  output: string,            // The text output
  toolsCalled: string[],     // Which tools were called
  raw?: object,              // Full JSON result if available
  error?: string,            // Error message if failed
}
```

### Assertion Helpers

- `assertContains(output, expected)` - Check output contains text
- `assertNotContains(output, unexpected)` - Check output doesn't contain text
- `assertToolCalled(result, toolName)` - Check a tool was called
