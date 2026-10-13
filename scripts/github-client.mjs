export class GitHubClient {
  constructor({ token, fetchImpl = globalThis.fetch, apiUrl = 'https://api.github.com' }) {
    if (!token) throw new Error('GitHub token is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

    this.token = token;
    this.fetchImpl = fetchImpl;
    this.apiUrl = apiUrl.replace(/\/$/, '');
  }

  async request(method, path, body) {
    const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      const detail = payload?.message ? `: ${payload.message}` : '';
      throw new Error(`GitHub API ${method} ${path} failed with ${response.status}${detail}`);
    }
    return payload;
  }

  async graphql(query, variables = {}) {
    const payload = await this.request('POST', '/graphql', { query, variables });
    if (payload.errors?.length) {
      throw new Error(`GitHub GraphQL failed: ${payload.errors.map(({ message }) => message).join('; ')}`);
    }
    return payload.data;
  }

  async ensureLabel(owner, repository, name, definition) {
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/labels`;
    try {
      await this.request('GET', `${base}/${encodeURIComponent(name)}`);
    } catch (error) {
      if (!error.message.includes('failed with 404')) throw error;
      await this.request('POST', base, { name, ...definition });
    }
  }

  addLabels(owner, repository, number, labels) {
    return this.request(
      'POST',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues/${number}/labels`,
      { labels },
    );
  }

  removeLabel(owner, repository, number, label) {
    return this.request(
      'DELETE',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues/${number}/labels/${encodeURIComponent(label)}`,
    );
  }

  addComment(owner, repository, number, body) {
    return this.request(
      'POST',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues/${number}/comments`,
      { body },
    );
  }

  setIssueState(owner, repository, number, state, stateReason = null) {
    return this.request(
      'PATCH',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues/${number}`,
      stateReason ? { state, state_reason: stateReason } : { state },
    );
  }
}
