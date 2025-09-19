import baseConfig from "../../eslint.config.js";
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    ...reactHooks.configs['recommended-latest'],
    ...reactRefresh.configs.vite,
    // Add any admin-app specific rules here if needed
  },
  {
    ignores: ['dist'],
  },
];
