import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

if('serviceWorker'in navigator){
  window.addEventListener('load',()=>void navigator.serviceWorker.register('/sw.js').then(registration=>{
    void registration.update();
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(sessionStorage.getItem('fm-sw-reloaded')==='1')return;
      sessionStorage.setItem('fm-sw-reloaded','1');
      location.reload();
    });
  }));
}
