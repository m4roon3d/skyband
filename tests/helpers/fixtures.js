'use strict';

let n = 0;

/** Build a Radio Browser–shaped raw station. */
function rawStation(over = {}) {
  n += 1;
  return {
    stationuuid: `uuid-${n}`,
    name: `Test Station ${n}`,
    url_resolved: `https://stream.example.com/${n}.mp3`,
    country: 'India', countrycode: 'IN', state: 'Karnataka',
    tags: 'pop,hits', language: 'english', codec: 'MP3', bitrate: 128,
    votes: 100, clickcount: 500, clicktrend: 3, lastcheckok: 1, ssl_error: 0,
    geo_lat: 12.97, geo_long: 77.59,
    ...over
  };
}

const many = (count, over = {}) => Array.from({ length: count }, (_, i) => rawStation(typeof over === 'function' ? over(i) : over));

module.exports = { rawStation, many };
