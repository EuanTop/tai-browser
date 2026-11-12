import { parseHTML } from 'linkedom/worker';
import { validatePackage } from './index.mjs';
import { assertModuleManifest } from '../../contracts/v1/index.mjs';

export class PackageError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'PackageError'; }
}
const reject = code => { throw new PackageError(code); };
const bytes = value => new TextEncoder().encode(value).length;
export function validateNativePayload(payload) {
  const {manifest,script,markup,style} = payload || {};
  assertModuleManifest(manifest);
  if (!manifest || manifest.id.startsWith('tai.') || manifest.entry !== 'index.html' ||
      manifest.surfaces.length !== 1 || manifest.surfaces[0] !== 'panel' ||
      Object.keys(manifest).some(key => !['apiVersion','id','version','title','entry','surfaces','capabilities'].includes(key)) ||
      bytes(manifest.id) > 100 || bytes(manifest.version) > 32 || bytes(manifest.title) > 300 ||
      manifest.capabilities.length > 4) reject('UNSUPPORTED_NATIVE_MANIFEST');
  for (const [value,limit] of [[script,2*1024*1024],[markup,256*1024],[style,128*1024]]) {
    if (typeof value !== 'string' || bytes(value) > limit) reject('NATIVE_PACKAGE_QUOTA');
  }
  return payload;
}

/** Small supported package form: one local module entry, local CSS, body markup. */
export async function prepareNativePackage(input, {bundle} = {}) {
  const pkg = validatePackage(input), html = pkg.files[pkg.manifest.entry];
  let {document} = parseHTML(html);
  if (document.documentElement?.localName !== 'html') ({document} = parseHTML('<!doctype html><html><head></head><body>' + html + '</body></html>'));
  const scripts = [...document.querySelectorAll('script')];
  if (scripts.length > 1 || scripts.some(script => script.type !== 'module' || !script.getAttribute('src') ||
      script.textContent.trim() || [...script.attributes].some(attr => !['type','src'].includes(attr.name)))) reject('UNSUPPORTED_SCRIPT');
  function local(reference) {
    if (typeof reference !== 'string' || !reference || /[\\%:?#\u0000-\u0020]/u.test(reference) ||
        reference.startsWith('/') || reference.split('/').some(part => !part || part === '..')) reject('UNSUPPORTED_RESOURCE');
    const key = reference.startsWith('./') ? reference.slice(2) : reference;
    if (!Object.hasOwn(pkg.files,key)) reject('MISSING_PACKAGE_RESOURCE');
    return key;
  }
  const entry = scripts[0] ? local(scripts[0].getAttribute('src')) : null;
  for (const script of scripts) script.remove();
  const styles = [];
  for (const node of document.querySelectorAll('link,style')) {
    if (node.localName === 'style') styles.push(node.textContent);
    else {
      if (node.getAttribute('rel') !== 'stylesheet' || [...node.attributes].some(attr => !['rel','href'].includes(attr.name))) reject('UNSUPPORTED_LINK');
      styles.push(pkg.files[local(node.getAttribute('href'))]);
    }
    node.remove();
  }
  const style = styles.join('\n');
  if (/@import\b|url\s*\(/i.test(style)) reject('UNSUPPORTED_CSS_RESOURCE');
  for (const node of document.querySelectorAll('*')) {
    if (['base','iframe','object','embed'].includes(node.localName) || [...node.attributes].some(attr =>
      /^on/i.test(attr.name) || ['src','srcset','poster','background','style'].includes(attr.name))) reject('UNSUPPORTED_MARKUP_RESOURCE');
  }
  const markup = document.body.innerHTML;
  // Validate before paying compilation cost, and again after bundling expansion.
  validateNativePayload({manifest:pkg.manifest,script:'',markup,style});
  if (entry && typeof bundle !== 'function') reject('PACKAGE_COMPILER_UNAVAILABLE');
  const script = entry ? await bundle({entry,files:structuredClone(pkg.files)}) : '';
  return validateNativePayload({kind:'custom',manifest:pkg.manifest,script,markup,style});
}
