<script setup lang="ts">
import { computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import { getOsType } from '@/utils/sysUtil'
import { hasCoreOption, type CoreConfig } from '@/utils/coreConfigCompat'
import CoreOptionLabel from './CoreOptionLabel.vue'

const config = defineModel<CoreConfig>('config', { required: true })
const props = defineProps<{
  section: 'addresses' | 'stun' | 'relay' | 'socket' | 'portal' | 'runtime' | 'state'
  help: string
  capabilityReason: string
}>()
const isLinux = getOsType() === 'linux'
const portal = computed(() => config.value.vpn_portal_config ?? {})

/** 单独编辑 IPv4 DHCP 地址段，留空表示自动分配，关闭开关时禁止修改。 */
const dhcpRange = computed({
  get: () => (typeof config.value.dhcp === 'string' ? config.value.dhcp : ''),
  set: (value: string) => {
    config.value.dhcp = value.trim() || true
  }
})

/** 仅在实际内核提供对应选项时允许新增配置。 */
const supports = (option: string) => hasCoreOption(props.help, option)
// DHCP 地址段需额外检查该选项自身的帮助，不能只检查旧版已有的 --dhcp。
const supportsDhcpRange = computed(() =>
  /(?:CIDR|subnet)/i.test(props.help.match(/--dhcp(?=[\s=<\[])[\s\S]*?(?=\s--[a-z]|$)/)?.[0] ?? '')
)

/** 保留旧地址池直到用户明确选择具名客户端格式，磁盘原件由保存流程备份。 */
async function addClient() {
  if (!supports('vpn-portal-client')) return
  if (portal.value.client_cidr) {
    try {
      await ElMessageBox.confirm(
        `旧地址池 ${portal.value.client_cidr} 无法自动转换。切换后请手动填写每个客户端；保存时将备份原文件。`,
        '切换 WireGuard 门户格式',
        { type: 'warning', confirmButtonText: '切换并添加客户端' }
      )
    } catch {
      return
    }
  }
  config.value.vpn_portal_config ??= {}
  delete config.value.vpn_portal_config.client_cidr
  config.value.vpn_portal_config.clients ??= []
  config.value.vpn_portal_config.clients.push({ name: '', virtual_ip: '', groups: [] })
}

/** 仅删除当前编辑草稿中的指定客户端。 */
function removeClient(index: string | number) {
  if (!supports('vpn-portal-client')) return
  portal.value.clients.splice(Number(index), 1)
}
</script>

<template>
  <el-row v-if="section === 'addresses'">
    <el-col :xs="24" :sm="12">
      <el-form-item>
        <template #label
          ><CoreOptionLabel
            label="IPv4 DHCP 地址段"
            description="启用自动获取虚拟 IP 后，可限制 IPv4 自动分配地址段；留空自动分配。"
            :supported="supportsDhcpRange"
            :unavailable-reason="capabilityReason"
        /></template>
        <el-input
          v-model="dhcpRange"
          :disabled="!config.dhcp || !supportsDhcpRange"
          clearable
          placeholder="可选，例如 10.126.126.0/24；留空自动分配"
        />
      </el-form-item> </el-col
    ><el-col :xs="24" :sm="12">
      <el-form-item>
        <template #label
          ><CoreOptionLabel
            label="IPv6 DHCP"
            description="自动分配 IPv6 虚拟地址，可指定 IPv6 CIDR；启用后不再手动设置 IPv6 地址。"
            :supported="supports('dhcpv6')"
            :unavailable-reason="capabilityReason"
        /></template>
        <el-select
          v-model="config.dhcpv6"
          clearable
          filterable
          allow-create
          default-first-option
          :disabled="!supports('dhcpv6')"
          placeholder="未设置；可输入 IPv6 CIDR"
        >
          <el-option label="自动分配" :value="true" />
          <el-option label="关闭" :value="false" />
          <el-option
            v-if="typeof config.dhcpv6 === 'string'"
            :label="config.dhcpv6"
            :value="config.dhcpv6"
          />
        </el-select>
      </el-form-item> </el-col
  ></el-row>
  <el-form-item v-if="section === 'stun'">
    <template #label
      ><CoreOptionLabel
        label="TCP STUN 服务器"
        version-note="从 EasyTier v2.7.0 预发布版起支持（官方更新记录）。同版本开发构建仍以实际能力检测为准。"
        description="配置用于 TCP NAT 探测的 STUN 服务器，格式为 host:port。"
        :supported="supports('tcp-stun-servers')"
        :unavailable-reason="capabilityReason"
    /></template>
    <el-select
      v-model="config.tcp_stun_servers"
      multiple
      filterable
      allow-create
      default-first-option
      clearable
      :disabled="!supports('tcp-stun-servers')"
      placeholder="输入 host:port 后回车"
    />
  </el-form-item>
  <el-row v-if="section === 'relay'">
    <el-col :xs="24" :sm="12">
      <el-form-item>
        <template #label
          ><CoreOptionLabel
            label="优先对等节点中继"
            version-note="从 EasyTier v2.7.0 预发布版起支持（v2.6.4 与 v2.7.0 配置字段对照）。"
            description="优先使用对等节点转发流量；未设置时采用内核默认策略。"
            :supported="supports('prefer-peer-relay')"
            :unavailable-reason="capabilityReason"
        /></template>
        <el-select
          v-model="config.flags.prefer_peer_relay"
          clearable
          :disabled="!supports('prefer-peer-relay')"
          placeholder="内核默认"
        >
          <el-option label="启用" :value="true" /><el-option label="关闭" :value="false" />
        </el-select>
      </el-form-item> </el-col
    ><el-col :xs="24" :sm="12">
      <el-form-item>
        <template #label
          ><CoreOptionLabel
            label="禁止数据中继"
            version-note="EasyTier v2.6.4 已支持；更早的首次引入版本尚未确认。"
            description="禁止本节点为其他节点中继数据；未设置时采用内核默认策略。"
            :supported="supports('disable-relay-data')"
            :unavailable-reason="capabilityReason"
        /></template>
        <el-select
          v-model="config.flags.disable_relay_data"
          clearable
          :disabled="!supports('disable-relay-data')"
          placeholder="内核默认"
        >
          <el-option label="启用" :value="true" /><el-option label="关闭" :value="false" />
        </el-select>
      </el-form-item> </el-col
  ></el-row>
  <el-form-item v-if="section === 'socket' && (isLinux || config.flags.socket_mark !== undefined)">
    <template #label
      ><CoreOptionLabel
        label="Socket mark"
        version-note="从 EasyTier v2.7.0 预发布版起支持（官方更新记录：SO_MARK 支持）。"
        description="设置套接字的数据包标记，用于策略路由；仅 Linux 生效。"
        :supported="isLinux && supports('socket-mark')"
        :unavailable-reason="!isLinux ? '仅 Linux 平台支持。' : capabilityReason"
    /></template>
    <el-input-number
      v-model="config.flags.socket_mark"
      :min="0"
      :max="4294967295"
      :precision="0"
      :disabled="!isLinux || !supports('socket-mark')"
    />
    <span class="ml-8px">仅 Linux 生效</span>
  </el-form-item>
  <template v-if="section === 'portal'">
    <el-alert
      v-if="portal.client_cidr"
      type="warning"
      :closable="false"
      title="当前为旧版地址池。新版内核需要明确填写客户端，旧内核仍可保存旧格式。"
      class="mb-12px"
    />
    <el-form-item v-if="portal.clients">
      <template #label
        ><CoreOptionLabel
          label="门户私钥"
          version-note="从 EasyTier v2.7.0 预发布版起支持新版 WireGuard 门户配置。"
          description="WireGuard 门户私钥，留空由内核生成；不会从旧地址池自动推导客户端。"
          :supported="supports('vpn-portal-private-key')"
          :unavailable-reason="capabilityReason"
      /></template>
      <el-input
        v-model="portal.wireguard_private_key"
        :disabled="!supports('vpn-portal-private-key')"
        type="password"
        show-password
        clearable
        placeholder="可选，留空交由内核生成"
      />
    </el-form-item>
    <div
      v-for="(client, index) in portal.clients"
      :key="index"
      class="border border-[var(--el-border-color)] rounded p-12px mb-12px"
    >
      <el-form-item
        ><template #label
          ><CoreOptionLabel
            label="客户端名称"
            version-note="从 EasyTier v2.7.0 预发布版起支持具名 WireGuard 客户端。"
            description="具名客户端的唯一名称，不能与其他客户端重复。"
            :supported="supports('vpn-portal-client')"
            :unavailable-reason="capabilityReason" /></template
        ><el-input v-model="client.name" :disabled="!supports('vpn-portal-client')"
      /></el-form-item>
      <el-form-item
        ><template #label
          ><CoreOptionLabel
            label="虚拟 IP / CIDR"
            version-note="从 EasyTier v2.7.0 预发布版起支持具名 WireGuard 客户端。"
            description="分配给该 WireGuard 客户端的虚拟地址，不能从旧地址池无损推导。"
            :supported="supports('vpn-portal-client')"
            :unavailable-reason="capabilityReason"
        /></template>
        <el-input
          v-model="client.virtual_ip"
          :disabled="!supports('vpn-portal-client')"
          placeholder="10.144.144.5/24"
      /></el-form-item>
      <el-form-item
        ><template #label
          ><CoreOptionLabel
            label="分组"
            version-note="从 EasyTier v2.7.0 预发布版起支持新版 WireGuard 客户端分组。"
            description="指定该客户端所属分组，供访问控制规则引用。"
            :supported="supports('vpn-portal-client-group')"
            :unavailable-reason="capabilityReason"
        /></template>
        <el-select
          v-model="client.groups"
          :disabled="!supports('vpn-portal-client-group')"
          multiple
          filterable
          allow-create
          default-first-option
        />
      </el-form-item>
      <el-button
        type="danger"
        plain
        :disabled="!supports('vpn-portal-client')"
        @click="removeClient(index)"
        >移除此客户端</el-button
      >
    </div>
    <el-form-item
      ><template #label
        ><CoreOptionLabel
          label="WireGuard 客户端"
          version-note="从 EasyTier v2.7.0 预发布版起支持具名客户端（官方更新记录）。"
          description="使用具名客户端配置替代旧地址池。切换需手动填写各客户端，保存前备份原配置。"
          :supported="supports('vpn-portal-client')"
          :unavailable-reason="capabilityReason"
      /></template>
      <el-button :disabled="!supports('vpn-portal-client')" @click="addClient"
        >添加具名客户端</el-button
      >
    </el-form-item>
  </template>
  <el-form-item v-if="section === 'runtime'">
    <template #label
      ><CoreOptionLabel
        label="共享运行时"
        description="多个实例共享运行时；启用后忽略实例多线程开关，工作线程数使用相邻线程数设置，最小为 1。"
        :supported="supports('shared-runtime')"
        :unavailable-reason="capabilityReason"
    /></template>
    <el-switch
      v-model="config.manager_runtime.shared_runtime"
      :disabled="!supports('shared-runtime')"
    />
  </el-form-item>
  <el-form-item v-if="section === 'state'">
    <template #label
      ><CoreOptionLabel
        label="持久化状态目录"
        description="本地持久化状态目录，目前用于保存 Web 配置服务器的机器 ID。留空使用平台默认目录，由管理器转换为进程参数。"
        :supported="supports('state-dir')"
        :unavailable-reason="capabilityReason"
    /></template>
    <el-input
      v-model="config.manager_runtime.state_dir"
      clearable
      :disabled="!supports('state-dir')"
      placeholder="留空使用平台默认目录"
    />
  </el-form-item>
</template>
