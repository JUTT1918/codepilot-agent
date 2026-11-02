import CodeMirror from '@uiw/react-codemirror';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';

function languageFor(path: string) {
  const name = path.toLowerCase();
  if (name.endsWith('.html') || name.endsWith('.htm')) return html();
  if (name.endsWith('.css')) return css();
  if (name.endsWith('.json')) return json();
  if (name.endsWith('.py')) return python();
  if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(name)) return javascript({ typescript: /\.(ts|tsx)$/.test(name), jsx: /\.(jsx|tsx)$/.test(name) });
  return javascript();
}

export default function CodeEditor({ path, value, onChange }: { path: string; value: string; onChange: (value: string) => void }) {
  return <CodeMirror value={value} height="100%" theme="dark" extensions={[languageFor(path)]} onChange={onChange} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, bracketMatching: true, autocompletion: true }} />;
}
