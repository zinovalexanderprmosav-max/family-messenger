import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {DatabasePool} from '../db/pool.js';
import {requireSession} from '../auth/session.js';
import {requireCsrf} from '../auth/csrf.js';
import type {AppConfig} from '../config.js';

const ProviderSchema=z.enum(['auto','ollama','openrouter']);
const MessageSchema=z.object({
  role:z.enum(['user','assistant']),
  content:z.string().trim().min(1).max(8000)
});
const ChatRequestSchema=z.object({
  provider:ProviderSchema.default('auto'),
  messages:z.array(MessageSchema).min(1).max(30)
});

type Provider='ollama'|'openrouter';
type ChatMessage=z.infer<typeof MessageSchema>;

const SYSTEM_PROMPT=[
  'Ты семейный ИИ-помощник внутри Family Messenger.',
  'Отвечай на русском языке, если пользователь не просит другой язык.',
  'Будь кратким, полезным и доброжелательным.',
  'Не утверждай, что видишь семейную переписку: ты получаешь только сообщения, которые пользователь явно отправил в чат помощника.',
  'Если вопрос требует актуальных данных из интернета, честно скажи, что у тебя нет встроенного веб-поиска в этом режиме.'
].join(' ');

function withSystem(messages:ChatMessage[]){
  return [{role:'system' as const,content:SYSTEM_PROMPT},...messages];
}

async function callOllama(config:AppConfig,messages:ChatMessage[]){
  if(!config.ollamaBaseUrl)throw new Error('ollama_not_configured');
  const endpoint=new URL('/api/chat',config.ollamaBaseUrl).toString();
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      model:config.ollamaModel,
      stream:false,
      messages:withSystem(messages)
    }),
    signal:AbortSignal.timeout(60000)
  });
  if(!response.ok)throw new Error('ollama_unavailable');
  const payload=await response.json() as {message?:{content?:string};model?:string};
  const content=payload.message?.content?.trim();
  if(!content)throw new Error('ollama_empty_response');
  return {provider:'ollama' as const,model:payload.model??config.ollamaModel,content};
}

async function callOpenRouter(config:AppConfig,messages:ChatMessage[]){
  if(!config.openRouterApiKey)throw new Error('openrouter_not_configured');
  const endpoint=new URL('/api/v1/chat/completions',config.openRouterBaseUrl).toString();
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'authorization':`Bearer ${config.openRouterApiKey}`,
      'HTTP-Referer':'https://family-messenger-9wd2.onrender.com',
      'X-Title':'Family Messenger'
    },
    body:JSON.stringify({
      model:config.openRouterModel,
      messages:withSystem(messages),
      temperature:0.5
    }),
    signal:AbortSignal.timeout(60000)
  });
  if(!response.ok){
    const body=await response.text().catch(()=>'');
    if(response.status===401||response.status===403)throw new Error('openrouter_auth_failed');
    if(response.status===429)throw new Error('openrouter_rate_limited');
    throw new Error(body?'openrouter_unavailable':'openrouter_unavailable');
  }
  const payload=await response.json() as {
    model?:string;
    choices?:Array<{message?:{content?:string|null}}>
  };
  const content=payload.choices?.[0]?.message?.content?.trim();
  if(!content)throw new Error('openrouter_empty_response');
  return {provider:'openrouter' as const,model:payload.model??config.openRouterModel,content};
}

async function callProvider(provider:Provider,config:AppConfig,messages:ChatMessage[]){
  return provider==='ollama'?callOllama(config,messages):callOpenRouter(config,messages);
}

function publicAssistantError(error:unknown){
  const code=error instanceof Error?error.message:'assistant_unavailable';
  const allowed=new Set([
    'assistant_not_configured','ollama_not_configured','ollama_unavailable','ollama_empty_response',
    'openrouter_not_configured','openrouter_auth_failed','openrouter_rate_limited',
    'openrouter_unavailable','openrouter_empty_response'
  ]);
  return allowed.has(code)?code:'assistant_unavailable';
}

export async function registerAssistantRoutes(app:FastifyInstance,pool:DatabasePool,config:AppConfig){
  app.get('/v1/assistant/status',async request=>{
    const principal=await requireSession(request,pool);
    if(principal.deviceStatus!=='active')throw Object.assign(new Error('device_not_active'),{statusCode:403});
    return {
      providers:{
        ollama:{configured:Boolean(config.ollamaBaseUrl),model:config.ollamaModel},
        openrouter:{configured:Boolean(config.openRouterApiKey),model:config.openRouterModel}
      }
    };
  });

  app.post('/v1/assistant/chat',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    requireCsrf(request,principal);
    if(principal.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const input=ChatRequestSchema.parse(request.body);

    try{
      if(input.provider==='ollama')return await callOllama(config,input.messages);
      if(input.provider==='openrouter')return await callOpenRouter(config,input.messages);

      const errors:string[]=[];
      if(config.ollamaBaseUrl){
        try{return await callProvider('ollama',config,input.messages);}
        catch(error){errors.push(publicAssistantError(error));}
      }
      if(config.openRouterApiKey){
        try{return await callProvider('openrouter',config,input.messages);}
        catch(error){errors.push(publicAssistantError(error));}
      }
      return reply.code(503).send({error:errors.at(-1)??'assistant_not_configured'});
    }catch(error){
      return reply.code(503).send({error:publicAssistantError(error)});
    }
  });
}
