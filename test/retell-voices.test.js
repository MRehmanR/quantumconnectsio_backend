const test = require('node:test');
const assert = require('node:assert/strict');
process.env.RETELL_API_KEY = 'test-key';
const { listVoices, updateVoice } = require('../src/services/retell-voices.service');
test('catalog preserves distinct provider IDs and audio URLs', async t => {
 t.mock.method(global, 'fetch', async () => ({ok:true,json:async()=>[
  {voice_id:'voice-a',voice_name:'Actor A',preview_audio_url:'https://audio.example/a.mp3',gender:'female'},
  {voice_id:'voice-b',voice_name:'Actor B',preview_audio_url:'https://audio.example/b.mp3',gender:'male'},
  {voice_id:'voice-c',voice_name:'No preview',preview_audio_url:'javascript:bad'}
 ]}));
 const voices=await listVoices();
 assert.deepEqual(voices.map(v=>[v.id,v.previewUrl]),[['voice-a','https://audio.example/a.mp3'],['voice-b','https://audio.example/b.mp3'],['voice-c',null]]);
});
test('agent voice update uses selected provider ID and documented endpoint', async t=>{
 const calls=[];
 t.mock.method(global,'fetch',async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/list-voices')?[{voice_id:'voice-b',voice_name:'Actor B'}]:{voice_id:'voice-b'}}});
 await updateVoice({agentId:'agent-123',voiceId:'voice-b'});
 assert.equal(calls[1].url,'https://api.retellai.com/update-agent/agent-123');
 assert.equal(calls[1].options.method,'PATCH');
 assert.deepEqual(JSON.parse(calls[1].options.body),{voice_id:'voice-b'});
 await assert.rejects(updateVoice({agentId:'agent-123',voiceId:'Actor B'}),/not available/);
});
