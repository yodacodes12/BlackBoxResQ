import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { SimProvider } from './state/SimContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SimProvider>
      <App />
    </SimProvider>
  </StrictMode>,
);
