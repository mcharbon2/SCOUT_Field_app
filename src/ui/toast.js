export function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast visible ${type}`;
  setTimeout(() => el.classList.remove('visible'), 3000);
}
