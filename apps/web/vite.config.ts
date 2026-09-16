import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],server:{proxy:{'/v1':{target:'http://localhost:8787',changeOrigin:true,ws:true},'/health':{target:'http://localhost:8787',changeOrigin:true}}},test:{environment:'jsdom'}});
