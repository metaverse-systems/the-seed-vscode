import * as assert from 'assert';
import { nativeComponentState } from '../../tool/nativeComponentState';

class Missing extends Error {}

const api = (require: () => void) => ({
  requireNativeComponent: require,
  NativeComponentMissingError: Missing as never,
  nativeComponentMessage: (loadError?: string | null) => `message${loadError ? ` (${loadError})` : ''}`,
});

suite('native component state', () => {
  test('a component that loads is built', () => {
    assert.deepStrictEqual(nativeComponentState(api(() => undefined)), { built: true });
  });

  test('a missing component carries the tool message unchanged', () => {
    const state = nativeComponentState(api(() => { throw new Missing('the tool says so'); }));
    assert.deepStrictEqual(state, { built: false, message: 'the tool says so' });
  });

  test('any other failure is reported with the tool message and the first line of the error', () => {
    const state = nativeComponentState(api(() => { throw new Error('boom\nsecond line'); }));
    assert.deepStrictEqual(state, { built: false, message: 'message (boom)' });
  });
});
