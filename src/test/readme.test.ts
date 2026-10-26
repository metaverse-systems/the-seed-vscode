// The readme's command table is checked against the manifest, so a command
// added, renamed or removed in package.json cannot be left out of the readme.
// The readme and the change log are also checked for emoji and pictographic
// symbols, which they do not use.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const START_MARKER = '<!-- commands -->';
const END_MARKER = '<!-- /commands -->';

/** The words a Needs cell starts with; more words may follow a term. */
export const NEEDS_TERMS = [
  'nothing',
  'prefix',
  'scope',
  'native component',
  'wixl',
  'MinGW cross-compiler',
  'open project',
  'selected file',
  'certificate',
  'libraries installed',
];

const PLACES = ['Palette', 'Sidebar', 'Explorer menu'];

interface Manifest {
  contributes: {
    commands: { command: string; title: string }[];
    menus?: { [menu: string]: { command: string }[] };
  };
}

interface CommandRow {
  line: number;
  title: string;
  needs: string;
  where: string[];
}

function readText(name: string): string {
  return fs.readFileSync(path.join(ROOT, name), 'utf-8');
}

function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function plainTitle(cell: string): string {
  return cell.replace(/^[*_`]+|[*_`]+$/g, '').trim();
}

/** The rows of the command table, or a problem when the markers are missing. */
function commandRows(readme: string): { rows: CommandRow[]; problems: string[] } {
  const lines = readme.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === START_MARKER);
  const end = lines.findIndex((line, index) => index > start && line.trim() === END_MARKER);
  if (start < 0 || end < 0) {
    return { rows: [], problems: [`the command table markers ${START_MARKER} and ${END_MARKER} are missing`] };
  }
  const rows: CommandRow[] = [];
  const problems: string[] = [];
  let header = true;
  for (let index = start + 1; index < end; index++) {
    const line = lines[index];
    if (!line.trim().startsWith('|')) {
      continue;
    }
    const row = cells(line);
    if (header) {
      // The first table line is the header; the separator line follows it
      header = false;
      continue;
    }
    if (row.every((cell) => /^:?-+:?$/.test(cell))) {
      continue;
    }
    if (row.length !== 3) {
      problems.push(`line ${index + 1}: a command row has ${row.length} cells, not 3 (Command, Needs, Where)`);
      continue;
    }
    rows.push({
      line: index + 1,
      title: plainTitle(row[0]),
      needs: row[1],
      where: row[2].split(',').map((place) => place.trim()).filter((place) => place !== ''),
    });
  }
  return { rows, problems };
}

/** Every difference between the readme's command table and the manifest's commands and explorer menu. */
export function commandTableProblems(readme: string, manifest: Manifest): string[] {
  const { rows, problems } = commandRows(readme);
  const titles = manifest.contributes.commands.map((command) => command.title);
  if (rows.length === 0 && problems.length > 0) {
    // Without a table, say which titles the readme does not mention anywhere
    const absent = titles.filter((title) => !readme.includes(title));
    if (absent.length > 0) {
      problems.push(`${titles.length - absent.length} of ${titles.length} contributed titles appear in the readme; missing: ${absent.join(', ')}`);
    }
    return problems;
  }
  const idByTitle = new Map(manifest.contributes.commands.map((command) => [command.title, command.command]));
  const explorer = new Set((manifest.contributes.menus?.['explorer/context'] ?? []).map((entry) => entry.command));

  for (const title of titles) {
    const count = rows.filter((row) => row.title === title).length;
    if (count === 0) {
      problems.push(`"${title}" is contributed but missing from the command table`);
    } else if (count > 1) {
      problems.push(`"${title}" appears ${count} times in the command table`);
    }
  }
  for (const row of rows) {
    const id = idByTitle.get(row.title);
    if (id === undefined) {
      problems.push(`line ${row.line}: "${row.title}" is not a contributed command`);
      continue;
    }
    if (row.needs === '') {
      problems.push(`line ${row.line}: "${row.title}" has an empty Needs cell`);
    } else if (!NEEDS_TERMS.some((term) => row.needs === term || row.needs.startsWith(`${term} `) || row.needs.startsWith(`${term},`) || row.needs.startsWith(`${term};`))) {
      problems.push(`line ${row.line}: the Needs cell of "${row.title}" ("${row.needs}") starts with none of: ${NEEDS_TERMS.join(', ')}`);
    }
    for (const place of row.where) {
      if (!PLACES.includes(place)) {
        problems.push(`line ${row.line}: "${row.title}" names an unknown place "${place}" (known: ${PLACES.join(', ')})`);
      }
    }
    if (!row.where.includes('Palette')) {
      problems.push(`line ${row.line}: "${row.title}" does not list Palette`);
    }
    const inExplorer = explorer.has(id);
    if (inExplorer && !row.where.includes('Explorer menu')) {
      problems.push(`line ${row.line}: "${row.title}" is in the explorer menu, but its row does not list Explorer menu`);
    }
    if (!inExplorer && row.where.includes('Explorer menu')) {
      problems.push(`line ${row.line}: "${row.title}" lists Explorer menu, but it is not in the explorer menu`);
    }
  }
  return problems;
}

const PICTOGRAPH = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/u;

/** Each emoji or pictographic symbol in a text, with its line and code point. */
export function pictographProblems(text: string, name: string): string[] {
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const character of line) {
      if (PICTOGRAPH.test(character)) {
        const code = character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
        problems.push(`${name} line ${index + 1}: U+${code} "${character}"`);
      }
    }
  });
  return problems;
}

function readManifest(): Manifest {
  return JSON.parse(readText('package.json')) as Manifest;
}

suite('Readme: the command table matches the manifest', () => {
  test('every contributed command is listed once, with its needs and where it is offered', () => {
    const problems = commandTableProblems(readText('README.md'), readManifest());
    assert.deepStrictEqual(problems, [], `README.md command table:\n${problems.join('\n')}`);
  });

  test('a removed row and an added row are both reported', () => {
    const manifest = readManifest();
    const [first, second] = manifest.contributes.commands;
    const readme = [
      START_MARKER,
      '| Command | Needs | Where |',
      '|---|---|---|',
      ...manifest.contributes.commands
        .filter((command) => command !== first)
        .map((command) => `| ${command.title} | nothing | Palette${manifest.contributes.menus?.['explorer/context']?.some((entry) => entry.command === command.command) ? ', Explorer menu' : ''} |`),
      '| The Seed: Not A Command | nothing | Palette |',
      END_MARKER,
    ].join('\n');
    const problems = commandTableProblems(readme, manifest);
    assert.ok(problems.some((problem) => problem.includes(`"${first.title}" is contributed but missing`)), `the removed row is reported: ${problems.join('; ')}`);
    assert.ok(problems.some((problem) => problem.includes('"The Seed: Not A Command" is not a contributed command')), `the added row is reported: ${problems.join('; ')}`);
    assert.ok(!problems.some((problem) => problem.includes(`"${second.title}"`)), 'an unchanged row is not reported');
  });

  test('missing markers, an empty or unknown Needs cell, a missing Palette and a wrong Explorer menu mark are reported', () => {
    const manifest = readManifest();
    const unmarked = commandTableProblems('| Command | Needs | Where |\n|---|---|---|\n', manifest);
    assert.ok(unmarked[0].includes('markers'), `the missing markers are reported: ${unmarked.join('; ')}`);
    assert.ok(unmarked[1].startsWith(`0 of ${manifest.contributes.commands.length} contributed titles`), `the missing titles are reported: ${unmarked.join('; ')}`);
    const explorerId = manifest.contributes.menus?.['explorer/context']?.[0]?.command;
    const explorerTitle = manifest.contributes.commands.find((command) => command.command === explorerId)?.title;
    const plain = manifest.contributes.commands.find((command) => command.command !== explorerId && !(manifest.contributes.menus?.['explorer/context'] ?? []).some((entry) => entry.command === command.command));
    assert.ok(explorerTitle !== undefined && plain !== undefined, 'the manifest has an explorer-menu command and one that is not');
    const readme = [
      START_MARKER,
      '| Command | Needs | Where |',
      '|---|---|---|',
      `| ${explorerTitle} |  | Palette |`,
      `| ${plain.title} | a compiler | Sidebar, Explorer menu |`,
      END_MARKER,
    ].join('\n');
    const problems = commandTableProblems(readme, manifest);
    for (const expected of [
      `"${explorerTitle}" has an empty Needs cell`,
      `"${explorerTitle}" is in the explorer menu, but its row does not list Explorer menu`,
      `the Needs cell of "${plain.title}"`,
      `"${plain.title}" does not list Palette`,
      `"${plain.title}" lists Explorer menu, but it is not in the explorer menu`,
    ]) {
      assert.ok(problems.some((problem) => problem.includes(expected)), `reported: ${expected}\n${problems.join('\n')}`);
    }
  });
});

suite('Readme: no emoji or pictographic symbols', () => {
  for (const name of ['README.md', 'CHANGELOG.md']) {
    test(`${name} has none`, () => {
      const problems = pictographProblems(readText(name), name);
      assert.deepStrictEqual(problems, [], `${name} has emoji or pictographic symbols:\n${problems.join('\n')}`);
    });
  }

  test('each range is reported, and plain punctuation is not', () => {
    const text = ['a \u{1F680} rocket', 'a check ✓ and a warning ⚠️', 'a star ⭐', 'a keycap 1⃣', 'plain - dashes — and arrows → and quotes "x"'].join('\n');
    const problems = pictographProblems(text, 'sample');
    assert.deepStrictEqual(problems, [
      'sample line 1: U+1F680 "\u{1F680}"',
      'sample line 2: U+2713 "✓"',
      'sample line 2: U+26A0 "⚠"',
      'sample line 2: U+FE0F "️"',
      'sample line 3: U+2B50 "⭐"',
      'sample line 4: U+20E3 "⃣"',
    ]);
  });
});
