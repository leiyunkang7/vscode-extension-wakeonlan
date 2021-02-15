import { window,  } from 'vscode';
import { ExtensionModule } from '../modules';
import { getWorkspaceRoot } from '../utils';
import { LANEquipmentProvider } from './LANEquipmentProvider';

export * from './LANEquipmentProvider';

const m: ExtensionModule = (ctx) => {
  console.log(ctx);
  console.log(LANEquipmentProvider.name);

  const lanEquipmentProvider = new LANEquipmentProvider(getWorkspaceRoot());

  window.createTreeView(LANEquipmentProvider.name, {
    treeDataProvider: lanEquipmentProvider,
  });
  

  return [];
};

export default m;
