import { pathToFileURL } from 'node:url';

import { GitHubClient } from './github-client.mjs';
import { LABEL_DEFINITIONS, planIssueChanges } from './status-policy.mjs';

const PROJECT_ITEMS_QUERY = `
  query ProjectItems($owner: String!, $number: Int!, $cursor: String) {
    organization(login: $owner) {
      projectV2(number: $number) {
        items(first: 100, after: $cursor) {
          nodes {
            id
            content {
              __typename
              ... on Issue {
                number
                url
                state
                stateReason
                repository { name owner { login } }
                labels(first: 100) { nodes { name } }
                comments(last: 100) { nodes { body } }
              }
            }
            fieldValues(first: 50) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
                ... on ProjectV2ItemFieldTextValue {
                  text
                  field { ... on ProjectV2Field { name } }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

export async function paginateProjectItems(client, { owner, number }) {
  const items = [];
  let cursor = null;

  do {
    const data = await client.graphql(PROJECT_ITEMS_QUERY, { owner, number, cursor });
    const page = data?.organization?.projectV2?.items;
    if (!page) throw new Error(`Project ${owner}/${number} was not found`);
    items.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  return items;
}

function fieldValue(item, fieldName) {
  const value = item.fieldValues?.nodes?.find((node) => node.field?.name === fieldName);
  return value?.name ?? value?.text ?? null;
}

export async function syncIssue(client, item) {
  if (item.content?.__typename !== 'Issue') {
    return { changed: false, skipped: true, reason: 'not-an-issue' };
  }

  const status = fieldValue(item, 'Status');
  if (!status) {
    return { changed: false, skipped: true, reason: 'missing-status' };
  }

  const issue = item.content;
  const owner = issue.repository.owner.login;
  const repository = issue.repository.name;
  const plan = planIssueChanges({
    status,
    projectReason: fieldValue(item, 'Причина решения'),
    comments: issue.comments.nodes,
    labels: issue.labels.nodes.map(({ name }) => name),
    state: issue.state,
    stateReason: issue.stateReason,
    projectItemId: item.id,
  });

  for (const label of plan.addLabels) {
    await client.ensureLabel(owner, repository, label, LABEL_DEFINITIONS[label]);
  }
  if (plan.addLabels.length) {
    await client.addLabels(owner, repository, issue.number, plan.addLabels);
  }
  for (const label of plan.removeLabels) {
    await client.removeLabel(owner, repository, issue.number, label);
  }
  if (plan.comment) {
    await client.addComment(owner, repository, issue.number, plan.comment.body);
  }
  if (plan.state) {
    await client.setIssueState(owner, repository, issue.number, plan.state, plan.stateReason);
  }

  return {
    changed:
      plan.addLabels.length > 0 ||
      plan.removeLabels.length > 0 ||
      plan.comment !== null ||
      plan.state !== null,
    skipped: false,
    opened: plan.state === 'open',
    closed: plan.state === 'closed',
    url: issue.url,
  };
}

export async function synchronizeProject(client, { owner, number }) {
  const items = await paginateProjectItems(client, { owner, number });
  const summary = {
    checked: items.length,
    changed: 0,
    opened: 0,
    closed: 0,
    skipped: 0,
    errors: [],
  };

  for (const item of items) {
    try {
      const result = await syncIssue(client, item);
      if (result.skipped) summary.skipped += 1;
      if (result.changed) summary.changed += 1;
      if (result.opened) summary.opened += 1;
      if (result.closed) summary.closed += 1;
    } catch (error) {
      summary.errors.push({
        itemId: item.id,
        url: item.content?.url ?? null,
        message: error.message,
      });
    }
  }

  return summary;
}

export async function main({ env = process.env, client = null, log = console.log } = {}) {
  const token = env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is required');

  const owner = env.PROJECT_OWNER || 'Th1rdPlanet';
  const number = Number(env.PROJECT_NUMBER || '1');
  if (!Number.isInteger(number) || number < 1) throw new Error('PROJECT_NUMBER must be a positive integer');

  const github = client ?? new GitHubClient({ token });
  const summary = await synchronizeProject(github, { owner, number });
  log(JSON.stringify(summary, null, 2));
  if (summary.errors.length) {
    throw new Error(`Synchronization completed with ${summary.errors.length} error(s)`);
  }
  return summary;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
