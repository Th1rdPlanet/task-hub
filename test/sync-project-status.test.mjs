import assert from 'node:assert/strict';
import test from 'node:test';

import { syncIssue, synchronizeProject } from '../scripts/sync-project-status.mjs';

function issueItem({
  id = 'PVTI_1',
  status = 'In Progress',
  reason = null,
  labels = [],
  comments = [],
  state = 'OPEN',
  stateReason = null,
  typename = 'Issue',
} = {}) {
  const fieldValues = status
    ? [{ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: status, field: { name: 'Status' } }]
    : [];
  if (reason !== null) {
    fieldValues.push({
      __typename: 'ProjectV2ItemFieldTextValue',
      text: reason,
      field: { name: 'Причина решения' },
    });
  }

  return {
    id,
    content:
      typename === 'Issue'
        ? {
            __typename: 'Issue',
            number: 3,
            url: 'https://github.com/Th1rdPlanet/task-hub/issues/3',
            state,
            stateReason,
            repository: { name: 'task-hub', owner: { login: 'Th1rdPlanet' } },
            labels: { nodes: labels.map((name) => ({ name })) },
            comments: { nodes: comments.map((body) => ({ body })) },
          }
        : { __typename: typename },
    fieldValues: { nodes: fieldValues },
  };
}

function recordingClient({ failOnAdd = false } = {}) {
  const calls = [];
  return {
    calls,
    async ensureLabel(...args) {
      calls.push(['ensureLabel', ...args]);
    },
    async addLabels(...args) {
      calls.push(['addLabels', ...args]);
      if (failOnAdd) throw new Error('label write failed');
    },
    async removeLabel(...args) {
      calls.push(['removeLabel', ...args]);
    },
    async addComment(...args) {
      calls.push(['addComment', ...args]);
    },
    async setIssueState(...args) {
      calls.push(['setIssueState', ...args]);
    },
  };
}

test('syncs an Issue while preserving unrelated labels', async () => {
  const client = recordingClient();
  const result = await syncIssue(
    client,
    issueItem({ status: 'In Progress', labels: ['на рассмотрении', 'blocked'] }),
  );

  assert.equal(result.changed, true);
  assert.deepEqual(
    client.calls.map(([name, ...args]) => [name, ...args.slice(0, 4)]),
    [
      ['ensureLabel', 'Th1rdPlanet', 'task-hub', 'в работе', { color: '1D76DB', description: 'Задача выполняется' }],
      ['addLabels', 'Th1rdPlanet', 'task-hub', 3, ['в работе']],
      ['removeLabel', 'Th1rdPlanet', 'task-hub', 3, 'на рассмотрении'],
    ],
  );
});

test('skips pull requests, draft items, and issues without Status', async () => {
  const client = recordingClient();

  assert.equal((await syncIssue(client, issueItem({ typename: 'PullRequest' }))).reason, 'not-an-issue');
  assert.equal((await syncIssue(client, { id: 'draft', content: null, fieldValues: { nodes: [] } })).reason, 'not-an-issue');
  assert.equal((await syncIssue(client, issueItem({ status: null }))).reason, 'missing-status');
  assert.deepEqual(client.calls, []);
});

test('is a no-op when issue labels and state already match the Project', async () => {
  const client = recordingClient();
  const result = await syncIssue(
    client,
    issueItem({ status: 'Ready for Verification', labels: ['проверка', 'security'] }),
  );

  assert.equal(result.changed, false);
  assert.deepEqual(client.calls, []);
});

test('comments and closes Rejected from a Project reason without duplicating its marker', async () => {
  const firstClient = recordingClient();
  await syncIssue(
    firstClient,
    issueItem({ status: 'Rejected', reason: 'Не входит в планы', labels: [] }),
  );
  const commentBody = firstClient.calls.find(([name]) => name === 'addComment')[4];
  assert.match(commentBody, /Причина: Не входит в планы/);
  assert.deepEqual(firstClient.calls.at(-1), [
    'setIssueState',
    'Th1rdPlanet',
    'task-hub',
    3,
    'closed',
    'not_planned',
  ]);

  const secondClient = recordingClient();
  await syncIssue(
    secondClient,
    issueItem({
      status: 'Rejected',
      reason: 'Не входит в планы',
      labels: ['rejected'],
      comments: [commentBody],
    }),
  );
  assert.equal(secondClient.calls.some(([name]) => name === 'addComment'), false);
});

test('closes Rejected from an issue comment without posting another comment', async () => {
  const client = recordingClient();
  await syncIssue(
    client,
    issueItem({
      status: 'Rejected',
      labels: ['rejected'],
      comments: ['Причина отклонения: уже объяснили'],
    }),
  );

  assert.equal(client.calls.some(([name]) => name === 'addComment'), false);
  assert.deepEqual(client.calls.at(-1), [
    'setIssueState',
    'Th1rdPlanet',
    'task-hub',
    3,
    'closed',
    'not_planned',
  ]);
});

test('continues after one item fails and returns a failing summary', async () => {
  const items = [
    issueItem({ id: 'bad', status: 'In Progress', labels: [] }),
    issueItem({ id: 'good', status: 'Ready', labels: [] }),
    issueItem({ id: 'pr', typename: 'PullRequest' }),
  ];
  let mutation = 0;
  const client = recordingClient();
  client.graphql = async () => ({
    organization: {
      projectV2: {
        items: {
          nodes: items,
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  });
  client.addLabels = async (...args) => {
    mutation += 1;
    client.calls.push(['addLabels', ...args]);
    if (mutation === 1) throw new Error('first item failed');
  };

  const summary = await synchronizeProject(client, { owner: 'Th1rdPlanet', number: 1 });

  assert.deepEqual(
    { checked: summary.checked, changed: summary.changed, skipped: summary.skipped },
    { checked: 3, changed: 1, skipped: 1 },
  );
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.errors[0].itemId, 'bad');
  assert.equal(client.calls.some(([name, , , , labels]) => name === 'addLabels' && labels?.[0] === 'готово к работе'), true);
});
