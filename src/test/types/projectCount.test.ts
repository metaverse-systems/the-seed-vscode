// Recursive build summaries say "1 project" and "2 projects".
import * as assert from 'assert';

suite('Project count wording', () => {
  const count = (n: number): string => (require('../../types/projectCount') as { projectCount(n: number): string }).projectCount(n);

  test('one project is singular', () => {
    assert.strictEqual(count(1), '1 project');
  });

  test('zero and several projects are plural', () => {
    assert.strictEqual(count(0), '0 projects');
    assert.strictEqual(count(2), '2 projects');
  });
});
