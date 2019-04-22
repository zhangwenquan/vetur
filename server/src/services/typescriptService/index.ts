import { DependencyService, T_TypeScript, State } from '../dependencyService';
import { LanguageServiceHost } from 'typescript';
import { VueTypescriptLanguageService } from './vueTypescriptLanguageService';
import { LanguageModelCache } from '../../embeddedSupport/languageModelCache';
import { TextDocument } from 'vscode-languageserver-types';

export class TypescriptService {
  private tsModule: T_TypeScript;
  private vueTypescriptLanguageServiceHost: VueTypescriptLanguageService;

  constructor(
    dependencyService: DependencyService,
    worksapcePath: string,
    jsDocuments: LanguageModelCache<TextDocument>
  ) {
    const tsDependency = dependencyService.getDependency('typescript');
    if (tsDependency && tsDependency.state === State.Loaded) {
      this.tsModule = tsDependency.module;
    } else {
      throw Error('Failed to load TypeScript module');
    }

    this.vueTypescriptLanguageServiceHost = new VueTypescriptLanguageService(this.tsModule, worksapcePath, jsDocuments);
  }
}
