<script setup lang="tsx">
// @ts-ignore
// @ts-nocheck
import { useMonacoEditor } from '@/hooks/web/useMonacoEditor'
import { onMounted, computed, watch, ref } from 'vue'
import { ElSelect, ElOption, ElFormItem, ElForm } from 'element-plus'
import { languageOptions, themeOptions } from './config/config'

const props = withDefaults(
  defineProps<{
    width?: string | number
    height?: string | number
    languageSelector?: boolean
    language?: string
    themeSelector?: boolean
    theme?: string
    editorOption?: object
    modelValue: string
    readOnly?: boolean // 是否只读 取值 true | false
    wordWrap?: string // 开启自动换行 取值 off | on
  }>(),
  {
    width: '100%',
    height: '100%',
    languageSelector: true,
    language: 'javascript',
    themeSelector: true,
    theme: 'vs-dark',
    editorOption: () => ({}),
    modelValue: '',
    readOnly: false, // 是否只读 取值 true | false
    wordWrap: 'off' // 开启自动换行
  }
)

const emits = defineEmits<{
  (e: 'blur'): void
  (e: 'update:modelValue', val: string): void
}>()

const monacoEditorStyle = computed(() => {
  return {
    width: typeof props.width === 'string' ? props.width : props.width + 'px',
    height: typeof props.height === 'string' ? props.height : props.height + 'px'
  }
})

const {
  monacoEditorRef,
  createEditor,
  updateVal,
  updateOptions,
  getEditor,
  changeLanguage,
  changeTheme
} = useMonacoEditor(props.language)

const editorFailed = ref(false)

const handleFallbackInput = (event: Event) => {
  emits('update:modelValue', (event.target as HTMLTextAreaElement).value)
}

onMounted(() => {
  try {
    const monacoEditor = createEditor(props)
    if (!monacoEditor) throw new Error('Monaco editor instance was not created')
    updateMonacoVal(props.modelValue)
    monacoEditor.onDidChangeModelContent(() => {
      emits('update:modelValue', monacoEditor.getValue())
    })
    monacoEditor.onDidBlurEditorText(() => {
      emits('blur')
    })
  } catch (e: any) {
    // 旧版 WebKit 上 Monaco 可能因缺少运行时 API 而初始化失败；
    // 降级为纯文本编辑器，保证配置内容始终可见可编辑，同时把现场信息写入日志。
    editorFailed.value = true
    console.error('[CodeEditor] Monaco 初始化失败，已降级为纯文本编辑器:', e, {
      ua: navigator.userAgent,
      hasArrayAt: typeof Array.prototype.at,
      hasFindLast: typeof Array.prototype.findLast,
      hasObjectHasOwn: typeof Object.hasOwn,
      containerHeight: (monacoEditorRef.value as HTMLElement | undefined)?.clientHeight
    })
  }
})

watch(
  () => props.modelValue,
  () => {
    if (!editorFailed.value) updateMonacoVal(props.modelValue)
  }
)

const localLanguage = ref(props.language)

watch(localLanguage, (newLanguage) => {
  changeLanguage(newLanguage)
})

const localTheme = ref(props.theme)
watch(localTheme, (newTheme) => {
  changeTheme(newTheme)
})

function updateMonacoVal(val: string) {
  if (val !== getEditor()?.getValue()) {
    updateVal(val)
  }
}

defineExpose({ updateOptions })
</script>

<template>
  <ElForm :inline="true">
    <ElFormItem v-if="languageSelector" label="language" class="w-30% mb-5px!">
      <ElSelect
        v-model="localLanguage"
        placeholder="Please select language"
        size="small"
        filterable
      >
        <ElOption
          v-for="item in languageOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </ElSelect>
    </ElFormItem>
    <ElFormItem v-if="themeSelector" label="theme" class="w-30% mb-5px!">
      <ElSelect v-model="localTheme" placeholder="Please select language" size="small" filterable>
        <ElOption
          v-for="item in themeOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </ElSelect>
    </ElFormItem>
  </ElForm>
  <textarea
    v-if="editorFailed"
    class="code-editor-fallback"
    :value="modelValue"
    spellcheck="false"
    :style="monacoEditorStyle"
    @input="handleFallbackInput"
    @blur="emits('blur')"
  />
  <div v-else ref="monacoEditorRef" :style="monacoEditorStyle"></div>
</template>

<style scoped>
.code-editor-fallback {
  padding: 10px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.5;
  color: #d4d4d4;
  background: #1e1e1e;
  border: none;
  outline: none;
  box-sizing: border-box;
  resize: none;
}
</style>
