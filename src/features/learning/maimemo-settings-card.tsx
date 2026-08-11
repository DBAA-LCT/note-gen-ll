'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getMaimemoStudyProgress, getMaimemoToken, saveMaimemoToken } from '@/lib/learning/maimemo'

export function MaimemoSettingsCard() {
  const [token, setToken] = useState('')
  const [savedToken, setSavedToken] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => { void getMaimemoToken().then(value => { setToken(value); setSavedToken(value) }) }, [])

  const verifyAndSave = async () => {
    if (!token.trim()) return
    setLoading(true)
    try {
      const progress = await getMaimemoStudyProgress(token)
      await saveMaimemoToken(token)
      setSavedToken(token.trim())
      toast.success(`墨墨已连接：今日 ${progress.finished}/${progress.total}`)
    } catch (cause) {
      toast.error('墨墨连接失败', { description: cause instanceof Error ? cause.message : String(cause) })
    } finally { setLoading(false) }
  }

  const disconnect = async () => {
    await saveMaimemoToken('')
    setToken(''); setSavedToken('')
    toast.success('已断开墨墨开放 API')
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div><h3 className="font-medium">墨墨开放 API</h3><p className="text-xs text-muted-foreground">与 AI API Key 使用同一套应用配置方式，验证成功后保存。</p></div>
      <div className="space-y-2"><Label htmlFor="maimemo-token">个人 Access Token</Label><Input id="maimemo-token" type="password" autoComplete="off" placeholder="在墨墨 App 的开放 API 页面获取" value={token} onChange={event => setToken(event.target.value)} /></div>
      <div className="flex flex-wrap items-center gap-2"><Button onClick={() => void verifyAndSave()} disabled={!token.trim() || loading}>{loading ? <LoaderCircle className="animate-spin" /> : null}验证并保存</Button>{savedToken ? <Button variant="outline" onClick={() => void disconnect()}>断开连接</Button> : null}<a className="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href="https://open.maimemo.com/" target="_blank" rel="noreferrer">API 文档<ExternalLink className="size-3.5" /></a></div>
    </div>
  )
}
