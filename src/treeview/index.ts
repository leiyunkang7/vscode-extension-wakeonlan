import { window  } from 'vscode';
import { ExtensionModule } from '../modules';
// import { getWorkspaceRoot } from '../utils';
import { Equipment, LANEquipmentProvider } from './LANEquipmentProvider';
import { Favorite, LANFavoritesProvider } from './LANFavoritesProvider'
import * as vscode from 'vscode'

export * from './LANEquipmentProvider';

const m: ExtensionModule = (ctx) => {

  const lanEquipmentProvider = new LANEquipmentProvider(ctx);

  const lanFavoritesProvider = new LANFavoritesProvider()

  window.createTreeView(LANEquipmentProvider.name, {
    treeDataProvider: lanEquipmentProvider,
  });

  window.createTreeView(LANFavoritesProvider.name, {
    treeDataProvider: lanFavoritesProvider
  })
  

  return [
    vscode.commands.registerCommand(LANEquipmentProvider.refreshEntry, () =>
      lanEquipmentProvider.refresh()
    ),

    vscode.commands.registerCommand(
      LANEquipmentProvider.wakeEntry,
      (equipment: Equipment) => lanEquipmentProvider.wake(equipment)
    ),

    vscode.commands.registerCommand(LANFavoritesProvider.add, () =>
      lanFavoritesProvider.add()
    ),

    vscode.commands.registerCommand(
      LANFavoritesProvider.remove,
      (item: Favorite) => lanFavoritesProvider.remove(item)
    ),

    vscode.commands.registerCommand(LANFavoritesProvider.refresh, () =>
      lanFavoritesProvider.refresh()
    ),

    vscode.commands.registerCommand(
      LANFavoritesProvider.wake,
      (item: Favorite) => lanFavoritesProvider.wake(item)
    ),
  ]
};

export default m;
