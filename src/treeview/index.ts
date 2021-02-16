import { window,  } from 'vscode';
import { ExtensionModule } from '../modules';
// import { getWorkspaceRoot } from '../utils';
import { LANEquipmentProvider } from './LANEquipmentProvider';
import { LANFavoritesProvider } from './LANFavoritesProvider'

export * from './LANEquipmentProvider';

const m: ExtensionModule = (ctx) => {

  const lanEquipmentProvider = new LANEquipmentProvider(ctx);

  window.createTreeView(LANEquipmentProvider.name, {
    treeDataProvider: lanEquipmentProvider,
  });

  window.createTreeView(LANFavoritesProvider.name, {
    treeDataProvider: new LANFavoritesProvider(),
  })
  

  return [];
};

export default m;
