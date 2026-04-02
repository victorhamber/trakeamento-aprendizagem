
import geoip from 'geoip-lite';
import { DDI_LIST } from './apps/api/src/lib/ddi';

function normalizePhone(phone: string, ip: string, country?: string): string {
  let p = phone.replace(/[^0-9]/g, '');
  if (p && p.length >= 10 && p.length <= 11) {
    let iso = (country || '').toUpperCase().trim();
    if (!iso && ip) {
      const geo = geoip.lookup(ip);
      if (geo?.country) iso = geo.country;
    }

    const targetCountry = iso || 'BR';
    console.log(`Detected Country ISO: ${targetCountry}`);
    
    const ddi = DDI_LIST.find(d => d.country === targetCountry)?.code;

    if (ddi) {
      if (!p.startsWith(ddi)) {
        p = ddi + p;
      }
    } else if (targetCountry === 'BR' || targetCountry === 'BRASIL') {
       if (!p.startsWith('55')) p = '55' + p;
    }
  }
  return p;
}

// Test 1: Mexican IP, 10 digit number, no country
const mexIp = '187.189.155.155'; // Example Mexican IP
const mexPhone = '5512345678';   // 10 digits
console.log('Test 1 (Mexico):', normalizePhone(mexPhone, mexIp));

// Test 2: Brazilian IP, 11 digit number, no country
const brIp = '200.200.200.200'; // Example Brazilian IP
const brPhone = '11999999999';  // 11 digits
console.log('Test 2 (Brazil):', normalizePhone(brPhone, brIp));

// Test 3: US IP, 10 digit number
const usIp = '8.8.8.8';
const usPhone = '2025550123';
console.log('Test 3 (USA):', normalizePhone(usPhone, usIp));
