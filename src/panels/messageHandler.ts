import * as vscode from 'vscode';
import Config from '@metaverse-systems/the-seed/dist/Config';
import Scopes from '@metaverse-systems/the-seed/dist/Scopes';
import Template from '@metaverse-systems/the-seed/dist/Template';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createTemplatePackage } from '../templateRuntime';
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  ConfigPayload,
  ScopeEntry,
  ScopeFormData,
  TemplateFormData,
  TemplateCreatedPayload,
} from '../types/messages';

function getConfigDir(): string {
  return path.join(os.homedir(), 'the-seed');
}

function getConfigFilePath(): string {
  return path.join(getConfigDir(), 'config.json');
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
  message: WebviewToExtensionMessage
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
