import * as vscode from "vscode";
import { askQuestions } from "./askQuestions";
import ResourcePak from "@metaverse-systems/the-seed/dist/ResourcePak";
import Config from "@metaverse-systems/the-seed/dist/Config";

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "the-seed.createResourcePak",
    async () => {
      const config = new Config();
      const rp = new ResourcePak(config);

      const questions = rp.askName();
	  const answers = await askQuestions(questions);

      if (!answers.scopeName || !answers.pakName) {
		return;
	  }

      rp.createPackage(answers.scopeName, answers.pakName);
      vscode.window.showInformationMessage(`ResourcePak '${answers.pakName}' created in scope '${answers.scopeName}'`);
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
