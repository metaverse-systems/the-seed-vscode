// A sidebar section keeps the folding the user gave it when the page's
// default for it changes later; an untouched section follows the default.
import * as assert from 'assert';
import { initialSection, nextSection } from '../../webview/logic/sectionState';

suite('Sidebar section folding', () => {
  test('a section the user opened stays open when its default becomes collapsed', () => {
    const opened = nextSection(initialSection(true), { kind: 'toggle' });
    assert.strictEqual(opened.collapsed, false, 'the toggle opens the section');

    const after = nextSection(opened, { kind: 'default', collapsed: true });

    assert.strictEqual(after.collapsed, false);
  });

  test('a section the user closed stays closed when its default becomes expanded', () => {
    const closed = nextSection(initialSection(false), { kind: 'toggle' });
    assert.strictEqual(closed.collapsed, true, 'the toggle closes the section');

    const after = nextSection(closed, { kind: 'default', collapsed: false });

    assert.strictEqual(after.collapsed, true);
  });

  test('an untouched section follows its default', () => {
    const untouched = initialSection(false);
    assert.strictEqual(untouched.collapsed, false, 'it starts at its default');

    const after = nextSection(untouched, { kind: 'default', collapsed: true });

    assert.strictEqual(after.collapsed, true);
  });
});
