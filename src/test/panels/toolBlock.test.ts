// Interface choices where the contract leaves them open:
// - toolBlockView(payload) returns { text, buttons, showEditors, showLoading }, buttons being
//   { label, action } with action 'openToolSetting' or 'checkTool';
// - the module is loaded when a case runs, so this file compiles before the module exists;
// - the usable text is `the-seed <version> — <location> (<found through>)`, checked by its parts.
import * as assert from 'assert';

type State = 'checking' | 'usable' | 'notFound' | 'notTheTool' | 'tooOld' | 'tooNew' | 'notLoadable' | 'reloadRequired';

interface Payload {
  state: State;
  usable: boolean;
  message: string;
  location: string | undefined;
  version: string | undefined;
  foundThrough: 'setting' | 'global' | 'path' | undefined;
  required: string;
  setting: string;
}

interface Button {
  label: string;
  action: 'openToolSetting' | 'checkTool';
}

interface View {
  text: string;
  buttons: Button[];
  showEditors: boolean;
  showLoading: boolean;
}

const toolBlockView = (payload: Payload): View => (
  require('../../types/toolBlock') as { toolBlockView(payload: Payload): View }
).toolBlockView(payload);

const payloadOf = (state: State, overrides: Partial<Payload> = {}): Payload => ({
  state,
  usable: state === 'usable',
  message: `message for ${state}`,
  location: undefined,
  version: undefined,
  foundThrough: undefined,
  required: '2.0.0',
  setting: 'the-seed.toolPath',
  ...overrides,
});

const UNUSABLE: State[] = ['notFound', 'notTheTool', 'tooOld', 'tooNew', 'notLoadable', 'reloadRequired'];

suite('toolBlockView', () => {
  test('checking shows the message and the loading line, with no buttons or editors', () => {
    const view = toolBlockView(payloadOf('checking'));
    assert.strictEqual(view.text, 'message for checking');
    assert.deepStrictEqual(view.buttons, []);
    assert.strictEqual(view.showEditors, false);
    assert.strictEqual(view.showLoading, true);
  });

  suite('usable', () => {
    const usable = (foundThrough: 'setting' | 'global' | 'path'): Payload => payloadOf('usable', {
      version: '2.1.0',
      location: '/opt/the-seed',
      foundThrough,
    });

    test('names the version, the location and how it was found, with only Check Again', () => {
      const view = toolBlockView(usable('setting'));
      assert.ok(view.text.startsWith('the-seed 2.1.0'), view.text);
      assert.ok(view.text.includes('/opt/the-seed'), view.text);
      assert.ok(view.text.includes('the-seed.toolPath'), view.text);
      assert.deepStrictEqual(view.buttons, [{ label: 'Check Again', action: 'checkTool' }]);
    });

    test('shows the editors and not the loading line', () => {
      const view = toolBlockView(usable('global'));
      assert.strictEqual(view.showEditors, true);
      assert.strictEqual(view.showLoading, false);
    });

    test('says how a global installation and a command on the path were found', () => {
      assert.ok(toolBlockView(usable('global')).text.includes('global'));
      assert.ok(toolBlockView(usable('path')).text.includes('path'));
    });
  });

  for (const state of UNUSABLE) {
    suite(state, () => {
      const payload = payloadOf(state, state === 'notFound' || state === 'notTheTool' ? {} : {
        version: '1.2.1',
        location: '/opt/the-seed',
        foundThrough: 'global',
      });

      test('shows the message, Set Tool Location and Check Again', () => {
        const view = toolBlockView(payload);
        assert.strictEqual(view.text, `message for ${state}`);
        assert.deepStrictEqual(view.buttons, [
          { label: 'Set Tool Location', action: 'openToolSetting' },
          { label: 'Check Again', action: 'checkTool' },
        ]);
      });

      test('hides the editors and the loading line', () => {
        const view = toolBlockView(payload);
        assert.strictEqual(view.showEditors, false);
        assert.strictEqual(view.showLoading, false);
      });
    });
  }

  test('only the checking state shows the loading line', () => {
    const states: State[] = ['checking', 'usable', ...UNUSABLE];
    const loading = states.filter((state) => toolBlockView(payloadOf(state, { version: '2.0.0', location: '/x', foundThrough: 'setting' })).showLoading);
    assert.deepStrictEqual(loading, ['checking']);
  });
});
