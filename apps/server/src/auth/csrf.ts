import type { FastifyRequest } from 'fastify';
import type { SessionPrincipal } from './session.js';
import { csrfMatches } from './session.js';
export function requireCsrf(request:FastifyRequest,principal:SessionPrincipal){
  const raw=request.headers['x-csrf-token'];
  const provided=Array.isArray(raw)?raw[0]:raw;
  if(!csrfMatches(provided,principal.csrfToken)) throw Object.assign(new Error('csrf_invalid'),{statusCode:403});
}
