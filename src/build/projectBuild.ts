import type Build from '@metaverse-systems/the-seed/Build';
import type { ProjectBuildResult } from '@metaverse-systems/the-seed/types';

/** Where a project build reports to; the editor's output channel and progress in the extension. */
export interface ProjectBuildUi {
  /** Raw output of a step */
  append(text: string): void;
  /** Whole progress lines */
  appendLine(text: string): void;
  /** A step is about to start; `index` is 0-based */
  stepStarted(label: string, index: number, total: number): void;
}

/**
 * Builds one project (a full build when a target is given, an incremental one
 * otherwise) through `buildProject`, so the install step is staged, stripped
 * (release with a target), signed and placed exactly as the command line does.
 * Only `signal` is passed: the editor's cancellation is the graceful kind, so
 * an install phase in progress always finishes.
 */
export async function runProjectBuild(
  build: Pick<Build, 'buildProject'>,
  options: {
    projectDir: string;
    target?: 'native' | 'windows';
    release: boolean;
    configDir: string;
    signal: AbortSignal;
  },
  ui: ProjectBuildUi
): Promise<ProjectBuildResult> {
  return build.buildProject({
    ...options,
    output: {
      stdout: (chunk) => ui.append(chunk.toString()),
      stderr: (chunk) => ui.append(chunk.toString()),
    },
    log: (line) => ui.appendLine(line),
    onStepStart: (step, index, total) => ui.stepStarted(step.label, index, total),
  });
}
