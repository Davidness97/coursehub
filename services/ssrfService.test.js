const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { isPrivateIp, safeFetchUrl } = require('./ssrfService');

test('ssrfService - IP Blocklist verification', (t) => {
  // Should block
  assert.strictEqual(isPrivateIp('127.0.0.1'), true);
  assert.strictEqual(isPrivateIp('10.5.5.5'), true);
  assert.strictEqual(isPrivateIp('172.20.0.1'), true);
  assert.strictEqual(isPrivateIp('192.168.1.1'), true);
  assert.strictEqual(isPrivateIp('169.254.169.254'), true); // Link-local
  assert.strictEqual(isPrivateIp('100.64.0.1'), true); // CGNAT
  
  // IPv6
  assert.strictEqual(isPrivateIp('::1'), true);
  assert.strictEqual(isPrivateIp('fc00::1'), true);
  assert.strictEqual(isPrivateIp('fe80::1'), true);
  assert.strictEqual(isPrivateIp('::ffff:192.168.1.1'), true); // IPv4-mapped
  
  // Should allow public
  assert.strictEqual(isPrivateIp('8.8.8.8'), false);
  assert.strictEqual(isPrivateIp('93.184.216.34'), false);
  assert.strictEqual(isPrivateIp('2001:4860:4860::8888'), false);
});

test('ssrfService - safeFetchUrl blocks direct private IP', async (t) => {
  await assert.rejects(
    safeFetchUrl('http://127.0.0.1/image.jpg'),
    /Risoluzione a IP privato bloccata/
  );
  
  await assert.rejects(
    safeFetchUrl('http://[::1]/image.jpg'),
    /Risoluzione a IP privato bloccata/
  );
});

test('ssrfService - safeFetchUrl blocks hostname resolving to private IP (DNS Rebinding)', async (t) => {
  const dns = require('dns').promises;
  const originalResolve = dns.resolve;
  
  dns.resolve = async (hostname) => {
    if (hostname === 'dns-rebinding-test.com') return ['192.168.1.1'];
    return originalResolve(hostname);
  };
  
  await assert.rejects(
    safeFetchUrl('http://dns-rebinding-test.com/image.jpg'),
    /Risoluzione a IP privato bloccata/
  );
  
  dns.resolve = originalResolve;
});

test('ssrfService - safeFetchUrl blocks redirect to private IP', async (t) => {
  // Avvia un server locale per generare un redirect HTTP 302 verso un IP privato
  const server = http.createServer((req, res) => {
    res.writeHead(302, { 'Location': 'http://169.254.169.254/latest/meta-data/' });
    res.end();
  });

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  
  process.env.NODE_ENV = 'test'; // Consente 127.0.0.1 per il primo hop
  
  await assert.rejects(
    safeFetchUrl(url),
    /Risoluzione a IP privato bloccata/
  );

  server.close();
  process.env.NODE_ENV = '';
});

// Test streaming limit (simulate route logic)
test('download-cover aborts streaming when > 10MB', async (t) => {
  process.env.NODE_ENV = 'test'; // allow localhost

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    // Stream 12MB of data in chunks
    const chunk = Buffer.alloc(1024 * 1024, 'a'); // 1MB chunk
    let sent = 0;
    
    const interval = setInterval(() => {
      res.write(chunk);
      sent++;
      if (sent >= 12) {
        clearInterval(interval);
        res.end();
      }
    }, 10);
  });

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  const url = `http://127.0.0.1:${port}/image.jpg`;
  
  const response = await safeFetchUrl(url);
  assert.strictEqual(response.statusCode, 200);

  let downloadedBytes = 0;
  const MAX_BYTES = 10 * 1024 * 1024;
  
  await new Promise((resolve, reject) => {
    response.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      if (downloadedBytes > MAX_BYTES) {
        response.destroy(new Error('Superato limite 10MB in streaming'));
      }
    });
    response.on('end', () => resolve());
    response.on('error', (err) => {
      assert.match(err.message, /Superato limite 10MB in streaming/);
      resolve();
    });
  });

  server.close();
  process.env.NODE_ENV = '';
});
