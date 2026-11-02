import type { Attachment, WorkspaceFile } from '../types';

const MAX_TEXT_FILE = 500_000;
const MAX_ARCHIVE_FILES = 180;
const OMIT = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|vendor)(\/|$)/i;
const TEXT_NAME = /(^|\/)(readme|dockerfile|makefile|gemfile|procfile|license|\.gitignore|\.dockerignore)$/i;
const TEXT_EXT = /\.(html?|css|[cm]?jsx?|tsx?|json|md|mdx|ya?ml|toml|xml|svg|txt|py|go|rs|java|kt|swift|php|rb|sh|sql|c|cc|cpp|h|hpp|cs|vue|svelte|astro|env\.example)$/i;
const PRIVATE_FILE = /(^|\/)(\.env(?!\.example$)[^/]*|id_rsa|id_ed25519|[^/]+\.(pem|key|p12|pfx))$/i;

function isTextFile(file: File) {
  return file.type.startsWith('text/') || file.type.includes('json') || file.type.includes('javascript') || file.type.includes('xml') || TEXT_NAME.test(file.name) || TEXT_EXT.test(file.name);
}

export async function filesToAttachments(files: FileList | File[]) {
  const attachments: Attachment[] = [];
  for (const file of Array.from(files)) {
    if (PRIVATE_FILE.test(file.name)) throw new Error(`${file.name} looks like a private credential and cannot be attached to the assistant.`);
    if (file.size > MAX_TEXT_FILE) throw new Error(`${file.name} is larger than the 500 KB attachment limit.`);
    const attachment: Attachment = { name: file.name, size: file.size };
    if (isTextFile(file)) attachment.content = await file.text();
    attachments.push(attachment);
  }
  return attachments;
}

export async function importProjectArchive(file: File) {
  if (file.size > 20_000_000) throw new Error('Project archives must be 20 MB or smaller.');
  const { strFromU8, unzipSync } = await import('fflate');
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('This archive could not be opened. Choose a valid .zip project file.');
  }
  const files: WorkspaceFile[] = [];
  let total = 0;
  for (const [path, bytes] of Object.entries(archive)) {
    const normalized = path.replace(/\\/g, '/');
    if (path.endsWith('/') || normalized.startsWith('/') || normalized.split('/').some((segment) => segment === '..') || normalized.startsWith('__MACOSX/') || OMIT.test(normalized) || !(TEXT_NAME.test(normalized) || TEXT_EXT.test(normalized))) continue;
    if (bytes.byteLength > MAX_TEXT_FILE) continue;
    total += bytes.byteLength;
    if (files.length >= MAX_ARCHIVE_FILES || total > 3_000_000) break;
    files.push({ path: normalized, content: strFromU8(bytes), updatedAt: new Date().toISOString() });
  }
  if (!files.length) throw new Error('No supported text or source files were found in that archive.');
  return files;
}

export async function downloadWorkspace(files: WorkspaceFile[], name: string) {
  const { zipSync, strToU8 } = await import('fflate');
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    const path = file.path.replace(/^\/+/, '').replace(/\.\.(\/|$)/g, '');
    if (path) entries[path] = strToU8(file.content);
  }
  const bytes = zipSync(entries, { level: 6 });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'codepilot-project'}.zip`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildPreview(files: WorkspaceFile[]) {
  const htmlFile = files.find((file) => file.path.toLowerCase() === 'index.html') ?? files.find((file) => file.path.toLowerCase().endsWith('.html'));
  if (!htmlFile) return '<!doctype html><html><body style="font:15px system-ui;color:#475569;padding:32px">Add an index.html file to preview this workspace.</body></html>';

  let html = htmlFile.content;
  const findFile = (href: string) => {
    const normalized = href.replace(/^\.\//, '').replace(/^\//, '');
    return files.find((file) => file.path === normalized || file.path.endsWith(`/${normalized}`));
  };
  html = html.replace(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi, (tag, href: string) => {
    if (/^(https?:|data:|\/\/)/i.test(href)) return tag;
    const css = findFile(href);
    return css ? `<style>\n${css.content.replace(/<\/style/gi, '<\\/style')}\n</style>` : '';
  });
  html = html.replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, before: string, src: string, after: string) => {
    if (/^(https?:|data:|\/\/)/i.test(src)) return tag;
    const js = findFile(src);
    return js ? `<script${before}${after}>\n${js.content.replace(/<\/script/gi, '<\\/script')}\n</script>` : '';
  });
  html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'; frame-src \'none\'">';
  if (/<head([^>]*)>/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>${policy}`);
  else html = html.replace(/<html([^>]*)>/i, `<html$1><head>${policy}</head>`);
  return html;
}

export function textContext(files: WorkspaceFile[], limit = 30_000) {
  let context = '';
  for (const file of files) {
    if (context.length >= limit) break;
    const section = `\n\n--- ${file.path} ---\n${file.content}`;
    context += section.slice(0, Math.max(0, limit - context.length));
  }
  return context;
}
