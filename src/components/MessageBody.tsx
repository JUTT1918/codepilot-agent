import React, { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ClipboardCheck, Copy, FileCode2 } from 'lucide-react';

function getCode(children: ReactNode) {
  for (const child of Children.toArray(children)) {
    if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) continue;
    const text = Children.toArray(child.props.children).map((part) => typeof part === 'string' ? part : '').join('').replace(/\n$/, '');
    const lang = child.props.className?.match(/language-([\w-]+)/)?.[1] ?? 'code';
    return { text, lang };
  }
  return null;
}

export default function MessageBody({ content, onApplyCode }: { content: string; onApplyCode?: (code: string) => void }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const components: Components = {
    pre: ({ children }) => {
      const code = getCode(children);
      if (!code) return <pre>{children}</pre>;
      return (
        <div className="message-code-block">
          <div className="message-code-head"><span><FileCode2 size={13} />{code.lang}</span><div><button onClick={() => void copy(code.text)} aria-label="Copy code">{copied ? <ClipboardCheck size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</button>{onApplyCode && <button className="apply-code" onClick={() => onApplyCode(code.text)}>Apply to editor</button>}</div></div>
          <pre><code>{code.text}</code></pre>
        </div>
      );
    },
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  };

  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown></div>;
}
