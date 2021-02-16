import * as vscode from 'vscode'
import * as wol from 'wakeonlan'
import * as path from 'path'
import { useLocalStorage } from '../use'
import { ref, Ref } from '@vue/reactivity'

export class LANFavoritesProvider implements vscode.TreeDataProvider<Favorite> {
  constructor() {
    vscode.commands.registerCommand(
      LANFavoritesProvider.add,
      (item: Favorite) => this.add(item)
    )
    this.favoriteList = useLocalStorage<Favorite[]>('favoriteList', [])
  }
  onDidChangeTreeData?:
    | vscode.Event<void | Favorite | null | undefined>
    | undefined

  favoriteList: Ref<Favorite[]> = ref([])

  getTreeItem(element: Favorite): vscode.TreeItem {
    return element
  }

  async getChildren(element?: Favorite): Promise<Favorite[]> {
    if (element) {
      return []
    }

    return this.favoriteList.value
  }

  static add = 'LANFavoritesProvider.add'

  add(item: Favorite) {}

  wake(equipment: Favorite) {
    wol(equipment.description).then(() => {
      vscode.window.showInformationMessage(`${equipment.label} 唤醒成功`)
    })
  }
}

class Favorite extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = 0
  ) {
    super(label, collapsibleState)
    this.tooltip = `${this.label} ${this.description}`
  }

  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', 'light', 'add.svg'),
    dark: path.join(__filename, '..', '..', 'resources', 'dark', 'add.svg'),
  }

  contextValue = 'favorite'
}
