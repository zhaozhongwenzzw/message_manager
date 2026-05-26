import { Database, Palette, Sparkles, Trash2 } from 'lucide-react';

export type SectionKey = 'appearance' | 'trash' | 'search' | 'llm';

export type SectionDef = {
  key: SectionKey;
  label: string;
  desc: string;
  icon: JSX.Element;
};

export const SECTIONS: SectionDef[] = [
  {
    key: 'appearance',
    label: '外观',
    desc: '主题与配色',
    icon: <Palette size={14} />
  },
  {
    key: 'trash',
    label: '回收站',
    desc: '软删除路径',
    icon: <Trash2 size={14} />
  },
  {
    key: 'search',
    label: '搜索索引',
    desc: '全文检索',
    icon: <Database size={14} />
  },
  {
    key: 'llm',
    label: 'AI 助手',
    desc: '续聊简报',
    icon: <Sparkles size={14} />
  }
];
