import * as ts from 'typescript';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-types';
import Uri from 'vscode-uri';
import { T_TypeScript } from '../dependencyService';
import * as bridge from './bridge';
import { VueFileInfoManager } from './vueFileInfoManager';
import { isVueFile } from './util';
import { LanguageModelCache } from '../../embeddedSupport/languageModelCache';
import { getVueDocumentRegions } from '../../embeddedSupport/embeddedSupport';

/**
 * Normalize file path, particularly for Windows path handling
 */
function getNormalizedFileFsPath(fileName: string): string {
  return Uri.file(fileName).fsPath;
}

export function createLanguageServiceHost(
  tsModule: T_TypeScript,
  options: ts.CompilerOptions,
  vueSys: ts.System,
  vueFileInfoManager: VueFileInfoManager,
  includeVirtualVueFiles: boolean,
  scriptDocs: Map<string, TextDocument>,
  jsDocuments: LanguageModelCache<TextDocument>,
  workspacePath: string
): ts.LanguageServiceHost {
  const isOldVersion = isUsingOldVueVersion(tsModule, workspacePath);

  return {
    getCompilationSettings: () => options,
    getScriptFileNames: () => vueFileInfoManager.getFiles(includeVirtualVueFiles),
    getScriptVersion: (fileName) => vueFileInfoManager.getScriptVersion(fileName),
    getScriptKind: (fileName) => vueFileInfoManager.getScriptKind(fileName),

    getDirectories: vueSys.getDirectories,
    directoryExists: vueSys.directoryExists,
    fileExists: vueSys.fileExists,
    readFile: vueSys.readFile,
    readDirectory: vueSys.readDirectory,

    resolveModuleNames(moduleNames: string[], containingFile: string): ts.ResolvedModule[] {
      // in the normal case, delegate to ts.resolveModuleName
      // in the relative-imported.vue case, manually build a resolved filename
      return moduleNames.map(name => {
        if (name === bridge.moduleName) {
          return {
            resolvedFileName: bridge.fileName,
            extension: tsModule.Extension.Ts
          };
        }

        if (path.isAbsolute(name) || !isVueFile(name)) {
          return tsModule.resolveModuleName(name, containingFile, options, tsModule.sys).resolvedModule;
        }
        const resolved = tsModule.resolveModuleName(name, containingFile, options, vueSys).resolvedModule;
        if (!resolved) {
          return undefined as any;
        }
        if (!resolved.resolvedFileName.endsWith('.vue.ts')) {
          return resolved;
        }
        const resolvedFileName = resolved.resolvedFileName.slice(0, -'.ts'.length);
        const uri = Uri.file(resolvedFileName);
        const doc =
          scriptDocs.get(resolvedFileName) ||
          jsDocuments.get(TextDocument.create(uri.toString(), 'vue', 0, tsModule.sys.readFile(resolvedFileName) || ''));
        const extension =
          doc.languageId === 'typescript'
            ? tsModule.Extension.Ts
            : doc.languageId === 'tsx'
            ? tsModule.Extension.Tsx
            : tsModule.Extension.Js;
        return { resolvedFileName, extension };
      });
    },
    getScriptSnapshot: (fileName: string) => {
      if (fileName === bridge.fileName) {
        const text = isOldVersion ? bridge.oldContent : bridge.content;
        return {
          getText: (start, end) => text.substring(start, end),
          getLength: () => text.length,
          getChangeRange: () => void 0
        };
      }
      const normalizedFileFsPath = getNormalizedFileFsPath(fileName);
      const doc = scriptDocs.get(normalizedFileFsPath);
      let fileText = doc ? doc.getText() : tsModule.sys.readFile(normalizedFileFsPath) || '';
      if (!doc && isVueFile(fileName)) {
        // Note: This is required in addition to the parsing in embeddedSupport because
        // this works for .vue files that aren't even loaded by VS Code yet.
        fileText = parseVueScript(fileText);
      }
      return {
        getText: (start, end) => fileText.substring(start, end),
        getLength: () => fileText.length,
        getChangeRange: () => void 0
      };
    },
    getCurrentDirectory: () => workspacePath,
    getDefaultLibFileName: tsModule.getDefaultLibFilePath,
    getNewLine: () => '\n',
    useCaseSensitiveFileNames: () => true
  };
}

/**
 * Check if the workspace is using Vue < 2.5
 */
function isUsingOldVueVersion(tsModule: T_TypeScript, workspacePath: string): boolean {
  const packageJSONPath = tsModule.findConfigFile(workspacePath, tsModule.sys.fileExists, 'package.json');
  try {
    const packageJSON = packageJSONPath && JSON.parse(tsModule.sys.readFile(packageJSONPath)!);
    const vueStr = packageJSON.dependencies.vue || packageJSON.devDependencies.vue;
    // use a sloppy method to infer version, to reduce dep on semver or so
    const vueDep = vueStr.match(/\d+\.\d+/)[0];
    const sloppyVersion = parseFloat(vueDep);
    return sloppyVersion < 2.5;
  } catch (e) {
    return true;
  }
}

export function parseVueScript(text: string): string {
  const doc = TextDocument.create('test://test/test.vue', 'vue', 0, text);
  const regions = getVueDocumentRegions(doc);
  const script = regions.getSingleTypeDocument('script');
  return script.getText() || 'export default {};';
}
