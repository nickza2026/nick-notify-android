import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {ClientError} from '../lib/client';
registerHooks({resolve(specifier,context,next){if(['firebase/app','firebase/auth'].includes(specifier))return {url:new URL('./firebase-sdk-mock.mjs',import.meta.url).href,shortCircuit:true};return next(specifier,context);}});
const google=import('../lib/google');
// Test-only facade; production uses the installed official SDK, not this file.
const mock=()=>import('./firebase-sdk-mock.mjs');
const config={apiKey:'SYNTHETIC_PUBLIC_CLIENT_KEY',authDomain:'synthetic-owner.firebaseapp.com',projectId:'synthetic-owner',appId:'1:123:web:synthetic'};
test('SDK exchange uses in-memory Firebase auth and clears it after backend exchange or UID-only setup',async()=>{
  const {state}=await mock();const {prepareGoogleSignIn,signInGoogleOwner}=await google;state.apps.length=0;state.signouts=0;state.popupError=null;state.verified=true;state.uid='SYNTHETIC_SELF_UID';state.token='header.payload.signature';
  prepareGoogleSignIn(config);assert.deepEqual(state.persistence,{type:'NONE'});
  let calls=0;await signInGoogleOwner(config,async(body,identity)=>{calls++;assert.deepEqual(body,{id_token:'header.payload.signature'});assert.deepEqual(identity,{uid:'SYNTHETIC_SELF_UID'});});
  assert.equal(calls,1);assert.equal(state.signouts,1);assert.deepEqual(state.parameters,{prompt:'select_account'});
  let onlyUID='';await signInGoogleOwner(config,async(_body,identity)=>{onlyUID=identity.uid;});assert.equal(onlyUID,'SYNTHETIC_SELF_UID');assert.equal(state.signouts,2);
});
test('SDK errors are sanitized, cancellation is recognizable and cleanup also follows denied exchange',async()=>{
  const {state}=await mock();const {signInGoogleOwner}=await google;let calls=0;
  for(const code of ['auth/popup-closed-by-user','auth/popup-blocked','auth/network-request-failed']){
    state.popupError=Object.assign(Error('SYNTHETIC_RAW_TOKEN_MUST_NOT_APPEAR'),{code});
    await assert.rejects(signInGoogleOwner(config,async()=>{calls++;}),error=>error instanceof Error && !error.message.includes('SYNTHETIC_RAW_TOKEN'));
  }
  state.popupError=null;state.verified=false;await assert.rejects(signInGoogleOwner(config,async()=>{calls++;}));state.verified=true;
  state.token='not-a-jwt';await assert.rejects(signInGoogleOwner(config,async()=>{calls++;}));state.token='header.payload.signature';assert.equal(calls,0);
  const denied=new ClientError('บัญชีนี้ไม่ได้รับอนุญาต','google_account_not_allowed');await assert.rejects(signInGoogleOwner(config,async()=>{throw denied;}),error=>error===denied);
  assert.ok(state.signouts>=6);
});
