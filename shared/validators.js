// Validaciones compartidas: el MISMO código corre en el cliente (mensajes inmediatos)
// y en el servidor (única fuente de verdad). Devuelven { errors, values } con un mensaje por campo.

export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@uptc\.edu\.co$/i;
export const NAME_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?: [A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)+$/;
export const CODE_RE = /^\d{8,10}$/;
export const CARGOS = ['docente', 'funcionario', 'estudiante'];

export function passwordChecks(password = '') {
  return {
    longitud: password.length >= 8,
    mayuscula: /[A-ZÁÉÍÓÚÑ]/.test(password),
    minuscula: /[a-záéíóúñ]/.test(password),
    numero: /\d/.test(password)
  };
}

export function validateRegistration(input = {}) {
  const values = {
    nombre: String(input.nombre ?? '').trim().replace(/\s+/g, ' '),
    codigo: String(input.codigo ?? '').trim(),
    cargo: String(input.cargo ?? '').trim().toLowerCase(),
    correo: String(input.correo ?? '').trim().toLowerCase(),
    password: String(input.password ?? '')
  };
  const errors = {};

  if (!values.nombre) errors.nombre = 'Escribe tu nombre completo.';
  else if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/.test(values.nombre)) errors.nombre = 'El nombre solo puede contener letras, tildes y espacios.';
  else if (!NAME_RE.test(values.nombre)) errors.nombre = 'Escribe al menos un nombre y un apellido (mínimo 2 palabras).';

  if (!values.codigo) errors.codigo = 'Escribe tu código estudiantil o institucional.';
  else if (!/^\d+$/.test(values.codigo)) errors.codigo = 'El código solo puede contener dígitos.';
  else if (values.codigo.length < 8) errors.codigo = 'El código debe tener mínimo 8 dígitos.';
  else if (values.codigo.length > 10) errors.codigo = 'El código debe tener máximo 10 dígitos.';

  if (!CARGOS.includes(values.cargo)) errors.cargo = 'Selecciona tu cargo: docente, funcionario o estudiante.';

  if (!values.correo) errors.correo = 'Escribe tu correo institucional.';
  else if (!EMAIL_RE.test(values.correo)) errors.correo = 'Usa tu correo institucional con dominio @uptc.edu.co.';

  const pw = passwordChecks(values.password);
  if (!values.password) errors.password = 'Escribe una contraseña.';
  else if (!pw.longitud) errors.password = 'La contraseña debe tener mínimo 8 caracteres.';
  else if (!pw.mayuscula) errors.password = 'La contraseña debe incluir al menos una letra mayúscula.';
  else if (!pw.minuscula) errors.password = 'La contraseña debe incluir al menos una letra minúscula.';
  else if (!pw.numero) errors.password = 'La contraseña debe incluir al menos un número.';

  return { errors, values };
}

export function validateLogin(input = {}) {
  const values = { correo: String(input.correo ?? '').trim().toLowerCase(), password: String(input.password ?? '') };
  const errors = {};
  if (!values.correo) errors.correo = 'Escribe tu correo institucional.';
  else if (!EMAIL_RE.test(values.correo)) errors.correo = 'Usa tu correo institucional con dominio @uptc.edu.co.';
  if (!values.password) errors.password = 'Escribe tu contraseña.';
  return { errors, values };
}
