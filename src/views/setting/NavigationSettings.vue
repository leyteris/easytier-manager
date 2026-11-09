<script setup lang="ts">
import { computed } from 'vue'
import { constantRouterMap } from '@/router'
import { useAppStore } from '@/store/modules/app'
import { arrangeNavigation, fixedMenuPaths } from '@/utils/navigation'
import { useI18n } from '@/hooks/web/useI18n'

const { t } = useI18n()
const appStore = useAppStore()
const rows = computed(() => arrangeNavigation(constantRouterMap, appStore.navigation, true))
const optional = computed(() => rows.value.filter((route) => !fixedMenuPaths.includes(route.path)))

/** 只在可调整菜单之间移动，三个固定菜单不能跨区或被隐藏。 */
function move(path: string, direction: number) {
  const paths = optional.value.map((route) => route.path)
  const index = paths.indexOf(path)
  const target = index + direction
  if (index < 0 || target < 0 || target >= paths.length) return
  ;[paths[index], paths[target]] = [paths[target], paths[index]]
  appStore.navigation = { ...appStore.navigation, order: paths }
}

/** 更新可选菜单显示状态，隐藏入口不移除页面路由。 */
function setVisible(path: string, visible: boolean | string | number) {
  if (fixedMenuPaths.includes(path)) return
  const hidden = (appStore.navigation?.hidden ?? []).filter((item) => item !== path)
  if (!visible) hidden.push(path)
  appStore.navigation = { order: appStore.navigation?.order ?? [], hidden }
}

/** 恢复固定分区的默认顺序与全部可用菜单。 */
function reset() {
  appStore.navigation = { order: [], hidden: [] }
}
</script>

<template>
  <el-card class="mb-20px shadow-sm">
    <template #header><span class="font-600">导航菜单</span></template>
    <p class="mb-12px text-[var(--el-text-color-secondary)]">
      工作台、配置固定在顶部，设置固定在最后。其余菜单可排序或隐藏，修改立即保存。
    </p>
    <div
      v-for="row in rows"
      :key="row.path"
      class="flex flex-wrap items-center gap-12px py-10px border-b border-[var(--el-border-color-lighter)]"
    >
      <span class="flex-1 min-w-100px">{{
        t(row.meta?.title || row.children?.[0]?.meta?.title || '')
      }}</span>
      <el-tag v-if="fixedMenuPaths.includes(row.path)" type="info">固定菜单</el-tag>
      <template v-else>
        <el-switch
          :model-value="!appStore.navigation?.hidden?.includes(row.path)"
          :aria-label="`显示 ${t(row.meta?.title || row.children?.[0]?.meta?.title || '')}`"
          @change="setVisible(row.path, $event)"
        />
        <el-button
          size="small"
          :disabled="optional[0]?.path === row.path"
          @click="move(row.path, -1)"
          >上移</el-button
        >
        <el-button
          size="small"
          :disabled="optional[optional.length - 1]?.path === row.path"
          @click="move(row.path, 1)"
          >下移</el-button
        >
      </template>
    </div>
    <el-button class="mt-16px" @click="reset">恢复默认</el-button>
  </el-card>
</template>
