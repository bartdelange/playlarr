import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/test-output',
      '**/src/generated/**',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'type:config',
              onlyDependOnLibsWithTags: ['type:config'],
            },
            {
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: ['type:domain'],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui'],
            },
            {
              sourceTag: 'type:provider',
              onlyDependOnLibsWithTags: [
                'type:provider',
                'type:domain',
                'type:config',
              ],
            },
            {
              sourceTag: 'type:persistence',
              onlyDependOnLibsWithTags: [
                'type:persistence',
                'type:domain',
                'type:config',
              ],
            },
            {
              sourceTag: 'type:command',
              onlyDependOnLibsWithTags: [
                'type:command',
                'type:domain',
                'type:provider',
                'type:persistence',
                'type:config',
              ],
            },
            {
              sourceTag: 'type:runtime',
              onlyDependOnLibsWithTags: [
                'type:runtime',
                'type:command',
                'type:domain',
                'type:provider',
                'type:persistence',
                'type:config',
              ],
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:domain',
                'type:config',
              ],
            },
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:domain',
                'type:runtime',
                'type:config',
              ],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
