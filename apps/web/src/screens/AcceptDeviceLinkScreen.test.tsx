import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
import { AcceptDeviceLinkForm } from './AcceptDeviceLinkScreen.js';

const inspection={
  deviceLinkId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  familyId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  memberId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  familyDisplayName:'Наша семья',
  memberDisplayName:'Александр',
  expiresAt:'2026-09-16T15:00:00.000Z'
};

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
