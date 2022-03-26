import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Config } from "@metaverse-systems/the-seed";

const homedir = os.homedir();
const configDir = homedir + "/.config/the-seed";

export class ConfigOptionProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined> = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined> = this._onDidChangeTreeData.event;

  data: TreeItem[];

  constructor() {
    this.data = [];
    this.loadConfig();
  }

  loadConfig(): void {
    this.data = [];
    let config_file = new Config(configDir);

//    Object.keys(config_file.config).forEach(section => {
      let opts: TreeItem[] = [];
      Object.keys(config_file.config).forEach(option => {
        let item = new TreeItem(option + ": " + config_file.config[option]);
        item.id = option;
        opts.push(item);
      });
      let s = new TreeItem("Configuration", opts, vscode.TreeItemCollapsibleState.Expanded);
      this.data.push(s);
//    });
  }

  edit(value: string | undefined): void {
    if(value === undefined) {
      return;
    }
    let [section, option] = value.split(".");
    let config_file = new Config(configDir);
    let qs = config_file.getQuestions();
    let self = this;
    qs.forEach(async function(q: any) {
      if(q.name !== value)  return;
      console.log(q);
      let result = await vscode.window.showInputBox({ prompt: q.message, value: q.default });
      config_file.config[section][option] = result;
      config_file.saveConfig();
      self.refresh();
    });
  }

  refresh(): void {
    this.loadConfig();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeItem): vscode.TreeItem|Thenable<vscode.TreeItem> {
    return element;
  }
	
  getChildren(element?: TreeItem|undefined): vscode.ProviderResult<TreeItem[]> {
    if (element === undefined) {
      return this.data;
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
