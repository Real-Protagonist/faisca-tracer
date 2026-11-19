import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as core from '@faisca/sim-core';
import { App } from './App';
import { hasLangPref, i18n, preferredLang } from './i18n';
import { lastChoice } from './onboarding/Wizard';
import { loadProject, openWizard, useApp } from './store';
import { startSimulation } from './sim/client';
import { startAutosave } from './actions';
import { startSplash } from './splash';
import './styles.css';

const lang = preferredLang();
useApp.setState({ lang, view: { x: 40, y: 40, zoom: 1 } });
document.documentElement.lang = lang;
i18n.on('languageChanged', (l) => (document.documentElement.lang = l));

startSimulation();
startAutosave();
loadProject(core.createProject({ lang, ...lastChoice() }));
// Primeira abertura: assistente com a escolha do idioma.
if (!hasLangPref()) openWizard(true);

// Acesso para os testes de interface (Playwright).
(window as unknown as { faisca: unknown }).faisca = { useApp, core, loadProject };

startSplash();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
