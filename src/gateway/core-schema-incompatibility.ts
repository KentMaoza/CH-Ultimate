import {
  CoreApiSchemaError,
  CoreApiUpgradeRequiredError,
} from './core-api-types';
import type { CoreGatewayState } from './core-gateway-state';
import { CORE_UPGRADE_REQUIRED_MESSAGE } from './sync-presentation';

export type CoreSchemaIncompatibilitySource =
  | 'bootstrap'
  | 'poll'
  | 'mutation'
  | 'deferred'
  | 'sku-image'
  | 'catalogue-validation'
  | 'catalogue-commit'
  | 'catalogue-image'
  | 'image-prefetch';

export interface CorePollingDiagnostic {
  event: 'core-schema-incompatibility';
  source: CoreSchemaIncompatibilitySource;
  errorName: string;
  errorMessage: string;
}

export type CorePollingDiagnosticSink = (
  diagnostic: CorePollingDiagnostic,
) => void;

export class CoreSchemaIncompatibilityHandler {
  constructor(
    private readonly state: CoreGatewayState,
    private readonly diagnosticSink: CorePollingDiagnosticSink = () => {},
  ) {}

  handle(error: unknown, source: CoreSchemaIncompatibilitySource): boolean {
    if (
      !(error instanceof CoreApiUpgradeRequiredError) &&
      !(error instanceof CoreApiSchemaError)
    ) {
      return false;
    }
    this.diagnosticSink({
      event: 'core-schema-incompatibility',
      source,
      errorName: error.name,
      errorMessage: error.message,
    });
    this.state.publishSync({
      phase: 'upgrade-required',
      message: CORE_UPGRADE_REQUIRED_MESSAGE,
    });
    return true;
  }
}
