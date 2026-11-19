// 夜间快照切换：先构建候选槽，严格校验通过后才接管主槽；旧槽保留供回退。
import type { KnowledgeCatalog } from "../knowledge/catalog.js";

export interface NightlySnapshotOutcome {
  promoted: boolean;
  version: string;
  errors: number;
}

/** 任一解析/标签错误都拒绝切换，避免把不完整知识库推给问答 */
export const runNightlySnapshot = async (
  catalog: KnowledgeCatalog,
): Promise<NightlySnapshotOutcome> => {
  const activeVersion = catalog.slots().active.version;
  const staged = await catalog.stage();
  if (staged.errors.length > 0) throw new Error("snapshot_validation_failed");
  if (staged.version === activeVersion) {
    return { promoted: false, version: staged.version, errors: 0 };
  }
  const info = catalog.promote();
  return { promoted: true, version: info.active.version, errors: 0 };
};
