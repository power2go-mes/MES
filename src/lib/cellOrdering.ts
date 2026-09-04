import type { CellItem, ModuleItem } from '../types';

export const sortCellsForWorkflow = (cells: CellItem[], modules: ModuleItem[]) => {
  const moduleOrder = new Map((modules || []).map((module) => [module.id, module.moduleIndex ?? 0]));

  return [...cells].sort((a, b) => {
    const aModuleIndex = moduleOrder.get(a.assignedToModuleId || '') ?? Number.MAX_SAFE_INTEGER;
    const bModuleIndex = moduleOrder.get(b.assignedToModuleId || '') ?? Number.MAX_SAFE_INTEGER;

    if (aModuleIndex !== bModuleIndex) {
      return aModuleIndex - bModuleIndex;
    }

    return (a.moduleSlotIndex ?? 0) - (b.moduleSlotIndex ?? 0);
  });
};
