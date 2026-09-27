import './style.css';
import { createIcons, ArrowLeft, ArrowRight, ArrowUp, Ellipsis, Info, LogOut,
  MailCheck, MessageCircle, MessageCircleMore, MessagesSquare, Mic, MicOff,
  Phone, PhoneOff, Plus, Search, Sparkles, SquarePen, UserRound, Video,
  VideoOff, X } from 'lucide';
import { auth, db, callTokenUrl } from './firebase.js';
import {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, reload, getIdToken
} from 'firebase/auth';
import {
  collection, doc, getDoc, onSnapshot, query, where, orderBy, limit,
  runTransaction, serverTimestamp, writeBatch, setDoc
} from 'firebase/firestore';
import { Room, RoomEvent, Track } from 'livekit-client';

const root = document.getElementById('app');
const state = {
  user: null, profile: null, chats: [], calls: [], messages: [], chatId: null,
  authMode: 'signin', search: '', draft: '', notice: '', busy: false,
  modal: null, activeCall: null, room: null, callConnected: false,
  muted: false, cameraOn: false, mobileList: true,
};
let subscriptions = [];
let messageSub = null;
let callSub = null;
let noticeTimer;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const $ = selector => root.querySelector(selector);
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name, size = 20) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;
const avatar = (name, size = '') => `<div class="avatar ${size}">${h((name || '?').trim().charAt(0).toUpperCase())}</div>`;
const normalizePhone = value => value.trim().replace(/[\s()-]/g, '');
const timestamp = value => value?.toDate?.()?.getTime() || 0;
const clock = value => value ? new Intl.DateTimeFormat(undefined, {hour:'numeric', minute:'2-digit'}).format(value) : '';
const shortDate = value => value ? new Intl.DateTimeFormat(undefined, {month:'short', day:'numeric'}).format(value) : '';
const label = chat => chat.kind === 'group' ? chat.title : (chat.names?.[chat.members.find(id => id !== state.user?.uid)] || 'Unknown');
const chatById = id => state.chats.find(chat => chat.id === id);
const show = (message, error = false) => {
  state.notice = message;
  clearTimeout(noticeTimer);
  const toast = $('#toast');
  if (toast) { toast.textContent = message; toast.className = `toast visible ${error ? 'error' : ''}`; }
  noticeTimer = setTimeout(() => { state.notice = ''; const t = $('#toast'); if (t) t.classList.remove('visible'); }, 4500);
};
const fail = error => { console.error(error); show(error?.message || String(error), true); };
const icons = { ArrowLeft, ArrowRight, ArrowUp, Ellipsis, Info, LogOut,
  MailCheck, MessageCircle, MessageCircleMore, MessagesSquare, Mic, MicOff,
  Phone, PhoneOff, Plus, Search, Sparkles, SquarePen, UserRound, Video,
  VideoOff, X };
const updateIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.8 } });

function resetSubscriptions() {
  subscriptions.forEach(stop => stop()); subscriptions = [];
  messageSub?.(); messageSub = null;
  callSub?.(); callSub = null;
  state.profile = null; state.chats = []; state.calls = []; state.messages = [];
  state.chatId = null; state.mobileList = true;
}

onAuthStateChanged(auth, user => {
  resetSubscriptions(); state.user = user;
  if (user?.emailVerified) subscribeProfile();
  render();
});

function subscribeProfile() {
  if (!state.user) return;
  subscriptions.push(onSnapshot(doc(db, 'users', state.user.uid), snapshot => {
    const old = !!state.profile;
    state.profile = snapshot.exists() ? snapshot.data() : null;
    if (state.profile && !old) subscribeData();
    render();
  }, fail));
}
function subscribeData() {
  const uid = state.user.uid;
  subscriptions.push(onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', uid)), snapshot => {
    state.chats = snapshot.docs.map(item => ({id: item.id, ...item.data()}))
      .sort((a,b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
    if (!state.activeCall) render();
  }, fail));
  subscriptions.push(onSnapshot(query(collection(db, 'calls'), where('members', 'array-contains', uid)), snapshot => {
    state.calls = snapshot.docs.map(item => ({id: item.id, ...item.data()}))
      .filter(call => call.status !== 'ended' && (!timestamp(call.createdAt) || Date.now() - timestamp(call.createdAt) < 7200000));
    if (!state.activeCall) render();
  }, fail));
}
function selectChat(id) {
  messageSub?.(); messageSub = null;
  state.chatId = id; state.draft = ''; state.messages = []; state.mobileList = false;
  render();
  messageSub = onSnapshot(query(collection(db, 'chats', id, 'messages'), orderBy('createdAt','desc'), limit(100)), snapshot => {
    state.messages = snapshot.docs.map(item => ({id:item.id, ...item.data(), pending:item.metadata.hasPendingWrites()})).reverse();
    if (!state.activeCall) render();
  }, fail);
}

function render() {
  if (!state.user) return renderAuth();
  if (!state.user.emailVerified) return renderVerify();
  if (!state.profile) return renderProfile();
  if (state.activeCall) return renderCall();
  renderMessenger();
}
const brand = () => `<div class="brandmark">${icon('MessageCircle',26)}</div><span class="brandname">noma<span class="branddot">.</span></span>`;
function renderAuth() {
  const signup = state.authMode === 'signup';
  root.innerHTML = `<main class="auth-page"><section class="auth-intro"><div class="auth-brand">${brand()}</div><div class="auth-copy"><div class="eyebrow light">A calmer way to stay close</div><h1>Conversations that<br>feel like home<span>.</span></h1><p>One to one, or all together. Pick up where you left off on Noma Web.</p></div><div class="auth-art"><div class="art-bubble one">Hey, are we still on for Sunday? <span>10:42</span></div><div class="art-bubble two">Absolutely. Can’t wait ✨ <span>10:43</span></div><div class="art-bubble three">See you there! <span>10:43</span></div></div><small>Made for the moments in between.</small></section><section class="auth-panel"><div class="mobile-brand">${brand()}</div><div class="auth-card"><div class="eyebrow">NOMA WEB</div><h2>${signup ? 'Let’s get started.' : 'Welcome back.'}</h2><p class="subtle">${signup ? 'Create an account and verify your email to join the conversation.' : 'Sign in to continue your conversations.'}</p><form id="auth-form"><label>Email address<input name="email" type="email" placeholder="you@example.com" autocomplete="email" required></label><label>Password<input name="password" type="password" minlength="6" placeholder="At least 6 characters" autocomplete="${signup ? 'new-password' : 'current-password'}" required></label>${!signup ? '<button type="button" id="forgot" class="text-button forgot">Forgot password?</button>' : ''}<button class="primary wide" type="submit" ${state.busy ? 'disabled' : ''}>${signup ? 'Create account' : 'Sign in'} ${icon('ArrowRight',18)}</button></form><p class="auth-switch">${signup ? 'Already have an account?' : 'New to Noma?'} <button id="switch-mode" class="text-button">${signup ? 'Sign in' : 'Create an account'}</button></p><div class="auth-foot">Your email is verified. Your phone number is reserved to your account but its ownership is not verified.</div></div></section></main><div id="toast" class="toast"></div>`;
  updateIcons();
  $('#switch-mode').onclick = () => { state.authMode = signup ? 'signin' : 'signup'; render(); };
  $('#auth-form').onsubmit = async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    state.busy = true; const button = event.currentTarget.querySelector('button[type=submit]'); button.disabled = true;
    try {
      if (signup) {
        const credential = await createUserWithEmailAndPassword(auth, data.get('email').trim(), data.get('password'));
        await sendEmailVerification(credential.user);
        show('Check your inbox for the verification link.');
      } else await signInWithEmailAndPassword(auth, data.get('email').trim(), data.get('password'));
    } catch (error) { fail(error); } finally { state.busy = false; button.disabled = false; }
  };
  if (!signup) $('#forgot').onclick = async () => {
    const email = $('#auth-form [name=email]').value.trim();
    if (!email) return show('Enter your email address first.', true);
    try { await sendPasswordResetEmail(auth, email); show('Password reset email sent.'); } catch (error) { fail(error); }
  };
}
function renderVerify() {
  root.innerHTML = `<main class="setup-page"><div class="setup-card"><div class="setup-icon">${icon('MailCheck',32)}</div><div class="eyebrow">ONE QUICK STEP</div><h1>Check your inbox.</h1><p>We sent a verification link to <strong>${h(state.user.email)}</strong>. Open it, then come back here.</p><button id="verified" class="primary wide">I’ve verified my email ${icon('ArrowRight',18)}</button><button id="resend" class="quiet wide">Resend verification email</button><button id="logout" class="text-button centered">Use another account</button></div></main><div id="toast" class="toast"></div>`;
  updateIcons();
  $('#verified').onclick = async () => {
    try { await reload(state.user); await getIdToken(state.user, true); if (!state.user.emailVerified) return show('Email not verified yet. Try again after opening the link.', true); subscribeProfile(); render(); }
    catch (error) { fail(error); }
  };
  $('#resend').onclick = async () => { try { await sendEmailVerification(state.user); show('Verification email sent.'); } catch(error) { fail(error); } };
  $('#logout').onclick = () => signOut(auth);
}
function renderProfile() {
  root.innerHTML = `<main class="setup-page"><div class="setup-card"><div class="setup-icon">${icon('UserRound',32)}</div><div class="eyebrow">YOUR NOMA PROFILE</div><h1>Make it yours.</h1><p>Friends will find you by your phone number. Each number can be claimed by only one account.</p><form id="profile-form"><label>Display name<input name="name" placeholder="Your name" minlength="2" maxlength="40" required></label><label>Phone number<input name="phone" type="tel" placeholder="+61412345678" required></label><p class="fine">Use your full international number. Noma does not verify phone ownership by SMS.</p><button class="primary wide" type="submit">Start chatting ${icon('ArrowRight',18)}</button></form><button id="logout" class="text-button centered">Use another account</button></div></main><div id="toast" class="toast"></div>`;
  updateIcons(); $('#logout').onclick = () => signOut(auth);
  $('#profile-form').onsubmit = async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const name = data.get('name').trim(), phone = normalizePhone(data.get('phone'));
    if (!E164.test(phone)) return show('Use a full number such as +61412345678.', true);
    const button = event.currentTarget.querySelector('button[type=submit]'); button.disabled = true;
    try {
      const userRef = doc(db,'users',state.user.uid), indexRef = doc(db,'phoneIndex',phone);
      await runTransaction(db, async tx => {
        if ((await tx.get(userRef)).exists() || (await tx.get(indexRef)).exists()) throw Error('This account or number is already claimed.');
        tx.set(indexRef, {uid:state.user.uid, displayName:name, phone});
        tx.set(userRef, {displayName:name, phone, createdAt:serverTimestamp()});
      });
    } catch(error) { fail(error); } finally { button.disabled = false; }
  };
}

function renderMessenger() {
  const chat = chatById(state.chatId);
  const incoming = state.calls.find(call => call.callerId !== state.user.uid);
  root.innerHTML = `<div class="app-shell ${state.mobileList ? 'show-list' : 'show-thread'}"><aside class="rail"><div class="rail-logo">${icon('MessageCircle',25)}</div><button class="rail-button active" title="Chats">${icon('MessagesSquare')}</button><div class="rail-spacer"></div><button class="rail-button" id="rail-profile" title="Profile">${icon('UserRound')}</button></aside><aside class="sidebar"><div class="side-heading"><div><div class="side-kicker">YOUR SPACE</div><h1>Messages<span>.</span></h1></div><button class="circle-button" id="new-chat" aria-label="New conversation" title="New conversation">${icon('SquarePen',20)}</button></div><div class="search-wrap">${icon('Search',18)}<input id="search" placeholder="Search conversations" value="${h(state.search)}" aria-label="Search conversations"><kbd>⌘ K</kbd></div><div class="list-label"><span>RECENT</span><span>${state.chats.length}</span></div><div class="chat-list" id="chat-list">${chatListHtml()}</div><div class="side-footer"><div class="profile-summary">${avatar(state.profile.displayName,'small')}<div><strong>${h(state.profile.displayName)}</strong><span>${h(state.profile.phone)}</span></div></div><button class="footer-menu" id="profile-menu" aria-label="Profile options">${icon('Ellipsis',21)}</button></div></aside><main class="thread">${chat ? threadHtml(chat) : welcomeHtml()}</main>${incoming ? incomingHtml(incoming) : ''}</div>${state.modal ? modalHtml() : ''}<div id="toast" class="toast ${state.notice ? 'visible' : ''}">${h(state.notice)}</div>`;
  updateIcons(); attachMessengerEvents();
  if (chat) { const list = $('#message-list'); if (list) list.scrollTop = list.scrollHeight; }
}
function chatListHtml() {
  const filtered = state.chats.filter(chat => label(chat).toLowerCase().includes(state.search.toLowerCase()));
  return filtered.length ? filtered.map(chat => `<button class="chat-row ${state.chatId === chat.id ? 'selected' : ''}" data-chat="${h(chat.id)}">${avatar(label(chat))}<span class="row-main"><span class="row-title">${h(label(chat))}</span><span class="row-preview">${h(chat.lastText || (chat.kind === 'group' ? 'Group created' : 'Say hello 👋'))}</span></span><span class="row-time">${shortDate(timestamp(chat.updatedAt)) || 'New'}</span></button>`).join('') : `<div class="empty-list"><div class="empty-icon">${icon('MessageCircleMore',25)}</div><strong>${state.search ? 'No conversations found' : 'No conversations yet'}</strong><span>${state.search ? 'Try another name.' : 'Start one with a phone number.'}</span></div>`;
}
function welcomeHtml() { return `<div class="welcome"><div class="welcome-art"><div class="welcome-orbit"></div><div class="welcome-mark">${icon('MessageCircle',48)}</div><div class="tiny-star one">✦</div><div class="tiny-star two">✦</div></div><div class="eyebrow">WELCOME TO NOMA WEB</div><h2>Your conversations,<br>right where you left them.</h2><p>Choose a chat to pick up the conversation, or start something new.</p><button id="welcome-new" class="primary">${icon('Plus',19)} New conversation</button><div class="welcome-foot">Private by default for chat participants · Messages are not end-to-end encrypted</div></div>`; }
function threadHtml(chat) {
  const name = label(chat);
  return `<div class="thread-head"><button class="back-button" id="back-list" aria-label="Back to chats">${icon('ArrowLeft',20)}</button>${avatar(name,'small')}<div class="thread-person"><strong>${h(name)}</strong><span>${chat.kind === 'group' ? `${chat.members.length} members` : 'Noma conversation'}</span></div><div class="thread-actions"><button class="head-action" id="voice-call" aria-label="Voice call" title="Voice call">${icon('Phone',20)}</button><button class="head-action" id="video-call" aria-label="Video call" title="Video call">${icon('Video',21)}</button><button class="head-action" id="chat-info" aria-label="Conversation details" title="Conversation details">${icon('Info',20)}</button></div></div><div class="messages" id="message-list"><div class="date-divider"><span>Conversation</span></div>${state.messages.length ? state.messages.map(message => messageHtml(message,chat)).join('') : `<div class="first-message"><div>${icon('Sparkles',24)}</div><h3>A good place to begin.</h3><p>Send a message to ${h(name)}.</p></div>`}</div><form class="composer" id="composer"><div class="composer-inner"><textarea id="draft" rows="1" maxlength="4000" placeholder="Write a message…" aria-label="Write a message">${h(state.draft)}</textarea><button class="send-button" aria-label="Send message" title="Send message" ${state.draft.trim() ? '' : 'disabled'}>${icon('ArrowUp',20)}</button></div><div class="composer-hint">Enter to send · Shift + Enter for a new line</div></form>`;
}
function messageHtml(message, chat) {
  const mine = message.senderId === state.user.uid;
  return `<div class="message-line ${mine ? 'mine' : 'theirs'}">${!mine ? avatar(chat.names?.[message.senderId] || 'Member','micro') : ''}<div class="bubble-wrap">${!mine && chat.kind === 'group' ? `<div class="sender-name">${h(chat.names?.[message.senderId] || 'Member')}</div>` : ''}<div class="bubble">${h(message.text)}</div><span class="message-meta">${message.pending ? 'Sending…' : clock(timestamp(message.createdAt))}</span></div></div>`;
}
function incomingHtml(call) {
  const chat = chatById(call.chatId), name = chat ? label(chat) : 'Someone';
  return `<div class="incoming">${avatar(name,'small')}<div><strong>${h(name)}</strong><span>Incoming ${call.video ? 'video' : 'voice'} call</span></div><button id="decline" class="decline" aria-label="Decline">${icon('PhoneOff',19)}</button><button id="answer" class="answer" aria-label="Answer">${icon('Phone',19)}</button></div>`;
}
function modalHtml() {
  const chat = chatById(state.chatId);
  if (state.modal === 'profile') return `<div class="modal-backdrop" id="modal-backdrop"><section class="modal"><button class="modal-close" id="modal-close" aria-label="Close">${icon('X')}</button><div class="modal-hero">${avatar(state.profile.displayName,'large')}<h2>${h(state.profile.displayName)}</h2><p>${h(state.profile.phone)}</p></div><div class="modal-note">Your phone number is reserved for this account. Ownership is not verified by SMS.</div><button id="signout" class="secondary wide">${icon('LogOut',18)} Sign out</button></section></div>`;
  if (state.modal === 'info' && chat) return `<div class="modal-backdrop" id="modal-backdrop"><section class="modal"><button class="modal-close" id="modal-close" aria-label="Close">${icon('X')}</button><div class="modal-hero">${avatar(label(chat),'large')}<h2>${h(label(chat))}</h2><p>${chat.kind === 'group' ? `${chat.members.length} members` : 'One to one conversation'}</p></div><div class="member-list">${chat.members.map(id => `<div>${avatar(chat.names?.[id] || 'Member','small')}<span>${h(chat.names?.[id] || 'Member')}${id === state.user.uid ? ' (you)' : ''}</span></div>`).join('')}</div></section></div>`;
  return `<div class="modal-backdrop" id="modal-backdrop"><section class="modal new-modal"><button class="modal-close" id="modal-close" aria-label="Close">${icon('X')}</button><div class="eyebrow">START SOMETHING NEW</div><h2>New conversation</h2><p>Find friends by their full international phone number.</p><form id="new-form"><div class="segment"><label><input type="radio" name="kind" value="direct" checked><span>One to one</span></label><label><input type="radio" name="kind" value="group"><span>Group</span></label></div><label id="group-title" class="hidden">Group name<input name="title" placeholder="Give your group a name" maxlength="60"></label><label>Phone number<span id="phone-plural"></span><textarea name="numbers" placeholder="+61412345678" rows="3" required></textarea></label><p class="fine">For groups, separate numbers with commas or new lines. Everyone must already have a Noma account.</p><button class="primary wide" type="submit">Start chat ${icon('ArrowRight',18)}</button></form></section></div>`;
}
function attachMessengerEvents() {
  $('#new-chat').onclick = () => { state.modal='new'; render(); };
  $('#welcome-new')?.addEventListener('click', () => { state.modal='new'; render(); });
  $('#rail-profile').onclick = $('#profile-menu').onclick = () => { state.modal='profile'; render(); };
  $('#search').oninput = event => { state.search = event.target.value; $('#chat-list').innerHTML = chatListHtml(); updateIcons(); bindRows(); };
  bindRows();
  $('#back-list')?.addEventListener('click', () => { state.mobileList=true; state.chatId=null; messageSub?.(); messageSub=null; render(); });
  $('#voice-call')?.addEventListener('click', () => startCall(false));
  $('#video-call')?.addEventListener('click', () => startCall(true));
  $('#chat-info')?.addEventListener('click', () => { state.modal='info'; render(); });
  $('#draft')?.addEventListener('input', event => { state.draft=event.target.value; $('.send-button').disabled=!state.draft.trim(); event.target.style.height='auto'; event.target.style.height=Math.min(event.target.scrollHeight,136)+'px'; });
  $('#draft')?.addEventListener('keydown', event => { if (event.key==='Enter' && !event.shiftKey) { event.preventDefault(); $('#composer').requestSubmit(); } });
  $('#composer')?.addEventListener('submit', sendMessage);
  $('#answer')?.addEventListener('click', () => joinCall(state.calls.find(call => call.callerId !== state.user.uid)));
  $('#decline')?.addEventListener('click', async () => { const call=state.calls.find(c => c.callerId !== state.user.uid); if (call) await endCall(call.id); });
  $('#modal-close')?.addEventListener('click', closeModal);
  $('#modal-backdrop')?.addEventListener('click', event => { if (event.target.id === 'modal-backdrop') closeModal(); });
  $('#signout')?.addEventListener('click', () => signOut(auth));
  $('#new-form')?.addEventListener('submit', createChat);
  root.querySelectorAll('[name=kind]').forEach(radio => radio.onchange = () => { const group = root.querySelector('[name=kind]:checked').value==='group'; $('#group-title').classList.toggle('hidden',!group); $('#phone-plural').textContent=group?'s':''; $('#new-form [name=numbers]').placeholder=group?'+61412345678, +61498765432':'+61412345678'; });
}
function bindRows() { root.querySelectorAll('[data-chat]').forEach(button => button.onclick = () => selectChat(button.dataset.chat)); }
function closeModal() { state.modal=null; render(); }
async function createChat(event) {
  event.preventDefault(); const form=event.currentTarget, data=new FormData(form);
  const group=data.get('kind')==='group'; const title=String(data.get('title')||'').trim();
  const numbers=String(data.get('numbers')||'').split(/[,\n]/).map(normalizePhone).filter(Boolean);
  if (numbers.length < (group ? 2 : 1) || numbers.length > (group ? 19 : 1) || new Set(numbers).size !== numbers.length || numbers.some(p=>!E164.test(p)) || (group && title.length < 2)) return show('Check the group name and phone numbers.',true);
  form.querySelector('button[type=submit]').disabled=true;
  try {
    const found=await Promise.all(numbers.map(phone => getDoc(doc(db,'phoneIndex',phone))));
    if (found.some(item=>!item.exists())) throw Error('One or more people have not joined Noma.');
    const people=found.map(item=>item.data());
    if (people.some(person=>person.uid===state.user.uid) || new Set(people.map(person=>person.uid)).size!==people.length) throw Error('Please check for duplicate accounts.');
    const members=[state.user.uid,...people.map(person=>person.uid)].sort();
    const names=Object.fromEntries([[state.user.uid,state.profile.displayName],...people.map(person=>[person.uid,person.displayName])]);
    const ref=group ? doc(collection(db,'chats')) : doc(db,'chats',`dm_${members.join('_')}`);
    await runTransaction(db,async tx=>{
      if (!(await tx.get(ref)).exists()) tx.set(ref,{kind:group?'group':'direct',title:group?title:'',members,names,createdBy:state.user.uid,lastText:'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    });
    state.modal=null; selectChat(ref.id);
  } catch(error) { fail(error); } finally { form.querySelector('button[type=submit]').disabled=false; }
}
async function sendMessage(event) {
  event.preventDefault(); const text=state.draft.trim(); if (!text || !state.chatId) return;
  const id=state.chatId, field=$('#draft'); state.draft=''; if(field) {field.value=''; field.style.height='auto';} $('.send-button').disabled=true;
  try {
    const chatRef=doc(db,'chats',id), msgRef=doc(collection(db,'chats',id,'messages'));
    const batch=writeBatch(db);
    batch.set(msgRef,{senderId:state.user.uid,text,createdAt:serverTimestamp()});
    batch.update(chatRef,{lastText:text.slice(0,160),updatedAt:serverTimestamp()});
    await batch.commit();
  } catch(error) { state.draft=text; if(field) field.value=text; fail(error); }
}
async function startCall(video) {
  const chat=chatById(state.chatId); if(!chat) return;
  try {
    const ref=doc(collection(db,'calls'));
    await setDoc(ref,{chatId:chat.id,members:chat.members,callerId:state.user.uid,video,status:'ringing',createdAt:serverTimestamp()});
    joinCall({id:ref.id,chatId:chat.id,video,callerId:state.user.uid});
  } catch(error) { fail(error); }
}
async function endCall(id) {
  try { const batch=writeBatch(db); batch.update(doc(db,'calls',id),{status:'ended'}); await batch.commit(); } catch(error) { fail(error); }
}
async function joinCall(call) {
  if(!call) return;
  state.activeCall=call; state.callConnected=false; state.muted=false; state.cameraOn=!!call.video; renderCall();
  callSub?.();
  callSub=onSnapshot(doc(db,'calls',call.id), snapshot=>{
    if ((!snapshot.exists() || snapshot.data().status==='ended') && state.activeCall?.id===call.id) leaveCall(false);
  }, fail);
  try {
    const idToken=await state.user.getIdToken();
    const response=await fetch(callTokenUrl,{method:'POST',headers:{Authorization:`Bearer ${idToken}`,'Content-Type':'application/json'},body:JSON.stringify({callId:call.id})});
    const result=await response.json(); if(!response.ok) throw Error(result.error||'Call unavailable');
    if(state.activeCall?.id!==call.id) return;
    const room=new Room({adaptiveStream:true,dynacast:true}); state.room=room;
    room.on(RoomEvent.TrackSubscribed,(track)=>{
      if(track.kind===Track.Kind.Audio) { const element=track.attach(); element.autoplay=true; $('#remote-audio')?.appendChild(element); }
      if(track.kind===Track.Kind.Video) $('#remote-video')?.appendChild(track.attach());
    });
    room.on(RoomEvent.TrackUnsubscribed,track=>track.detach().forEach(element=>element.remove()));
    room.on(RoomEvent.Disconnected,()=>{ if(state.activeCall?.id===call.id) leaveCall(false); });
    await room.connect(result.url,result.token);
    await room.localParticipant.setMicrophoneEnabled(true);
    if(call.video) await room.localParticipant.setCameraEnabled(true);
    state.callConnected=true; updateCallStatus();
    if(call.video) attachLocalVideo();
    if(!room.canPlaybackAudio) $('#enable-audio')?.classList.remove('hidden');
  } catch(error) { fail(error); await endCall(call.id); leaveCall(false); }
}
function attachLocalVideo() {
  const track=state.room?.localParticipant?.getTrackPublication(Track.Source.Camera)?.track;
  const target=$('#local-video'); if(track && target) { target.replaceChildren(track.attach()); target.classList.remove('hidden'); }
}
function updateCallStatus() { const item=$('#call-status'); if(item) item.textContent=state.callConnected?'Connected':'Connecting…'; }
function renderCall() {
  const call=state.activeCall; if(!call) return renderMessenger();
  const chat=chatById(call.chatId), name=chat?label(chat):'Noma call';
  root.innerHTML=`<div class="call-page"><div class="call-top"><div class="call-brand">${brand()}</div><span>ENCRYPTED IN TRANSIT</span></div><div class="call-center"><div class="call-video ${call.video?'':'hidden'}" id="remote-video"><div class="video-placeholder">Waiting for video…</div></div><div id="local-video" class="local-video hidden"></div><div class="call-avatar ${call.video?'compact':''}">${avatar(name,'huge')}</div><h1>${h(name)}</h1><p id="call-status">${state.callConnected?'Connected':'Connecting…'}</p><button id="enable-audio" class="secondary hidden">Enable audio</button><div id="remote-audio" class="visually-hidden"></div></div><div class="call-controls"><button id="toggle-mic" class="call-control" aria-label="Mute microphone">${icon(state.muted?'MicOff':'Mic',23)}<span>${state.muted?'Unmute':'Mute'}</span></button>${call.video?`<button id="toggle-camera" class="call-control" aria-label="Toggle camera">${icon(state.cameraOn?'Video':'VideoOff',23)}<span>${state.cameraOn?'Camera off':'Camera on'}</span></button>`:''}<button id="hangup" class="call-control hangup" aria-label="End call">${icon('PhoneOff',23)}<span>End call</span></button></div></div><div id="toast" class="toast"></div>`;
  updateIcons();
  $('#hangup').onclick=()=>leaveCall(true);
  $('#toggle-mic').onclick=async()=>{if(!state.room)return; state.muted=!state.muted; try{await state.room.localParticipant.setMicrophoneEnabled(!state.muted);$('#toggle-mic').innerHTML=`${icon(state.muted?'MicOff':'Mic',23)}<span>${state.muted?'Unmute':'Mute'}</span>`;updateIcons();}catch(error){fail(error);}};
  $('#toggle-camera')?.addEventListener('click',async()=>{if(!state.room)return; state.cameraOn=!state.cameraOn;try{await state.room.localParticipant.setCameraEnabled(state.cameraOn);$('#toggle-camera').innerHTML=`${icon(state.cameraOn?'Video':'VideoOff',23)}<span>${state.cameraOn?'Camera off':'Camera on'}</span>`;updateIcons();if(state.cameraOn)attachLocalVideo();else $('#local-video')?.replaceChildren();}catch(error){fail(error);}});
  $('#enable-audio').onclick=async()=>{try{await state.room.startAudio();$('#enable-audio').classList.add('hidden');}catch(error){fail(error);}};
}
function leaveCall(updateFirestore) {
  const id=state.activeCall?.id;
  callSub?.(); callSub=null;
  const room=state.room; state.room=null; state.activeCall=null; state.callConnected=false;
  room?.disconnect();
  if(updateFirestore && id) endCall(id);
  render();
}
window.addEventListener('keydown',event=>{
  if(event.key==='Escape' && state.modal) closeModal();
  if((event.metaKey||event.ctrlKey) && event.key.toLowerCase()==='k' && state.profile) {event.preventDefault();$('#search')?.focus();}
});
root.innerHTML='<div class="loading"><div class="brandmark">✳</div><span>Loading Noma…</span></div>';
