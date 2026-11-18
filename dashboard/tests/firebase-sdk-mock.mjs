// tsx can load this facade through both require(ESM) and import(ESM). Both
// paths must observe one fixture state, without changing production code.
const key=Symbol.for('notify.google.sdk.test-state');
export const state=globalThis[key]??=( {apps:[],signouts:0,popupError:null,uid:'SYNTHETIC_SELF_UID',verified:true,token:'header.payload.signature',persistence:null} );
export function getApps(){return state.apps;}
export function initializeApp(options,name){const app={options,name};state.apps.push(app);return app;}
export const inMemoryPersistence={type:'NONE'};
export const browserPopupRedirectResolver={};
export function initializeAuth(_app,options){state.persistence=options.persistence;return {};}
export class GoogleAuthProvider {setCustomParameters(value){state.parameters=value;}}
export async function signInWithPopup(){if(state.popupError)throw state.popupError;return {user:{uid:state.uid,emailVerified:state.verified,getIdToken:async()=>state.token}};}
export async function signOut(){state.signouts++;}
