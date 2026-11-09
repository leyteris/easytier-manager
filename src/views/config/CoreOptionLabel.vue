<script setup lang="ts">
import { InfoFilled } from '@element-plus/icons-vue'

defineProps<{
  label: string
  description: string
  supported?: boolean
  unavailableReason?: string
  versionNote?: string
}>()
</script>

<template>
  <span>{{ label }}</span>
  <el-tooltip trigger="click" placement="top">
    <template #content>
      <div class="max-w-360px">
        <p>{{ description }}</p>
        <p>{{
          versionNote ||
          '支持依据：已在 EasyTier 2.7.0 开发构建（2026-11-07）验证，首次支持版本尚未确认。'
        }}</p>
        <p v-if="supported === false">{{
          unavailableReason || '当前内核帮助未声明支持此选项，暂不可编辑。'
        }}</p>
        <p v-else-if="supported === true">当前内核已声明支持，保存时仍会校验配置。</p>
      </div>
    </template>
    <el-icon class="ml-4px cursor-pointer" tabindex="0" :aria-label="`${label}说明`">
      <InfoFilled />
    </el-icon>
  </el-tooltip>
</template>
