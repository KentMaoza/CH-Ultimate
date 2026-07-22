import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { createMobileDemoState } from '../src/domain/mobile-demo-state';
import { MockOperationsGateway } from '../src/gateway/operations-gateway';
import { MobileApp } from './MobileApp';
import { createMobilePorts } from './bootstrap';
import './styles.css';

const gateway = new MockOperationsGateway(createMobileDemoState);
const ports = createMobilePorts(Capacitor.isNativePlatform());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileApp gateway={gateway} notifications={ports.notifications} scanner={ports.scanner} />
  </StrictMode>,
);
