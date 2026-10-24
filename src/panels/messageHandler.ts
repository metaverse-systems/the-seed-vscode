import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectResourcePak } from '../utils/detectResourcePak';
import { chooseCreationFolder, describeError } from '../utils/projectFolder';
import { addResourceFile } from '../utils/addResourceFile';
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
  PackageStatusPayload,
  SigningStatusPayload,
  SigningScopeStatus,
} from '../types/messages';
import { toToolStatusPayload } from '../tool/toolStatus';
import { cancelActiveBuild } from '../commands/buildNative';
import { cancelActiveRecursiveBuild } from '../commands/buildNativeRecursive';
import { getOperationLock } from '../operationLock';
import type Config from '@metaverse-systems/the-seed/Config';
import type { ToolApi } from '../tool/toolApi';
import type { ToolService } from '../tool/toolService';
import { isToolRefusal } from '../utils/projectFolder';

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

// The last dependency status of each target, for getDependencyStatus
const currentDependencyStatuses: { native?: DependencyStatusPayload; windows?: DependencyStatusPayload } = {};

export function updateDependencyStatus(status: DependencyStatusPayload): void {
  currentDependencyStatuses[status.target] = status;
}

/** The last status of each target that has one, native first. */
export function getCurrentDependencyStatuses(): DependencyStatusPayload[] {
  return [currentDependencyStatuses.native, currentDependencyStatuses.windows]
    .filter((status): status is DependencyStatusPayload => status !== undefined);
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

/**
 * The messages that work without the tool. Every other message is an operation: it is refused, with
 * the reason, when the tool is not usable.
 */
export const TOOL_FREE_MESSAGES: ReadonlySet<WebviewToExtensionMessage['command']> = new Set<WebviewToExtensionMessage['command']>([
  'cancelBuild',
  'cancelRecursiveBuild',
  'getBuildStatus',
  'getResourcePakStatus',
  'browseResourceFile',
  'getDependencyStatus',
  'cancelInstallDependencies',
  'getPackageStatus',
  'ready',
  'getToolStatus',
  'checkTool',
  'openToolSetting',
]);

export async function handleMessage(
  message: WebviewToExtensionMessage,
  pushMessage: ((msg: ExtensionToWebviewMessage) => void) | undefined,
  service: ToolService
): Promise<ExtensionToWebviewMessage | null> {
  let tool!: ToolApi;
  try {
    if (!TOOL_FREE_MESSAGES.has(message.command)) {
      const acquired = await service.acquire();
      if (!acquired.ok) {
        return {
          type: 'error',
          requestId: (message as { requestId?: string }).requestId,
          payload: { message: acquired.status.message, code: 'toolUnavailable' },
        };
      }
      tool = acquired.api;
    }
    switch (message.command) {
      case 'ready': {
        const acquired = await service.acquire();
        const statusMessage: ExtensionToWebviewMessage = { type: 'toolStatus', payload: toToolStatusPayload(service.status) };
        pushMessage?.(statusMessage);
        if (!acquired.ok) {
          return statusMessage;
        }
        const configFileExists = fs.existsSync(getConfigFilePath());
        const config = new acquired.api.Config();
        config.loadConfig();
        const isDefault = !configFileExists;
        return {
          type: 'configLoaded',
          payload: buildConfigPayload(config, isDefault),
        };
      }

      case 'getToolStatus':
        return { type: 'toolStatus', requestId: message.requestId, payload: toToolStatusPayload(service.status) };

      case 'checkTool': {
        const status = await service.check('checkAgain');
        return { type: 'toolStatus', requestId: message.requestId, payload: toToolStatusPayload(status) };
      }

      case 'openToolSetting':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'the-seed.toolPath');
        return null;

      case 'getConfig': {
        const config = new tool.Config();
        config.loadConfig();
        return {
          type: 'configLoaded',
          requestId: message.requestId,
          payload: buildConfigPayload(config, false),
        };
      }

      case 'savePrefix': {
        const config = new tool.Config();
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
        const config = new tool.Config();
        config.loadConfig();
        const scopeName = message.data.scopeName.startsWith('@')
          ? message.data.scopeName
          : `@${message.data.scopeName}`;
        const invalid = tool.validateScopeName(scopeName);
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
        const scopes = new tool.Scopes(config);
        scopes.createOrEditScope(toScopeAnswers(message.data));
        config.saveConfig();
        return {
          type: 'scopeAdded',
          requestId: message.requestId,
          payload: buildConfigPayload(config, false),
        };
      }

      case 'confirmOverwriteScope': {
        const config = new tool.Config();
        config.loadConfig();
        const scopes = new tool.Scopes(config);
        scopes.createOrEditScope(toScopeAnswers(message.data));
        config.saveConfig();
        return {
          type: 'scopeAdded',
          requestId: message.requestId,
          payload: buildConfigPayload(config, false),
        };
      }

      case 'editScope': {
        const config = new tool.Config();
        config.loadConfig();
        const scopes = new tool.Scopes(config);
        scopes.createOrEditScope(toScopeAnswers(message.data));
        config.saveConfig();
        return {
          type: 'scopeEdited',
          requestId: message.requestId,
          payload: buildConfigPayload(config, false),
        };
      }

      case 'deleteScope': {
        const config = new tool.Config();
        config.loadConfig();
        const scopes = new tool.Scopes(config);
        scopes.deleteScope(message.data.scopeName);
        config.saveConfig();
        return {
          type: 'scopeDeleted',
          requestId: message.requestId,
          payload: buildConfigPayload(config, false),
        };
      }

      case 'createTemplate': {
        const config = new tool.Config();
        config.loadConfig();
        const { templateType, scopeName, templateName } = message.data;

        const creation = await chooseCreationFolder();
        if (!creation) {
          return noFolderChosen(message.requestId);
        }
        const folder = creation.folder;

        const template = new tool.Template(config);
        template.type = templateType;
        let projectPath: string;
        try {
          projectPath = template.createPackage(scopeName, templateName, folder);
        } catch (error) {
          if (error instanceof tool.ProjectError && error.code === 'target-exists') {
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
            openFolder: creation.openAfterCreate,
          } as TemplateCreatedPayload,
        };
      }

      case 'startBuild': {
        // The command refuses a start while any operation holds the lock, with the same warning as from
        // the palette, so the sidebar always runs it and acknowledges the request.
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
        // The command refuses a start while any operation holds the lock, with the same warning as from
        // the palette, so the sidebar always runs it and acknowledges the request.
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
        const config = new tool.Config();
        config.loadConfig();
        const rp = new tool.ResourcePak(config);
        const { scopeName, pakName } = message.data;
        const scope = scopeName.startsWith('@') ? scopeName : `@${scopeName}`;
        const creation = await chooseCreationFolder();
        if (!creation) {
          return noFolderChosen(message.requestId);
        }
        const folder = creation.folder;
        const packageDir = rp.createPackage(scope, pakName, folder);
        return {
          type: 'resourcePakCreated',
          requestId: message.requestId,
          payload: {
            scope,
            pakName,
            packageDir,
            openFolder: creation.openAfterCreate,
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
        const config = new tool.Config();
        config.loadConfig();
        const { resourceName, filePath: srcFilePath } = message.data;

        const packageDir = detectedPakDir();
        if (!packageDir) {
          return noPakProject(message.requestId);
        }

        const added = addResourceFile(new tool.ResourcePak(config), packageDir, resourceName, srcFilePath, tool);
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
        const config = new tool.Config();
        config.loadConfig();

        const packageDir = detectedPakDir();
        if (!packageDir) {
          return noPakProject(message.requestId);
        }
        const rp = new tool.ResourcePak(config);
        const pkgData = rp.readProject(packageDir);
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

        // Perform build; the tool says where it wrote the pak
        let pakFilePath: string;
        try {
          pakFilePath = rp.build(packageDir);
        } catch (error) {
          if (error instanceof tool.ProjectError) {
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
        const config = new tool.Config();
        config.loadConfig();

        if (!config.config.prefix || config.config.prefix === '') {
          return {
            type: 'error',
            requestId: message.requestId,
            payload: { message: 'No prefix configured. Configure a project first.' },
          };
        }

        const target = message.data.target;
        const ecsInstalled = tool.checkLibEcs(config, target);
        const seedInstalled = tool.checkLibTheSeed(config, target);

        const status: DependencyStatusPayload = {
          target,
          libraries: [
            { name: 'libecs-cpp', installed: ecsInstalled },
            { name: 'libthe-seed', installed: seedInstalled },
          ],
          checking: false,
          timestamp: new Date().toISOString(),
        };

        updateDependencyStatus(status);

        return {
          type: 'dependencyStatus',
          requestId: message.requestId,
          payload: status,
        };
      }

      case 'getDependencyStatus': {
        // Every known target's status: all but the last pushed, the last as the answer.
        const known = getCurrentDependencyStatuses();
        if (known.length > 0) {
          for (const status of known.slice(0, -1)) {
            pushMessage?.({ type: 'dependencyStatus', requestId: message.requestId, payload: status });
          }
          return {
            type: 'dependencyStatus',
            requestId: message.requestId,
            payload: known[known.length - 1],
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
        // The sidebar runs the command itself, which reports through the view provider.
        void vscode.commands.executeCommand('the-seed.installDependencies', message.data.target);
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
        const signing = new tool.Signing();
        const config = new tool.Config();
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
    if (isToolRefusal(err)) {
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
