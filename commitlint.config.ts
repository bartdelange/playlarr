import type { UserConfig } from '@commitlint/types';

const config: UserConfig = {
  parserPreset: {
    parserOpts: {
      headerPattern:
        /^(\p{Extended_Pictographic}\uFE0F?)\s+(feat|fix|chore|test)(?:\((playlarr|e2e|ui|home|imports|settings|domain|providers|persistence|commands|runtime|config|repo)\))?: (.+)$/u,
      headerCorrespondence: ['gitmoji', 'type', 'scope', 'subject'],
    },
  },
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'chore', 'test']],
    'scope-enum': [
      2,
      'always',
      [
        'playlarr',
        'e2e',
        'ui',
        'home',
        'imports',
        'settings',
        'domain',
        'providers',
        'persistence',
        'commands',
        'runtime',
        'config',
        'repo',
      ],
    ],
    'header-max-length': [2, 'always', 100],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'subject-case': [2, 'always', ['lower-case', 'sentence-case']],
  },
};

export default config;
