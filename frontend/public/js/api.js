// Thin fetch wrapper around the backend API.

export class ApiError extends Error {
  constructor(message, status, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

let onServedBy = () => {};
export function setServedByListener(fn) { onServedBy = fn; }

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }

  const served = res.headers.get('X-Served-By');
  if (served) onServedBy(served);

  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body (e.g. a proxy error page) */ }

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.fields || {});
  }
  return data;
}

export const api = {
  meta: () => request('GET', '/meta'),
  list: () => request('GET', '/employees'),
  create: (employee) => request('POST', '/employees', employee),
  update: (id, employee) => request('PUT', `/employees/${encodeURIComponent(id)}`, employee),
  remove: (id) => request('DELETE', `/employees/${encodeURIComponent(id)}`),
};
