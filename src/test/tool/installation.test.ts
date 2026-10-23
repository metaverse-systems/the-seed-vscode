import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { activeToolService } from '../../tool/toolService';

// The whole suite, real builds included, runs against the installation named by THE_SEED_TEST_TOOL.
// In the hosted jobs that is the global installation of the published tool.
suite('the installation the suite runs against', () => {
  test('is the real path of THE_SEED_TEST_TOOL, found through the setting, compatible, at the version on disk', () => {
    const named = process.env.THE_SEED_TEST_TOOL;
    assert.ok(named, 'THE_SEED_TEST_TOOL is not set');
    const location = fs.realpathSync(named);
    const onDisk = (JSON.parse(fs.readFileSync(path.join(location, 'package.json'), 'utf8')) as { version: string }).version;

    const status = activeToolService().status;
    assert.strictEqual(status.state, 'usable', status.message);
    const installation = status.installation;
    assert.ok(installation, 'an installation is in use');
    assert.strictEqual(fs.realpathSync(installation.packageDir), location);
    assert.strictEqual(installation.foundThrough, 'setting');
    assert.strictEqual(installation.verdict, 'compatible');
    assert.strictEqual(installation.version, onDisk);
  });
});
