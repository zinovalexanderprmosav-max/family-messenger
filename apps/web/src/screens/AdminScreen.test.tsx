import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it } from 'vitest';
import type { LocalProfile } from '../local/db.js';
import { AdminScreen } from './AdminScreen.js';

const profile:LocalProfile={
  familyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  memberId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  deviceId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  familyChatId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  status:'active',
  csrfToken:'csrf',
  memberDisplayName:'Александр',
  familyDisplayName:'Наша семья'
};

describe('AdminScreen device enrollment',()=>{
  it('offers the current member a separate action to connect another own device',()=>{
    const html=renderToStaticMarkup(<AdminScreen profile={profile}/>);
    expect(html).toContain('Подключить моё устройство');
    expect(html).toContain('Пригласить нового члена семьи');
  });
});
