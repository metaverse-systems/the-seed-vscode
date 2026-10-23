import * as vscode from "vscode";
import { createOutputChannel } from "./outputChannel";
import { wrapCommand } from "./commands/wrapCommand";
import { configureProject } from "./commands/configureProject";
import { addScope } from "./commands/addScope";
import { listScopes } from "./commands/listScopes";
import { showConfig } from "./commands/showConfig";
import { editScope } from "./commands/editScope";
import { deleteScope } from "./commands/deleteScope";
import { createComponentTemplate } from "./commands/createComponentTemplate";
import { createSystemTemplate } from "./commands/createSystemTemplate";
import { createProgramTemplate } from "./commands/createProgramTemplate";
import { buildNativeCommand, buildWindowsCommand, buildIncrementalCommand } from "./commands/buildNative";
import { buildNativeRecursiveCommand, buildWindowsRecursiveCommand } from "./commands/buildNativeRecursive";
import { checkDependenciesCommand, installDependenciesCommand } from "./commands/dependencyCommands";
import { packageProjectCommand } from "./commands/packageProject";
import { generateInstallerCommand } from "./commands/generateInstaller";
import { createResourcePak } from "./commands/createResourcePak";
import { addResource } from "./commands/addResource";
import { buildResourcePak } from "./commands/buildResourcePak";
import { createSigningCert } from "./commands/createSigningCert";
import { importSigningCert } from "./commands/importSigningCert";
import { signingCertInfo } from "./commands/signingCertInfo";
import { exportSigningCert } from "./commands/exportSigningCert";
import { signFile } from "./commands/signFile";
import { verifySignature } from "./commands/verifySignature";
import { TheSeedViewProvider, setActiveViewProvider } from "./panels/TheSeedViewProvider";
import { createToolService, setActiveToolService } from "./tool/toolService";

export function activate(context: vscode.ExtensionContext) {
  const toolService = createToolService();
  setActiveToolService(toolService);
  context.subscriptions.push(
    toolService,
    toolService.watchSetting(vscode.workspace.onDidChangeConfiguration),
    { dispose: () => setActiveToolService(undefined) }
  );

  const outputChannel = createOutputChannel();
  context.subscriptions.push(outputChannel);

  // Register the Webview panel provider for the activity bar
  const viewProvider = new TheSeedViewProvider(context.extensionUri, toolService);
  setActiveViewProvider(viewProvider);
  context.subscriptions.push(viewProvider, { dispose: () => setActiveViewProvider(undefined) });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TheSeedViewProvider.viewType,
      viewProvider
    )
  );

  // Create ResourcePak command
  const createResourcePakDisposable = vscode.commands.registerCommand(
    "the-seed.createResourcePak",
    wrapCommand(createResourcePak, outputChannel, toolService)
  );

  // New commands
  const configureProjectDisposable = vscode.commands.registerCommand(
    "the-seed.configureProject",
    wrapCommand(configureProject, outputChannel, toolService)
  );

  const showConfigDisposable = vscode.commands.registerCommand(
    "the-seed.showConfig",
    wrapCommand(showConfig, outputChannel, toolService)
  );

  const listScopesDisposable = vscode.commands.registerCommand(
    "the-seed.listScopes",
    wrapCommand(listScopes, outputChannel, toolService)
  );

  const addScopeDisposable = vscode.commands.registerCommand(
    "the-seed.addScope",
    wrapCommand(addScope, outputChannel, toolService)
  );

  const editScopeDisposable = vscode.commands.registerCommand(
    "the-seed.editScope",
    wrapCommand(editScope, outputChannel, toolService)
  );

  const deleteScopeDisposable = vscode.commands.registerCommand(
    "the-seed.deleteScope",
    wrapCommand(deleteScope, outputChannel, toolService)
  );

  const createComponentTemplateDisposable = vscode.commands.registerCommand(
    "the-seed.createComponentTemplate",
    wrapCommand(createComponentTemplate, outputChannel, toolService)
  );

  const createSystemTemplateDisposable = vscode.commands.registerCommand(
    "the-seed.createSystemTemplate",
    wrapCommand(createSystemTemplate, outputChannel, toolService)
  );

  const createProgramTemplateDisposable = vscode.commands.registerCommand(
    "the-seed.createProgramTemplate",
    wrapCommand(createProgramTemplate, outputChannel, toolService)
  );

  const buildNativeDisposable = vscode.commands.registerCommand(
    "the-seed.buildNative",
    wrapCommand(buildNativeCommand(outputChannel, viewProvider), outputChannel, toolService)
  );

  const buildWindowsDisposable = vscode.commands.registerCommand(
    "the-seed.buildWindows",
    wrapCommand(buildWindowsCommand(outputChannel, viewProvider), outputChannel, toolService)
  );

  const buildIncrementalDisposable = vscode.commands.registerCommand(
    "the-seed.buildIncremental",
    wrapCommand(buildIncrementalCommand(outputChannel, viewProvider), outputChannel, toolService)
  );

  const buildNativeRecursiveDisposable = vscode.commands.registerCommand(
    "the-seed.buildNativeRecursive",
    wrapCommand(buildNativeRecursiveCommand(outputChannel, viewProvider), outputChannel, toolService)
  );

  const buildWindowsRecursiveDisposable = vscode.commands.registerCommand(
    "the-seed.buildWindowsRecursive",
    wrapCommand(buildWindowsRecursiveCommand(outputChannel, viewProvider), outputChannel, toolService)
  );

  // Add Resource command (palette)
  const addResourceDisposable = vscode.commands.registerCommand(
    "the-seed.addResource",
    wrapCommand(addResource, outputChannel, toolService)
  );

  // Build ResourcePak command (palette)
  const buildResourcePakDisposable = vscode.commands.registerCommand(
    "the-seed.buildResourcePak",
    wrapCommand(buildResourcePak, outputChannel, toolService)
  );

  // Check Dependencies command
  const checkDependenciesDisposable = vscode.commands.registerCommand(
    "the-seed.checkDependencies",
    wrapCommand(checkDependenciesCommand(outputChannel), outputChannel, toolService)
  );

  // Install Dependencies command
  const installDependenciesDisposable = vscode.commands.registerCommand(
    "the-seed.installDependencies",
    wrapCommand(installDependenciesCommand(outputChannel, viewProvider), outputChannel, toolService)
  );

  // Package Projects command
  const packageProjectDisposable = vscode.commands.registerCommand(
    "the-seed.packageProject",
    wrapCommand(packageProjectCommand(outputChannel, viewProvider), outputChannel, toolService)
  );

  // Generate Windows Installer command
  const generateInstallerDisposable = vscode.commands.registerCommand(
    "the-seed.generateWindowsInstaller",
    wrapCommand(generateInstallerCommand(outputChannel, viewProvider), outputChannel, toolService)
  );

  // Signing commands
  const createSigningCertDisposable = vscode.commands.registerCommand(
    "the-seed.createSigningCert",
    wrapCommand(createSigningCert, outputChannel, toolService)
  );

  const importSigningCertDisposable = vscode.commands.registerCommand(
    "the-seed.importSigningCert",
    wrapCommand(importSigningCert, outputChannel, toolService)
  );

  const signFileDisposable = vscode.commands.registerCommand(
    "the-seed.signFile",
    wrapCommand(signFile, outputChannel, toolService)
  );

  const verifySignatureDisposable = vscode.commands.registerCommand(
    "the-seed.verifySignature",
    wrapCommand(verifySignature, outputChannel, toolService)
  );

  const signingCertInfoDisposable = vscode.commands.registerCommand(
    "the-seed.signingCertInfo",
    wrapCommand(signingCertInfo, outputChannel, toolService)
  );

  const exportSigningCertDisposable = vscode.commands.registerCommand(
    "the-seed.exportSigningCert",
    wrapCommand(exportSigningCert, outputChannel, toolService)
  );

  // Check Tool command: reports the installation in use; it works whether or not the tool is usable.
  const checkToolDisposable = vscode.commands.registerCommand("the-seed.checkTool", async () => {
    const status = await toolService.check("checkAgain");
    if (status.state === "usable") {
      void vscode.window.showInformationMessage(`The Seed: ${status.message}`);
    }
    // An unusable status was already announced by the check the user asked for.
  });

  context.subscriptions.push(
    checkToolDisposable,
    createResourcePakDisposable,
    configureProjectDisposable,
    showConfigDisposable,
    listScopesDisposable,
    addScopeDisposable,
    editScopeDisposable,
    deleteScopeDisposable,
    createComponentTemplateDisposable,
    createSystemTemplateDisposable,
    createProgramTemplateDisposable,
    buildNativeDisposable,
    buildWindowsDisposable,
    buildIncrementalDisposable,
    buildNativeRecursiveDisposable,
    buildWindowsRecursiveDisposable,
    addResourceDisposable,
    buildResourcePakDisposable,
    checkDependenciesDisposable,
    installDependenciesDisposable,
    packageProjectDisposable,
    generateInstallerDisposable,
    createSigningCertDisposable,
    importSigningCertDisposable,
    signFileDisposable,
    verifySignatureDisposable,
    signingCertInfoDisposable,
    exportSigningCertDisposable
  );

  // The first check runs in the background so activation never waits for it or fails because of it.
  void toolService.check("activate");
}

export function deactivate() {}
