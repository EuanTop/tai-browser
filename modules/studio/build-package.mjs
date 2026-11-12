// Developer/product build service entry. Never imported by browser runtime code.
import { build } from 'esbuild';
import { prepareNativePackage, PackageError } from './package.mjs';

/** In-memory files only; esbuild cannot resolve host files or npm/network imports. */
export async function bundlePackageESM({entry,files}) {
  const result = await build({
    entryPoints:[entry], bundle:true, write:false, format:'esm', platform:'browser',
    target:'es2022', charset:'utf8', legalComments:'inline', metafile:true, logLevel:'silent',
    // Lower import() so unsupported computed imports emit an unmistakable require shim.
    supported:{'dynamic-import':false},
    plugins:[{name:'package-files-only',setup(builder) {
      builder.onResolve({filter:/.*/}, args => {
        if (args.kind !== 'entry-point' && !args.path.startsWith('./') && !args.path.startsWith('../'))
          throw new PackageError('UNSUPPORTED_DEPENDENCY');
        if (/[\\%:?#\u0000-\u001f]/u.test(args.path) || args.path.startsWith('/')) throw new PackageError('UNSUPPORTED_DEPENDENCY');
        const parts = (args.importer ? args.importer.split('/').slice(0,-1) : []).concat(args.path.split('/'));
        const normalized = [];
        for (const part of parts) {
          if (part === '.') continue;
          if (part === '..') { if (!normalized.length) throw new PackageError('PACKAGE_IMPORT_ESCAPE'); normalized.pop(); }
          else normalized.push(part);
        }
        const path = normalized.join('/');
        if (!Object.hasOwn(files,path) || !/\.(?:m?js|ts|json)$/.test(path)) throw new PackageError('UNSUPPORTED_DEPENDENCY');
        return {path,namespace:'tai-package'};
      });
      builder.onLoad({filter:/.*/,namespace:'tai-package'}, args => ({
        contents:files[args.path],loader:args.path.endsWith('.ts') ? 'ts' : args.path.endsWith('.json') ? 'json' : 'js',
      }));
    }}],
  });
  const script = result.outputFiles[0].text;
  if (/var __require\d*\s*=/.test(script) || Object.values(result.metafile.outputs).some(output => output.imports.length))
    throw new PackageError('UNSUPPORTED_RUNTIME_IMPORT');
  return script;
}
export const buildNativePackage = input => prepareNativePackage(input,{bundle:bundlePackageESM});
