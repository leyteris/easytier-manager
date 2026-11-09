/** 恢复同版界面偏好；升级后沿用新版默认布局，仅保留明确的个人偏好。 */
export function restoreUiState(serialized: string, version: string): Record<string, unknown> {
  const saved = JSON.parse(serialized)
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { uiVersion: version }
  if (saved.uiVersion === version) return saved

  // 旧版整份状态含布局、主题色和功能开关，不能覆盖新版 UI 默认定义。
  const migrated: Record<string, unknown> = { uiVersion: version }
  if (typeof saved.isDark === 'boolean') migrated.isDark = saved.isDark
  if (['default', 'large', 'small'].includes(saved.currentSize)) {
    migrated.currentSize = saved.currentSize
  }
  if (saved.navigation && typeof saved.navigation === 'object') {
    migrated.navigation = {
      order: Array.isArray(saved.navigation.order)
        ? saved.navigation.order.filter((path: unknown) => typeof path === 'string')
        : [],
      hidden: Array.isArray(saved.navigation.hidden)
        ? saved.navigation.hidden.filter((path: unknown) => typeof path === 'string')
        : []
    }
  }
  return migrated
}
