import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { applyTheme,loadThemePreference } from './local/theme.js';
import './styles/app.css';

applyTheme(loadThemePreference());
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
if('serviceWorker'in navigator)window.addEventListener('load',()=>void navigator.serviceWorker.register('/sw.js'));
