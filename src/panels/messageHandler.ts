import * as vscode from 'vscode';
import Config from '@metaverse-systems/the-seed/Config';
import Scopes, { validateScopeName } from '@metaverse-systems/the-seed/Scopes';
import Template from '@metaverse-systems/the-seed/Template';
import ResourcePak from '@metaverse-systems/the-seed/ResourcePak';
import SigningModule from '@metaverse-systems/the-seed/Signing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectResourcePak } from '../utils/detectResourcePak';
import { chooseProjectFolder, describeError } from '../utils/projectFolder';
import { addResourceFile } from '../utils/addResourceFile';
import { ProjectError } from '@metaverse-systems/the-seed/ProjectError';
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
  ResourcePakFormData,
  DependencyStatusPayload,
  InstallProgressPayload,
  PackageStatusPayload,
  SigningStatusPayload,
  SigningScopeStatus,
} from '../types/messages';
import { getActiveBuild, cancelActiveBuild } from '../commands/buildNative';
import { cancelActiveRecursiveBuild } from '../commands/buildNativeRecursive';
import { checkLibEcs, checkLibTheSeed, getInstallSteps } from '@metaverse-systems/the-seed/Dependencies';
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

// Package status tracking
let currentPackageStatus: PackageStatusPayload | null = null;

export function updatePackageStatus(status: PackageStatusPayload): void {
  currentPackageStatus = status;
}

export function getCurrentPackageStatus(): PackageStatusPayload | null {
  return currentPackageStatus;
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

/** The resource pak project in the first workspace folder, if there is one. */
function detectedPakDir(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return detectResourcePak(folders[0].uri.fsPath)?.packageDir;
}

function noPakProject(requestId: string): ExtensionToWebviewMessage {
  return {
    type: 'error',
    requestId,
    payload: { message: 'No resource pak project in the open folder.' },
  };
}

function noFolderChosen(requestId: string): ExtensionToWebviewMessage {
  return {
    type: 'error',
    requestId,
    payload: { message: 'No folder was chosen; nothing was created.' },
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
        const invalid = validateScopeName(scopeName);
        if (invalid !== null) {
          return { type: 'error', payload: { message: invalid } };
        }
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

        const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
        const folder = await chooseProjectFolder();
        if (!folder) {
          return noFolderChosen(message.requestId);
        }

        const template = new Template(config);
        template.type = templateType;
        let projectPath: string;
        try {
          projectPath = template.createPackage(scopeName, templateName, folder);
        } catch (error) {
          if (error instanceof ProjectError && error.code === 'target-exists') {
            return {
              type: 'templateExists',
              requestId: message.requestId,
              payload: { projectPath: path.join(folder, templateName) },
            };
          }
          throw error;
        }

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

      case 'startRecursiveBuild': {
        // Check if a build is already running
        if (getActiveBuild()) {
          return {
            type: 'error',
            requestId: message.requestId,
            payload: { message: 'A build is already in progress.' },
          };
        }

        const recursiveTarget = message.data.target;
        const recursiveCommandMap: Record<string, string> = {
          'native': 'the-seed.buildNativeRecursive',
          'windows': 'the-seed.buildWindowsRecursive',
        };
        const recursiveCommandId = recursiveCommandMap[recursiveTarget];
        if (recursiveCommandId) {
          // Fire and forget — the command handler manages the full lifecycle
          vscode.commands.executeCommand(recursiveCommandId);
        }
        return {
          type: 'buildStarted',
          requestId: message.requestId,
        };
      }

      case 'cancelRecursiveBuild': {
        cancelActiveRecursiveBuild();
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
        const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
        const folder = await chooseProjectFolder();
        if (!folder) {
          return noFolderChosen(message.requestId);
        }
        const packageDir = rp.createPackage(scope, pakName, folder);
        return {
          type: 'resourcePakCreated',
          requestId: message.requestId,
          payload: {
            scope,
            pakName,
            packageDir,
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
        const { resourceName, filePath: srcFilePath } = message.data;

        const packageDir = detectedPakDir();
        if (!packageDir) {
          return noPakProject(message.requestId);
        }

        const added = addResourceFile(new ResourcePak(config), packageDir, resourceName, srcFilePath);
        return {
          type: 'resourceAdded',
          requestId: message.requestId,
          payload: {
            resourceName,
            fileName: path.basename(added.filename),
            size: added.size,
            totalResources: added.totalResources,
          },
        };
      }

      case 'buildResourcePak': {
        const config = new Config();
        config.loadConfig();

        const packageDir = detectedPakDir();
        if (!packageDir) {
          return noPakProject(message.requestId);
        }
        const pkgPath = path.join(packageDir, 'package.json');

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
        try {
          rp.build(packageDir);
        } catch (error) {
          if (error instanceof ProjectError) {
            if (pushMessage) {
              pushMessage({
                type: 'resourcePakBuildProgress',
                payload: {
                  state: 'failed',
                  errorMessage: describeError(error),
                  timestamp: new Date().toISOString(),
                },
              });
            }
            return null;
          }
          throw error;
        }

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

      // ── Package Handlers ────────────────────────────────────

      case 'startPackage': {
        // Fire the command — the command handler manages the full lifecycle
        vscode.commands.executeCommand('the-seed.packageProject');
        return {
          type: 'packageStarted',
          requestId: message.requestId,
        };
      }

      case 'getPackageStatus': {
        const status: PackageStatusPayload = currentPackageStatus ?? {
          state: 'idle',
          timestamp: new Date().toISOString(),
        };
        return {
          type: 'packageStatusResponse',
          requestId: message.requestId,
          payload: status,
        };
      }

      // ── Installer Handlers ──────────────────────────────────

      case 'generateInstaller': {
        // Fire the command — the command handler manages the full lifecycle
        vscode.commands.executeCommand('the-seed.generateWindowsInstaller');
        return null;
      }

      case 'createSigningCert': {
        await vscode.commands.executeCommand('the-seed.createSigningCert');
        return null;
      }

      case 'importSigningCert': {
        await vscode.commands.executeCommand('the-seed.importSigningCert');
        return null;
      }

      case 'signingCertInfo': {
        await vscode.commands.executeCommand('the-seed.signingCertInfo');
        return null;
      }

      case 'exportSigningCert': {
        await vscode.commands.executeCommand('the-seed.exportSigningCert');
        return null;
      }

      case 'getSigningStatus': {
        const signing = new SigningModule();
        const config = new Config();
        config.loadConfig();
        const scopes: SigningScopeStatus[] = Object.keys(config.config.scopes).map((scope) => {
          const certInfo = signing.getCertInfo(scope);
          if (!certInfo) {
            return { scope, status: 'no certificate' };
          }
          return {
            scope,
            status: certInfo.isExpired ? 'expired' : 'active',
            subject: signing._formatSubject(certInfo.subject),
            issuer: certInfo.issuer,
            fingerprint: certInfo.fingerprint,
            validFrom: certInfo.notBefore.toISOString(),
            validTo: certInfo.notAfter.toISOString(),
            isExpired: certInfo.isExpired,
          };
        });
        const payload: SigningStatusPayload = { scopes };
        return {
          type: 'signingStatus',
          requestId: message.requestId,
          payload,
        };
      }

      default:
        return {
          type: 'error',
          payload: { message: `Unknown command: ${(message as { command: string }).command}` },
        };
    }
  } catch (err: unknown) {
    if (err instanceof ProjectError) {
      return {
        type: 'error',
        requestId: (message as { requestId?: string }).requestId,
        payload: err.hint ? { message: err.message, hint: err.hint } : { message: err.message },
      };
    }
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
