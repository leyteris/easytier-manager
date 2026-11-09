import assert from 'node:assert/strict'
import { restoreUiState } from './uiState'

const previous = {
  layout: 'classic',
  theme: { leftMenuBgColor: 'obsolete' },
  tagsView: true,
  isDark: true,
  currentSize: 'small',
  navigation: { order: ['/instance'], hidden: ['/overview'] }
}
const migrated = restoreUiState(JSON.stringify(previous), '3.6.0:1')
assert.deepEqual(migrated, {
  uiVersion: '3.6.0:1',
  isDark: true,
  currentSize: 'small',
  navigation: previous.navigation
})
assert.equal(previous.layout, 'classic')
const current = { ...previous, uiVersion: '3.6.0:1' }
assert.deepEqual(restoreUiState(JSON.stringify(current), '3.6.0:1'), current)
assert.equal(restoreUiState(JSON.stringify(current), '3.7.0:1').layout, undefined)
assert.deepEqual(restoreUiState('null', '3.6.0:1'), { uiVersion: '3.6.0:1' })
assert.deepEqual(
  restoreUiState('{"navigation":{"order":[1,"/instance"],"hidden":null}}', '3.6.0:1'),
  {
    uiVersion: '3.6.0:1',
    navigation: { order: ['/instance'], hidden: [] }
  }
)
console.log('UI 状态迁移测试通过：升级恢复新版布局，同版保留偏好')
