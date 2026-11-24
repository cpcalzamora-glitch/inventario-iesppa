// Ingreso con usuario y PIN.
import { h } from '../ui.js';

export function vistaLogin(alIngresar) {
  let error = h('p.error');
  const usuario = h('input', { name: 'usuario', autocomplete: 'username', autocapitalize: 'none', placeholder: 'hernan, invent1…', required: true });
  const pin = h('input', { name: 'pin', type: 'password', inputMode: 'numeric', pattern: '[0-9]{4,6}', maxLength: 6, autocomplete: 'current-password', placeholder: '••••', required: true });
  try { usuario.value = localStorage.getItem('ultimoUsuario') || ''; } catch (e) { /* */ }
  const btn = h('button.btn.pri.grande', { type: 'submit' }, 'Ingresar');
  return h('div.pantalla.login',
    h('div.logo', '▣'),
    h('h1', 'Inventario IESPPA 2026'),
    h('p.texto.chico', 'Verificación física de bienes patrimoniales'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true; btn.textContent = 'Ingresando…'; error.textContent = '';
        try {
          await alIngresar(usuario.value.trim().toLowerCase(), pin.value.trim(), (msg) => { btn.textContent = msg; });
          try { localStorage.setItem('ultimoUsuario', usuario.value.trim().toLowerCase()); } catch (er) { /* */ }
        } catch (er) {
          error.textContent = er.message;
          btn.disabled = false; btn.textContent = 'Ingresar';
        }
      }
    },
    h('label.campo', h('span', 'Usuario'), usuario),
    h('label.campo', h('span', 'PIN'), pin),
    error, btn));
}
