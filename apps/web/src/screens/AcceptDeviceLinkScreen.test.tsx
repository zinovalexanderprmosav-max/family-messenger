import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { acceptDeviceLink,inspectDeviceLinkToken } from '../flows/device-link.js';
import { AcceptDeviceLinkForm,AcceptDeviceLinkScreen } from './AcceptDeviceLinkScreen.js';

vi.mock('../flows/device-link.js',()=>({
  inspectDeviceLinkToken:vi.fn(),
  acceptDeviceLink:vi.fn()
}));

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

const inspection={
  deviceLinkId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  familyId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  memberId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  familyDisplayName:'Наша семья',
  memberDisplayName:'Александр',
  expiresAt:'2026-09-16T15:00:00.000Z'
};

function setInput(input:HTMLInputElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
  setter?.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
}

afterEach(()=>vi.clearAllMocks());

describe('AcceptDeviceLinkForm',()=>{
  it('connects a device to the existing member without asking for a new member name',()=>{
    const html=renderToStaticMarkup(<AcceptDeviceLinkForm inspection={inspection} busy={false} error="" onSubmit={vi.fn()}/>);
    expect(html).toContain('Подключение устройства');
    expect(html).toContain('Александр');
    expect(html).toContain('Наша семья');
    expect(html).toContain('Название устройства');
    expect(html).toContain('Личный PIN');
    expect(html).toContain('Подключить устройство');
    expect(html).not.toContain('Ваше имя');
  });
});

describe('AcceptDeviceLinkScreen',()=>{
  it('inspects the one-time token before showing the existing family profile',async()=>{
    vi.mocked(inspectDeviceLinkToken).mockResolvedValue(inspection);
    const container=document.createElement('div');
    document.body.appendChild(container);
    const root=createRoot(container);
    try{
      await act(async()=>{root.render(<AcceptDeviceLinkScreen token="one-time-token" onDone={vi.fn()}/>);});
      await act(async()=>{await Promise.resolve();});
      expect(inspectDeviceLinkToken).toHaveBeenCalledWith('one-time-token');
      expect(container.textContent).toContain('Подключение устройства');
      expect(container.textContent).toContain('Александр');
      expect(container.textContent).toContain('Наша семья');
    }finally{
      await act(async()=>root.unmount());
      container.remove();
    }
  });

  it('enrolls the scanned device under the inspected existing member and finishes in pending approval',async()=>{
    vi.mocked(inspectDeviceLinkToken).mockResolvedValue(inspection);
    vi.mocked(acceptDeviceLink).mockResolvedValue({familyId:inspection.familyId,memberId:inspection.memberId,deviceId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',familyChatId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',status:'pending_key',csrfToken:'csrf'});
    const onDone=vi.fn();
    const container=document.createElement('div');
    document.body.appendChild(container);
    const root=createRoot(container);
    try{
      await act(async()=>{root.render(<AcceptDeviceLinkScreen token="one-time-token" onDone={onDone}/>);});
      await act(async()=>{await Promise.resolve();});
      const inputs=Array.from(container.querySelectorAll('input'));
      const deviceName=inputs.find(input=>input.getAttribute('placeholder')==='Например, Рабочий ПК') as HTMLInputElement;
      const pin=inputs.find(input=>input.getAttribute('type')==='password') as HTMLInputElement;
      expect(deviceName).toBeTruthy();
      expect(pin).toBeTruthy();
      await act(async()=>{setInput(deviceName,'Рабочий ПК');setInput(pin,'123456');});
      const form=container.querySelector('form')!;
      await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await Promise.resolve();});
      expect(acceptDeviceLink).toHaveBeenCalledWith({
        linkToken:'one-time-token',
        deviceName:'Рабочий ПК',
        pin:'123456',
        memberDisplayName:'Александр',
        familyDisplayName:'Наша семья'
      });
      expect(onDone).toHaveBeenCalledTimes(1);
    }finally{
      await act(async()=>root.unmount());
      container.remove();
    }
  });
});
