module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es2021: true,
    node: true
  },
  extends: ['standard', 'prettier'],
  parserOptions: {
    ecmaVersion: 'latest'
  },
  rules: {
    // Customize rules for this project
    'no-console': 'off', // Allow console.log for logging
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    'prefer-template': 'error',
    'arrow-spacing': 'error',
    'comma-dangle': ['error', 'never'],
    eqeqeq: ['error', 'always'],
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    'no-alert': 'warn',
    'no-debugger': 'warn',
    'no-duplicate-imports': 'error',
    'no-useless-return': 'error',
    'prefer-arrow-callback': 'error',
    'prefer-destructuring': [
      'error',
      {
        array: false,
        object: true
      }
    ],
    'prefer-rest-params': 'error',
    'prefer-spread': 'error',
    'no-confusing-arrow': 'off', // Allow arrow functions with ternary expressions
    'no-useless-constructor': 'error',
    'no-useless-rename': 'error',
    'object-property-newline': ['error', { allowMultiplePropertiesPerLine: true }],
    'max-len': [
      'error',
      {
        code: 120,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true
      }
    ],
    camelcase: 'off' // Allow snake_case for configuration variables
  },
  globals: {
    // Add any global variables used in the project
    process: 'readonly',
    Buffer: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
    module: 'readonly',
    require: 'readonly',
    exports: 'readonly',
    global: 'readonly'
  },
  ignorePatterns: ['node_modules/', 'venv/', '*.min.js', 'dist/', 'build/']
};
