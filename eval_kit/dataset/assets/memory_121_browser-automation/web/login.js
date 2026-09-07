const form = document.querySelector('#login');
const status = document.querySelector('[role=status]');
form.addEventListener('submit', e => { e.preventDefault(); const data = new FormData(form); status.textContent = data.get('email') ? 'Signed in' : 'Email required'; });
