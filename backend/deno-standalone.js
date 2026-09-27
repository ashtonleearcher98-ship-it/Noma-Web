// Paste this entire file into a Deno Deploy playground.
const enc = new TextEncoder();
const b64 = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const jwks = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let cachedKeys;
async function verifyFirebase(jwt, projectId) {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw Error('Invalid sign-in token');
  const head = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if (head.alg !== 'RS256' || !head.kid || payload.aud !== projectId ||
      payload.iss !== `https://securetoken.google.com/${projectId}` || !payload.sub ||
      payload.exp <= Math.floor(Date.now() / 1000) || payload.iat > Math.floor(Date.now() / 1000) ||
      payload.email_verified !== true) throw Error('Verify your email first');
  if (!cachedKeys || cachedKeys.expires < Date.now()) {
    const response = await fetch(jwks); if (!response.ok) throw Error('Token verification unavailable');
    cachedKeys = {keys: (await response.json()).keys, expires: Date.now() + 60 * 60 * 1000};
  }
  const key = cachedKeys.keys.find(k => k.kid === head.kid);
  if (!key) { cachedKeys = null; throw Error('Please retry sign-in'); }
  const publicKey = await crypto.subtle.importKey('jwk', key, {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'}, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decode(parts[2]), enc.encode(parts[0] + '.' + parts[1])))
    throw Error('Invalid sign-in token');
  return payload.sub;
}
async function getDoc(path, token, projectId) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    {headers: {Authorization: `Bearer ${token}`}});
  if (!response.ok) throw Error('Call unavailable');
  return (await response.json()).fields;
}
async function signLiveKit(secret, key, uid, callId) {
  const now = Math.floor(Date.now()/1000);
  const head = b64(enc.encode(JSON.stringify({alg:'HS256',typ:'JWT'})));
  const body = b64(enc.encode(JSON.stringify({iss:key,sub:uid,iat:now,nbf:now,exp:now+3600,
    video:{room:`call_${callId}`,roomJoin:true,canPublish:true,canSubscribe:true,canPublishData:false}})));
  const input = head + '.' + body;
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return input + '.' + b64(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(input)));
}
const handler = {
  async fetch(request, env) {
    const cors = {'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Authorization, Content-Type', 'Access-Control-Max-Age':'86400'};
    const reply = (data, status) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json','Cache-Control':'no-store', ...cors}});
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:cors});
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/token') return reply({error:'Not found'},404);
    try {
      const auth = request.headers.get('Authorization') || '';
      if (!auth.startsWith('Bearer ')) return reply({error:'Sign in required'},401);
      const idToken = auth.slice(7);
      const uid = await verifyFirebase(idToken, env.FIREBASE_PROJECT_ID);
      const {callId} = await request.json();
      if (typeof callId !== 'string' || !/^[A-Za-z0-9]{20}$/.test(callId)) return reply({error:'Invalid call'},400);
      const call = await getDoc(`calls/${callId}`, idToken, env.FIREBASE_PROJECT_ID);
      if (call.status?.stringValue === 'ended' || !call.members?.arrayValue?.values?.some(x => x.stringValue === uid))
        return reply({error:'Call unavailable'},403);
      const chatId = call.chatId?.stringValue;
      if (!chatId || !/^[A-Za-z0-9_-]{1,256}$/.test(chatId)) return reply({error:'Invalid chat'},400);
      const chat = await getDoc(`chats/${chatId}`, idToken, env.FIREBASE_PROJECT_ID);
      if (!chat.members?.arrayValue?.values?.some(x => x.stringValue === uid)) return reply({error:'Chat unavailable'},403);
      const created = Date.parse(call.createdAt?.timestampValue || 0);
      if (Date.now()-created > 2*60*60*1000 || created > Date.now()+60000) return reply({error:'Call expired'},403);
      if (!env.LIVEKIT_URL?.startsWith('wss://') || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET)
        return reply({error:'Calls are not configured'},503);
      return reply({url:env.LIVEKIT_URL, token:await signLiveKit(env.LIVEKIT_API_SECRET, env.LIVEKIT_API_KEY, uid, callId)},200);
    } catch (e) { return reply({error:'Could not authorize this call'},401); }
  }
};

Deno.serve(request => handler.fetch(request, {
  FIREBASE_PROJECT_ID: Deno.env.get('FIREBASE_PROJECT_ID'),
  LIVEKIT_URL: Deno.env.get('LIVEKIT_URL'),
  LIVEKIT_API_KEY: Deno.env.get('LIVEKIT_API_KEY'),
  LIVEKIT_API_SECRET: Deno.env.get('LIVEKIT_API_SECRET'),
}));
