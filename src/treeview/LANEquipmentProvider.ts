import * as vscode from 'vscode';
import * as path from 'path';
import * as find from 'local-devices';

export class LANEquipmentProvider implements vscode.TreeDataProvider<Equipment> {
  static refreshEntry = 'LANEquipmentProvider.refreshEntry';

  static wakeEntry = 'LANEquipmentProvider.wakeEntry';

  constructor(private workspaceRoot: string) {
    vscode.commands.registerCommand(LANEquipmentProvider.refreshEntry, () =>
      this.refresh()
    );

    vscode.commands.registerCommand(
      LANEquipmentProvider.wakeEntry,
      (equipment: Equipment) => this.wake(equipment)
    );
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    Equipment | undefined | void
  > = new vscode.EventEmitter<Equipment | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<
    Equipment | undefined | void
  > = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Equipment): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Equipment): Promise<Equipment[]> {
    if (element) {
      return [];
    }

    const equipmentList = await find();

    return equipmentList.map((item) => new Equipment(item.ip, item.mac));
  }

  wake(equipment: Equipment) {
    vscode.window.showInformationMessage(equipment.label);
  }
}

class Equipment extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = 0
  ) {
    super(label, collapsibleState);
    this.tooltip = `${this.label} ${this.description}`;
  }

  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', 'light', 'add.svg'),
    dark: path.join(__filename, '..', '..', 'resources', 'dark', 'add.svg'),
  };

  contextValue = 'equipment';
}
