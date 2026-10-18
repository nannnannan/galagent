import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { DesktopObserver, parseObservation } from '../../runtime/desktop/observer';
import type { Observation } from '../../runtime/shared/contracts';

const sample = (extra: Record<string, unknown> = {}) => JSON.stringify({ available: true, observedAt: new Date().toISOString(), locked: false, appName: 'Code', idleSeconds: 3.8, fullscreen: false, ...extra });
class FakeProcess extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); kills = 0;
  kill() { this.kills++; return true; }
  close() { this.emit('close', 0); }
}
function fixture(enabled = false) {
  const children: FakeProcess[] = [];
  const calls: { command: string; args: string[]; options: unknown }[] = [];
  const observations: Observation[] = [];
  const observer = new DesktopObserver({ scriptPath: 'C:\\Project space\\observer.ps1', enabled, onObservation: x => observations.push(x) }, (command, args, options) => {
    calls.push({ command, args, options });
    const child = new FakeProcess(); children.push(child); return child as unknown as ChildProcess;
  });
  return { observer, calls, children, observations };
}

test('parser rejects stale, malformed and unbounded samples; discards titles by default', () => {
  assert.equal(parseObservation('null'), undefined);
  assert.equal(parseObservation('{bad'), undefined);
  assert.equal(parseObservation('x'.repeat(8193)), undefined);
  assert.equal(parseObservation(sample({ observedAt: '2000-01-01' })), undefined);
  assert.equal(parseObservation(sample({ appName: '../malicious' })), undefined);
  assert.equal(parseObservation(sample({ title: 'private chat', arbitrary: 'ignored' }))?.title, undefined);
  assert.equal(parseObservation(sample())?.idleSeconds, 3);
  assert.equal(parseObservation(sample({ title: 'abc\nxyz' }), true)?.title, 'abc xyz');
  assert.equal(parseObservation(sample({ locked: true }))?.available, false);
  assert.equal(parseObservation(sample({ locked: undefined }))?.available, false);
  assert.equal(parseObservation(sample({ suspended: true }))?.appName, undefined);
});

test('explicit enable runs exactly one hidden fixed helper; stop disposes without restart', () => {
  const f = fixture();
  f.observer.start(); assert.equal(f.calls.length, 0);
  f.observer.setOptions({ enabled: true });
  f.observer.start(); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].command, 'powershell.exe');
  assert.deepEqual(f.calls[0].options, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(f.calls[0].args.at(-1), 'C:\\Project space\\observer.ps1');
  assert.ok(f.calls[0].args.includes('-NoProfile'));
  assert.ok(!f.calls[0].args.includes('-Command'));
  f.children[0].stdout.write(sample() + '\n');
  assert.equal(f.observations.at(-1)?.appName, 'Code');
  f.observer.stop(); f.observer.stop();
  assert.equal(f.children[0].kills, 1);
  f.children[0].close(); assert.equal(f.calls.length, 1);
});

test('titles opt in restarts only after existing helper closes; late old lines are ignored', () => {
  const f = fixture(true); f.observer.start();
  f.observer.setOptions({ includeTitles: true });
  assert.equal(f.calls.length, 1); assert.equal(f.children[0].kills, 1);
  f.children[0].stdout.write(sample({ title: 'ignored old line' }) + '\n');
  assert.equal(f.observations.at(-1)?.available, false);
  f.children[0].close(); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].args.at(-1), '-IncludeTitles');
  const line = sample({ title: 'explicit title' });
  f.children[1].stdout.write(line.slice(0, 20)); f.children[1].stdout.write(line.slice(20) + '\n');
  assert.equal(f.observations.at(-1)?.title, 'explicit title');
  f.observer.setOptions({ enabled: false }); f.children[1].close();
  assert.equal(f.calls.length, 2); f.observer.stop();
});

test('overlong partial line is bounded and following valid line survives', () => {
  const f = fixture(true); f.observer.start();
  f.children[0].stdout.write('x'.repeat(9000));
  f.children[0].stdout.write('\n' + sample() + '\n');
  assert.equal(f.observations.length, 1);
  f.observer.stop(); f.children[0].close();
});

test('unexpected exits have finite exponential retry and disposal clears timers', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(true); f.observer.start();
  for (const delay of [1000, 2000, 4000]) {
    f.children.at(-1)!.close();
    const before = f.calls.length;
    t.mock.timers.tick(delay - 1); assert.equal(f.calls.length, before);
    t.mock.timers.tick(1); assert.equal(f.calls.length, before + 1);
  }
  f.children.at(-1)!.close(); t.mock.timers.tick(100_000);
  assert.equal(f.calls.length, 4);
  assert.equal(f.observations.at(-1)?.error, 'helper-retry-limit');
  f.observer.stop();
  const g = fixture(true); g.observer.start(); g.children[0].close();
  g.observer.stop(); t.mock.timers.tick(100_000); assert.equal(g.calls.length, 1);
});
