import * as fs from 'fs-extra';
import * as path from 'path';
import { execSync } from 'child_process';
import Template from '@metaverse-systems/the-seed/dist/Template';

/**
 * Create a template package at a specified target directory.
 * This bypasses the Template class's reliance on require.main.filename
 * and allows us to specify any target directory.
 */
export function createTemplatePackage(
  template: Template,
  scopeName: string,
  templateName: string,
  targetDir?: string
): string {
  const packageRoot = path.dirname(
    require.resolve('@metaverse-systems/the-seed/package.json')
  );
  const templateDir = path.join(packageRoot, 'templates', template.type);

  // If targetDir provided, use it; otherwise use default prefix-based path
  const projectPath = targetDir ?? path.join(
    template.config.config.prefix,
    'projects',
    scopeName,
    templateName
  );

  // Ensure parent directory exists
  const parentDir = path.dirname(projectPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Copy template files
  fs.copySync(templateDir, projectPath);

  // Replace template variables
  const underscoreName = templateName.replace(/-/g, '_');
  const author = template.scopes.getScope(scopeName).author;
  const variables: Record<string, string> = {
    'AUTHOR_EMAIL': author.email,
    'AUTHOR_URL': author.url,
    'SKELETON_': underscoreName,
    'SKELETON': templateName,
  };

  const files = [
    'AUTHORS',
    'COPYING',
    'configure.ac',
    'Makefile.am',
    'src/Makefile.am',
    'src/SKELETON.hpp',
    'src/SKELETON.cpp',
  ];

  if (template.type !== 'program') {
    files.push('SKELETON.pc.in');
  }

  files.forEach((file) => {
    const filePath = path.join(projectPath, file);
    let content = fs.readFileSync(filePath).toString();
    Object.keys(variables).forEach((variable) => {
      const regex = new RegExp(variable, 'g');
      content = content.replace(regex, variables[variable]);
    });
    fs.writeFileSync(filePath, content);
  });

  // Rename skeleton files
  fs.renameSync(
    path.join(projectPath, 'src/SKELETON.hpp'),
    path.join(projectPath, 'src', `${templateName}.hpp`)
  );
  fs.renameSync(
    path.join(projectPath, 'src/SKELETON.cpp'),
    path.join(projectPath, 'src', `${templateName}.cpp`)
  );

  if (template.type !== 'program') {
    fs.renameSync(
      path.join(projectPath, 'SKELETON.pc.in'),
      path.join(projectPath, `${templateName}.pc.in`)
    );
  }

  // Run npm init and configure package.json
  execSync('npm init --yes', { cwd: projectPath });
  const packageJsonPath = path.join(projectPath, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath).toString());
  pkg.author = author;
  pkg.license = 'UNLICENSED';
  pkg.name = `${scopeName}/${templateName}`;
  pkg.version = '0.0.1';
  pkg.scripts = {
    test: 'echo "Error: no test specified" && exit 1',
    build: 'the-seed build native',
    'build-win64': 'the-seed build windows',
  };
  delete pkg.main;
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2));

  return projectPath;
}
