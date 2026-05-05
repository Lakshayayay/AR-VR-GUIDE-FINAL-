import fetch from 'node-fetch';

const KEY = 'AIzaSyDqErr5GDejFAZKu25hYR2yCHLg1LeoDYQ';
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${KEY}`);
const data = await res.json();
if (data.error) { console.error('API Error:', data.error); process.exit(1); }
data.models
  .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
  .forEach(m => console.log(m.name));
