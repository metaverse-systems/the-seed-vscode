import * as vscode from 'vscode';
import Config from '@metaverse-systems/the-seed/dist/Config';
import Scopes from '@metaverse-systems/the-seed/dist/Scopes';
import Template from '@metaverse-systems/the-seed/dist/Template';
import ResourcePak from '@metaverse-systems/the-seed/dist/ResourcePak';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createTemplatePackage } from '../templateRuntime';
import { detectResourcePak } from '../utils/detectResourcePak';
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  ConfigPayload,
  ScopeEntry,
  ScopeFormData,
  TemplateFormData,
  TemplateCreatedPayload,
  BuildStatusPayload,
  AddResourceData,
  BuildResourcePakData,
  ResourcePakFormData,
  DependencyStatusPayload,
  InstallProgressPayload,
} from '../types/messages';
import { getActiveBuild, cancelActiveBuild } from '../commands/buildNative';
import { checkLibEcs, checkLibTheSeed, getInstallSteps } from '@metaverse-systems/the-seed/dist/Dependencies';
import { runBuildSteps } from '../build/buildRunner';
import { acquireOperationLock, releaseOperationLock, getOperationLock } from '../operationLock';

function getConfigDir(): string {
  return path.join(os.homedir(), 'the-seed');
}

function getConfigFilePath(): string {
  return path.join(getConfigDir(), 'config.json');
}

// Build status tracking for getBuildStatus queries
let currentBuildStatus: BuildStatusPayload = { state: 'idle', target: '' };

export function updateBuildStatus(status: BuildStatusPayload): void {
  currentBuildStatus = status;
}

export function getCurrentBuildStatus(): BuildStatusPayload {
  return currentBuildStatus;
}

// Dependency status tracking for getDependencyStatus / late-joining
let currentDependencyStatus: DependencyStatusPayload | null = null;
let currentInstallProgress: InstallProgressPayload | null = null;

export function updateDependencyStatus(status: DependencyStatusPayload): void {
  currentDependencyStatus = status;
}

export function getCurrentDependencyStatus(): DependencyStatusPayload | null {
  return currentDependencyStatus;
}

export function updateInstallProgress(progress: InstallProgressPayload | null): void {
  currentInstallProgress = progress;
}

export function getCurrentInstallProgress(): InstallProgressPayload | null {
  return currentInstallProgress;
}

function buildConfigPayload(config: Config, isDefault: boolean): ConfigPayload {
  const scopes: ScopeEntry[] = Object.entries(config.config.scopes).map(
    ([name, scope]) => ({
      name,
      author: {
        name: scope.author.name || '',
        email: scope.author.email || '',
        url: scope.author.url || '',
      },
    })
  );

  return {
    prefix: config.config.prefix,
    isDefault,
    scopes,
  };
}

function toScopeAnswers(data: ScopeFormData) {
  return {
    scopeName: data.scopeName,
    authorName: data.authorName,
    authorEmail: data.authorEmail,
    authorURL: data.authorUrl,
  };
}

export async function handleMessage(
  message: WebviewToExtensionMessage,
  pushMessage?: (msg: ExtensionToWebviewMessage) => void
): Promise<ExtensionToWebviewMessage | null> {
  try {
    switch (message.command) {
      case 'ready': {
        const configFileExists = fs.existsSync(getConfigFilePath());
        const config = new Config();
        config.loadConfig();
        const isDefault = !configFileExists;
        return {
          type: 'configLoaded',
          payload: buildConfigPayload(config, isDefault),
        };
      }

      case 'getConfig': {
        const config = new Config();
        config.loadConfig();
        return {
          type: 'configLoaded',
          requestId: message.requestId,
          payload: buildConfigPayload(config, false),
        };
      }

      case 'savePrefix': {
        const config = new Config();
        config.loadConfig();
        config.config.prefix = message.data.prefix;
        config.saveConfig();
        return {
          type: 'prefixSaved',
          requestId: message.requestId,
          payload: { prefix: message.data.prefix },
        };
      }

      case 'addScope': {
        const config = new Config();
        config.loadConfig();
        const scopeName = message.data.scopeName.startsWith('@')
          ? message.data.scopeName
          : `@${message.data.scopeName}`;
        const exists = config.config.scopes[scopeName] !== undefined;
        if (exists) {
          return {
            type: 'scopeExists',
            requestId: message.requestId,
            payload: { scopeName },
          };
        }
        const scopes = new Scopes(config);
        scopes.createOrEditScope(toScopeAnswers(message.data));
        config.saveConfig();
        return {
          type: 'scopeAdded',
          requestId: message.requestId,
          payload: buildConfigPayload(config, false),
        };
      }

      case 'confirmOverwriteScope': {
        const config = new Config();
        config.loadConfig();
        const scopes = new Scopes(config);
        scopes.createOrEditScope(toScopeAnswers(message.data));
        config.saveConfig();
        return {
          type: 'scopeAdded',
          requestId: message.requestId,
          payload: buildConfigPayload(config, false),
        };
      }

      case 'editScope': {
        const config = new Config();
        config.loadConfig();
        const scopes = new Scopes(config);
        scopes.createOrEditScope(toScopeAnswers(message.data));
        config.saveConfig();
        return {
          type: 'scopeEdited',
          requestId: message.requestId,
          payload: buildConfigPayload(config, false),
        };
      }

      case 'deleteScope': {
        const config = new Config();
        config.loadConfig();
        const scopes = new Scopes(config);
        scopes.deleteScope(message.data.scopeName);
        config.saveConfig();
        return {
          type: 'scopeDeleted',
          requestId: message.requestId,
          payload: buildConfigPayload(config, false),
        };
      }

      case 'createTemplate': {
        const config = new Config();
        config.loadConfig();
        const { templateType, scopeName, templateName } = message.data;

        // Check if a workspace folder is open
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const hasWorkspace = workspaceFolders && workspaceFolders.length > 0;

        // Determine target path based on workspace state
        let projectPath: string;
        if (hasWorkspace) {
          // Create in the first workspace folder
          projectPath = path.join(workspaceFolders[0].uri.fsPath, templateName);
        } else {
          // Use default prefix-based path
          projectPath = path.join(
            config.config.prefix,
            'projects',
            scopeName,
            templateName
          );
        }

        if (fs.existsSync(projectPath)) {
          return {
            type: 'templateExists',
            requestId: message.requestId,
            payload: { projectPath },
          };
        }

        const template = new Template(config);
        template.type = templateType;
        createTemplatePackage(template, scopeName, templateName, projectPath);

        return {
          type: 'templateCreated',
          requestId: message.requestId,
          payload: {
            projectPath,
            templateType,
            openFolder: !hasWorkspace, // Open folder if no workspace was open
          } as TemplateCreatedPayload,
        };
      }

      case 'startBuild': {
        // Check if a build is already running
        if (getActiveBuild()) {
          return {
            type: 'error',
            requestId: message.requestId,
            payload: { message: 'A build is already in progress.' },
          };
        }

        // The actual build execution is triggered via VS Code commands from the webview
        // This handler acknowledges the request; the command handler does the work
        const target = message.data.target;
        const commandMap: Record<string, string> = {
          'native': 'the-seed.buildNative',
          'windows': 'the-seed.buildWindows',
          'incremental': 'the-seed.buildIncremental',
        };
        const commandId = commandMap[target];
        if (commandId) {
          // Fire and forget — the command handler manages the full lifecycle
          vscode.commands.executeCommand(commandId);
        }
        return {
          type: 'buildStarted',
          requestId: message.requestId,
        };
      }

      case 'cancelBuild': {
        cancelActiveBuild();
        return {
          type: 'buildCancelled',
          requestId: message.requestId,
        };
      }

      case 'getBuildStatus': {
        return {
          type: 'buildStatusResponse',
          requestId: message.requestId,
          payload: currentBuildStatus,
        };
      }

      // ── ResourcePak Handlers ────────────────────────────────

      case 'getResourcePakStatus': {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          return {
            type: 'resourcePakStatus',
            requestId: message.requestId,
            payload: { detected: false },
          };
        }
        const detected = detectResourcePak(workspaceFolders[0].uri.fsPath);
        return {
          type: 'resourcePakStatus',
          requestId: message.requestId,
          payload: detected ?? { detected: false },
        };
      }

      case 'createResourcePak': {
        const config = new Config();
        config.loadConfig();
        const rp = new ResourcePak(config);
        const { scopeName, pakName } = message.data;
        const scope = scopeName.startsWith('@') ? scopeName : `@${scopeName}`;
        rp.createPackage(scope, pakName);
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const hasWorkspace = workspaceFolders && workspaceFolders.length > 0;
        return {
          type: 'resourcePakCreated',
          requestId: message.requestId,
          payload: {
            scope,
            pakName,
            packageDir: rp.packageDir,
            openFolder: !hasWorkspace,
          },
        };
      }

      case 'browseResourceFile': {
        const result = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectMany: false,
          openLabel: 'Select Resource File',
        });
        if (!result || result.length === 0) {
          return {
            type: 'resourceFileBrowsed',
            requestId: message.requestId,
            payload: { filePath: null, fileName: null },
          };
        }
        const selectedPath = result[0].fsPath;
        return {
          type: 'resourceFileBrowsed',
          requestId: message.requestId,
          payload: {
            filePath: selectedPath,
            fileName: path.basename(selectedPath),
          },
        };
      }

      case 'addResource': {
        const config = new Config();
        config.loadConfig();
        const { scope, pakName, resourceName, filePath: srcFilePath, useDetectedPak } = message.data;

        // Resolve package directory
        let packageDir: string;
        if (useDetectedPak) {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders || workspaceFolders.length === 0) {
            return {
              type: 'error',
              requestId: message.requestId,
              payload: { message: 'No workspace folder open' },
            };
          }
          packageDir = workspaceFolders[0].uri.fsPath;
        } else {
          packageDir = config.config.prefix + '/projects/' + scope + '/' + pakName;
        }

        // Validate source file exists
        if (!fs.existsSync(srcFilePath)) {
          return {
            type: 'error',
            requestId: message.requestId,
            payload: { message: `File not found: ${srcFilePath}` },
          };
        }

        // Read and check for duplicate resource name
        const pkgPath = path.join(packageDir, 'package.json');
        if (!fs.existsSync(pkgPath)) {
          return {
            type: 'error',
            requestId: message.requestId,
            payload: { message: `ResourcePak not found at ${packageDir}` },
          };
        }
        const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkgData.resources && pkgData.resources.find((r: { name: string }) => r.name === resourceName)) {
          return {
            type: 'error',
            requestId: message.requestId,
            payload: { message: `Resource '${resourceName}' already exists in this ResourcePak` },
          };
        }

        // Copy file to pak dir if not already there
        const basename = path.basename(srcFilePath);
        const destPath = path.join(packageDir, basename);
        if (srcFilePath !== destPath) {
          fs.copyFileSync(srcFilePath, destPath);
        }

        // Add resource via domain library
        const rp = new ResourcePak(config);
        rp.addResource(resourceName, basename, packageDir);

        // Re-read to get updated resource count and size
        const updatedPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const addedResource = updatedPkg.resources.find((r: { name: string }) => r.name === resourceName);
        return {
          type: 'resourceAdded',
          requestId: message.requestId,
          payload: {
            resourceName,
            fileName: basename,
            size: addedResource?.size ?? 0,
            totalResources: updatedPkg.resources.length,
          },
        };
      }

      case 'buildResourcePak': {
        const config = new Config();
        config.loadConfig();
        const { scope, pakName, useDetectedPak } = message.data;

        // Resolve package directory
        let packageDir: string;
        if (useDetectedPak) {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders || workspaceFolders.length === 0) {
            return {
              type: 'error',
              requestId: message.requestId,
              payload: { message: 'No workspace folder open' },
            };
          }
          packageDir = workspaceFolders[0].uri.fsPath;
        } else {
          packageDir = config.config.prefix + '/projects/' + scope + '/' + pakName;
        }

        // Validate ResourcePak exists
        const pkgPath = path.join(packageDir, 'package.json');
        if (!fs.existsSync(pkgPath)) {
          if (pushMessage) {
            pushMessage({
              type: 'resourcePakBuildProgress',
              payload: {
                state: 'failed',
                errorMessage: `ResourcePak not found at ${packageDir}`,
                timestamp: new Date().toISOString(),
              },
            });
          }
          return null;
        }

        const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (!pkgData.resources || pkgData.resources.length === 0) {
          if (pushMessage) {
            pushMessage({
              type: 'resourcePakBuildProgress',
              payload: {
                state: 'failed',
                errorMessage: 'No resources to build. Add resources before building.',
                timestamp: new Date().toISOString(),
              },
            });
          }
          return null;
        }

        // Validate all resource files exist
        for (const r of pkgData.resources) {
          const resPath = path.join(packageDir, r.filename);
          if (!fs.existsSync(resPath)) {
            if (pushMessage) {
              pushMessage({
                type: 'resourcePakBuildProgress',
                payload: {
                  state: 'failed',
                  errorMessage: `Resource file missing: ${r.filename}`,
                  timestamp: new Date().toISOString(),
                },
              });
            }
            return null;
          }
        }

        // Send progress: building
        if (pushMessage) {
          pushMessage({
            type: 'resourcePakBuildProgress',
            payload: {
              state: 'building',
              totalResources: pkgData.resources.length,
              resourceIndex: 0,
              timestamp: new Date().toISOString(),
            },
          });
        }

        // Perform build
        const rp = new ResourcePak(config);
        rp.build(packageDir);

        // Determine output file
        const [, name] = pkgData.name.split('/');
        const pakFilePath = path.join(packageDir, name + '.pak');

        // Send progress: completed
        if (pushMessage) {
          pushMessage({
            type: 'resourcePakBuildProgress',
            payload: {
              state: 'completed',
              totalResources: pkgData.resources.length,
              resourceIndex: pkgData.resources.length,
              timestamp: new Date().toISOString(),
            },
          });
        }

        return {
          type: 'resourcePakBuilt',
          requestId: message.requestId,
          payload: {
            pakName: pkgData.name,
            pakFilePath,
            resourceCount: pkgData.resources.length,
          },
        };
      }

      // ── Dependency Handlers ─────────────────────────────────

      case 'checkDependencies': {
        const config = new Config();
        config.loadConfig();

        if (!config.config.prefix || config.config.prefix === '') {
          return {
            type: 'error',
            requestId: message.requestId,
            payload: { message: 'No prefix configured. Configure a project first.' },
          };
        }

        const target = message.data.target;
        const ecsInstalled = checkLibEcs(config, target);
        const seedInstalled = checkLibTheSeed(config, target);

        const status: DependencyStatusPayload = {
          target,
          libraries: [
            { name: 'libecs-cpp', installed: ecsInstalled },
            { name: 'libthe-seed', installed: seedInstalled },
          ],
          checking: false,
          timestamp: new Date().toISOString(),
        };

        currentDependencyStatus = status;

        return {
          type: 'dependencyStatus',
          requestId: message.requestId,
          payload: status,
        };
      }

      case 'getDependencyStatus': {
        if (currentDependencyStatus) {
          return {
            type: 'dependencyStatus',
            requestId: message.requestId,
            payload: currentDependencyStatus,
          };
        }
        // Never checked — return null-like payload
        return {
          type: 'dependencyStatus',
          requestId: message.requestId,
          payload: {
            target: 'native',
            libraries: [],
            checking: false,
            timestamp: new Date().toISOString(),
          },
        };
      }

      case 'installDependencies': {
        const config = new Config();
        config.loadConfig();

        if (!config.config.prefix || config.config.prefix === '') {
          return {
            type: 'error',
            requestId: message.requestId,
            payload: { message: 'No prefix configured. Configure a project first.' },
          };
        }

        // Check operation lock
        const currentLock = getOperationLock();
        if (currentLock.active) {
          const opType = currentLock.type === 'build' ? 'build' : 'install';
          return {
            type: 'error',
            requestId: message.requestId,
            payload: { message: `Cannot install: a ${opType} operation is in progress.` },
          };
        }

        const target = message.data.target;

        // Check which libraries are missing
        const steps = getInstallSteps(config, target);
        if (steps.length === 0) {
          return {
            type: 'error',
            requestId: message.requestId,
            payload: { message: `All dependencies are already installed for ${target}.` },
          };
        }

        // Acquire lock
        const lockResult = acquireOperationLock('install');
        if (!lockResult.success) {
          return {
            type: 'error',
            requestId: message.requestId,
            payload: { message: `Cannot install: a ${lockResult.heldBy} operation is in progress.` },
          };
        }

        const abortController = lockResult.abortController!;

        // Acknowledge start
        if (pushMessage) {
          pushMessage({
            type: 'installDependenciesStarted',
            requestId: message.requestId,
          });
        }

        // Run install asynchronously
        (async () => {
          try {
            const result = await runBuildSteps(steps, {
              cwd: config.config.prefix,
              onStdout: () => {},
              onStderr: () => {},
              onStepStart: (step, index, total) => {
                const progressPayload: InstallProgressPayload = {
                  state: 'running',
                  target,
                  currentLibrary: step.label.split(' ')[1] || step.label,
                  currentStep: step.label,
                  stepIndex: index + 1,
                  totalSteps: total,
                  timestamp: new Date().toISOString(),
                };
                currentInstallProgress = progressPayload;
                if (pushMessage) {
                  pushMessage({
                    type: 'installDependenciesProgress',
                    payload: progressPayload,
                  });
                }
              },
              signal: abortController.signal,
            });

            if (!result.success) {
              if (result.cancelledAtStep !== undefined) {
                const cancelPayload: InstallProgressPayload = {
                  state: 'cancelled',
                  target,
                  timestamp: new Date().toISOString(),
                };
                currentInstallProgress = null;
                if (pushMessage) {
                  pushMessage({
                    type: 'installDependenciesProgress',
                    payload: cancelPayload,
                  });
                }
              } else {
                const failPayload: InstallProgressPayload = {
                  state: 'failed',
                  target,
                  errorMessage: 'Installation step failed with non-zero exit code',
                  timestamp: new Date().toISOString(),
                };
                currentInstallProgress = null;
                if (pushMessage) {
                  pushMessage({
                    type: 'installDependenciesProgress',
                    payload: failPayload,
                  });
                }
              }
            } else {
              const completePayload: InstallProgressPayload = {
                state: 'completed',
                target,
                timestamp: new Date().toISOString(),
              };
              currentInstallProgress = null;
              if (pushMessage) {
                pushMessage({
                  type: 'installDependenciesProgress',
                  payload: completePayload,
                });
              }
            }

            // Auto-refresh dependency status
            const ecsInstalled = checkLibEcs(config, target);
            const seedInstalled = checkLibTheSeed(config, target);
            const refreshStatus: DependencyStatusPayload = {
              target,
              libraries: [
                { name: 'libecs-cpp', installed: ecsInstalled },
                { name: 'libthe-seed', installed: seedInstalled },
              ],
              checking: false,
              timestamp: new Date().toISOString(),
            };
            currentDependencyStatus = refreshStatus;
            if (pushMessage) {
              pushMessage({
                type: 'dependencyStatus',
                payload: refreshStatus,
              });
            }
          } finally {
            releaseOperationLock();
          }
        })();

        // Return null since we handle async responses via pushMessage
        return null;
      }

      case 'cancelInstallDependencies': {
        const lock = getOperationLock();
        if (lock.active && lock.type === 'install' && lock.abortController) {
          lock.abortController.abort();
        }
        return {
          type: 'installDependenciesCancelled',
          requestId: message.requestId,
        };
      }

      default:
        return {
          type: 'error',
          payload: { message: `Unknown command: ${(message as { command: string }).command}` },
        };
    }
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : 'An unexpected error occurred';

    // Check for specific error types
    const code = (err as NodeJS.ErrnoException)?.code;
    let userMessage = errorMessage;
    if (code === 'EACCES' || code === 'EPERM') {
      userMessage = 'Could not save — check file permissions';
    } else if (errorMessage.includes('JSON') || errorMessage.includes('parse')) {
      userMessage = 'Configuration file is malformed. Please check config.json';
    }

    return {
      type: 'error',
      requestId: (message as { requestId?: string }).requestId,
      payload: { message: userMessage },
    };
  }
}
