// PLA-I38-3: post a plania-scan commit status. The body is built by statusRequest.

export function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "plania-scan",
  };
}

export function statusUrl(target) {
  return `https://api.github.com/repos/${target.owner}/${target.repo}/statuses/${target.headSha}`;
}

export function runUrl(env) {
  const server = env.GITHUB_SERVER_URL;
  const repo = env.GITHUB_REPOSITORY;
  const id = env.GITHUB_RUN_ID;
  if (!server || !repo || !id) return null;
  if (!/^https:\/\/github\.com$/.test(server)) return null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  if (!/^\d+$/.test(id)) return null;
  return `${server}/${repo}/actions/runs/${id}`;
}

export async function postStatus(fetchImpl, token, target, body, env = {}) {
  const payload = { state: body.state, context: body.context, description: body.description };
  const targetUrl = runUrl(env);
  if (targetUrl) payload.target_url = targetUrl;
  const response = await fetchImpl(statusUrl(target), {
    method: "POST",
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`status post failed (${response.status})`);
}
