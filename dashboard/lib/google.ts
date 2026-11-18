'use client';

import {getApps,initializeApp} from 'firebase/app';
import {browserPopupRedirectResolver,GoogleAuthProvider,initializeAuth,inMemoryPersistence,signInWithPopup,signOut,type Auth} from 'firebase/auth';
import {firebaseWebConfig,googleLoginBody,type FirebaseWebConfig} from './google-contract';
import {ClientError} from './client';

function googleAuth(config:FirebaseWebConfig) {
  const checked=firebaseWebConfig(config);
  const name='notify-google-owner';
  const existing=getApps().find(app=>app.name===name);
  if (existing && Object.keys(checked).some(key=>existing.options[key as keyof FirebaseWebConfig]!==checked[key as keyof FirebaseWebConfig])) throw Error('server_configuration');
  const app=existing ?? initializeApp(checked,name);
  return initializeAuth(app,{persistence:inMemoryPersistence,popupRedirectResolver:browserPopupRedirectResolver});
}

// Prepare only SDK state; opening the provider window still requires a user click.
export function prepareGoogleSignIn(config:FirebaseWebConfig) { googleAuth(config); }

export async function signInGoogleOwner(config:FirebaseWebConfig, exchange:(body:{id_token:string}, identity:{uid:string})=>Promise<void>) {
  let auth:Auth|undefined;
  try {
    auth=googleAuth(config);
    const provider=new GoogleAuthProvider();
    provider.setCustomParameters({prompt:'select_account'});
    const result=await signInWithPopup(auth,provider);
    if (!result.user.uid || !result.user.emailVerified) throw Error('invalid_google_account');
    // Firebase's token is the backend proof, not Google's OAuth access/ID token.
    const token=await result.user.getIdToken(true);
    await exchange(googleLoginBody({id_token:token}),{uid:result.user.uid});
  } catch (cause) {
    const code=typeof cause==='object' && cause!==null && 'code' in cause ? String(cause.code) : '';
    if (['auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(code)) throw Error('ยกเลิกการเข้าสู่ระบบ Google แล้ว');
    if (code==='auth/popup-blocked') throw Error('เบราว์เซอร์ปิดกั้นหน้าต่าง Google กรุณาอนุญาต popup แล้วกดใหม่');
    if (code.startsWith('auth/')) throw Error('เข้าสู่ระบบ Google ไม่สำเร็จ กรุณาตรวจการตั้งค่า Firebase หรือกดลองใหม่');
    if (cause instanceof ClientError) throw cause;
    throw Error('เข้าสู่ระบบ Google ไม่สำเร็จ กรุณาตรวจการตั้งค่า Firebase หรือกดลองใหม่');
  } finally {
    // Local opaque HttpOnly sessions are authoritative after the exchange.
    if (auth) await signOut(auth).catch(()=>undefined);
  }
}
