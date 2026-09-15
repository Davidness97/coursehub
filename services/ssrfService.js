const dns = require('dns').promises;
const http = require('http');
const https = require('https');

// Helper to convert IPv4 string to 32-bit integer
function ip4ToInt(ip) {
  return ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
}

// Helper to check IPv4 against CIDR
function isIp4InCidr(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - bits) - 1);
  return (ip4ToInt(ip) & mask) === (ip4ToInt(range) & mask);
}

// Blocklist checks
function isPrivateIp(ip) {
  // IPv6 checks
  if (ip.includes(':')) {
    if (ip === '::1') return true; // Loopback
    
    // Normalize basic IPv6
    const lower = ip.toLowerCase();
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // Unique local (fc00::/7)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // Link-local (fe80::/10)
    
    // IPv4-mapped IPv6 (::ffff:192.168.1.1)
    if (lower.startsWith('::ffff:')) {
      return isPrivateIp(lower.substring(7));
    }
    
    return false;
  }
  
  // IPv4 checks
  const ipv4Ranges = [
    '127.0.0.0/8',    // Loopback
    '10.0.0.0/8',     // Private
    '172.16.0.0/12',  // Private
    '192.168.0.0/16', // Private
    '169.254.0.0/16', // Link-local
    '100.64.0.0/10'   // CGNAT
  ];
  
  return ipv4Ranges.some(cidr => isIp4InCidr(ip, cidr));
}

async function safeFetchUrl(urlString, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error('Too many redirects');
  }

  const parsed = new URL(urlString);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Solo http e https sono consentiti');
  }

  let ip = parsed.hostname;
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }
  
  // se l'hostname non è già un IP, risolviamo
  const net = require('net');
  if (!net.isIP(ip)) {
    const addresses = await dns.resolve(parsed.hostname);
    if (!addresses || addresses.length === 0) {
      throw new Error('Hostname non risolvibile');
    }
    ip = addresses[0];
  }

  if (isPrivateIp(ip)) {
    if (process.env.NODE_ENV === 'test' && ip === '127.0.0.1') {
      // Allow localhost ONLY for testing streaming limits and local servers
    } else {
      throw new Error('Risoluzione a IP privato bloccata per sicurezza (SSRF)');
    }
  }

  // 4 & 5: Direct connection to IP, preserving Host header and SNI
  return new Promise((resolve, reject) => {
    const options = {
      hostname: ip,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'Host': parsed.hostname,
        'User-Agent': 'CourseHub-SafeFetch/1.0'
      },
      timeout: 10000 // 10s connection timeout
    };

    if (parsed.protocol === 'https:') {
      options.servername = parsed.hostname; // Crucial for SNI
    }

    const client = parsed.protocol === 'https:' ? https : http;
    
    const req = client.request(options, (res) => {
      // 6: Handle redirects manually without auto-following
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let nextUrl;
        try {
          nextUrl = new URL(res.headers.location, urlString).href;
        } catch (e) {
          return reject(new Error('Redirect URL non valido'));
        }
        res.resume(); // discard body
        return resolve(safeFetchUrl(nextUrl, redirectCount + 1));
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`Status Code ${res.statusCode}`));
      }

      resolve(res);
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout di connessione'));
    });
    
    req.end();
  });
}

module.exports = {
  isPrivateIp,
  safeFetchUrl
};
