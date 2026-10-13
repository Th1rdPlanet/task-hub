import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WORKFLOW_PATH = new URL('../.github/workflows/sync-project-status.yml', import.meta.url);

test('workflow exposes scheduled and manual synchronization with guarded execution', async () => {
  const source = await readFile(WORKFLOW_PATH, 'utf8');

  assert.match(source, /cron:\s*['"]\*\/5 \* \* \* \*['"]/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /node-version:\s*20/);
  assert.match(source, /GH_TOKEN:\s*\$\{\{ secrets\.PROJECT_SYNC_TOKEN \}\}/);
  assert.match(source, /timeout-minutes:\s*10/);
  assert.match(source, /group:\s*project-issue-status-sync/);
  assert.match(source, /cancel-in-progress:\s*false/);
  assert.match(source, /permissions:\s*\n\s+contents:\s*read/);
  assert.match(source, /run:\s*node scripts\/sync-project-status\.mjs/);
});

test('every intake form starts with the Russian triage label', async () => {
  const forms = ['bug.yml', 'build-change.yml', 'idea.yml', 'other.yml', 'website.yml'];

  for (const form of forms) {
    const source = await readFile(new URL(`../.github/ISSUE_TEMPLATE/${form}`, import.meta.url), 'utf8');
    assert.match(source, /^labels:\s*\[на рассмотрении(?:,|\])/m, form);
    assert.doesNotMatch(source, /needs-triage/, form);
  }
});
