// The build section's text claims nothing about a project: while the
// configuration loads it shows none and its buttons are disabled; once loaded
// it shows a neutral line and its buttons are enabled.
import * as assert from 'assert';
import { buildNotice } from '../../webview/logic/buildNotice';

suite('Build section notice', () => {
  test('while the configuration loads, no project claim is shown and the buttons are disabled', () => {
    const notice = buildNotice('loading');

    assert.ok(!(notice.text ?? '').includes('No buildable project'), `the text claims there is no project: ${notice.text}`);
    assert.strictEqual(notice.buttonsEnabled, false);
  });

  test('once the configuration has loaded, the neutral line is shown with no detection claim and the buttons are enabled', () => {
    const notice = buildNotice('loaded');

    assert.strictEqual(notice.text, 'Builds the project of the active file, or one you choose.');
    assert.ok(!(notice.text ?? '').includes('detected'), `the text claims a detection: ${notice.text}`);
    assert.strictEqual(notice.buttonsEnabled, true);
  });
});
