import * as vscode from 'vscode';
import Signing from '@metaverse-systems/the-seed/dist/Signing';
import Config from '@metaverse-systems/the-seed/dist/Config';
import Scopes from '@metaverse-systems/the-seed/dist/Scopes';

/**
 * Chooses the scope a signing command works on.
 * With no scopes it offers to add one; with one scope it returns that scope;
 * with several it asks the user to pick.
 * @param signing the signing object of the caller (kept so callers share one entry point)
 * @param purpose what the scope is for, completing "Which scope should be used to ...?"
 * @returns the chosen scope, or undefined when there is none or the pick was dismissed
 */
export async function chooseScope(signing: Signing, purpose: string): Promise<string | undefined> {
  void signing;
  const config = new Config();
  config.loadConfig();
  const scopes = new Scopes(config).getScopes();

  if (scopes.length === 0) {
    const action = await vscode.window.showErrorMessage(
      `No scopes are configured. Add one to ${purpose}.`,
      'Add Scope'
    );
    if (action === 'Add Scope') {
      await vscode.commands.executeCommand('the-seed.addScope');
    }
    return undefined;
  }

  if (scopes.length === 1) {
    return scopes[0];
  }

  return vscode.window.showQuickPick(scopes, {
    placeHolder: `Which scope should be used to ${purpose}?`,
  });
}
