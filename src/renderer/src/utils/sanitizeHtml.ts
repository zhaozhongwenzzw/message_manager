import DOMPurify from 'dompurify';

// LLM 输出的 HTML 是不受信任内容。渲染前必须过滤，剥掉脚本 / 内联事件 /
// 外链资源，只留语义化排版标签 + class（供 .markdown 样式着色）。
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr', 'span', 'div',
      'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'code', 'pre', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'mark',
      'blockquote', 'a'
    ],
    ALLOWED_ATTR: ['class', 'href', 'title'],
    // 禁外链资源 + 脚本协议
    FORBID_TAGS: ['script', 'style', 'iframe', 'img', 'link', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
    ALLOW_DATA_ATTR: false
  });
}
