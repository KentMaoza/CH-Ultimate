import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMobileDemoState } from '../src/domain/mobile-demo-state';
import { MockOperationsGateway } from '../src/gateway/operations-gateway';
import { MobileApp } from './MobileApp';
import { browserBarcodeScanner, browserLocalNotifications } from './ports';
import './styles.css';

const gateway = new MockOperationsGateway(createMobileDemoState);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileApp gateway={gateway} notifications={browserLocalNotifications} scanner={browserBarcodeScanner} />
  </StrictMode>,
);
