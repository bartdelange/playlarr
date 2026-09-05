import type { UserConfig } from '@commitlint/types';

const types = ['feat', 'fix', 'chore', 'test'] as const;

const typePattern = types.join('|');

const config: UserConfig = {
  parserPreset: {
    parserOpts: {
      headerPattern: new RegExp(
        `^(\\p{Extended_Pictographic}\\uFE0F?)\\s+(${typePattern})(?:\\(([a-z0-9-]+)\\))?: (.+)$`,
        'u',
      ),
      headerCorrespondence: ['gitmoji', 'type', 'scope', 'subject'],
    },
  },

  rules: {
    'type-enum': [2, 'always', types],
    'scope-case': [2, 'always', 'kebab-case'],
    'header-max-length': [2, 'always', 100],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'subject-case': [2, 'always', ['lower-case', 'sentence-case']],
  },
};

export default config;
