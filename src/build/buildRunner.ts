import { spawn, ChildProcess } from 'child_process';
import type { BuildStep } from '@metaverse-systems/the-seed/dist/types';

export interface BuildRunnerOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  onStdout: (data: string) => void;
  onStderr: (data: string) => void;
  onStepStart: (step: BuildStep, index: number, total: number) => void;
  /** AbortSignal wired to VS Code CancellationToken */
  signal?: AbortSignal;
}

export interface BuildResult {
  success: boolean;
  cancelledAtStep?: number;
}

/**
 * Executes an ordered array of build steps sequentially.
 * Supports real-time stdout/stderr streaming, cancellation via AbortSignal,
 * and process group kill for reliable cleanup.
 */
export async function runBuildSteps(
  steps: BuildStep[],
  options: BuildRunnerOptions
): Promise<BuildResult> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (options.signal?.aborted) {
      return { success: false, cancelledAtStep: i };
    }

    options.onStepStart(step, i, steps.length);

    const exitCode = await runSingleCommand(step.command, {
      cwd: options.cwd,
      env: options.env,
      onStdout: options.onStdout,
      onStderr: options.onStderr,
      signal: options.signal,
    });

    if (options.signal?.aborted) {
      return { success: false, cancelledAtStep: i };
    }

    if (exitCode !== 0 && !step.ignoreExitCode) {
      return { success: false };
    }
  }

  return { success: true };
}

function runSingleCommand(
  command: string,
  opts: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    onStdout: (data: string) => void;
    onStderr: (data: string) => void;
    signal?: AbortSignal;
  }
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(command, [], {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // Create new process group for reliable kill
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      opts.onStdout(chunk.toString());
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      opts.onStderr(chunk.toString());
    });

    const onAbort = () => {
      try {
        // Kill the entire process group (negative PID)
        process.kill(-child.pid!, 'SIGTERM');
      } catch {
        // Process may have already exited
      }
      // Grace period, then force kill
      setTimeout(() => {
        try {
          if (!child.killed) {
            process.kill(-child.pid!, 'SIGKILL');
          }
        } catch {
          // Process already gone
        }
      }, 3000);
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        try {
          process.kill(-child.pid!, 'SIGTERM');
        } catch {
          // Process may not have started
        }
        return resolve(1);
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}
