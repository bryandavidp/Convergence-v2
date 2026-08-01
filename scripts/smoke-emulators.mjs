import net from 'node:net';

const host = '127.0.0.1';
const services = [
  ['Hosting', 5000],
  ['Functions', 5001],
  ['Firestore', 8080],
  ['Realtime Database', 9000],
  ['Auth', 9099],
  ['Storage', 9199],
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function checkTcp(name, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`${name} did not accept TCP connections on ${host}:${port}`));
    }, 5_000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.end();
      console.log(`PASS ${name} (${host}:${port})`);
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`${name} failed on ${host}:${port}: ${error.message}`));
    });
  });
}

await Promise.all(services.map(([name, port]) => checkTcp(name, port)));

const hosting = await fetch(`http://${host}:5000/`);
assert(hosting.ok, `Hosting returned HTTP ${hosting.status}`);
const home = await hosting.text();
assert(home.includes('<!doctype html>') || home.includes('<!DOCTYPE html>'), 'Hosting did not serve the web app');
console.log(`PASS Hosting web app (HTTP ${hosting.status})`);

const callable = await fetch(
  `http://${host}:5001/demo-convergence-v2/europe-west1/health`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: {} }),
  },
);
assert(
  [400, 401, 403].includes(callable.status),
  `Protected health callable accepted an anonymous request or returned an unexpected status: HTTP ${callable.status}`,
);
console.log(`PASS Protected callable rejects anonymous access (HTTP ${callable.status})`);

console.log('Firebase Emulator Suite smoke passed.');
