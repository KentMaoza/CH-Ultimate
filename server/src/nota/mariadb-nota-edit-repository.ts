import type { NotaRepository } from './service.js';
import type { Dependencies } from './mariadb-nota-shared.js';
import { MariaDbNotaHeaderRepository } from './mariadb-nota-header-repository.js';
import { MariaDbNotaLineRepository } from './mariadb-nota-line-repository.js';
import { MariaDbNotaPageRepository } from './mariadb-nota-page-repository.js';

export class MariaDbNotaEditRepository {
  private readonly header: MariaDbNotaHeaderRepository;
  private readonly line: MariaDbNotaLineRepository;
  private readonly page: MariaDbNotaPageRepository;

  constructor(dependencies: Partial<Dependencies> = {}) {
    this.header = new MariaDbNotaHeaderRepository(dependencies);
    this.line = new MariaDbNotaLineRepository(dependencies);
    this.page = new MariaDbNotaPageRepository(dependencies);
  }

  create = (...args: Parameters<NotaRepository['create']>) => this.page.create(...args);
  addPage = (...args: Parameters<NotaRepository['addPage']>) => this.page.addPage(...args);
  cancelPage = (...args: Parameters<NotaRepository['cancelPage']>) => this.page.cancelPage(...args);
  restorePage = (...args: Parameters<NotaRepository['restorePage']>) => this.page.restorePage(...args);
  updateHeader = (...args: Parameters<NotaRepository['updateHeader']>) =>
    this.header.updateHeader(...args);
  updateLine = (...args: Parameters<NotaRepository['updateLine']>) => this.line.updateLine(...args);
  deleteLine = (...args: Parameters<NotaRepository['deleteLine']>) => this.line.deleteLine(...args);
}
