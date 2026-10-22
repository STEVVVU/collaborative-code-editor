import assert from 'node:assert/strict';
import {fork, execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync, openSync, closeSync, statfsSync} from 'node:fs';
import {resolve} from 'node:path';
import {availableParallelism, cpus, totalmem, platform, release, loadavg} from 'node:os';
import {performance, monitorEventLoopDelay} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import * as Y from 'yjs';

if (process.argv[2] === '--serve') {
  const {createNotebookServer} = await import('../apps/notebook-server/src/server.mjs');
  const server = await createNotebookServer({port: 0, dbPath: process.argv[3]});
  process.send({ready: server.url});
  const timer = setInterval(() => process.send({resource: {at: performance.now(), cpu: process.cpuUsage(), ...process.memoryUsage(), ...process.resourceUsage()}}), 250);
  process.on('message', async message => {
    if (message !== 'stop') return;
    clearInterval(timer);
    process.send({resource: {cpu: process.cpuUsage(), ...process.memoryUsage(), ...process.resourceUsage()}});
    await server.close();
    process.exit(0);
  });
} else {
  const smoke = process.argv.includes('--smoke');
  const profile = process.argv.includes('--profile');
  const run = resolve(process.env.BENCH_OUTPUT ?? `.audit/benchmarks/notebooks-${Date.now()}`);
  mkdirSync(run, {recursive: true});
  assert(Number(statfsSync(run).bavail) * Number(statfsSync(run).bsize) > 10 * 1024 ** 3, '10 GiB reserve required');
  const evidence = {schema: 1, passed: false, smoke, profile, claim: 'Disk-backed notebook protocol latency and convergence, excluding browser rendering',
    source: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), dirty: execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}),
    environment: {node: process.version, platform: platform(), release: release(), cores: availableParallelism(), cpu: cpus()[0]?.model, memory: totalmem(), load: loadavg(), command: process.argv}, samples: []};
  const quantiles = values => {
    const sorted = values.toSorted((a, b) => a - b);
    const q = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null;
    return {n: sorted.length, p50: q(.5), p95: q(.95), p99: q(.99), min: sorted[0] ?? null, max: sorted.at(-1) ?? null};
  };
  let child;
  const deadline = setTimeout(() => { child?.kill('SIGKILL'); writeFileSync(resolve(run, 'deadline.txt'), 'Campaign exceeded 45 minutes'); process.exit(1); }, 45 * 60_000);
  async function sample(config) {
    const directory = resolve(run, `sample-${evidence.samples.length}`);
    mkdirSync(directory);
    const log = openSync(resolve(directory, 'server.log'), 'w');
    const resources = [], peers = [], updates = [], errors = [];
    const lag = monitorEventLoopDelay({resolution: 10}); lag.enable();
    const clientCpu = process.cpuUsage(), started = performance.now();
    const result = {...config, directory, passed: false, errors, updates, resources};
    evidence.samples.push(result);
    child = fork(new URL(import.meta.url), ['--serve', resolve(directory, 'notebooks.sqlite')], {execArgv: profile ? ['--cpu-prof', `--cpu-prof-dir=${directory}`] : [], stdio: ['ignore', log, log, 'ipc'], windowsHide: true});
    const owned = child;
    const exited = new Promise(done => owned.once('exit', (code, signal) => done({code, signal})));
    let url;
    try {
      url = await Promise.race([new Promise(done => owned.on('message', message => {
        if (message.ready) done(message.ready);
        if (message.resource) resources.push(message.resource);
      })), exited.then(value => {throw new Error(`service exited before readiness ${JSON.stringify(value)}`);}), delay(10_000).then(() => {throw new Error('service readiness timeout');})]);
      const response = await fetch(`${url}/api/notebooks`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({title: 'Benchmark', source: 'x'.repeat(config.bytes), settings: {mode: 'script', entrypoint: '', argumentsText: '[]', projectionContracts: ''}}), signal: AbortSignal.timeout(5000)});
      assert.equal(response.status, 201);
      const room = await response.json();
      async function connect(peer) {
        return new Promise((done, reject) => {
          const socket = new WebSocket(`${url.replace('http', 'ws')}/api/notebooks/${room.id}/live`);
          peer.socket = socket;
          const timeout = setTimeout(() => reject(new Error('peer connection timeout')), 10_000);
          socket.on('error', error => {errors.push({kind: 'socket', message: error.message}); reject(error);});
          socket.on('open', () => socket.send(JSON.stringify({type: 'auth', token: room.editToken})));
          socket.on('message', bytes => {
            const message = JSON.parse(bytes.toString());
            if (message.type === 'error') {errors.push({kind: 'rejected', message: message.message}); return;}
            if (message.type !== 'state') return;
            Y.applyUpdate(peer.doc, Buffer.from(message.state, 'base64'));
            const now = performance.now(), text = peer.doc.getText('source').toString();
            for (const update of updates) {
              if (message.ack === update.id) update.ack ??= now - update.scheduled;
              if (!update.seen.includes(peer.id) && text.includes(update.marker)) {
                update.seen.push(peer.id);
                update.observed.push({peer: peer.id, ms: now - update.scheduled});
              }
            }
            clearTimeout(timeout); done();
          });
          socket.on('close', (code) => {if (!peer.offline && !peer.closing) errors.push({kind: 'closed', peer: peer.id, code});});
        });
      }
      for (let i = 0; i < config.clients; i++) {
        const peer = {id: i, doc: new Y.Doc()};
        peer.doc.getText('source'); peer.doc.getMap('settings'); peer.doc.getArray('annotations');
        peers.push(peer); await connect(peer);
      }
      // Warmup is outside the offered-arrival clock and uses the real persisted path.
      peers[0].doc.getText('source').insert(config.bytes, '\n');
      peers[0].socket.send(JSON.stringify({type: 'update', updateId: 'warmup', state: Buffer.from(Y.encodeStateAsUpdate(peers[0].doc)).toString('base64')}));
      const warmDeadline = performance.now() + 5000;
      while (!peers.every(p => p.doc.getText('source').length === config.bytes + 1)) {
        assert(performance.now() < warmDeadline, 'warmup convergence timeout'); await delay(10);
      }
      const base = performance.now(), count = Math.ceil(config.seconds * config.rate);
      const offline = peers.at(-1);
      let reconnect;
      for (let i = 0; i < count; i++) {
        const scheduled = base + i * 1000 / config.rate;
        while (performance.now() < scheduled) await delay(Math.ceil(scheduled - performance.now()));
        if (config.reconnect && i === Math.floor(count / 3)) {offline.offline = true; offline.socket.terminate();}
        if (config.reconnect && i === Math.floor(2 * count / 3)) {
          const at = performance.now(); await connect(offline); offline.offline = false;
          reconnect = {ms: performance.now() - at, retainedEdits: updates.filter(u => u.seen.includes(offline.id)).length};
        }
        const peer = peers[i % (config.reconnect ? config.clients - 1 : config.clients)];
        const marker = `#${i.toString(16).padStart(7, '0')}\n`;
        const update = {id: String(i), marker, scheduled, lateness: performance.now() - scheduled, seen: [], observed: []};
        assert(update.lateness >= 0, 'offer predates its scheduled deadline');
        updates.push(update);
        peer.doc.getText('source').insert(peer.doc.getText('source').length, marker);
        peer.socket.send(JSON.stringify({type: 'update', updateId: update.id, state: Buffer.from(Y.encodeStateAsUpdate(peer.doc)).toString('base64')}));
        result.maxPending = Math.max(result.maxPending ?? 0, updates.filter(u => u.ack === undefined).length);
        result.maxSocketBufferedBytes = Math.max(result.maxSocketBufferedBytes ?? 0, ...peers.map(p => p.socket.bufferedAmount));
      }
      const drain = performance.now() + 30_000;
      while (updates.some(u => u.ack === undefined || u.seen.length !== config.clients) && performance.now() < drain) await delay(10);
      assert(updates.every(u => (u.ack === undefined || u.ack >= 0) && u.observed.every(o => o.ms >= 0)), 'acknowledgment or convergence predates the offer deadline');
      const persisted = await fetch(`${url}/api/notebooks/${room.id}/open`, {method: 'POST', headers: {authorization: `Bearer ${room.editToken}`}, signal: AbortSignal.timeout(5000)});
      assert.equal(persisted.status, 200);
      const saved = new Y.Doc(); saved.getText('source'); saved.getMap('settings'); saved.getArray('annotations');
      Y.applyUpdate(saved, Buffer.from((await persisted.json()).state, 'base64'));
      const finalText = saved.getText('source').toString();
      assert(updates.every(u => finalText.includes(u.marker)), 'persisted edit missing');
      assert(peers.every(p => p.doc.getText('source').toString() === finalText), 'peer state divergence');
      saved.destroy();
      result.counts = {offered: count, sent: updates.length, acknowledged: updates.filter(u => u.ack !== undefined).length, converged: updates.filter(u => u.seen.length === config.clients).length, failed: errors.length, timedOut: updates.filter(u => u.ack === undefined || u.seen.length !== config.clients).length};
      result.latencyMs = {ack: quantiles(updates.flatMap(u => u.ack === undefined ? [] : [u.ack])), allPeers: quantiles(updates.filter(u => u.seen.length === config.clients).map(u => Math.max(...u.observed.map(o => o.ms)))), arrivalLateness: quantiles(updates.map(u => u.lateness))};
      result.reconnect = reconnect;
      assert.equal(result.counts.timedOut, 0, 'unacknowledged or undelivered edits'); assert.equal(errors.length, 0, 'protocol errors');
      result.passed = true;
    } finally {
      for (const peer of peers) {peer.closing = true; peer.socket?.terminate(); peer.doc.destroy();}
      if (owned.connected) owned.send('stop');
      const outcome = await Promise.race([exited, delay(5000).then(() => {owned.kill('SIGKILL'); return {code: null, forced: true};})]);
      if (outcome.forced) {await exited; result.passed = false; errors.push({kind: 'cleanup', message: 'forced service termination'});}
      child = undefined; closeSync(log); lag.disable();
      result.cleanup = !outcome.forced && outcome.code === 0;
      result.client = {cpu: process.cpuUsage(clientCpu), rss: process.memoryUsage().rss, eventLoopP99Ms: lag.percentile(99) / 1e6};
      result.elapsedSeconds = (performance.now() - started) / 1000;
      writeFileSync(resolve(directory, 'sample.json'), JSON.stringify(result, null, 2));
    }
    assert(result.cleanup, 'owned service cleanup failed');
  }
  try {
    if (smoke) await sample({clients: 2, bytes: 1024, rate: 10, seconds: .6, reconnect: true, repeat: 0});
    else if (profile) await sample({clients: 8, bytes: 16384, rate: 50, seconds: 10, repeat: 0});
    else {
      for (let repeat = 0; repeat < 5; repeat++) {
        const clients = repeat % 2 ? [32, 8, 2] : [2, 8, 32];
        for (const count of clients) for (const bytes of [1024, 16384, 49152]) for (const rate of [1, 10, 50]) await sample({clients: count, bytes, rate, seconds: 10, repeat});
        await sample({clients: 8, bytes: 16384, rate: 10, seconds: 10, reconnect: true, repeat});
      }
      await sample({clients: 8, bytes: 16384, rate: 10, seconds: 120, reconnect: true, repeat: 0, stability: true});
    }
    evidence.passed = true;
  } catch (error) {evidence.error = error.stack; process.exitCode = 1;}
  finally {clearTimeout(deadline); writeFileSync(resolve(run, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({passed: evidence.passed, run, samples: evidence.samples.length}));}
}
