import { window,  } from 'vscode';
import { ExtensionModule } from '../modules';
// import { getWorkspaceRoot } from '../utils';
import { LANEquipmentProvider } from './LANEquipmentProvider';

export * from './LANEquipmentProvider';

const m: ExtensionModule = (ctx) => {

  const lanEquipmentProvider = new LANEquipmentProvider(ctx);

  window.createTreeView(LANEquipmentProvider.name, {
    treeDataProvider: lanEquipmentProvider,
  });
  

  return [];
};

export default m;
