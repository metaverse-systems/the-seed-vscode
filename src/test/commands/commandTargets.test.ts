// The files a context-menu command was started on, worked out from the
// arguments the editor passes: no tool is needed, so every case runs against
// real files and folders under a scratch directory. The result holds the
// file-system paths of regular files only, and is undefined when the command
// was not started on a file (a palette start).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { chosenFiles } from '../../commands/commandTargets';
import { useScratchState } from '../helpers/scratchState';

suite('chosenFiles', () => {
  const state = useScratchState({ prefix: false });
  let root: string;
  let fileA: string;
  let fileB: string;
  let fileC: string;
  let folder: string;
  let missing: string;

  setup(() => {
    root = state.dir('targets');
    fileA = path.join(root, 'a.exe');
    fileB = path.join(root, 'b.exe');
    fileC = path.join(root, 'c.txt');
    folder = path.join(root, 'folder');
    missing = path.join(root, 'missing.exe');
    for (const file of [fileA, fileB, fileC]) {
      fs.writeFileSync(file, file);
    }
    fs.mkdirSync(folder);
  });

  const uri = (file: string): vscode.Uri => vscode.Uri.file(file);

  test('no arguments give undefined', () => {
    assert.strictEqual(chosenFiles([]), undefined);
  });

  test('an undefined first argument gives undefined', () => {
    assert.strictEqual(chosenFiles([undefined]), undefined);
  });

  test('one file gives that file', () => {
    assert.deepStrictEqual(chosenFiles([uri(fileA)]), [fileA]);
  });

  test('the file and a one-element array of it give the file once', () => {
    assert.deepStrictEqual(chosenFiles([uri(fileA), [uri(fileA)]]), [fileA]);
  });

  test('a selection of three is returned in the explorer order', () => {
    assert.deepStrictEqual(
      chosenFiles([uri(fileB), [uri(fileA), uri(fileB), uri(fileC)]]),
      [fileA, fileB, fileC]
    );
  });

  test('an array that does not contain the first file is not the selection', () => {
    assert.deepStrictEqual(chosenFiles([uri(fileA), [uri(fileB), uri(fileC)]]), [fileA]);
  });

  test('non-files in the selection are left out', () => {
    const selection = [uri(fileA), uri(folder), vscode.Uri.parse('untitled:x'), uri(missing)];
    assert.deepStrictEqual(chosenFiles([uri(fileA), selection]), [fileA]);
  });

  test('an editor-title group argument leaves the first file alone', () => {
    assert.deepStrictEqual(chosenFiles([uri(fileA), { groupId: 1 }]), [fileA]);
  });

  test('duplicates in the selection are kept once at their first position', () => {
    assert.deepStrictEqual(
      chosenFiles([uri(fileB), [uri(fileA), uri(fileB), uri(fileA), uri(fileB)]]),
      [fileA, fileB]
    );
  });

  test('a folder gives undefined', () => {
    assert.strictEqual(chosenFiles([uri(folder)]), undefined);
  });

  test('a path that does not exist gives undefined', () => {
    assert.strictEqual(chosenFiles([uri(missing)]), undefined);
  });

  test('an untitled document gives undefined', () => {
    assert.strictEqual(chosenFiles([vscode.Uri.parse('untitled:Untitled-1')]), undefined);
  });

  test('a remote uri gives undefined', () => {
    assert.strictEqual(chosenFiles([vscode.Uri.parse('vscode-remote://ssh-remote+host/tmp/a.exe')]), undefined);
  });

  test('a string path gives undefined', () => {
    assert.strictEqual(chosenFiles([fileA]), undefined);
  });

  test('an object with a resourceUri gives undefined', () => {
    assert.strictEqual(chosenFiles([{ resourceUri: uri(fileA) }]), undefined);
  });

  test('a number gives undefined', () => {
    assert.strictEqual(chosenFiles([42]), undefined);
  });
});
