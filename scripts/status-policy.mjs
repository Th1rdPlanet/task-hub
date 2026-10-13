import { createHash } from 'node:crypto';

export const LABEL_DEFINITIONS = Object.freeze({
  'needs-triage': Object.freeze({ color: 'D4C5F9', description: 'Запрос ожидает рассмотрения' }),
  'готово к работе': Object.freeze({ color: '0E8A16', description: 'Задача готова к выполнению' }),
  'в работе': Object.freeze({ color: '1D76DB', description: 'Задача выполняется' }),
  'ревью': Object.freeze({ color: '5319E7', description: 'Ожидает ревью кода или конфигурации' }),
  'проверка': Object.freeze({ color: 'FBCA04', description: 'Ожидает проверки на сборке' }),
  'отложено': Object.freeze({ color: 'BFDADC', description: 'Работа отложена' }),
  rejected: Object.freeze({ color: 'B60205', description: 'Задача отклонена' }),
});

export const LIFECYCLE_LABELS = Object.freeze([
  ...Object.keys(LABEL_DEFINITIONS),
  'на рассмотрении',
]);

const STATUS_TO_LABEL = Object.freeze({
  Inbox: 'needs-triage',
  Triage: 'needs-triage',
  Ready: 'готово к работе',
  'In Progress': 'в работе',
  Review: 'ревью',
  'Ready for Verification': 'проверка',
  Deferred: 'отложено',
  Rejected: 'rejected',
  Done: null,
});

export function desiredLifecycle(status) {
  if (!Object.hasOwn(STATUS_TO_LABEL, status)) return undefined;
  return STATUS_TO_LABEL[status];
}

export function extractIssueReason(comments = []) {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const body = comments[index]?.body;
    if (typeof body !== 'string') continue;

    const match = body.match(/^\s*Причина отклонения:\s*([\s\S]*\S)\s*$/u);
    if (match) return match[1];
  }
  return null;
}

function rejectionMarker(projectItemId, reason) {
  const digest = createHash('sha256').update(reason).digest('hex').slice(0, 12);
  return `<!-- development-hub:rejected:${projectItemId}:${digest} -->`;
}

export function planIssueChanges(input) {
  const {
    status,
    projectReason,
    comments = [],
    labels = [],
    state,
    stateReason,
    projectItemId,
  } = input;
  const desiredLabel = desiredLifecycle(status);
  if (desiredLabel === undefined) {
    return {
      addLabels: [],
      removeLabels: [],
      state: null,
      stateReason: null,
      comment: null,
    };
  }
  const addLabels = desiredLabel && !labels.includes(desiredLabel) ? [desiredLabel] : [];
  const removeLabels = labels.filter(
    (label) => LIFECYCLE_LABELS.includes(label) && label !== desiredLabel,
  );

  let nextState = null;
  let nextStateReason = null;
  let comment = null;

  if (status === 'Done') {
    if (state !== 'CLOSED' || stateReason !== 'COMPLETED') {
      nextState = 'closed';
      nextStateReason = 'completed';
    }
  } else if (status === 'Rejected') {
    if (state !== 'CLOSED') {
      const normalizedProjectReason =
        typeof projectReason === 'string' && projectReason.trim() ? projectReason.trim() : null;
      const issueReason = extractIssueReason(comments);
      const reason = normalizedProjectReason ?? issueReason;

      if (reason) {
        nextState = 'closed';
        nextStateReason = 'not_planned';

        if (normalizedProjectReason) {
          const marker = rejectionMarker(projectItemId, normalizedProjectReason);
          const alreadyPosted = comments.some(({ body }) => body?.includes(marker));
          if (!alreadyPosted) {
            comment = {
              body: `Задача отклонена.\n\nПричина: ${normalizedProjectReason}\n\n${marker}`,
              marker,
            };
          }
        }
      }
    }
  } else if (status && state === 'CLOSED') {
    nextState = 'open';
  }

  return {
    addLabels,
    removeLabels,
    state: nextState,
    stateReason: nextStateReason,
    comment,
  };
}
