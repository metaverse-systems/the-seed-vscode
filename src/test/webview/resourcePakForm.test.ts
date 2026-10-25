// The add-resource form puts a space between "Selected file:" and the name of the file.
import * as assert from 'assert';
import { resourcePakHint, SELECTED_FILE_LABEL } from '../../webview/logic/resourcePakForm';

suite('Add-resource form text', () => {
  test('the selected-file label ends in a space', () => {
    assert.strictEqual(`${SELECTED_FILE_LABEL}level1.dat`, 'Selected file: level1.dat');
  });

  test('the hint says how many resource paks the open folder holds when it holds several', () => {
    assert.ok(resourcePakHint(3).startsWith('3 ResourcePaks found in the open folder'));
    assert.ok(resourcePakHint(0).includes('choose one'));
  });
});
