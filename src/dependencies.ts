import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
const Dependencies = require("@metaverse-systems/the-seed-utils/Dependencies");

export class DependencyProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined> = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined> = this._onDidChangeTreeData.event;

  deps: TreeItem[];

  constructor() {
    this.deps = [];
    this.loadDependencies();
  }

  loadDependencies(): void {
    this.deps = [];
    let data = new Dependencies().Dependencies();
    Object.keys(data).forEach(target => {
      let sections: TreeItem[] = [];
      sections.push(new TreeItem("Prefix: " + data[target].Prefix));
      sections.push(new TreeItem("Directory prefix: " + data[target]["Prefix directory"]));
		  
      let libs: TreeItem[] = [];
      Object.keys(data[target].Libraries).forEach(lib => {
        let entry = lib + ": " + (data[target].Libraries[lib] ? "Found" : "Not found");
        libs.push(new TreeItem(entry));
      });
      sections.push(new TreeItem("Libraries", libs, vscode.TreeItemCollapsibleState.Expanded));

      let tools: TreeItem[] = [];
      Object.keys(data[target]["Build tools"]).forEach(tool => {
        let path = data[target]["Build tools"][tool];
        let entry = tool + ": " + (path ? path : "Not found");
        tools.push(new TreeItem(entry));
      });
      sections.push(new TreeItem("Build tools", tools, vscode.TreeItemCollapsibleState.Expanded));

      let compilers: TreeItem[] = [];
      Object.keys(data[target]["Compilers"]).forEach(compiler => {
        let path = data[target]["Compilers"][compiler];
        let entry = compiler + ": " + (path ? path : "Not found");
        compilers.push(new TreeItem(entry));
      });
      sections.push(new TreeItem("Compilers", compilers, vscode.TreeItemCollapsibleState.Expanded));

      let files: TreeItem[] = [];
      Object.keys(data[target].Files).forEach(file => {
        let filepath = "";
        if(file[0] !== "/") {
          filepath = data[target]["Prefix directory"] + "/" + file;
        } else {
          filepath = file;
        }

        let entry = filepath + ": " + (data[target].Files[file] ? "Found" : "Not found");
        files.push(new TreeItem(entry));
      });
      sections.push(new TreeItem("Files", files, vscode.TreeItemCollapsibleState.Expanded));

      let t = new TreeItem(target, sections, vscode.TreeItemCollapsibleState.Expanded);
      this.deps.push(t);
    });
  }

  refresh(): void {
    this.loadDependencies();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeItem): vscode.TreeItem|Thenable<vscode.TreeItem> {
    return element;
  }
	
  getChildren(element?: TreeItem|undefined): vscode.ProviderResult<TreeItem[]> {
    if(element === undefined) {
      return this.deps;
    }
    return element.children;
  }
}

class TreeItem extends vscode.TreeItem {
  children: TreeItem[]|undefined;
  
  constructor(label: string, children?: TreeItem[], state?: vscode.TreeItemCollapsibleState) {
    super(label, state);
    if(state === undefined) {
      state = children === undefined ? vscode.TreeItemCollapsibleState.None :
        vscode.TreeItemCollapsibleState.Collapsed;
    }

    if(children !== undefined) {
	  this.contextValue = "TreeItem";
    } else {
	  this.contextValue = "TreeBranch";
    }
    this.children = children;
  }
}
