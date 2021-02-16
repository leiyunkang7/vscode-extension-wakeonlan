import * as vscode from 'vscode'
import { ref, Ref } from '@vue/reactivity'

export let context: Ref<vscode.ExtensionContext> = ref() as any

export function setContext(ctx: vscode.ExtensionContext) {
  context.value = ctx
}

export function useContext() {
  return {
    context
  }
}
