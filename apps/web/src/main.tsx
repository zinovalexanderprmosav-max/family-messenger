import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(registration=>{
      void registration.update();
    });

    let refreshed=false;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(refreshed)return;
      refreshed=true;
      window.location.reload();
    });
  });
}
