import type { OpenTerminalError } from '../types';

export function translateTerminalError(err: OpenTerminalError): string {
  switch (err.code) {
    case 'cwd_not_set':
      return '该会话未记录工作目录，无法 resume';
    case 'cwd_missing':
      return `原工作目录已不存在：${err.cwd}，无法 resume`;
    case 'cli_not_found':
      return `找不到 ${err.cli} 命令，请在设置 → 终端中填写绝对路径`;
    case 'session_id_invalid':
      return `无法从文件名解析会话 ID（${err.raw}）`;
    case 'terminal_spawn_failed':
      return `启动终端失败：${err.detail}`;
  }
}
