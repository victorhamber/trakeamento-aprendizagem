
const geoip = require('geoip-lite');

// Mock DDI_LIST 
const MOCK_DDI_LIST = [
  { code: '55', country: 'BR' },
  { code: '52', country: 'MX' },
  { code: '1', country: 'US' },
];

function normalizePhone(phone, ip, country) {
  let p = phone.replace(/[^0-9]/g, '');
  if (p && p.length >= 10 && p.length <= 11) {
    let iso = (country || '').toUpperCase().trim();
    if (!iso && ip) {
      const geo = geoip.lookup(ip);
      if (geo?.country) iso = geo.country;
    }

    const targetCountry = iso || 'BR';
    const ddi = MOCK_DDI_LIST.find(d => d.country === targetCountry)?.code;

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

const mexIp = '187.189.155.155';
const mexPhone = '5512345678';
console.log('Test 1 (Mexico IP 187.189.155.155, Phone 5512345678):', normalizePhone(mexPhone, mexIp));

const brIp = '200.200.200.200';
const brPhone = '11999999999';
console.log('Test 2 (Brazil IP 200.200.200.200, Phone 11999999999):', normalizePhone(brPhone, brIp));

const usIp = '8.8.8.8';
const usPhone = '2025550123';
console.log('Test 3 (USA IP 8.8.8.8, Phone 2025550123):', normalizePhone(usPhone, usIp));
