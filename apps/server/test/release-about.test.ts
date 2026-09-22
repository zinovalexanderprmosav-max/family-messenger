import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';

let app:FastifyInstance;

beforeAll(async()=>{
  process.env.APP_VERSION='0.3.8-rc1-test';
  app=await buildApp({skipDatabase:true});
});

afterAll(async()=>{
  await app.close();
  delete process.env.APP_VERSION;
});

describe('release diagnostics',()=>{
  it('reports the exact server build version without database access',async()=>{
    const r=await app.inject({method:'GET',url:'/v1/about'});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      service:'family-messenger-server',
      version:'0.3.8-rc1-test'
    });
    expect(Number.isNaN(Date.parse(r.json().serverTime))).toBe(false);
  });
});
