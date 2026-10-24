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
    throw new Error(typeof error.detail === 'string' ? error.detail : `Request failed (${response.status}). Check your inputs and operator token.`);
  }
  return options.download ? response.blob() : response.json();
}

export function saveBlob(blob, name) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
