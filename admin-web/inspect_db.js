const fs = require('fs');
let envFile = '';
if (fs.existsSync('.env.local')) envFile = fs.readFileSync('.env.local', 'utf8');
else if (fs.existsSync('../.env')) envFile = fs.readFileSync('../.env', 'utf8');

const env = {};
envFile.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts[0] && parts.length > 1) {
    env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
});

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_KEY
);

async function check() {
  const dns = require('dns');
  dns.setDefaultResultOrder('ipv4first');
  const cheerio = require('cheerio');
  const res = await fetch('https://transactioninfo.ethiotelecom.et/receipt/DEH63S5O8S', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ');

  // Direct label-to-label regex
  const payerMatch = text.match(/(?:የከፋይ\s*ስም\/Payer\s*Name|Payer\s*Name)\s+([A-Za-z\u1200-\u137F\s.]+?)(?=\s*(?:የከፋይ\s*ቴሌብር|Payer\s*telebirr|የከፋይ\s*አካውንት))/i);
  console.log('REGEX PAYER NAME:', payerMatch ? payerMatch[1].trim() : 'NOT FOUND');

  const phoneMatch = text.match(/(?:የከፋይ\s*ቴሌብር\s*ቁ\.?\/Payer\s*telebirr\s*no\.?|Payer\s*telebirr\s*no\.?)\s+([0-9*]{10,15})/i);
  console.log('REGEX PAYER PHONE:', phoneMatch ? phoneMatch[1].trim() : 'NOT FOUND');

  const creditedMatch = text.match(/(?:የገንዘብ\s*ተቀባይ\s*ስም\/Credited\s*Party\s*name|Credited\s*Party\s*name)\s+([A-Za-z\u1200-\u137F\s.]+?)(?=\s*(?:የገንዘብ\s*ተቀባይ\s*ቴሌብር|Credited\s*party\s*account))/i);
  console.log('REGEX CREDITED PARTY:', creditedMatch ? creditedMatch[1].trim() : 'NOT FOUND');
}

check().catch(console.error);
