import assert from 'node:assert/strict';
import test from 'node:test';

import {
  desiredLifecycle,
  extractIssueReason,
  planIssueChanges,
} from '../scripts/status-policy.mjs';

test('maps every Project status to its issue lifecycle label', () => {
  const cases = [
    ['Inbox', 'на рассмотрении'],
    ['Triage', 'на рассмотрении'],
    ['Ready', 'готово к работе'],
    ['In Progress', 'в работе'],
    ['Review', 'ревью'],
    ['Ready for Verification', 'проверка'],
    ['Deferred', 'отложено'],
    ['Rejected', 'rejected'],
    ['Done', null],
  ];

  for (const [status, expected] of cases) {
    assert.equal(desiredLifecycle(status), expected, status);
  }
});

test('distinguishes unknown statuses from Done', () => {
  assert.equal(desiredLifecycle('Unknown'), undefined);
  assert.equal(desiredLifecycle(null), undefined);
  assert.equal(desiredLifecycle('Done'), null);
});

test('leaves an issue untouched for an unknown Project status', () => {
  const plan = planIssueChanges({
    status: 'Unknown',
    comments: [],
    labels: ['в работе', 'blocked'],
    state: 'CLOSED',
    stateReason: 'NOT_PLANNED',
    projectItemId: 'PVTI_unknown',
  });

  assert.deepEqual(plan, {
    addLabels: [],
    removeLabels: [],
    state: null,
    stateReason: null,
    comment: null,
  });
});

test('extracts only the latest explicitly prefixed rejection reason', () => {
  const comments = [
    { body: 'Обычное обсуждение' },
    { body: 'Причина отклонения: первая причина' },
    { body: 'Причина отклонения: окончательная причина\nс уточнением' },
  ];

  assert.equal(extractIssueReason(comments), 'окончательная причина\nс уточнением');
  assert.equal(extractIssueReason([{ body: 'Причина неизвестна' }]), null);
});

test('prefers the Project rejection reason and plans one marked comment', () => {
  const plan = planIssueChanges({
    status: 'Rejected',
    projectReason: 'Не входит в планы релиза',
    comments: [{ body: 'Причина отклонения: старая причина' }],
    labels: ['в работе', 'blocked'],
    state: 'OPEN',
    projectItemId: 'PVTI_123',
  });

  assert.deepEqual(plan.addLabels, ['rejected']);
  assert.deepEqual(plan.removeLabels, ['в работе']);
  assert.equal(plan.state, 'closed');
  assert.equal(plan.stateReason, 'not_planned');
  assert.match(plan.comment.body, /^Задача отклонена\.\n\nПричина: Не входит в планы релиза\n\n<!-- development-hub:rejected:PVTI_123:[a-f0-9]{12} -->$/);
});

test('uses an existing issue reason without posting a duplicate comment', () => {
  const plan = planIssueChanges({
    status: 'Rejected',
    projectReason: '',
    comments: [{ body: 'Причина отклонения: уже объяснили' }],
    labels: ['на рассмотрении'],
    state: 'OPEN',
    projectItemId: 'PVTI_124',
  });

  assert.equal(plan.comment, null);
  assert.equal(plan.state, 'closed');
  assert.equal(plan.stateReason, 'not_planned');
});

test('keeps a rejected issue open when no reason exists', () => {
  const plan = planIssueChanges({
    status: 'Rejected',
    projectReason: null,
    comments: [{ body: 'Пока обсуждаем' }],
    labels: ['needs-info'],
    state: 'OPEN',
    projectItemId: 'PVTI_125',
  });

  assert.deepEqual(plan.addLabels, ['rejected']);
  assert.deepEqual(plan.removeLabels, []);
  assert.equal(plan.state, null);
  assert.equal(plan.stateReason, null);
  assert.equal(plan.comment, null);
});

test('respects a manually closed rejected issue even without a reason', () => {
  const plan = planIssueChanges({
    status: 'Rejected',
    comments: [],
    labels: ['rejected'],
    state: 'CLOSED',
    stateReason: 'NOT_PLANNED',
    projectItemId: 'PVTI_126',
  });

  assert.equal(plan.state, null);
  assert.equal(plan.comment, null);
});

test('closes Done as completed and clears lifecycle labels', () => {
  const plan = planIssueChanges({
    status: 'Done',
    comments: [],
    labels: ['проверка', 'security'],
    state: 'OPEN',
    projectItemId: 'PVTI_127',
  });

  assert.deepEqual(plan.addLabels, []);
  assert.deepEqual(plan.removeLabels, ['проверка']);
  assert.equal(plan.state, 'closed');
  assert.equal(plan.stateReason, 'completed');
});

test('reopens active work and replaces conflicting lifecycle labels only', () => {
  const plan = planIssueChanges({
    status: 'In Progress',
    comments: [],
    labels: ['на рассмотрении', 'проверка', 'blocked', 'duplicate'],
    state: 'CLOSED',
    stateReason: 'NOT_PLANNED',
    projectItemId: 'PVTI_128',
  });

  assert.deepEqual(plan.addLabels, ['в работе']);
  assert.deepEqual(plan.removeLabels, ['на рассмотрении', 'проверка']);
  assert.equal(plan.state, 'open');
  assert.equal(plan.stateReason, null);
});

test('does not repeat an automated rejection comment with the same marker', () => {
  const first = planIssueChanges({
    status: 'Rejected',
    projectReason: 'Дубликат другой задачи',
    comments: [],
    labels: [],
    state: 'OPEN',
    projectItemId: 'PVTI_129',
  });
  const second = planIssueChanges({
    status: 'Rejected',
    projectReason: 'Дубликат другой задачи',
    comments: [{ body: first.comment.body }],
    labels: ['rejected'],
    state: 'OPEN',
    projectItemId: 'PVTI_129',
  });

  assert.equal(second.comment, null);
  assert.equal(second.state, 'closed');
});
