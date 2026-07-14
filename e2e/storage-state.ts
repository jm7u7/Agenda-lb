import path from 'node:path';
// Ruta del storageState de la sesión autenticada (compartida por el config y auth.setup).
// En un módulo aparte para que el config NO importe un archivo con test()/setup().
export const STORAGE_STATE = path.join(__dirname, '.auth/state.json');
