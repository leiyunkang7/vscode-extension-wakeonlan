import * as vscode from 'vscode'
import * as wol from 'wakeonlan'
import * as path from 'path'
import { useLocalStorage } from '../use'
import { ref, Ref } from '@vue/reactivity'
import I18n from '../i18n'

export class LANFavoritesProvider implements vscode.TreeDataProvider<Favorite> {
  constructor() {
    this.favoriteList = useLocalStorage<Favorite[]>('favoriteList', [])
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    Favorite | undefined | void
  > = new vscode.EventEmitter<Favorite | undefined | void>()

  readonly onDidChangeTreeData: vscode.Event<Favorite | undefined | void> = this
    ._onDidChangeTreeData.event

  favoriteList: Ref<Favorite[]> = ref([])

  getTreeItem(element: Favorite): vscode.TreeItem {
    return element
  }

  getChildren(element?: Favorite): Favorite[] {
    if (element) {
      return []
    }

    return this.favoriteList.value
  }

  static add = 'LANFavoritesProvider.add'

  async add() {
    // this.favoriteList.value.push(item)
    const { ip, mac } = await showInputBox()

    if (ip && mac) {
      this.doAdd(ip, mac)
    }

  }

  doAdd(ip: string, mac:string) {
    this.favoriteList.value.push(new Favorite(ip, mac))
    this.refresh()
  }

  static refresh = 'LANFavoritesProvider.refresh'
  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  static remove = 'LANFavoritesProvider.remove'

  remove(item: Favorite) {
    const index = this.favoriteList.value.findIndex(
      ({ description }) => item.description === description
    )
    this.favoriteList.value.splice(index, 1)
    this.refresh()
  }

  static wake = 'LANFavoritesProvider.wake'

  wake(equipment: Favorite) {
    wol(equipment.description).then(() => {
      vscode.window.showInformationMessage(`${equipment.label} ${I18n.t('message.WakeSuccess')}`)
    })
  }
}

export class Favorite extends vscode.TreeItem {
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


/**
 * Shows an input box using window.showInputBox().
 */
export async function showInputBox() {
	const ip = await vscode.window.showInputBox({
		value: '',
		// valueSelection: [2, 4],
		placeHolder: I18n.t('message.PleaseEnterDeviceName'),
		validateInput: text => {
			// vscode.window.showInformationMessage(`Validating: ${text}`)
			return !text ? I18n.t('message.NotNull') : null;
		}
  });

  let mac
  
  if (ip) {
    // vscode.window.showInformationMessage(`Got: ${result}`)
    mac = await vscode.window.showInputBox({
      value: '',
      // valueSelection: [2, 4],
      placeHolder: I18n.t('message.PleaseEnterMACAddress'),
      validateInput: (text) => {
        // vscode.window.showInformationMessage(`Validating: ${text}`)
        return !text ? I18n.t('message.NotNull') : null
      },
    })
  }
    
  return {ip , mac}
}
