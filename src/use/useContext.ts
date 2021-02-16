import * as vscode from 'vscode';
import { Ref} from '@vue/reactivity';

export let context: Ref<vscode.ExtensionContext>; 

export function setContext(ctx: vscode.ExtensionContext) {
  context.value = ctx;
}

export function useContext() {
  return {
    context
  };
}