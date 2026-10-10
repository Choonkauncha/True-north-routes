import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {passwordChangeError} from '../lib/password-reset.js';
const event={preventDefault(){}};
function surface(ids){const nodes=Object.fromEntries(ids.map(id=>[id,{value:id.endsWith('1')?'new-password':id.endsWith('2')?'new-password':'',textContent:'',disabled:false,classList:{add(){},remove(){}}}]));const button={disabled:false,textContent:'Save password'};return {nodes,button,document:{getElementById:id=>nodes[id],querySelector:()=>button,querySelectorAll:()=>ids.filter(id=>/1|2/.test(id)).map(id=>nodes[id])}};}
const gateSource=readFileSync(new URL('../tn-files/password-gate.js',import.meta.url),'utf8');
const gateSave=gateSource.slice(gateSource.indexOf('async function save('),gateSource.indexOf('\nfunction storageKeys'));
let ui=surface(['tnGate1','tnGate2','tnGateError']);let calls=0,done=false;
const gate=vm.createContext({...ui,passwordGateProblem:passwordChangeError,passwordUpdateError:()=> 'retry',showSaved:()=>{done=true},setTimeout:()=>{},location:{reload(){}},gateFetch:async()=>{calls++;if(calls===1)return {ok:true,json:async()=>({})};throw Error('network offline')}});
vm.runInContext(gateSave,gate);const ctx={url:'https://example',key:'public',token:'user'};
await gate.save(event,ctx,ui.nodes.tnGateError);assert.match(ui.nodes.tnGateError.textContent,/password was saved/);assert.equal(ui.button.disabled,false);assert.equal(ui.button.textContent,'Retry account verification');assert.equal(ui.nodes.tnGate1.value,'');
gate.gateFetch=async()=>({ok:true});await gate.save(event,ctx,ui.nodes.tnGateError);assert.equal(done,true);assert.equal(calls,2,'Retry skips password update and only clears the gate');
ui=surface(['tnGate1','tnGate2','tnGateError']);const failed=vm.createContext({...ui,passwordGateProblem:passwordChangeError,passwordUpdateError:()=> 'retry',gateFetch:async()=>{throw Error('offline')}});vm.runInContext(gateSave,failed);await failed.save(event,{},ui.nodes.tnGateError);assert.match(ui.nodes.tnGateError.textContent,/could not confirm/);assert.equal(ui.button.disabled,false);
const resetSource=readFileSync(new URL('../tn-files/reset-page.js',import.meta.url),'utf8');const resetSave=resetSource.slice(resetSource.indexOf('async function save('),resetSource.indexOf('\nasync function start'));
ui=surface(['pw1','pw2','pwMsg']);let updates=0,attempts=0;const sb={auth:{updateUser:async()=>{updates++;return{}},signOut:async()=>{}},rpc:async()=>{if(attempts++===0)throw Error('offline');return{}}};
const reset=vm.createContext({...ui,savedClients:new WeakSet(),passwordChangeError,passwordUpdateError:()=> 'retry',location:{}});vm.runInContext(resetSave,reset);await reset.save(event,sb);assert.match(ui.nodes.pwMsg.textContent,/password was saved/);assert.equal(ui.button.disabled,false);await reset.save(event,sb);assert.equal(updates,1);assert.equal(reset.location.href,'/?reset=1');
console.log('Password save network failures, secret field clearing and verification-only retries passed');
