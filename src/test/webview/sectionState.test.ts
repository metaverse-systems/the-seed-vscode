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

suite('Sidebar section folding across hide and show', () => {
  type Logic = {
    restoreSection(saved: unknown, title: string, defaultCollapsed: boolean): { collapsed: boolean; userSet: boolean };
    saveSection(saved: unknown, title: string, section: { collapsed: boolean; userSet: boolean }): unknown;
  };
  const logic = (): Logic => require('../../webview/logic/sectionState') as Logic;

  test('a section the user opened comes back open although its default is collapsed', () => {
    const opened = nextSection(initialSection(true), { kind: 'toggle' });
    const saved = logic().saveSection(undefined, 'Dependencies', opened);

    const restored = logic().restoreSection(saved, 'Dependencies', true);

    assert.deepStrictEqual(restored, { collapsed: false, userSet: true });
    assert.strictEqual(nextSection(restored, { kind: 'default', collapsed: true }).collapsed, false, 'a new default leaves it open');
  });

  test('a section the user closed comes back closed', () => {
    const closed = nextSection(initialSection(false), { kind: 'toggle' });
    const saved = logic().saveSection({ other: 1 }, 'Build', closed);

    assert.deepStrictEqual(logic().restoreSection(saved, 'Build', false), { collapsed: true, userSet: true });
    assert.strictEqual((saved as { other: number }).other, 1, 'other saved values are kept');
  });

  test('an untouched section is not kept and follows its default', () => {
    const saved = logic().saveSection(undefined, 'Templates', initialSection(false));

    assert.deepStrictEqual(logic().restoreSection(saved, 'Templates', true), { collapsed: true, userSet: false });
    assert.deepStrictEqual(logic().restoreSection(undefined, 'Templates', false), { collapsed: false, userSet: false });
  });

  test('a section is kept apart from the others', () => {
    let saved = logic().saveSection(undefined, 'A', { collapsed: false, userSet: true });
    saved = logic().saveSection(saved, 'B', { collapsed: true, userSet: true });

    assert.strictEqual(logic().restoreSection(saved, 'A', true).collapsed, false);
    assert.strictEqual(logic().restoreSection(saved, 'B', false).collapsed, true);
  });
});
