// The readme and the change log are shown on the store page and the releases
// page, where a relative link leads nowhere: every link is absolute or points
// to a heading in the same document.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

/** The text with fenced code blocks and inline code blanked out, keeping its lines. */
function withoutCode(text: string): string {
  const lines = text.split(/\r?\n/);
  let fence: string | null = null;
  return lines.map((line) => {
    const opening = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (opening && opening[1][0] === fence[0] && opening[1].length >= fence.length) {
        fence = null;
      }
      return '';
    }
    if (opening) {
      fence = opening[1];
      return '';
    }
    return line.replace(/`+[^`]*`+/g, '');
  }).join('\n');
}

function allowed(target: string): boolean {
  return target.startsWith('https://') || /^#[^\s#]+$/.test(target);
}

/** Every link target in a Markdown text that is not absolute or a same-document anchor, and every front-page or "Coming soon" text. */
export function linkProblems(text: string, name: string): string[] {
  const problems: string[] = [];
  withoutCode(text).split('\n').forEach((line, index) => {
    const where = `${name} line ${index + 1}`;
    const targets: string[] = [];
    // Inline links and images: [text](target) and ![alt](target), with an optional <target> and title
    for (const match of line.matchAll(/\]\(\s*(<[^>]*>|[^)\s]*)/g)) {
      targets.push(match[1].replace(/^<|>$/g, ''));
    }
    // Reference definitions: [label]: target
    const definition = /^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/.exec(line);
    if (definition) {
      targets.push(definition[1].replace(/^<|>$/g, ''));
    }
    // HTML attributes
    for (const match of line.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      targets.push(match[1] ?? match[2] ?? match[3]);
    }
    for (const target of targets) {
      if (!allowed(target)) {
        problems.push(`${where}: "${target}" is neither an https:// link nor a #anchor`);
      }
    }
    if (/https:\/\/marketplace\.visualstudio\.com\/?(?![\w%?#./-])/.test(line)) {
      problems.push(`${where}: a link to the marketplace front page`);
    }
    if (/coming soon/i.test(line)) {
      problems.push(`${where}: "Coming soon"`);
    }
  });
  return problems;
}

suite('Readme: links are absolute', () => {
  for (const name of ['README.md', 'CHANGELOG.md']) {
    test(`every link in ${name} is an https:// link or a same-document anchor`, () => {
      const problems = linkProblems(fs.readFileSync(path.join(ROOT, name), 'utf-8'), name);
      assert.deepStrictEqual(problems, [], `${name}:\n${problems.join('\n')}`);
    });
  }

  test('a relative link, image, reference and HTML attribute are reported, and absolute links and anchors are not', () => {
    const text = [
      '# Title',
      'See [the licence](LICENSE) and [this section](#title) and [the site](https://example.com/a).',
      '![icon](media/icon.png)',
      '[ref]: ./docs/guide.md',
      '<img src="media/icon.png"> <a href="https://example.com/">x</a>',
      '[insecure](http://example.com/)',
      '[store](https://marketplace.visualstudio.com/)',
      '[listing](https://marketplace.visualstudio.com/items?itemName=a.b)',
      '_Coming soon_',
      '```',
      '[not a link](inside/code)',
      '```',
      'and `[inline](code)` text',
    ].join('\n');
    assert.deepStrictEqual(linkProblems(text, 'sample'), [
      'sample line 2: "LICENSE" is neither an https:// link nor a #anchor',
      'sample line 3: "media/icon.png" is neither an https:// link nor a #anchor',
      'sample line 4: "./docs/guide.md" is neither an https:// link nor a #anchor',
      'sample line 5: "media/icon.png" is neither an https:// link nor a #anchor',
      'sample line 6: "http://example.com/" is neither an https:// link nor a #anchor',
      'sample line 7: a link to the marketplace front page',
      'sample line 9: "Coming soon"',
    ]);
  });
});
