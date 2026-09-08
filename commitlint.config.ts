import type { UserConfig } from '@commitlint/types';
import { createProjectGraphAsync } from '@nx/devkit';

const types = ['feat', 'fix', 'chore', 'test'] as const;
const defaultScopes = ['repo', 'ci', 'deps', 'release'] as const;

function getScopes(projectNames: string[]) {
  const projectScopes = projectNames.map((name) =>
    name.replace(/^@playlarr\//, ''),
  );

  const prefixCounts = projectScopes.reduce<Map<string, number>>(
    (counts, scope) => {
      const [prefix] = scope.split('-');

      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);

      return counts;
    },
    new Map(),
  );

  const groupScopes = [...prefixCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([prefix]) => prefix);

  return [
    ...new Set([...defaultScopes, ...groupScopes, ...projectScopes]),
  ].sort();
}

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

      return [2, 'always', getScopes(Object.keys(graph.nodes))];
    },
    'scope-case': [2, 'always', 'kebab-case'],
    'header-max-length': [2, 'always', 100],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'subject-case': [2, 'always', ['sentence-case']],
  },
};

export default config;
