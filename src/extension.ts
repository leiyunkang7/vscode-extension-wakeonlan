// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'
import viewsModules from './treeview'
import { flatten } from 'lodash'
import { setContext } from './use'
import I18n from './i18n'

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated

  setContext(context)

  I18n.init(context.extensionPath)

  const modules = [viewsModules]
  const disposables = flatten(modules.map((m) => m(context)))
  context.subscriptions.push(...disposables)
}

// this method is called when your extension is deactivated
export function deactivate() {}
