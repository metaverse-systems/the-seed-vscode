// A native component that is missing when first asked for is picked up by the next check once it is
// built, in the same editor session and without a reload.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { useScratchState } from '../helpers/scratchState';
import { copyTestTool } from '../helpers/stubTool';
import { testTool, withToolSetting } from '../helpers/tool';
import { activeToolService } from '../../tool/toolService';
import { nativeComponentState } from '../../tool/nativeComponentState';

suite('Native component built after a failed check', function () {
  this.timeout(60000);
  const state = useScratchState({});

  test('the next check reports built after the component is restored, without a reload', async () => {
    const copy = copyTestTool(path.join(state.dir('toolcopy'), 'the-seed'), { native: true });
    const aside = path.join(state.dir('aside'), 'native');

    // The component is absent when the tool is first loaded, as before "npm run build-addon"
    fs.renameSync(path.join(copy, 'native'), aside);

    await withToolSetting(copy, async () => {
      const tool = testTool();
      assert.strictEqual(fs.realpathSync(activeToolService().status.installation!.packageDir), fs.realpathSync(copy));

      const missing = nativeComponentState(tool);
      assert.strictEqual(missing.built, false, 'the component is reported missing before it is built');

      fs.renameSync(aside, path.join(copy, 'native'));
      assert.deepStrictEqual(nativeComponentState(tool), { built: true }, 'the component is picked up once built');
    });
  });
});
