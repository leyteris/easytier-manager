/** 菜单个性化只保存稳定路径，不保存路由组件或翻译后的标题。 */
export interface NavigationPreferences {
  order: string[]
  hidden: string[]
}

export const fixedMenuPaths = ['/', '/config', '/setting']

/** 合并新菜单并校正重复、失效及固定菜单偏好，平台隐藏规则优先。 */
export function arrangeNavigation<T extends { path: string; meta?: { hidden?: boolean } }>(
  routes: T[],
  preferences: NavigationPreferences,
  includeHidden = false
): T[] {
  const available = routes.filter((route) => !route.meta?.hidden)
  const optional = available.filter((route) => !fixedMenuPaths.includes(route.path))
  const order = Array.isArray(preferences?.order) ? preferences.order : []
  const hidden = Array.isArray(preferences?.hidden) ? preferences.hidden : []
  const paths = [...new Set([...order, ...optional.map((route) => route.path)])]
  const middle = paths.flatMap((path) => {
    const route = optional.find((item) => item.path === path)
    return route && (includeHidden || !hidden.includes(path)) ? [route] : []
  })
  return [
    ...['/', '/config'].flatMap((path) => available.filter((route) => route.path === path)),
    ...middle,
    ...available.filter((route) => route.path === '/setting')
  ]
}
