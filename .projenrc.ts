import { DependencyType, javascript, JsonFile, JsonPatch, typescript } from 'projen';
import { versionMajorMinor } from 'typescript';
import { BuildWorkflow } from './projenrc/build-workflow';
import { ReleaseWorkflow } from './projenrc/release';
import { SUPPORT_POLICY, SupportPolicy } from './projenrc/support';
import { UpgradeDependencies } from './projenrc/upgrade-dependencies';

const project = new typescript.TypeScriptProject({
  projenrcTs: true,

  name: 'jsii-rosetta',
  license: 'Apache-2.0',

  authorName: 'Amazon Web Services',
  authorUrl: 'https://aws.amazon.com',

  homepage: 'https://aws.github.io/jsii',
  repository: 'https://github.com/aws/jsii-rosetta.git',

  pullRequestTemplateContents: [
    '',
    '',
    '---',
    '',
    'By submitting this pull request, I confirm that my contribution is made under the terms of the [Apache 2.0 license].',
    '',
    '[Apache 2.0 license]: https://www.apache.org/licenses/LICENSE-2.0',
  ],

  autoDetectBin: true,

  minNodeVersion: '14.18.0',
  tsconfig: {
    compilerOptions: {
      // @see https://github.com/microsoft/TypeScript/wiki/Node-Target-Mapping
      lib: ['es2020', 'es2021.WeakRef'],
      target: 'ES2020',

      esModuleInterop: false,
      noImplicitOverride: true,
      skipLibCheck: true,

      sourceMap: true,
      inlineSourceMap: false,
      inlineSources: true,
    },
  },

  prettier: true,
  prettierOptions: {
    ignoreFile: false,
    settings: {
      bracketSpacing: true,
      printWidth: 120,
      quoteProps: javascript.QuoteProps.CONSISTENT,
      semi: true,
      singleQuote: true,
      tabWidth: 2,
      trailingComma: javascript.TrailingComma.ALL,
    },
  },

  jestOptions: {
    configFilePath: 'jest.config.json',
    jestConfig: {
      moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
      watchPathIgnorePatterns: [
        // NB: Those are regexes...
        '<rootDir>/fixtures/\\..*',
        '<rootDir>/fixtures/node_modules',
        '<rootDir>/fixtures/.*\\.d\\.ts',
        '<rootDir>/fixtures/.*\\.js',
        '<rootDir>/fixtures/.*\\.map',
      ],
    },
    junitReporting: false,
  },

  buildWorkflow: false, // We have our own build workflow (need matrix test)
  release: false, // We have our own release workflow
  defaultReleaseBranch: 'main',

  autoApproveUpgrades: true,
  autoApproveOptions: {
    allowedUsernames: ['aws-cdk-automation', 'github-bot'],
  },

  depsUpgrade: false, // We have our own custom upgrade workflow

  vscode: true,

  devDeps: [
    '@actions/core',
    '@actions/github',
    '@types/commonmark',
    '@types/mock-fs',
    '@types/stream-json',
    '@types/tar',
    '@types/workerpool',
    'mock-fs',
    'tar',
    'ts-node',
  ],
  deps: [
    '@jsii/check-node',
    '@jsii/spec',
    '@xmldom/xmldom',
    'chalk@^4',
    'commonmark',
    'fast-glob',
    `jsii@${versionMajorMinor}.x`,
    'semver-intersect',
    'semver',
    'stream-json',
    'typescript',
    'workerpool',
    'yargs',
  ],
});

new UpgradeDependencies(project, {
  workflowOptions: {
    branches: [
      'main',
      ...Object.entries(SUPPORT_POLICY.maintenance).flatMap(([version, until]) => {
        if (Date.now() > until.getTime()) {
          return [];
        }
        return [`maintenance/v${version}`];
      }),
    ],
    labels: ['auto-approve'],
  },
});

// VSCode will look at the "closest" file named "tsconfig.json" when deciding on which config to use
// for a given TypeScript file with the TypeScript language server. In order to make this "seamless"
// we'll be dropping `tsconfig.json` files at strategic locations in the project. These will not be
// committed as they are only here for VSCode comfort.
for (const dir of ['build-tools', 'projenrc', 'test', 'test/translations']) {
  new JsonFile(project, `${dir}/tsconfig.json`, {
    allowComments: true,
    committed: false,
    marker: true,
    obj: {
      extends: '../tsconfig.dev.json',
      references: [{ path: '../tsconfig.json' }],
    },
    readonly: true,
  });
}
project.tsconfig?.file?.patch(
  JsonPatch.add('/compilerOptions/composite', true),
  JsonPatch.add('/compilerOptions/declarationMap', true),
);
// Don't try to compile files under the `test/translations` directory with tests...
project.tsconfigDev.addExclude('test/translations/**/*.ts');
project.eslint?.addIgnorePattern('test/translations/**/*.ts');

// Don't show .gitignore'd files in the VSCode explorer
project.vscode!.settings.addSetting('explorer.excludeGitIgnore', true);
// Use the TypeScript SDK from the project dependencies
project.vscode!.settings.addSetting('typescript.tsdk', 'node_modules/typescript/lib');
// Format-on-save using ESLint
project.vscode!.extensions.addRecommendations('dbaeumer.vscode-eslint');
project.vscode!.settings.addSetting('editor.codeActionsOnSave', { 'source.fixAll.eslint': true });
project.vscode!.settings.addSetting('eslint.validate', ['typescript']);

// Exports map...
project.package.addField('exports', {
  '.': `./${project.package.entrypoint}`,
  './package.json': './package.json',
});

// Remove TypeScript devDependency (it's a direct/normal dependency here)
project.deps.removeDependency('typescript', DependencyType.BUILD);

// Modernize ts-jest configuration
if (project.jest?.config?.globals?.['ts-jest']) {
  delete project.jest.config.globals['ts-jest'];
  project.jest.config.transform ??= {};
  project.jest.config.transform['^.+\\.tsx?$'] = [
    'ts-jest',
    {
      compiler: 'typescript',
      tsconfig: 'tsconfig.dev.json',
    },
  ];
}

// Add fixtures & other exemptions to npmignore
project.npmignore?.addPatterns(
  '/.*',
  '/CODE_OF_CONDUCT.md',
  '/CONTRIBUTING.md',
  '/build-tools/',
  '/fixtures/',
  '/projenrc/',
  '*.tsbuildinfo',
  '*.d.ts.map', // Declarations map aren't useful in published packages.
);

// Customize ESLint rules
project.tsconfigDev.addInclude('build-tools/**/*.ts');
project.eslint!.rules!['no-bitwise'] = ['off']; // The TypeScript compiler API leverages some bit-flags.
project.eslint!.rules!.quotes = ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }];
project.addDevDeps('eslint-plugin-unicorn');
// Add Unicorn rules (https://github.com/sindresorhus/eslint-plugin-unicorn#rules)
project.eslint?.addPlugins('unicorn');
project.eslint?.addRules({
  'unicorn/prefer-node-protocol': ['error'],
  'unicorn/no-array-for-each': ['error'],
  'unicorn/no-unnecessary-await': ['error'],
});

// Add Node.js version matrix test
new BuildWorkflow(project);

// Add support policy documents & release workflows
new SupportPolicy(project);
const releases = new ReleaseWorkflow(project)
  .autoTag({
    preReleaseId: 'dev',
    runName: 'Auto-Tag Prerelease (default branch)',
    schedule: '0 0 * * 0,2-6', // Tuesday though sundays at midnight
  })
  .autoTag({
    runName: 'Auto-Tag Release (default branch)',
    schedule: '0 0 * * 1', // Mondays at midnight
  });

// We'll stagger release schedules so as to avoid everything going out at once.
let hour = 0;
for (const [version, until] of Object.entries(SUPPORT_POLICY.maintenance)) {
  if (Date.now() <= until.getTime()) {
    // Stagger schedules every 5 hours, rolling. 5 was selected because it's co-prime to 24.
    hour = (hour + 5) % 24;

    const branch = `v${version}`;

    releases
      .autoTag({
        preReleaseId: 'dev',
        runName: `Auto-Tag Prerelease (${branch})`,
        schedule: `0 ${hour} * * 0,2-6`, // Tuesday though sundays
        branch: `maintenance/${branch}`,
        nameSuffix: branch,
      })
      .autoTag({
        runName: `Auto-Tag Release (${branch})`,
        schedule: `0 ${hour} * * 1`, // Mondays
        branch: `maintenance/${branch}`,
        nameSuffix: branch,
      });
  }
}

project.synth();
