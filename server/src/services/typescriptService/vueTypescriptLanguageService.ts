import * as ts from 'typescript';
import { T_TypeScript, DependencyService, State } from '../dependencyService';
import * as parseGitIgnore from 'parse-gitignore';
import { getVueSys } from './vueSys';
import { TextDocument } from 'vscode-languageserver-types';
import { VueFileInfoManager } from './vueFileInfoManager';
import { createLanguageServiceHost } from './vueTypescriptLanguageServiceHost';
import { createUpdater } from './preprocess';
import { getFileFsPath, getFilePath } from '../../utils/paths';

export class VueTypescriptLanguageService {
  private tsModule: T_TypeScript;
  private vueFileInfoManager: VueFileInfoManager;
  private versions = new Map<string, number>();

  /**
   * fileName => .vue file where everything other than <script> region overwritten by whitespace
   */
  private scriptDocs = new Map<string, TextDocument>();

  /**
   * Service/Host for .vue/.js/.ts files
   */
  private tsHost: ts.LanguageServiceHost;
  public tsService: ts.LanguageService;

  /**
   * Service/Host for virtual .vue.template files
   */
  private templateHost: ts.LanguageServiceHost;
  public templateService: ts.LanguageService;

  constructor() {}

  async init(dependencyService: DependencyService, workspacePath: string) {
    if (dependencyService) {
      const tsDependency = dependencyService.getDependency('typescript');
      if (tsDependency && tsDependency.state === State.Loaded) {
        this.tsModule = tsDependency.module;
      } else {
        throw Error('Failed to load TS service');
      }
    }

    patchTS(this.tsModule);
    let currentScriptDoc: TextDocument;
    const parsedConfig = getParsedConfig(this.tsModule, workspacePath);
    const tsServiceOptions = {
      ...getDefaultCompilerOptions(this.tsModule),
      ...parsedConfig.options,
      allowNonTsExtensions: true
    };
    const templateServiceOptions = {
      ...tsServiceOptions,
      noImplicitAny: false,
      noUnusedLocals: false,
      noUnusedParameters: false,
      allowJs: true,
      checkJs: true
    };

    const registry = this.tsModule.createDocumentRegistry(true);

    this.vueFileInfoManager = new VueFileInfoManager(this.tsModule);
    const vueSys = getVueSys(this.tsModule);

    this.tsHost = createLanguageServiceHost(
      this.tsModule,
      tsServiceOptions,
      vueSys,
      this.vueFileInfoManager,
      false, // includeVirtualVueFiles
      this.scriptDocs,
      this.jsDocuments,
      workspacePath
    );
    this.templateHost = createLanguageServiceHost(
      this.tsModule,
      templateServiceOptions,
      vueSys,
      this.vueFileInfoManager,
      true, // includeVirtualVueFiles
      this.scriptDocs,
      this.jsDocuments,
      this.workspacePath
    );

    this.tsService = this.tsModule.createLanguageService(this.tsHost, registry);
    this.templateService = this.tsModule.createLanguageService(this.templateHost, registry);
  }

  updateCurrentTextDocument(doc: TextDocument) {
    const fileFsPath = getFileFsPath(doc.uri);
    const filePath = getFilePath(doc.uri);
    // When file is not in language service, add it
    if (!this.scriptDocs.has(fileFsPath)) {
      if (fileFsPath.endsWith('.vue') || fileFsPath.endsWith('.vue.template')) {
        files.push(filePath);
      }
    }
    if (isVirtualVueTemplateFile(fileFsPath)) {
      scriptDocs.set(fileFsPath, doc);
      versions.set(fileFsPath, (versions.get(fileFsPath) || 0) + 1);
    } else if (!currentScriptDoc || doc.uri !== currentScriptDoc.uri || doc.version !== currentScriptDoc.version) {
      currentScriptDoc = jsDocuments.get(doc);
      const lastDoc = scriptDocs.get(fileFsPath);
      if (lastDoc && currentScriptDoc.languageId !== lastDoc.languageId) {
        // if languageId changed, restart the language service; it can't handle file type changes
        jsLanguageService.dispose();
        jsLanguageService = tsModule.createLanguageService(jsHost);
      }
      scriptDocs.set(fileFsPath, currentScriptDoc);
      versions.set(fileFsPath, (versions.get(fileFsPath) || 0) + 1);
    }
    return {
      service: jsLanguageService,
      templateService: templateLanguageService,
      scriptDoc: currentScriptDoc,
      templateSourceMap
    };

  }

  // External Documents: JS/TS, non Vue documents
  updateExternalDocument(filePath: string) {}
}

function patchTS(tsModule: T_TypeScript) {
  // Patch typescript functions to insert `import Vue from 'vue'` and `new Vue` around export default.
  // NOTE: this is a global hack that all ts instances after is changed
  const { createLanguageServiceSourceFile, updateLanguageServiceSourceFile } = createUpdater(tsModule);
  (tsModule as any).createLanguageServiceSourceFile = createLanguageServiceSourceFile;
  (tsModule as any).updateLanguageServiceSourceFile = updateLanguageServiceSourceFile;
}

function getDefaultCompilerOptions(tsModule: T_TypeScript) {
  const defaultCompilerOptions: ts.CompilerOptions = {
    allowNonTsExtensions: true,
    allowJs: true,
    lib: ['lib.dom.d.ts', 'lib.es2017.d.ts'],
    target: tsModule.ScriptTarget.Latest,
    moduleResolution: tsModule.ModuleResolutionKind.NodeJs,
    module: tsModule.ModuleKind.CommonJS,
    jsx: tsModule.JsxEmit.Preserve,
    allowSyntheticDefaultImports: true
  };

  return defaultCompilerOptions;
}

function getParsedConfig(tsModule: T_TypeScript, workspacePath: string) {
  const configFilename =
    tsModule.findConfigFile(workspacePath, tsModule.sys.fileExists, 'tsconfig.json') ||
    tsModule.findConfigFile(workspacePath, tsModule.sys.fileExists, 'jsconfig.json');
  const configJson = (configFilename && tsModule.readConfigFile(configFilename, tsModule.sys.readFile).config) || {
    exclude: defaultIgnorePatterns(tsModule, workspacePath)
  };
  // existingOptions should be empty since it always takes priority
  return tsModule.parseJsonConfigFileContent(
    configJson,
    tsModule.sys,
    workspacePath,
    /*existingOptions*/ {},
    configFilename,
    /*resolutionStack*/ undefined,
    [{ extension: 'vue', isMixedContent: true }]
  );
}

function defaultIgnorePatterns(tsModule: T_TypeScript, workspacePath: string) {
  const nodeModules = ['node_modules', '**/node_modules/*'];
  const gitignore = tsModule.findConfigFile(workspacePath, tsModule.sys.fileExists, '.gitignore');
  if (!gitignore) {
    return nodeModules;
  }
  const parsed: string[] = parseGitIgnore(gitignore);
  const filtered = parsed.filter(s => !s.startsWith('!'));
  return nodeModules.concat(filtered);
}
