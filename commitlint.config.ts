import type { UserConfig } from '@commitlint/types';
import { createProjectGraphAsync } from '@nx/devkit';

const types = ['feat', 'fix', 'chore', 'test'] as const;

const typePattern = types.join('|');

const defaultScopes = ['repo', 'ci', 'deps', 'release'] as const;

const config: UserConfig = {
  parserPreset: {
    parserOpts: {
      headerPattern: new RegExp(
        `^(\\p{Extended_Pictographic}\\uFE0F?)\\s+([a-z]+)(?:\\(([a-z0-9-]+)\\))?: (.+)$`,
        'u',
      ),
      headerCorrespondence: ['gitmoji', 'type', 'scope', 'subject'],
    },
  },

  rules: {
    'type-enum': [2, 'always', types],

    'scope-enum': async () => {
      const graph = await createProjectGraphAsync();

      const projectScopes = Object.keys(graph.nodes).map((projectName) =>
        projectName.replace(/^@playlarr\//, ''),
      );

      return [2, 'always', [...defaultScopes, ...projectScopes].sort()];
    },

    'scope-case': [2, 'always', 'kebab-case'],
    'header-max-length': [2, 'always', 100],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'subject-case': [2, 'always', ['sentence-case']],
  },
};

export default config;
