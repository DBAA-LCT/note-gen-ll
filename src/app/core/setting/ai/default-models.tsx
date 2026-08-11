'use client'
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import { Gem, Move3D, Eye, MessageSquare } from "lucide-react";
import Image from 'next/image';
import { open } from '@tauri-apps/plugin-shell'

export default function DefaultModelsSection() {
  const t = useTranslations('settings.ai.defaultModels');
  const { theme, systemTheme } = useTheme();
  
  // 确定当前主题
  const currentTheme = theme === 'system' ? systemTheme : theme;
  const isDark = currentTheme === 'dark';
  
  // SiliconFlow 图片URL
  const siliconFlowImageUrl = isDark 
    ? 'https://s2.loli.net/2025/09/10/KWPOA5XhIGmYTV9.png'
    : 'https://s2.loli.net/2025/09/10/gVhlriQ81PJabSY.png';

  const models = [
    {
      name: t('chatModel.name'),
      type: t('chatModel.type'),
      desc: t('chatModel.desc'),
      icon: <MessageSquare />,
    },
    {
      name: t('embeddingModel.name'),
      type: t('embeddingModel.type'),
      desc: t('embeddingModel.desc'),
      icon: <Move3D />,
    },
    {
      name: t('visionModel.name'),
      type: t('visionModel.type'),
      desc: t('visionModel.desc'),
      icon: <Eye />,
    }
  ];

  function openInBrowser() {
    open('https://cloud.siliconflow.cn/i/O2ciJeZw')
  }

  return (
    <Card className="mb-6 relative">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gem className="h-5 w-5" />
          {t('title')}
        </CardTitle>
        <CardDescription>
          {t('desc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* 模型列表 */}
        <ItemGroup className="grid gap-3 lg:grid-cols-3">
          {models.map((model, index) => (
            <Item key={index} variant="outline">
              <ItemMedia variant="icon">{model.icon}</ItemMedia>
              <ItemContent>
                <ItemTitle>{model.name}</ItemTitle>
                <ItemDescription>{model.desc}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant="secondary">{model.type}</Badge>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
        <Button variant="ghost" className="h-auto w-fit p-0" onClick={openInBrowser}>
          <Image
            src={siliconFlowImageUrl}
            alt="SiliconFlow"
            width={240}
            height={60}
            className="h-10 w-auto object-contain"
            unoptimized
          />
        </Button>
      </CardContent>
    </Card>
  );
}
