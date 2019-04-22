import * as ts from 'typescript';
import * as bridge from './bridge';
import { T_TypeScript } from '../dependencyService';
import { isVueFile, isVirtualVueFile, isVirtualVueTemplateFile } from './util';

interface FileInfo {
  fileName: string;
  version: string;
  kind: ts.ScriptKind;
}

/**
 * Manages the version, script kind and other metadata for Vue files
 */
export class VueFileInfoManager {
  /**
   * For .vue and .vue.ts files
   */
  private sharedFileInfoMap: {
    [fileName: string]: FileInfo
  } = {};

  /**
   * For .vue.template files
   */
  private virtualVueTemplateFileInfoMap: {
    [fileName: string]: FileInfo
  } = {};

  constructor(private tsModule: T_TypeScript) {
    this.sharedFileInfoMap[bridge.fileName] = {
      fileName: bridge.fileName,
      version: '0',
      kind: tsModule.ScriptKind.TS
    };
  }

  getFiles(includeVirtualVueFiles: boolean) {
    if (includeVirtualVueFiles) {
      return [...Object.keys(this.sharedFileInfoMap), ...Object.keys(this.virtualVueTemplateFileInfoMap)];
    }

    return Object.keys(this.sharedFileInfoMap);
  }

  getScriptVersion(fileName: string) {
    if (this.sharedFileInfoMap[fileName]) {
      return this.sharedFileInfoMap[fileName].version;
    }

    return this.virtualVueTemplateFileInfoMap[fileName]
      ? this.virtualVueTemplateFileInfoMap[fileName].version
      : '0';
  }

  getScriptKind(fileName: string) {
    if (this.sharedFileInfoMap[fileName]) {
      return this.sharedFileInfoMap[fileName].kind;
    }

    if (this.virtualVueTemplateFileInfoMap[fileName]) {
      return this.virtualVueTemplateFileInfoMap[fileName].kind;
    }

    console.log(`Can't find ScriptKind for ${fileName}`);
    return this.tsModule.ScriptKind.JS;

    // if (isVueFile(fileName)) {
    //   const doc =
    //     scriptDocs.get(fileName) ||
    //     jsDocuments.get(TextDocument.create(uri.toString(), 'vue', 0, tsModule.sys.readFile(fileName) || ''));
    //   return getScriptKind(tsModule, doc.languageId);
    // } else if (isVirtualVueTemplateFile(fileName)) {
    //   return tsModule.ScriptKind.JS;
    // } else {
    //   if (fileName === bridge.fileName) {
    //     return tsModule.ScriptKind.TS;
    //   }
    //   // NOTE: Typescript 2.3 should export getScriptKindFromFileName. Then this cast should be removed.
    //   return (tsModule as any).getScriptKindFromFileName(fileName);
    // }

    // return this.virtualVueTemplateFileInfoMap[fileName]
    //   ? this.virtualVueTemplateFileInfoMap[fileName].version
    //   : '0';
  }

  addScript(fileName: string, kind: ts.ScriptKind) {
    if (isVueFile(fileName) || isVirtualVueFile(fileName)) {
      if (!this.sharedFileInfoMap[fileName]) {
        this.sharedFileInfoMap[fileName] = {
          fileName,
          kind, 
          version: '0'
        }
      }
    }

    if (isVirtualVueTemplateFile(fileName)) {
      if (!this.virtualVueTemplateFileInfoMap[fileName]) {
        this.virtualVueTemplateFileInfoMap[fileName] = {
          fileName,
          kind,
          version: '0'
        }
      }
    }
  }
}