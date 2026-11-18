import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backendAuthConfig,firebaseWebConfig,googleLoginBody,publicAuthConfig} from '../lib/google-contract';

const firebase={apiKey:'SYNTHETIC_PUBLIC_CLIENT_KEY',authDomain:'synthetic-owner.firebaseapp.com',projectId:'synthetic-owner',appId:'1:123456789:web:synthetic'};
test('auth mode has no owner UID and legacy mode does not carry a Firebase project',()=>{
  assert.deepEqual(backendAuthConfig({mode:'password',firebase_project_id:null}),{mode:'password',firebase_project_id:null});
  assert.deepEqual(backendAuthConfig({mode:'google',firebase_project_id:'synthetic-owner'}),{mode:'google',firebase_project_id:'synthetic-owner'});
  for(const value of [null,{},[],{mode:'google',firebase_project_id:null},{mode:'password',firebase_project_id:'synthetic-owner'},{mode:'google',firebase_project_id:'synthetic-owner',owner_uid:'private'},{mode:'google',firebase_project_id:'bad/project'},{mode:'unknown',firebase_project_id:null}])assert.throws(()=>backendAuthConfig(value));
});
test('public Firebase config is an exact four-field projection with safe domain and matching project',()=>{
  assert.deepEqual(firebaseWebConfig(firebase),firebase);
  assert.deepEqual(publicAuthConfig({mode:'google',firebase_project_id:'synthetic-owner',firebase}),{mode:'google',firebase_project_id:'synthetic-owner',firebase});
  assert.deepEqual(publicAuthConfig({mode:'password',firebase_project_id:null,firebase:null}),{mode:'password',firebase_project_id:null,firebase:null});
  for(const change of [{apiKey:''},{apiKey:'key\r\nsecret'},{authDomain:'https://evil.example/path'},{authDomain:'owner@evil.example'},{authDomain:'evil.example:443'},{authDomain:'evil.example/path'},{authDomain:'evil.example?x=y'},{projectId:'bad/project'},{owner_uid:'private'},{client_secret:'private'}])assert.throws(()=>firebaseWebConfig({...firebase,...change}));
  assert.throws(()=>publicAuthConfig({mode:'google',firebase_project_id:'another-project',firebase}));
  assert.throws(()=>publicAuthConfig({mode:'password',firebase_project_id:null,firebase}));
});
test('Google exchange body accepts only a bounded JWT-shaped ID token, never email or UID',()=>{
  assert.deepEqual(googleLoginBody({id_token:'header.payload.signature'}),{id_token:'header.payload.signature'});
  for(const value of [null,{},[],{id_token:null},{id_token:''},{id_token:'secret'},{id_token:'a.b.c\n'},{id_token:'a.b.c',uid:'owner'},{id_token:'a.b.c',email:'synthetic@example.org'},{id_token:'a.b.'+'x'.repeat(8190)}])assert.throws(()=>googleLoginBody(value));
});
