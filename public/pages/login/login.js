/**
 * login.js — Página de acceso. Autocontenida: no depende de ningún otro
 * archivo JS de la app (duplica el helper api() mínimo que necesita).
 */

const $ = sel => document.querySelector(sel);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

$('#form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#login-error');
  err.classList.add('hidden');
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#login-username').value.trim(), password: $('#login-password').value }),
    });
    const qrIdLogin = new URLSearchParams(location.search).get('qr_equipo');
    location.href = qrIdLogin ? '/equipo/' + qrIdLogin : '/';
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.remove('hidden');
  }
});

// ---------- Olvidé contraseña ----------

$('#btn-olvide-pass').addEventListener('click', () => {
  $('#recuperar-username').value = $('#login-username').value || '';
  $('#recuperar-status').classList.add('hidden');
  $('#modal-recuperar-pass').showModal();
});

$('#btn-recuperar-cancelar').addEventListener('click', () => $('#modal-recuperar-pass').close());

$('#form-recuperar-pass').addEventListener('submit', async e => {
  e.preventDefault();
  const st = $('#recuperar-status');
  const username = $('#recuperar-username').value.trim();
  st.classList.add('hidden');
  try {
    await api('/api/solicitar-reset', { method: 'POST', body: JSON.stringify({ username }) });
    st.textContent = '✓ Si el usuario existe, se ha enviado un enlace al correo de recuperación.';
    st.style.color = '#15803d';
    st.classList.remove('hidden');
    setTimeout(() => $('#modal-recuperar-pass').close(), 3000);
  } catch (err) {
    st.textContent = '✗ ' + err.message;
    st.style.color = '#dc2626';
    st.classList.remove('hidden');
  }
});
