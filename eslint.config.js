// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'src/worklet.bundle.js', '.expo/*', 'ios/*', 'android/*', 'wdk-bundle/*'],
  },
  {
    plugins: {
      prettier: require('eslint-plugin-prettier'),
    },
    rules: {
      'prettier/prettier': 'error',
      // The WDK packages resolve through package.json `exports` maps, which the
      // classic import resolver can't follow, and the worklet bundle is a
      // gitignored build artifact — both are false positives here.
      'import/no-unresolved': ['error', { ignore: ['^@tetherto/', 'wdk-worklet\\.bundle'] }],
    },
  },
  {
    files: [
      '**/__tests__/**/*.ts',
      '**/__tests__/**/*.tsx',
      '**/jest.setup.js',
      '**/jest.setup.ts',
    ],
    // Flat config replaced `env: { jest: true }` with explicit globals.
    languageOptions: {
      globals: require('globals').jest,
    },
  },
]);
