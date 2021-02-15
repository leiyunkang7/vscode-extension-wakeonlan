import * as vscode from 'vscode';

export function getWorkspaceRoot() {
  const { workspaceFolders = [] } = vscode.workspace;
  let rootUrl = '';
  if (workspaceFolders.length) {
    rootUrl = fixDriveCasingInWindows(workspaceFolders[0].uri.fsPath);
  }

  return rootUrl;
}


export function fixDriveCasingInWindows(pathToFix: string): string {
  return process.platform === 'win32' && pathToFix
    ? pathToFix.substr(0, 1).toUpperCase() + pathToFix.substr(1)
    : pathToFix;
}