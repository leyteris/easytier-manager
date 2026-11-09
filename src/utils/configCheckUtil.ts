import { invoke } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { error, warn } from '@tauri-apps/plugin-log'
import { getConfigDir, getCoreDir } from './fileUtil'
import { exists, readTextFile, writeTextFile, rename, remove } from '@tauri-apps/plugin-fs'
import * as toml from 'smol-toml'
import { adaptConfigForCore, coreProcessArgs } from './coreConfigCompat'

/** 内核配置校验结果。 */
export interface ConfigCheckResult {
  valid: boolean
  message?: string
}

/**
 * 调用 easytier-core --check-config 校验配置文件。
 * 根据退出码识别语法、未知字段和语义错误。
 * @param configFileName 配置文件名（如 server.toml）
 * @returns valid 为 true 表示校验通过
 */
export async function checkConfigFile(configFileName: string): Promise<ConfigCheckResult> {
  try {
    const configPath = await join(await getConfigDir(), configFileName)
    const program = await getCoreDir()
    const config = toml.parse(await readTextFile(configPath))
    const res = await invoke<{ code: number; stdout: string; stderr: string }>('check_config', {
      program,
      configPath,
      processArgs: coreProcessArgs(config)
    })
    if (res.code === 0) {
      return { valid: true }
    }
    const detail = (res.stderr || res.stdout || '').trim()
    // 内核诊断可能包含配置中的密钥行，只把详细信息返回界面，不写入日志。
    warn(`配置校验失败(${configFileName}): exit ${res.code}`)
    return {
      valid: false,
      message: detail || `easytier-core --check-config 退出码 ${res.code}`
    }
  } catch (e: any) {
    error(`配置校验执行异常:${JSON.stringify(e)}`)
    return { valid: false, message: String(e) }
  }
}

/** 读取实际安装内核的帮助，避免仅依赖可能重复的开发版版本号。 */
export async function getCoreHelp(): Promise<string> {
  const result = await invoke<{ code: number; stdout: string; stderr: string }>('check_config', {
    program: await getCoreDir(),
    configPath: null
  })
  if (result.code !== 0 || !result.stdout.includes('--config-file')) {
    throw new Error('无法读取当前内核能力，请先在设置中安装或检测内核。')
  }
  return result.stdout
}

/** 先校验临时副本，再备份并替换正式配置；失败时原文件保持不变。 */
export async function saveCompatibleConfig(fileName: string, content: string): Promise<void> {
  const help = await getCoreHelp()
  const parsed = toml.parse(content)
  const adapted = adaptConfigForCore(parsed, help)
  const output =
    JSON.stringify(parsed) === JSON.stringify(adapted) ? content : toml.stringify(adapted)
  const directory = await getConfigDir()
  const path = await join(directory, fileName)
  const temporaryName = `.${fileName}.${crypto.randomUUID()}.tmp`
  const temporary = await join(directory, temporaryName)
  try {
    await writeTextFile(temporary, output)
    if (help.includes('--check-config')) {
      const result = await checkConfigFile(temporaryName)
      if (!result.valid) throw new Error(`配置校验失败，原文件未修改：${result.message}`)
    }
    // 老内核没有校验命令时仍保留 TOML 语法检查和能力检查，不阻断旧版本保存。
    if (await exists(path)) {
      await writeTextFile(`${path}.${Date.now()}.bak`, await readTextFile(path))
    }
    await rename(temporary, path)
  } finally {
    if (await exists(temporary)) await remove(temporary)
  }
}

/** 启动或安装服务前适配历史字段并备份原件，无法无损迁移时阻止启动。 */
export async function prepareConfigForRun(fileName: string): Promise<ConfigCheckResult> {
  try {
    const help = await getCoreHelp()
    const path = await join(await getConfigDir(), fileName)
    const content = await readTextFile(path)
    const parsed = toml.parse(content)
    const adapted = adaptConfigForCore(parsed, help)
    if (JSON.stringify(parsed) !== JSON.stringify(adapted)) {
      await saveCompatibleConfig(fileName, content)
      return { valid: true }
    }
    // 旧内核没有校验命令时，保留语法与能力校验，不调用不支持的参数。
    return help.includes('--check-config') ? await checkConfigFile(fileName) : { valid: true }
  } catch (error) {
    return { valid: false, message: error instanceof Error ? error.message : String(error) }
  }
}
