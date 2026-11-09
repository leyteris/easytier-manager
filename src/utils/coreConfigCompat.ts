/** 保留未知扩展字段的内核配置对象，兼容历代 TOML 结构。 */
export type CoreConfig = Record<string, any>

/** 完整匹配帮助中的选项名称，避免误认同前缀的其他选项。 */
export function hasCoreOption(help: string, option: string): boolean {
  return new RegExp(`--${option}(?=[\\s=<\\[]|$)`).test(help)
}

/** 将旧界面字段转换为内核的标准结构，不修改输入及未知字段。 */
export function normalizeCoreConfig(input: CoreConfig): CoreConfig {
  const config = structuredClone(input)
  const flags = config.flags
  if (flags) {
    for (const key of [
      'ipv6_public_addr_provider',
      'ipv6_public_addr_auto',
      'ipv6_public_addr_prefix'
    ]) {
      if (flags[key] !== undefined && config[key] === undefined) config[key] = flags[key]
      delete flags[key]
    }
    if (flags.secure_mode !== undefined && config.secure_mode === undefined) {
      config.secure_mode = { enabled: flags.secure_mode }
    }
    delete flags.secure_mode
    // 不监听必须保留显式空数组；省略 listeners 会重新启用默认监听。
    if (flags.no_listener === true) config.listeners = []
    delete flags.no_listener
    if (flags.disable_ipv6 !== undefined) flags.enable_ipv6 = !flags.disable_ipv6
    delete flags.disable_ipv6
    if (flags.compression_algorithm !== undefined && flags.data_compress_algo === undefined) {
      flags.data_compress_algo = flags.compression_algorithm
    }
    delete flags.compression_algorithm
    // 旧界面使用小写名称，新内核枚举区分大小写；统一为已有表单使用的枚举数值。
    if (typeof flags.data_compress_algo === 'string') {
      const algorithms: Record<string, number> = { none: 1, zstd: 2, lzo: 3 }
      flags.data_compress_algo =
        algorithms[flags.data_compress_algo.toLowerCase()] ?? flags.data_compress_algo
    }
    if (flags.socks5 && config.socks5_proxy === undefined) config.socks5_proxy = flags.socks5
    delete flags.socks5
    if (
      flags.foreign_network_whitelist !== undefined &&
      flags.relay_network_whitelist === undefined
    ) {
      flags.relay_network_whitelist = flags.foreign_network_whitelist
    }
    delete flags.foreign_network_whitelist
    if (flags.ipv6_listener === '') delete flags.ipv6_listener
  }
  for (const key of ['local_private_key', 'local_public_key']) {
    if (config[key]) {
      config.secure_mode ??= {}
      config.secure_mode[key] ??= config[key]
    }
    delete config[key]
  }
  if (config.stun_server !== undefined && config.stun_servers === undefined) {
    config.stun_servers = config.stun_server
  }
  delete config.stun_server
  if (config.credential) {
    config.secure_mode ??= {}
    if (
      config.secure_mode.local_private_key &&
      config.secure_mode.local_private_key !== config.credential
    ) {
      throw new Error('入网凭据与安全模式私钥不一致，请明确选择使用的身份。')
    }
    config.secure_mode.enabled = true
    config.secure_mode.local_private_key = config.credential
    delete config.credential
  }
  return config
}

/** 构建进程级参数，集中供工作台、官方服务和 NSSM 使用，避免写成无效实例开关。 */
export function coreProcessArgs(config: CoreConfig): string[] {
  const args: string[] = []
  const runtime = config.manager_runtime
  if (runtime?.shared_runtime) {
    args.push('--shared-runtime')
    if (config.flags?.multi_thread_count !== undefined) {
      args.push('--multi-thread-count', String(config.flags.multi_thread_count))
    }
  }
  if (runtime?.state_dir) args.push('--state-dir', runtime.state_dir)
  if (config.credential_file) args.push('--credential-file', config.credential_file)
  if (config.console_logger?.level) args.push('--console-log-level', config.console_logger.level)
  return args
}

/** 根据实际帮助选项适配配置，拒绝无损转换不了的功能，交给内核做最终校验。 */
export function adaptConfigForCore(input: CoreConfig, help: string): CoreConfig {
  const config = normalizeCoreConfig(input)
  // 选项必须完整匹配，避免把 --vpn-portal-client-group 当作 --vpn-portal-client。
  const supported = (option: string) => hasCoreOption(help, option)
  if (
    config.secure_mode &&
    Object.values(config.secure_mode).every((value) => value === undefined || value === '')
  ) {
    delete config.secure_mode
  }
  if (
    !supported('secure-mode') &&
    config.secure_mode?.enabled === false &&
    Object.keys(config.secure_mode).every((key) => key === 'enabled')
  ) {
    delete config.secure_mode
  }
  for (const key of ['dhcpv6', 'tcp_stun_servers']) {
    if (config[key] === '' || config[key] === null) delete config[key]
  }
  for (const key of ['prefer_peer_relay', 'disable_relay_data', 'socket_mark']) {
    if (config.flags?.[key] === '' || config.flags?.[key] === null) delete config.flags[key]
  }
  const requirements: [string, unknown, string][] = [
    ['dhcpv6', config.dhcpv6, 'IPv6 DHCP'],
    ['tcp-stun-servers', config.tcp_stun_servers, 'TCP STUN'],
    ['socket-mark', config.flags?.socket_mark, 'Socket mark'],
    ['prefer-peer-relay', config.flags?.prefer_peer_relay, '优先对等节点中继'],
    ['disable-relay-data', config.flags?.disable_relay_data, '禁止数据中继'],
    ['secure-mode', config.secure_mode, '安全模式'],
    ['ipv6-public-addr-provider', config.ipv6_public_addr_provider, 'IPv6 公网子网共享'],
    ['ipv6-public-addr-auto', config.ipv6_public_addr_auto, 'IPv6 公网地址自动分配'],
    ['ipv6-public-addr-prefix', config.ipv6_public_addr_prefix, 'IPv6 公网前缀'],
    ['shared-runtime', config.manager_runtime?.shared_runtime || undefined, '共享运行时'],
    ['state-dir', config.manager_runtime?.state_dir || undefined, '状态目录'],
    ['credential-file', config.credential_file || undefined, '凭据文件']
  ]
  for (const [option, value, label] of requirements) {
    if (value !== undefined && !supported(option)) {
      throw new Error(`当前内核不支持${label}，请升级内核或取消此项配置；原文件未修改。`)
    }
  }
  // 只检查 DHCP 自身的帮助段，不能借用 DHCPv6 或子网代理的 CIDR 说明。
  const dhcpHelp = help.match(/--dhcp(?=[\s=<\[])[\s\S]*?(?=\s--[a-z]|$)/)?.[0] ?? ''
  if (typeof config.dhcp === 'string' && !/(?:CIDR|subnet)/i.test(dhcpHelp)) {
    throw new Error('当前内核不支持 DHCP 地址段，请使用布尔开关或升级内核。')
  }
  const compression = config.flags?.data_compress_algo
  const threads = config.flags?.multi_thread_count
  const minimumThreads = config.manager_runtime?.shared_runtime ? 1 : 2
  if (
    threads !== undefined &&
    threads !== null &&
    (!Number.isInteger(threads) || threads < minimumThreads)
  ) {
    throw new Error(`当前运行模式的工作线程数必须为大于等于 ${minimumThreads} 的整数。`)
  }
  if ((compression === 3 || String(compression).toLowerCase() === 'lzo') && !/lzo/i.test(help)) {
    throw new Error('当前内核不支持 LZO 压缩。')
  }
  const portal = config.vpn_portal_config
  if (portal) {
    if (!portal.wireguard_listen && !portal.client_cidr && !portal.clients?.length) {
      delete config.vpn_portal_config
    } else if (supported('vpn-portal-client')) {
      if (portal.client_cidr) {
        throw new Error(
          '此内核不再支持 WireGuard 地址池。请在门户设置中填写具名客户端并切换为新版格式；旧地址池不能自动转换，原文件未修改。'
        )
      }
      delete portal.client_cidr
      if (portal.wireguard_private_key === '') delete portal.wireguard_private_key
      const names = new Set<string>()
      for (const client of portal.clients ?? []) {
        if (!client.name?.trim() || !client.virtual_ip?.trim() || names.has(client.name)) {
          throw new Error('WireGuard 客户端必须填写唯一名称及虚拟 IP / CIDR。')
        }
        names.add(client.name)
      }
    } else if (portal.clients !== undefined || portal.wireguard_private_key !== undefined) {
      throw new Error(
        '当前内核不支持新版 WireGuard 客户端配置，请使用支持该功能的内核；不会自动降级或删除客户端。'
      )
    }
  }
  return config
}
