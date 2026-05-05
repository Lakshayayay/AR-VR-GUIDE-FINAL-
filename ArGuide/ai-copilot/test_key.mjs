// Quick text test to confirm key works
const KEY = 'AIzaSyDKthBIi-LZ_pVchxJty2RwxNRP7PGc6Jc';

const body = {
  contents: [{ parts: [{ text: 'You are an industrial safety AI. Describe 2 common safety hazards in 1 sentence each. Reply as JSON: {"anomalies":[{"type":"safety","severity":"high","description":"..."}]}' }] }]
};

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
);
const data = await res.json();
if (data.error) console.error('ERROR:', data.error.code, data.error.message.slice(0,120));
else {
  const text = data.candidates[0].content.parts[0].text.trim();
  console.log('SUCCESS - AI responded with:', text.slice(0, 200));
}
