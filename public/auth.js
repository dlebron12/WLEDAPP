const form = document.getElementById('auth-form');
const message = document.getElementById('message');
const submit = document.getElementById('submit');
const confirmRow = document.querySelector('.signup-only');
let mode = 'login';

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    mode = tab.dataset.mode;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    confirmRow.hidden = mode !== 'signup';
    form.password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    message.textContent = '';
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  message.textContent = '';

  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) return showError('Enter a username and password.');
  if (mode === 'signup' && password !== form.confirm.value) {
    return showError('Passwords do not match.');
  }

  submit.disabled = true;
  try {
    const res = await fetch(`/api/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error || 'Something went wrong.');
    window.location.href = '/home';
  } catch {
    showError('Could not reach the server.');
  } finally {
    submit.disabled = false;
  }
});

function showError(text) {
  message.textContent = text;
}
