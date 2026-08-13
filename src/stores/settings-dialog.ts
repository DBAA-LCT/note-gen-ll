import { create } from 'zustand'

export type SettingSection =
  | 'about'
  | 'general'
  | 'record'
  | 'editor'
  | 'sync'
  | 'backup'
  | 'imageHosting'
  | 'ai'
  | 'agentEngines'
  | 'webSearch'
  | 'rag'
  | 'mcp'
  | 'skills'
  | 'prompt'
  | 'memories'
  | 'template'
  | 'file'
  | 'shortcuts'
  | 'imageMethod'
  | 'audio'
  | 'learning'

export const settingSections: SettingSection[] = [
  'about',
  'general',
  'record',
  'editor',
  'learning',
  'shortcuts',
  'imageMethod',
  'audio',
  'ai',
  'agentEngines',
  'webSearch',
  'rag',
  'memories',
  'prompt',
  'mcp',
  'skills',
  'template',
  'sync',
  'backup',
  'imageHosting',
  'file',
]

interface SettingsDialogState {
  open: boolean
  activeSection: SettingSection
  openSettings: (section?: SettingSection) => void
  closeSettings: () => void
  setActiveSection: (section: SettingSection) => void
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  activeSection: 'about',
  openSettings: (section) => set((state) => ({
    open: true,
    activeSection: section ?? state.activeSection,
  })),
  closeSettings: () => set({ open: false }),
  setActiveSection: (activeSection) => set({ activeSection }),
}))
