import { loadProfile } from '../local/session.js';
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const headers=new Headers(options.headers);headers.set('content-type','application/json');
  const profile=await loadProfile();if(profile&&options.method&&options.method!=='GET'&&options.method!=='HEAD')headers.set('x-csrf-token',profile.csrfToken);
  const response=await fetch(path,{...options,headers,credentials:'same-origin'});
  if(!response.ok){const payload=await response.json().catch(()=>({error:`http_${response.status}`})) as {error?:string};throw new Error(payload.error??`http_${response.status}`);}
  if(response.status===204)return undefined as T;return response.json() as Promise<T>;
}
