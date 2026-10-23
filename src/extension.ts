import * as vscode from "vscode";
import { askQuestions } from "./askQuestions";
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
import { chooseScope } from "./signing/chooseScope";
import { createSigningCert } from "./commands/createSigningCert";
import { signFile } from "./commands/signFile";
import { verifySignature } from "./commands/verifySignature";
import { TheSeedViewProvider } from "./panels/TheSeedViewProvider";
import { chooseCreationFolder, choosePakProject, openCreatedProject, describeError, isToolRefusal } from "./utils/projectFolder";
import { addResourceFile } from "./utils/addResourceFile";
import * as path from "path";
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
  context.subscriptions.push(viewProvider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TheSeedViewProvider.viewType,
      viewProvider
    )
  );

  // Existing command: Create ResourcePak
  const createResourcePakDisposable = vscode.commands.registerCommand(
    "the-seed.createResourcePak",
    wrapCommand(async (oc, tool) => {
      const config = new tool.Config();
      const rp = new tool.ResourcePak(config);

      const questions = rp.askName();
      const answers = await askQuestions(questions);

      if (!answers.scopeName || !answers.pakName) {
        return;
      }

      const creation = await chooseCreationFolder();
      if (!creation) {
        return;
      }
      const packageDir = rp.createPackage(answers.scopeName, answers.pakName, creation.folder);
      oc.appendLine(`[INFO] ResourcePak '${answers.pakName}' created at ${packageDir}`);
      vscode.window.showInformationMessage(`ResourcePak '${answers.pakName}' created at ${packageDir}`);
      if (creation.openAfterCreate) {
        void openCreatedProject(packageDir);
      }
    }, outputChannel, toolService)
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
    wrapCommand(async (oc, tool) => {
      const config = new tool.Config();
      const rp = new tool.ResourcePak(config);

      const packageDir = await choosePakProject(tool);
      if (!packageDir) {
        return;
      }
      oc.appendLine(`[INFO] ResourcePak: ${packageDir}`);

      // Open file picker
      const fileResult = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        openLabel: "Select Resource File",
      });
      if (!fileResult || fileResult.length === 0) {
        return;
      }
      const selectedFile = fileResult[0].fsPath;

      // Prompt for resource name
      const resourceName = await vscode.window.showInputBox({
        prompt: "Enter a name for this resource",
        placeHolder: "my-resource",
        validateInput: (value) => (value === "" ? "Name is required" : null),
      });
      if (!resourceName) {
        return;
      }

      try {
        addResourceFile(rp, packageDir, resourceName, selectedFile, tool);
      } catch (error) {
        if (isToolRefusal(error)) {
          oc.appendLine(`[ERROR] ${describeError(error)}`);
          vscode.window.showErrorMessage(describeError(error));
          return;
        }
        throw error;
      }
      vscode.window.showInformationMessage(
        `Resource '${resourceName}' added to ResourcePak`
      );
    }, outputChannel, toolService)
  );

  // Build ResourcePak command (palette)
  const buildResourcePakDisposable = vscode.commands.registerCommand(
    "the-seed.buildResourcePak",
    wrapCommand(async (oc, tool) => {
      const config = new tool.Config();
      const rp = new tool.ResourcePak(config);

      const packageDir = await choosePakProject(tool);
      if (!packageDir) {
        return;
      }
      oc.appendLine(`[INFO] ResourcePak: ${packageDir}`);

      try {
        rp.build(packageDir);
      } catch (error) {
        if (isToolRefusal(error)) {
          oc.appendLine(`[ERROR] ${describeError(error)}`);
          vscode.window.showErrorMessage(describeError(error));
          return;
        }
        throw error;
      }

      const pkgData = rp.readProject(packageDir);
      const [, name] = pkgData.name.split("/");
      const pakFilePath = path.join(packageDir, name + ".pak");

      vscode.window.showInformationMessage(
        `ResourcePak built successfully: ${pakFilePath}`
      );
    }, outputChannel, toolService)
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
    wrapCommand(async (oc, tool) => {
      const signing = new tool.Signing();
      const scope = await chooseScope(signing, 'import the certificate', tool);
      if (!scope) {
        return;
      }
      const certResult = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        openLabel: "Select Certificate File",
        filters: { 'PEM Files': ['pem', 'crt'] },
      });
      if (!certResult || certResult.length === 0) {return;}

      // Show file picker for private key
      const keyResult = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        openLabel: "Select Private Key File",
        filters: { 'Key Files': ['pem', 'key'] },
      });
      if (!keyResult || keyResult.length === 0) {return;}

      // Check for existing cert
      if (signing.hasCert(scope)) {
        const overwrite = await vscode.window.showWarningMessage(
          'A signing certificate already exists. Overwrite?',
          'Overwrite',
          'Cancel'
        );
        if (overwrite !== 'Overwrite') {return;}
      }

      try {
        const certInfo = await signing.importCert(certResult[0].fsPath, keyResult[0].fsPath, scope);
        vscode.window.showInformationMessage(
          `Certificate imported. Subject: ${signing._formatSubject(certInfo.subject)} | Fingerprint: ${certInfo.fingerprint}`
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Import failed: ${message}`);
      }
    }, outputChannel, toolService)
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
    wrapCommand(async (oc, tool) => {
      const signing = new tool.Signing();
      const scope = await chooseScope(signing, 'show the certificate', tool);
      if (!scope) {
        return;
      }
      const certInfo = signing.getCertInfo(scope);

      if (!certInfo) {
        const action = await vscode.window.showInformationMessage(
          'No signing certificate found.',
          'Create',
          'Import'
        );
        if (action === 'Create') {
          await vscode.commands.executeCommand('the-seed.createSigningCert');
        } else if (action === 'Import') {
          await vscode.commands.executeCommand('the-seed.importSigningCert');
        }
        return;
      }

      const subject = signing._formatSubject(certInfo.subject);
      const status = certInfo.isExpired ? 'Expired' : 'Active';
      vscode.window.showInformationMessage(
        `Certificate: ${subject} | Issuer: ${certInfo.issuer} | Status: ${status} | Fingerprint: ${certInfo.fingerprint}`
      );
    }, outputChannel, toolService)
  );

  const exportSigningCertDisposable = vscode.commands.registerCommand(
    "the-seed.exportSigningCert",
    wrapCommand(async (oc, tool) => {
      const signing = new tool.Signing();
      const scope = await chooseScope(signing, 'export the certificate', tool);
      if (!scope) {
        return;
      }

      if (!signing.hasCert(scope)) {
        vscode.window.showErrorMessage(`No signing certificate for scope ${scope}.`);
        return;
      }

      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('signing-cert.pem'),
        filters: { 'PEM Files': ['pem'] },
      });
      if (!saveUri) {return;}

      await signing.exportCert(saveUri.fsPath, scope);
      vscode.window.showInformationMessage(`Certificate exported to ${saveUri.fsPath}`);
    }, outputChannel, toolService)
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
