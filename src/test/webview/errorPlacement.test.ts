// The sidebar's choice of where an `error` message is shown: the section that
// sent the request it answers, or the top banner for anything else.
import * as assert from 'assert';
import { errorPlacement } from '../../webview/logic/errorPlacement';
import type { SectionArea } from '../../webview/logic/errorPlacement';

suite('Sidebar error placement', () => {
  /** Requests waiting for an answer, as the page records them when it sends them. */
  function pending(): Map<string, SectionArea> {
    return new Map<string, SectionArea>([
      ['template-create-1', 'templates'],
      ['pak-build-1', 'resourcePak'],
      ['dependency-check-1', 'dependencies'],
    ]);
  }

  test('an error answering a prefix save, which no section sent, is shown in the banner only', () => {
    assert.strictEqual(errorPlacement('prefix-save-1', pending()), 'banner');
  });

  test('an error answering a template request is shown in the templates section only', () => {
    assert.strictEqual(errorPlacement('template-create-1', pending()), 'templates');
  });

  test('an error answering a resource pak build is shown in the resource pak section only', () => {
    assert.strictEqual(errorPlacement('pak-build-1', pending()), 'resourcePak');
  });

  test('an error with an unknown request id, or none, is shown in the banner only', () => {
    assert.strictEqual(errorPlacement('never-sent', pending()), 'banner');
    assert.strictEqual(errorPlacement(undefined, pending()), 'banner');
  });
});
