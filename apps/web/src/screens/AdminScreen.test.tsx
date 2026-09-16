import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it } from 'vitest';
import { AdminScreen } from './AdminScreen.js';

describe('AdminScreen device enrollment',()=>{
  it('offers the current member a separate action to connect another own device',()=>{
    const html=renderToStaticMarkup(<AdminScreen/>);
    expect(html).toContain('Подключить моё устройство');
    expect(html).toContain('Пригласить нового члена семьи');
  });
});
