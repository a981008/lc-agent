/* REST 帮助 + Token 管理（localStorage: lc-token） */

let token = localStorage.getItem('lc-token') || '';

export function getToken() {
  return token;
}

export function setToken(t) {
  token = t;
  localStorage.setItem('lc-token', t);
}

export function clearToken() {
  token = '';
  localStorage.removeItem('lc-token');
}

/** 401 时派发全局事件（App.vue 监听后登出），并抛出带 unauthorized 标记的错误 */
export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('lc:unauthorized'));
    throw Object.assign(new Error('unauthorized'), { unauthorized: true });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
