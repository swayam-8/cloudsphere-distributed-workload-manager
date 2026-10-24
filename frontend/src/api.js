export let token = sessionStorage.getItem('cloudsphere-token') || '';
export function setToken(value) {
  token = value;
  if (value) sessionStorage.setItem('cloudsphere-token', value);
  else sessionStorage.removeItem('cloudsphere-token');
}

export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const hint = response.status === 401 ? 'Operator authentication required. Check the operator token.'
      : response.status === 404 ? `CloudSphere API route /api${path.split('?')[0]} was not found. Verify CLOUDSPHERE_API_PORT matches in the frontend and backend terminals, then restart the frontend.`
      : `API request failed (${response.status}). Check backend connectivity and server logs.`;
    throw new Error(typeof error.detail === 'string' ? error.detail : hint);
  }
  return options.download ? response.blob() : response.json();
}

export function saveBlob(blob, name) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
