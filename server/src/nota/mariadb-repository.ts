import type { NotaRepository } from './service.js';
import type { Dependencies } from './mariadb-nota-shared.js';
import { MariaDbNotaConflictRepository } from './mariadb-nota-conflict-repository.js';
import { MariaDbNotaEditRepository } from './mariadb-nota-edit-repository.js';
import { MariaDbNotaLifecycleRepository } from './mariadb-nota-lifecycle-repository.js';

export class MariaDbNotaRepository implements NotaRepository {
  private readonly edit: MariaDbNotaEditRepository;
  private readonly lifecycle: MariaDbNotaLifecycleRepository;
  private readonly conflicts: MariaDbNotaConflictRepository;

  constructor(dependencies: Partial<Dependencies> = {}) {
    this.edit = new MariaDbNotaEditRepository(dependencies);
    this.lifecycle = new MariaDbNotaLifecycleRepository(dependencies);
    this.conflicts = new MariaDbNotaConflictRepository({
      updateHeader: this.edit.updateHeader,
      updateLine: this.edit.updateLine,
      deleteLine: this.edit.deleteLine,
      addPage: this.edit.addPage,
      restorePage: this.edit.restorePage,
      cancelPage: this.edit.cancelPage,
      complete: this.lifecycle.complete,
      reopen: this.lifecycle.reopen,
      cancel: this.lifecycle.cancel,
      restore: this.lifecycle.restore,
    }, dependencies);
  }

  create = (...args: Parameters<NotaRepository['create']>) => this.edit.create(...args);
  addPage = (...args: Parameters<NotaRepository['addPage']>) => this.edit.addPage(...args);
  cancelPage = (...args: Parameters<NotaRepository['cancelPage']>) => this.edit.cancelPage(...args);
  restorePage = (...args: Parameters<NotaRepository['restorePage']>) => this.edit.restorePage(...args);
  updateHeader = (...args: Parameters<NotaRepository['updateHeader']>) => this.edit.updateHeader(...args);
  updateLine = (...args: Parameters<NotaRepository['updateLine']>) => this.edit.updateLine(...args);
  deleteLine = (...args: Parameters<NotaRepository['deleteLine']>) => this.edit.deleteLine(...args);
  complete = (...args: Parameters<NotaRepository['complete']>) => this.lifecycle.complete(...args);
  reopen = (...args: Parameters<NotaRepository['reopen']>) => this.lifecycle.reopen(...args);
  cancel = (...args: Parameters<NotaRepository['cancel']>) => this.lifecycle.cancel(...args);
  restore = (...args: Parameters<NotaRepository['restore']>) => this.lifecycle.restore(...args);
  resolveConflict = (...args: Parameters<NotaRepository['resolveConflict']>) =>
    this.conflicts.resolveConflict(...args);
}
