import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as toml from 'smol-toml'
import {
  adaptConfigForCore,
  coreProcessArgs,
  hasCoreOption,
  normalizeCoreConfig
} from './coreConfigCompat'
import { arrangeNavigation } from './navigation'

const modernHelp =
  '--config-file <FILE> --dhcp <BOOL|CIDR> --dhcpv6 <CIDR> --tcp-stun-servers <HOST> --vpn-portal-client <CLIENT> --secure-mode <BOOL> --ipv6-public-addr-auto <BOOL> --disable-relay-data <BOOL> --prefer-peer-relay <BOOL> --socket-mark <MARK> Lzo'
const oldHelp = '--config-file <FILE> --dhcp <BOOL> --vpn-portal <URL>'
const original = {
  instance_name: 'compat-test',
  custom_section: { preserved: 123 },
  flags: { no_listener: true, secure_mode: true, ipv6_public_addr_auto: true },
  local_private_key: 'example-not-a-real-key',
  peer: [{ uri: 'tcp://localhost:11010', peer_public_key: 'preserve' }],
  proxy_network: [{ cidr: '10.0.0.0/24', mapped_cidr: '10.1.0.0/24', allow: ['x'] }],
  file_logger: { size: 17, count: 3 }
}
const snapshot = structuredClone(original)
const normalized = normalizeCoreConfig(original)
assert.deepEqual(original, snapshot)
assert.deepEqual(normalized.listeners, [])
assert.equal(normalized.secure_mode.local_private_key, original.local_private_key)
assert.equal(normalized.ipv6_public_addr_auto, true)
assert.deepEqual(normalized.peer, original.peer)
assert.deepEqual(normalized.proxy_network, original.proxy_network)
assert.deepEqual(normalized.file_logger, original.file_logger)
assert.deepEqual(normalized.custom_section, original.custom_section)
assert.equal(normalized.flags.no_listener, undefined)
assert.deepEqual(normalizeCoreConfig(normalized), normalized)

const legacyPortal = {
  vpn_portal_config: { client_cidr: '10.14.14.0/24', wireguard_listen: '0.0.0.0:51820' }
}
assert.deepEqual(adaptConfigForCore(legacyPortal, oldHelp), legacyPortal)
assert.throws(() => adaptConfigForCore(legacyPortal, modernHelp), /不能自动转换/)
assert.throws(() => adaptConfigForCore({ dhcpv6: true }, oldHelp), /不支持/)
assert.throws(() => adaptConfigForCore({ flags: { data_compress_algo: 3 } }, oldHelp), /LZO/)
assert.throws(() => adaptConfigForCore({ dhcp: '10.1.0.0/24' }, oldHelp), /DHCP/)
assert.throws(
  () => adaptConfigForCore({ dhcp: '10.1.0.0/24' }, '--dhcp <BOOL> --dhcpv6 <CIDR>'),
  /DHCP/
)
assert.equal(hasCoreOption('--vpn-portal-client-group <GROUP>', 'vpn-portal-client'), false)
assert.equal(hasCoreOption('--shared-runtime', 'shared-runtime'), true)
assert.deepEqual(adaptConfigForCore({ dhcp: true }, oldHelp), { dhcp: true })
assert.deepEqual(adaptConfigForCore({ flags: { prefer_peer_relay: '' }, dhcpv6: '' }, oldHelp), {
  flags: {}
})
assert.deepEqual(adaptConfigForCore({ listeners: [], stun_servers: [] }, modernHelp), {
  listeners: [],
  stun_servers: []
})
assert.deepEqual(
  coreProcessArgs({
    manager_runtime: { shared_runtime: true, state_dir: 'C:\\state dir' },
    flags: { multi_thread_count: 1 },
    console_logger: { level: 'error' }
  }),
  [
    '--shared-runtime',
    '--multi-thread-count',
    '1',
    '--state-dir',
    'C:\\state dir',
    '--console-log-level',
    'error'
  ]
)

const routes = ['/', '/overview', '/instance', '/config', '/configWeb', '/setting'].map((path) => ({
  path
}))
assert.deepEqual(
  arrangeNavigation(routes, {
    order: ['/setting', '/instance', '/instance', '/missing'],
    hidden: ['/', '/config', '/setting', '/overview']
  }).map((r) => r.path),
  ['/', '/config', '/instance', '/configWeb', '/setting']
)
assert.deepEqual(
  arrangeNavigation(routes, { order: [], hidden: [] }).map((r) => r.path),
  ['/', '/config', '/overview', '/instance', '/configWeb', '/setting']
)
assert.equal(
  arrangeNavigation([{ path: '/configWeb', meta: { hidden: true } }], {
    order: ['/configWeb'],
    hidden: []
  }).length,
  0
)
assert.deepEqual(
  routes.map((r) => r.path),
  ['/', '/overview', '/instance', '/config', '/configWeb', '/setting']
)

// 指定二进制时用实际内核校验适配输出，临时目录不接触用户配置。
if (process.argv[2]) {
  const binary = resolve(process.argv[2])
  const help = execFileSync(binary, ['--help'], { encoding: 'utf8' })
  const directory = mkdtempSync(join(tmpdir(), 'easytier-compat-'))
  try {
    const fixtures = [
      { instance_name: 'test', flags: { disable_ipv6: true, compression_algorithm: 'zstd' } },
      { instance_name: 'test', dhcp: true, flags: { no_listener: true } },
      {
        instance_name: 'test',
        dhcp: '10.126.126.0/24',
        dhcpv6: 'fd6b:8c2d:91e4::/64',
        tcp_stun_servers: [],
        flags: { data_compress_algo: 3, prefer_peer_relay: true, disable_relay_data: true }
      },
      { instance_name: 'test', flags: { ipv6_public_addr_auto: true, secure_mode: false } },
      {
        instance_name: 'test',
        manager_runtime: { shared_runtime: true },
        flags: { multi_thread_count: 1 }
      },
      {
        instance_name: 'test',
        vpn_portal_config: {
          wireguard_listen: '0.0.0.0:51820',
          clients: [{ name: 'client', virtual_ip: '10.144.144.5/24', groups: [] }]
        }
      }
    ]
    fixtures.forEach((fixture, index) => {
      const path = join(directory, `${index}.toml`)
      const adapted = adaptConfigForCore(fixture, help)
      writeFileSync(path, toml.stringify(adapted))
      const result = spawnSync(
        binary,
        ['--disable-env-parsing', '--check-config', '-c', path, ...coreProcessArgs(adapted)],
        { encoding: 'utf8' }
      )
      assert.equal(result.status, 0, `fixture ${index}: ${result.stderr}`)
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
console.log('配置兼容、未知字段保留、菜单约束测试通过')
