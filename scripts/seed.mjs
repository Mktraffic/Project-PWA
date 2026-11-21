import { ensureAdminSeed, ensureDefaultCategories } from '../server/services/auth.js';

// Seed idempotente: se puede ejecutar cuantas veces se quiera.
await ensureAdminSeed();
ensureDefaultCategories();
console.log('Seed listo: admin Pepito Perez (pepito.perez@uptc.edu.co) y categorías por defecto.');
