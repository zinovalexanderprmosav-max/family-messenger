import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { inspectDeviceLinkToken } from '../flows/device-link.js';
import { AcceptDeviceLinkForm,AcceptDeviceLinkScreen } from './AcceptDeviceLinkScreen.js';

vi.mock('../flows/device-link.js',()=>({
  inspectDeviceLinkToken:vi.fn(),
  acceptDeviceLink:vi.fn()
}));

const inspection={
  deviceLinkId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  familyId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  memberId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  familyDisplayName:'Наша семья',
  memberDisplayName:'Александр',
  expiresAt:'2026-09-16T15:00:00.000Z'
};

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
});
