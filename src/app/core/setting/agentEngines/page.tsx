'use client'

import { Bot } from 'lucide-react'
import { SettingType } from '../components/setting-base'
import AgentEngines from '../ai/agent-engines'

export default function AgentEnginesPage() {
  return (
    <SettingType
      id="agent-engines"
      icon={<Bot />}
      title="Agent 引擎"
      desc="选择并检测安装在本机的 Agent CLI。模型、账号和服务地址由对应软件自行管理。"
    >
      <AgentEngines />
    </SettingType>
  )
}
