import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { api } from '../api/client.js';
import { DevicesScreen,type DeviceItem } from './DevicesScreen.js';

vi.mock('../api/client.js',()=>({api:vi.fn()}));
vi.mock('../flows/device-link.js',()=>({createDeviceLink:vi.fn()}));
vi.mock('qrcode',()=>({default:{toDataURL:vi.fn()}}));

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

const device:DeviceItem={
  deviceId:'33333333-3333-4333-8333-333333333333',
  memberId:'22222222-2222-4222-8222-222222222222',
  memberDisplayName:'Александр',
  memberRole:'owner',
  deviceName:'iPhone Александра',
  status:'active',
  createdAt:'2026-09-01T07:00:00.000Z',
  lastSeenAt:'2026-09-17T06:00:00.000Z',
  encryptionPublicKey:'public-key',
  canManage:true
};

beforeEach(()=>{
  vi.mocked(api).mockImplementation((async(path:string,options:RequestInit={})=>{
    if(path==='/v1/devices'&&(!options.method||options.method==='GET'))return {items:[device]};
    if(path===`/v1/devices/${device.deviceId}`&&options.method==='PATCH')return {deviceId:device.deviceId,deviceName:'Рабочий iPhone'};
    throw new Error(`unexpected request: ${path}`);
  }) as typeof api);
});
afterEach(()=>vi.clearAllMocks());

describe('device editing',()=>{
  it('renames a manageable device and updates the visible name',async()=>{
    const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container);
    try{
      await act(async()=>{root.render(<DevicesScreen/>);await Promise.resolve();await Promise.resolve();});
      const rename=Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Переименовать');
      expect(rename).toBeTruthy();
      await act(async()=>{rename!.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
      const input=container.querySelector<HTMLInputElement>('input[aria-label="Название устройства"]');
      expect(input).toBeTruthy();
      await act(async()=>{
        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
        setter.call(input,'Рабочий iPhone');
        input!.dispatchEvent(new Event('input',{bubbles:true}));
      });
      const save=Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Сохранить');
      expect(save).toBeTruthy();
      await act(async()=>{save!.dispatchEvent(new MouseEvent('click',{bubbles:true}));await Promise.resolve();await Promise.resolve();});
      expect(api).toHaveBeenCalledWith(`/v1/devices/${device.deviceId}`,{method:'PATCH',body:JSON.stringify({deviceName:'Рабочий iPhone'})});
      expect(container.textContent).toContain('Рабочий iPhone');
      expect(container.textContent).not.toContain('iPhone Александра');
    }finally{await act(async()=>root.unmount());container.remove();}
  });
});
