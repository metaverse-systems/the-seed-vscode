import * as vscode from "vscode";
import { askQuestions } from "./askQuestions";
import ResourcePak from "@metaverse-systems/the-seed/dist/ResourcePak";
import Config from "@metaverse-systems/the-seed/dist/Config";
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
import { checkDependenciesCommand, installDependenciesCommand } from "./commands/dependencyCommands";
import { TheSeedViewProvider } from "./panels/TheSeedViewProvider";
import { detectResourcePak } from "./utils/detectResourcePak";
import * as fs from "fs";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = createOutputChannel();
  context.subscriptions.push(outputChannel);

  // Register the Webview panel provider for the activity bar
  const viewProvider = new TheSeedViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TheSeedViewProvider.viewType,
      viewProvider
    )
  );

  // Existing command: Create ResourcePak
  const createResourcePakDisposable = vscode.commands.registerCommand(
    "the-seed.createResourcePak",
    wrapCommand(async (oc) => {
      const config = new Config();
      const rp = new ResourcePak(config);

      const questions = rp.askName();
      const answers = await askQuestions(questions);

      if (!answers.scopeName || !answers.pakName) {
        return;
      }

      rp.createPackage(answers.scopeName, answers.pakName);
      vscode.window.showInformationMessage(`ResourcePak '${answers.pakName}' created in scope '${answers.scopeName}'`);
    }, outputChannel)
  );

  // New commands
  const configureProjectDisposable = vscode.commands.registerCommand(
    "the-seed.configureProject",
    wrapCommand(configureProject, outputChannel)
  );

  const showConfigDisposable = vscode.commands.registerCommand(
    "the-seed.showConfig",
    wrapCommand(showConfig, outputChannel)
  );

  const listScopesDisposable = vscode.commands.registerCommand(
    "the-seed.listScopes",
    wrapCommand(listScopes, outputChannel)
  );

  const addScopeDisposable = vscode.commands.registerCommand(
    "the-seed.addScope",
    wrapCommand(addScope, outputChannel)
  );

  const editScopeDisposable = vscode.commands.registerCommand(
    "the-seed.editScope",
    wrapCommand(editScope, outputChannel)
  );

  const deleteScopeDisposable = vscode.commands.registerCommand(
    "the-seed.deleteScope",
    wrapCommand(deleteScope, outputChannel)
  );

  const createComponentTemplateDisposable = vscode.commands.registerCommand(
    "the-seed.createComponentTemplate",
    wrapCommand(createComponentTemplate, outputChannel)
  );

  const createSystemTemplateDisposable = vscode.commands.registerCommand(
    "the-seed.createSystemTemplate",
    wrapCommand(createSystemTemplate, outputChannel)
  );

  const createProgramTemplateDisposable = vscode.commands.registerCommand(
    "the-seed.createProgramTemplate",
    wrapCommand(createProgramTemplate, outputChannel)
  );

  const buildNativeDisposable = vscode.commands.registerCommand(
    "the-seed.buildNative",
    wrapCommand(buildNativeCommand(outputChannel, viewProvider), outputChannel)
  );

  const buildWindowsDisposable = vscode.commands.registerCommand(
    "the-seed.buildWindows",
    wrapCommand(buildWindowsCommand(outputChannel, viewProvider), outputChannel)
  );

  const buildIncrementalDisposable = vscode.commands.registerCommand(
    "the-seed.buildIncremental",
    wrapCommand(buildIncrementalCommand(outputChannel, viewProvider), outputChannel)
  );

  // Add Resource command (palette)
  const addResourceDisposable = vscode.commands.registerCommand(
    "the-seed.addResource",
    wrapCommand(async (oc) => {
      const config = new Config();
      const rp = new ResourcePak(config);

      // Try auto-detect
      let packageDir: string | undefined;
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        const detected = detectResourcePak(workspaceFolders[0].uri.fsPath);
        if (detected) {
          packageDir = detected.packageDir;
          oc.appendLine(`[INFO] Auto-detected ResourcePak: ${detected.pakName}`);
        }
      }

      // If not auto-detected, ask user for scope + pak name
      if (!packageDir) {
        const questions = rp.askName();
        const answers = await askQuestions(questions);
        if (!answers.scopeName || !answers.pakName) {
          return;
        }
        packageDir = config.config.prefix + "/projects/" + answers.scopeName + "/" + answers.pakName;
      }

      // Validate ResourcePak exists
      const pkgPath = path.join(packageDir, "package.json");
      if (!fs.existsSync(pkgPath)) {
        vscode.window.showErrorMessage(`ResourcePak not found at ${packageDir}`);
        return;
      }

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
        validateInput: (value) => {
          if (!value.trim()) return "Name is required";
          if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(value)) {
            return "Name must start with a letter or number and contain only letters, numbers, and hyphens";
          }
          return null;
        },
      });
      if (!resourceName) {
        return;
      }

      // Copy file to pak dir if needed
      const basename = path.basename(selectedFile);
      const destPath = path.join(packageDir, basename);
      if (selectedFile !== destPath) {
        fs.copyFileSync(selectedFile, destPath);
      }

      rp.addResource(resourceName, basename, packageDir);
      vscode.window.showInformationMessage(
        `Resource '${resourceName}' added to ResourcePak`
      );
    }, outputChannel)
  );

  // Build ResourcePak command (palette)
  const buildResourcePakDisposable = vscode.commands.registerCommand(
    "the-seed.buildResourcePak",
    wrapCommand(async (oc) => {
      const config = new Config();
      const rp = new ResourcePak(config);

      // Try auto-detect
      let packageDir: string | undefined;
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        const detected = detectResourcePak(workspaceFolders[0].uri.fsPath);
        if (detected) {
          packageDir = detected.packageDir;
          oc.appendLine(`[INFO] Auto-detected ResourcePak: ${detected.pakName}`);
        }
      }

      // If not auto-detected, ask user
      if (!packageDir) {
        const questions = rp.askName();
        const answers = await askQuestions(questions);
        if (!answers.scopeName || !answers.pakName) {
          return;
        }
        packageDir = config.config.prefix + "/projects/" + answers.scopeName + "/" + answers.pakName;
      }

      // Validate
      const pkgPath = path.join(packageDir, "package.json");
      if (!fs.existsSync(pkgPath)) {
        vscode.window.showErrorMessage(`ResourcePak not found at ${packageDir}`);
        return;
      }

      rp.build(packageDir);

      const pkgData = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const [, name] = pkgData.name.split("/");
      const pakFilePath = path.join(packageDir, name + ".pak");

      vscode.window.showInformationMessage(
        `ResourcePak built successfully: ${pakFilePath}`
      );
    }, outputChannel)
  );

  // Check Dependencies command
  const checkDependenciesDisposable = vscode.commands.registerCommand(
    "the-seed.checkDependencies",
    wrapCommand(checkDependenciesCommand(outputChannel), outputChannel)
  );

  // Install Dependencies command
  const installDependenciesDisposable = vscode.commands.registerCommand(
    "the-seed.installDependencies",
    wrapCommand(installDependenciesCommand(outputChannel, viewProvider), outputChannel)
  );

  context.subscriptions.push(
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
    addResourceDisposable,
    buildResourcePakDisposable,
    checkDependenciesDisposable,
    installDependenciesDisposable
  );
}

export function deactivate() {}
