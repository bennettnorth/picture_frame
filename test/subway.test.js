import { test } from 'node:test';
import assert from 'node:assert/strict';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { decodeFeed, arrivalsFromFeeds, alertsFromFeed, feedsFor } from '../server/sources/subway.js';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const NOW = Date.parse('2026-10-13T16:00:00Z');
const s = (mins) => Math.floor(NOW / 1000) + mins * 60;

function encode(obj) {
  return FeedMessage.encode(FeedMessage.fromObject(obj)).finish();
}

const feedBytes = encode({
  header: { gtfsRealtimeVersion: '1.0', timestamp: s(0) },
  entity: [
    { id: '1', tripUpdate: { trip: { routeId: 'L' }, stopTimeUpdate: [{ stopId: 'L08N', arrival: { time: s(7) } }] } },
    { id: '2', tripUpdate: { trip: { routeId: 'L' }, stopTimeUpdate: [{ stopId: 'L08N', arrival: { time: s(2) } }, { stopId: 'L06N', arrival: { time: s(5) } }] } },
    { id: '3', tripUpdate: { trip: { routeId: 'L' }, stopTimeUpdate: [{ stopId: 'L08N', arrival: { time: s(-5) } }] } },
    { id: '4', tripUpdate: { trip: { routeId: 'L' }, stopTimeUpdate: [{ stopId: 'L08S', departure: { time: s(4) } }] } },
  ],
});

test('decodes a GTFS-realtime feed and lists upcoming arrivals per stop', () => {
  const feed = decodeFeed(feedBytes.buffer.slice(feedBytes.byteOffset, feedBytes.byteOffset + feedBytes.byteLength));
  const stops = [
    { label: 'Bedford Av', direction: 'Manhattan', stopId: 'L08N', routes: ['L'] },
    { label: 'Bedford Av', direction: 'Canarsie', stopId: 'L08S', routes: ['L'] },
  ];
  const out = arrivalsFromFeeds([feed], stops, { now: NOW, maxArrivals: 4 });
  assert.deepEqual(out[0].arrivals.map((a) => (a.time - NOW) / 60000), [2, 7]);
  assert.deepEqual(out[1].arrivals.map((a) => [a.route, (a.time - NOW) / 60000]), [['L', 4]]);
});

test('route filter keeps express variants', () => {
  const bytes = encode({
    header: { gtfsRealtimeVersion: '1.0' },
    entity: [
      { id: '1', tripUpdate: { trip: { routeId: '6X' }, stopTimeUpdate: [{ stopId: '631N', arrival: { time: s(3) } }] } },
      { id: '2', tripUpdate: { trip: { routeId: '4' }, stopTimeUpdate: [{ stopId: '631N', arrival: { time: s(4) } }] } },
    ],
  });
  const out = arrivalsFromFeeds([decodeFeed(bytes)], [{ label: 'GCT', stopId: '631N', routes: ['6'] }], { now: NOW });
  assert.deepEqual(out[0].arrivals.map((a) => a.route), ['6X']);
});

test('feedsFor maps routes to MTA feeds', () => {
  assert.deepEqual(feedsFor([{ routes: ['L'] }, { routes: ['J', 'M'] }]).sort(), ['nyct%2Fgtfs-bdfm', 'nyct%2Fgtfs-jz', 'nyct%2Fgtfs-l']);
  assert.equal(feedsFor([{ stopId: 'X' }]).length, 8);
  assert.throws(() => feedsFor([{ routes: ['K'] }]), /Unknown subway route/);
});

test('alerts are filtered to configured routes and active periods', () => {
  const bytes = encode({
    header: { gtfsRealtimeVersion: '1.0' },
    entity: [
      { id: 'a', alert: { informedEntity: [{ routeId: 'L' }], headerText: { translation: [{ language: 'en', text: 'No L trains between  Bedford and 8 Av' }, { language: 'en-html', text: '<p>x</p>' }] } } },
      { id: 'b', alert: { informedEntity: [{ routeId: 'A' }], headerText: { translation: [{ language: 'en', text: 'A trains delayed' }] } } },
      { id: 'c', alert: { activePeriod: [{ start: s(60), end: s(120) }], informedEntity: [{ routeId: 'L' }], headerText: { translation: [{ language: 'en', text: 'Future work' }] } } },
    ],
  });
  assert.deepEqual(alertsFromFeed(decodeFeed(bytes), ['L'], NOW), [{ routes: ['L'], text: 'No L trains between Bedford and 8 Av' }]);
});
