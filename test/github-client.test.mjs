import assert from 'node:assert/strict';
import test from 'node:test';

import { GitHubClient } from '../scripts/github-client.mjs';
import { paginateProjectItems } from '../scripts/sync-project-status.mjs';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('paginates every Project item exactly once', async () => {
  const cursors = [];
  const client = {
    async graphql(_query, variables) {
      cursors.push(variables.cursor);
      if (variables.cursor === null) {
        return {
          organization: {
            projectV2: {
              items: {
                nodes: Array.from({ length: 100 }, (_, index) => ({ id: `item-${index}` })),
                pageInfo: { hasNextPage: true, endCursor: 'cursor-100' },
              },
            },
          },
        };
      }
      return {
        organization: {
          projectV2: {
            items: {
              nodes: [{ id: 'item-100' }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
    },
  };

  const items = await paginateProjectItems(client, { owner: 'Th1rdPlanet', number: 1 });

  assert.equal(items.length, 101);
  assert.equal(new Set(items.map(({ id }) => id)).size, 101);
  assert.deepEqual(cursors, [null, 'cursor-100']);
});

test('creates a missing label before assigning it', async () => {
  const requests = [];
  const client = new GitHubClient({
    token: 'secret-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (options.method === 'GET') return jsonResponse({ message: 'Not Found' }, 404);
      return jsonResponse({ name: 'в работе' }, 201);
    },
  });

  await client.ensureLabel('Th1rdPlanet', 'eSCore', 'в работе', {
    color: '1D76DB',
    description: 'Задача выполняется',
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    name: 'в работе',
    color: '1D76DB',
    description: 'Задача выполняется',
  });
  assert.equal(requests[1].options.headers.authorization, 'Bearer secret-token');
});

test('emits the exact REST mutations for labels, comments, and issue state', async () => {
  const requests = [];
  const client = new GitHubClient({
    token: 'secret-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({}, options.method === 'DELETE' ? 200 : 201);
    },
  });

  await client.addLabels('Th1rdPlanet', 'task-hub', 3, ['rejected']);
  await client.removeLabel('Th1rdPlanet', 'task-hub', 3, 'на рассмотрении');
  await client.addComment('Th1rdPlanet', 'task-hub', 3, 'Причина');
  await client.setIssueState('Th1rdPlanet', 'task-hub', 3, 'closed', 'not_planned');
  await client.setIssueState('Th1rdPlanet', 'task-hub', 3, 'open');

  assert.deepEqual(
    requests.map(({ url, options }) => [options.method, new URL(url).pathname, options.body && JSON.parse(options.body)]),
    [
      ['POST', '/repos/Th1rdPlanet/task-hub/issues/3/labels', { labels: ['rejected'] }],
      ['DELETE', '/repos/Th1rdPlanet/task-hub/issues/3/labels/%D0%BD%D0%B0%20%D1%80%D0%B0%D1%81%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D0%BD%D0%B8%D0%B8', undefined],
      ['POST', '/repos/Th1rdPlanet/task-hub/issues/3/comments', { body: 'Причина' }],
      ['PATCH', '/repos/Th1rdPlanet/task-hub/issues/3', { state: 'closed', state_reason: 'not_planned' }],
      ['PATCH', '/repos/Th1rdPlanet/task-hub/issues/3', { state: 'open' }],
    ],
  );
});

test('reports API failures without leaking the token', async () => {
  const client = new GitHubClient({
    token: 'super-secret-token',
    fetchImpl: async () => jsonResponse({ message: 'Forbidden' }, 403),
  });

  await assert.rejects(
    () => client.request('GET', '/forbidden'),
    (error) => error.message.includes('403') && !error.message.includes('super-secret-token'),
  );
});
