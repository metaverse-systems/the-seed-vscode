"use strict";

import * as vscode from "vscode";

import { ConfigOptionProvider } from "./configOptions";
//import { DependencyProvider } from "./dependencies";

export function activate(context: vscode.ExtensionContext) {
  const configProvider = new ConfigOptionProvider();
  vscode.window.registerTreeDataProvider("configOptions", configProvider);
  vscode.commands.registerCommand("configOptions.editEntry", (item: vscode.TreeItem) => configProvider.edit(item.id));

//  const depProvider = new DependencyProvider();
//  vscode.window.registerTreeDataProvider("dependencies", depProvider);
}

export function deactivate() {}
