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
import { TheSeedViewProvider } from "./panels/TheSeedViewProvider";

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

  context.subscriptions.push(
    createResourcePakDisposable,
    configureProjectDisposable,
    showConfigDisposable,
    listScopesDisposable,
    addScopeDisposable,
    editScopeDisposable,
    deleteScopeDisposable
  );
}

export function deactivate() {}
