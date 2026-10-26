// askQuestions puts the tool's prompt questions to the user with the editor's
// quick pick and input box. The pick and the input box are stubbed.
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { askQuestions } from '../askQuestions';

type Question = Parameters<typeof askQuestions>[0][number];

suite('askQuestions', () => {
  teardown(() => {
    sinon.restore();
  });

  test('a list prompt offers its choices with the message, and the pick is the answer', async () => {
    const pick = sinon.stub(vscode.window, 'showQuickPick').resolves('beta' as unknown as vscode.QuickPickItem);
    const input = sinon.stub(vscode.window, 'showInputBox');
    const questions: Question[] = [{ type: 'list', name: 'scope', message: 'Which scope?', choices: ['alpha', 'beta'] }];

    const answers = await askQuestions(questions);

    assert.deepStrictEqual(answers, { scope: 'beta' });
    assert.strictEqual(pick.callCount, 1);
    assert.deepStrictEqual(pick.firstCall.args[0], ['alpha', 'beta']);
    assert.deepStrictEqual(pick.firstCall.args[1], { placeHolder: 'Which scope?' });
    assert.ok(input.notCalled);
  });

  test('a text prompt starts at its default and shows the validator\'s reason, accepting what it accepts', async () => {
    const input = sinon.stub(vscode.window, 'showInputBox').resolves('my-project');
    const questions: Question[] = [{
      name: 'projectName',
      message: 'Project name?',
      default: 'untitled',
      validate: (value: string) => (value.includes(' ') ? 'No spaces, please' : true),
    }];

    const answers = await askQuestions(questions);

    assert.deepStrictEqual(answers, { projectName: 'my-project' });
    const options = input.firstCall.args[0];
    assert.ok(options);
    assert.strictEqual(options.prompt, 'Project name?');
    assert.strictEqual(options.placeHolder, 'Project name?');
    assert.strictEqual(options.value, 'untitled');
    const validateInput = options.validateInput;
    assert.ok(validateInput, 'the validator is passed on');
    assert.strictEqual(validateInput('two words'), 'No spaces, please');
    assert.strictEqual(validateInput('one-word'), undefined);
  });

  test('a text prompt without a default starts empty and has no validator', async () => {
    const input = sinon.stub(vscode.window, 'showInputBox').resolves('Ada');
    const questions: Question[] = [{ name: 'author', message: 'Author?', default: null }];

    const answers = await askQuestions(questions);

    assert.deepStrictEqual(answers, { author: 'Ada' });
    assert.strictEqual(input.firstCall.args[0]?.value, '');
    assert.strictEqual(input.firstCall.args[0]?.validateInput, undefined);
  });

  test('a cancelled prompt gives no answers and asks nothing more', async () => {
    const input = sinon.stub(vscode.window, 'showInputBox');
    input.onFirstCall().resolves('first');
    input.onSecondCall().resolves(undefined);
    const questions: Question[] = [
      { name: 'a', message: 'A?' },
      { name: 'b', message: 'B?' },
      { name: 'c', message: 'C?' },
    ];

    const answers = await askQuestions(questions);

    assert.deepStrictEqual(answers, {});
    assert.strictEqual(input.callCount, 2);
  });

  test('a question without a message is not accepted by the type', () => {
    // @ts-expect-error a question must have a message to show
    const missing: Question = { name: 'noMessage' };
    assert.strictEqual(missing.name, 'noMessage');
  });
});
