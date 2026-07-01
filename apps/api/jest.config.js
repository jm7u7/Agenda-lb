/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@limablue/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  transform: {
    // isolatedModules: transpila sin re-chequear tipos (los valida `tsc --noEmit`).
    // Evita el OOM al type-chequear los tipos generados de Prisma.
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
};
