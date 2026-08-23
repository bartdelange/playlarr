import nx from "@nx/eslint-plugin";

export default [
    ...nx.configs["flat/base"],
    ...nx.configs["flat/typescript"],
    ...nx.configs["flat/javascript"],
    {
      "ignores": [
        "**/dist",
        "**/out-tsc",
        "**/test-output",
        "**/vitest.config.*.timestamp*"
      ]
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx"
        ],
        rules: {
          '@nx/enforce-module-boundaries': [
            'error',
            {
              enforceBuildableLibDependency: true,
              allow: [],
              depConstraints: [
                {
                  sourceTag: 'type:domain',
                  onlyDependOnLibsWithTags: ['type:domain'],
                },
                {
                  sourceTag: 'type:ui',
                  onlyDependOnLibsWithTags: ['type:ui', 'type:domain'],
                },
                {
                  sourceTag: 'type:provider',
                  onlyDependOnLibsWithTags: ['type:provider', 'type:domain'],
                },
                {
                  sourceTag: 'type:persistence',
                  onlyDependOnLibsWithTags: ['type:persistence', 'type:domain'],
                },
                {
                  sourceTag: 'type:command',
                  onlyDependOnLibsWithTags: [
                    'type:command',
                    'type:domain',
                    'type:provider',
                    'type:persistence',
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
                  ],
                },
                {
                  sourceTag: 'type:feature',
                  onlyDependOnLibsWithTags: [
                    'type:feature',
                    'type:ui',
                    'type:domain',
                  ],
                },
                {
                  sourceTag: 'type:app',
                  onlyDependOnLibsWithTags: [
                    'type:feature',
                    'type:ui',
                    'type:domain',
                    'type:runtime',
                  ],
                },
              ],
            },
          ],
        }
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.cts",
            "**/*.mts",
            "**/*.js",
            "**/*.jsx",
            "**/*.cjs",
            "**/*.mjs"
        ],
        // Override or add rules here
        rules: {}
    }
];
