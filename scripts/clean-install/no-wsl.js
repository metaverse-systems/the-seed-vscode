// The Windows-without-WSL leg of the hosted clean-install check. The tool is
// installed with Windows Node, where its native component is not built, and the
// editor is not run (the readme lists what is unavailable there). This checks
// through the tool's API that the native operations refuse with the tool's own
// message and that the pure ones work, and writes one record per command to
// test-results/clean-install-windows-no-wsl.json.
//
// HOME and USERPROFILE must point at an empty directory. CLEAN_INSTALL_TOOL_ROOT
// names another installation of the tool than the global one.
//
//   node scripts/clean-install/no-wsl.js [--results <dir>]
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

const LEG = 'windows-no-wsl';
const REPOSITORY = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(REPOSITORY, 'src', 'test', 'fixtures', 'tiny.exe');
const SCOPE = '@cleancheck';
const NOT_RUN = 'not exercised: no extension host on this leg (owner pass)';

function parseArgs(argv) {
  const options = { results: path.join(REPOSITORY, 'test-results') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--results' && argv[i + 1] !== undefined) {
      options.results = argv[++i];
    } else {
      throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  return options;
}

function globalToolRoot() {
  const found = cp.spawnSync('npm', ['root', '-g'], { encoding: 'utf-8', shell: process.platform === 'win32' });
  if (found.status !== 0) {
    throw new Error(`npm root -g failed: ${found.stderr}`);
  }
  return path.join(found.stdout.trim(), '@metaverse-systems', 'the-seed');
}

function reason(error) {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  lib.assertHostedRunner(process.env);
  lib.assertFreshHome(os.homedir());

  const toolRoot = process.env.CLEAN_INSTALL_TOOL_ROOT || globalToolRoot();
  const load = (name) => require(path.join(toolRoot, 'dist', `${name}.js`));
  const toolVersion = JSON.parse(fs.readFileSync(path.join(toolRoot, 'package.json'), 'utf-8')).version;
  const manifest = JSON.parse(fs.readFileSync(path.join(REPOSITORY, 'package.json'), 'utf-8'));
  const Config = load('Config').default;
  const Scopes = load('Scopes').default;
  const Package = load('Package').default;
  const Signing = load('Signing').default;
  const Installer = load('Installer').default;
  const { NativeComponentMissingError, nativeComponentMessage } = load('NativeComponent');
  const expected = nativeComponentMessage();
  console.log(`Tool ${toolVersion} at ${toolRoot}; home ${os.homedir()}`);
  console.log(`The tool's native-component message: ${expected}`);

  const scratch = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'clean-install-no-wsl-'));
  const outcomes = {};
  const attempt = async (id, body) => {
    try {
      outcomes[id] = await body();
    } catch (error) {
      outcomes[id] = `failed (${reason(error)})`;
    }
    console.log(`${id}: ${outcomes[id]}`);
  };

  await attempt('the-seed.showConfig', async () => {
    const config = new Config();
    config.config.prefix = path.join(scratch, 'prefix');
    new Scopes(config).createOrEditScope({
      scopeName: SCOPE,
      authorName: 'Clean Install',
      authorEmail: 'clean-install@example.invalid',
      authorURL: 'https://example.invalid',
    });
    config.saveConfig();
    const reloaded = new Config();
    if (reloaded.config.prefix !== config.config.prefix || !new Scopes(reloaded).getScopes().includes(SCOPE)) {
      throw new Error(`the configuration at ${reloaded.configPath} did not keep the prefix and scope`);
    }
    return 'passed';
  });

  await attempt('the-seed.createSigningCert', async () => {
    await new Signing().createCert({ scope: SCOPE });
    return 'passed';
  });

  await attempt('the-seed.packageProject', async () => {
    const project = path.join(scratch, 'project');
    fs.mkdirSync(project, { recursive: true });
    const result = await new Package(new Config()).run(path.join(scratch, 'dist'), [project]);
    if (result.success !== false || result.message !== expected) {
      throw new Error(`Package.run resolved ${JSON.stringify({ success: result.success, message: result.message })}`);
    }
    return `refused as expected (${result.message})`;
  });

  await attempt('the-seed.signFile', async () => {
    const exe = path.join(scratch, 'tiny.exe');
    fs.copyFileSync(FIXTURE, exe);
    try {
      await new Signing().signFile(exe, { scope: SCOPE });
    } catch (error) {
      if (!(error instanceof NativeComponentMissingError) || error.message !== expected) {
        throw new Error(`embedded signing rejected with ${error && error.constructor ? error.constructor.name : typeof error}: ${reason(error)}`);
      }
      return `refused as expected (${error.message})`;
    }
    throw new Error('embedded signing of a Windows program succeeded without the native component');
  });

  await attempt('the-seed.verifySignature', async () => {
    // Only binary files are signed; a file of no program format gets a detached signature.
    const data = path.join(scratch, 'data.bin');
    fs.writeFileSync(data, Buffer.from([0, 1, 2, 3, 0, 255, 254, 0, 7, 0]));
    const signing = new Signing();
    const signed = await signing.signFile(data, { scope: SCOPE });
    if (signed.signatureType !== 'detached') {
      throw new Error(`a data file was signed ${signed.signatureType}`);
    }
    const verified = await signing.verifyFile(data);
    if (verified.status !== 'VALID') {
      throw new Error(`the detached signature verified ${verified.status}: ${verified.reason || ''}`);
    }
    return 'passed';
  });

  await attempt('the-seed.generateWindowsInstaller', async () => {
    const result = await new Installer(new Config()).run(path.join(scratch, 'project'));
    if (result.ok !== false || result.message !== expected) {
      throw new Error(`Installer.run resolved ${JSON.stringify(result)}`);
    }
    return `refused as expected (${result.message})`;
  });

  fs.rmSync(scratch, { recursive: true, force: true });

  const records = lib.commandRecords({
    manifest,
    platform: LEG,
    runId: process.env.GITHUB_RUN_ID || null,
    editorVersion: 'none (no editor on this leg)',
    toolVersion,
    outcomes,
    fallback: NOT_RUN,
  });
  lib.writeRecords(lib.recordsFile(options.results, LEG), records);
  const failures = records.filter(lib.isFailure);
  for (const record of failures) {
    console.log(`::error::clean-install ${LEG}: ${record.command}: ${record.outcome}`);
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
