import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createProject } from '@faisca/sim-core';
import { App } from './App';
import { i18n, preferredLang } from './i18n';
import { loadProject, useApp } from './store';
import { startSimulation } from './sim/client';
import { startAutosave } from './actions';
import './styles.css';

const lang = preferredLang();
useApp.setState({ lang, view: { x: 40, y: 40, zoom: 1 } });
document.documentElement.lang = lang;
i18n.on('languageChanged', (l) => (document.documentElement.lang = l));

startSimulation();
startAutosave();
loadProject(createProject({ lang }));

// Acesso para os testes de interface (Playwright).
(window as unknown as { faisca: unknown }).faisca = { useApp };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
