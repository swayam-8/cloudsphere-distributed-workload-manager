import http from 'node:http';

// Loopback traffic must not be routed through a workstation's HTTP proxy.
// Remote AWS/control-plane HTTPS requests continue to use their normal clients.
export function isLoopbackHttp(address) {
  const url = new URL(address);
  return url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
}

export function localRequest(address, { method = 'GET', headers = {}, body, signal, timeoutMs = 5000, maxBytes = 16 * 1024 * 1024 } = {}) {
  const url = new URL(address);
  if (!isLoopbackHttp(url)) throw new Error('localRequest accepts loopback HTTP addresses only');
  return new Promise((resolve,reject) => {
    const request = http.request(url, { method, headers, agent:false, signal }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(new Error('Local HTTP response exceeds size limit')); return; }
        chunks.push(chunk);
      });
      response.on('error',reject);
      response.on('end', () => {
        const status = response.statusCode || 500;
        resolve(new Response([204,205,304].includes(status) ? null : Buffer.concat(chunks), { status, headers:response.headers }));
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Local HTTP request timed out after ${timeoutMs}ms`)));
    request.on('error',reject);
    request.end(body);
  });
}
