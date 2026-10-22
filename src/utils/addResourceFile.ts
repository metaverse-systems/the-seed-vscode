import * as fs from 'fs';
import * as path from 'path';
import ResourcePak from '@metaverse-systems/the-seed/ResourcePak';
import { ProjectError } from '@metaverse-systems/the-seed/ProjectError';
import { replaceResourceHint } from '@metaverse-systems/the-seed/Hints';

export interface AddedResource {
  name: string;
  filename: string;
  size: number;
  totalResources: number;
}

/**
 * Adds a file to a resource pak project under a name. A duplicate name, a missing file and a different
 * file of the same base name already in the project are refused before anything is copied; a copy made
 * for a resource the tool then refuses is removed again.
 * @throws ProjectError with the reason
 */
export function addResourceFile(
  rp: ResourcePak,
  packageDir: string,
  resourceName: string,
  sourceFile: string
): AddedResource {
  const project = rp.readProject(packageDir);

  if (resourceName === '') {
    throw new ProjectError('not-pak-project', 'The resource name cannot be empty.');
  }
  const existing = project.resources.find((resource) => resource.name === resourceName);
  if (existing) {
    throw new ProjectError(
      'duplicate-resource',
      `Resource "${resourceName}" already exists in ${project.name}; it refers to ${existing.filename}.`,
      replaceResourceHint()
    );
  }

  let sourceStats: fs.Stats;
  try {
    sourceStats = fs.statSync(sourceFile);
  } catch {
    throw new ProjectError('resource-file-missing', `File not found: ${sourceFile}`);
  }
  if (!sourceStats.isFile()) {
    throw new ProjectError('resource-file-missing', `${sourceFile} is not a file.`);
  }

  const dir = path.resolve(packageDir);
  const basename = path.basename(sourceFile);
  const destination = path.join(dir, basename);
  let copied = false;
  if (path.resolve(sourceFile) !== destination) {
    if (fs.existsSync(destination)) {
      if (!fs.readFileSync(destination).equals(fs.readFileSync(sourceFile))) {
        throw new ProjectError(
          'target-exists',
          `${destination} already exists in the project and is a different file; rename the file you are adding.`
        );
      }
    } else {
      fs.copyFileSync(sourceFile, destination);
      copied = true;
    }
  }

  try {
    const entry = rp.addResource(resourceName, basename, dir);
    return {
      name: entry.name,
      filename: entry.filename,
      size: entry.size,
      totalResources: project.resources.length + 1,
    };
  } catch (error) {
    if (copied) {
      fs.rmSync(destination, { force: true });
    }
    throw error;
  }
}
