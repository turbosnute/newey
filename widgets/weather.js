/**
 * Weather widget — current conditions and hourly outlook from met.no.
 * Geocoding of the configured place uses the open Open-Meteo geocoding API
 * (its results include the place's time zone, which the widget uses for
 * day/night icons).
 */

import { BaseWidget, defineWidget } from '../js/module-api.js';
import { proxiedFetch, createTTLCache, formatTemp, debounce } from '../js/utils.js';

const FORECAST_ENDPOINT = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const GEOCODE_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const CONTACT = 'newey-dashboard github.com'; // met.no requires identification (UA)
const apiCache = createTTLCache();

/** met.no symbol_code -> { kind, isDay }. kind drives the inline SVG icon. */
function symbolToIcon(symbolCode = '') {
  const [base, phase] = symbolCode.split('_');
  const isDay = phase !== 'night' && phase !== 'polartwilight';
  const kinds = {
    clearsky: 'clear',
    cloudy: 'cloudy',
    fair: 'partly',
    partlycloudy: 'partly',
    fog: 'fog',
    heavyrain: 'rain', lightrain: 'rain', rain: 'rain', rainsnow: 'sleet',
    heavyrainandthunder: 'storm', heavysleet: 'sleet', heavysleetandthunder: 'storm',
    heavysnow: 'snow', heavysnowandthunder: 'storm', lightsleet: 'sleet',
    lightsnow: 'snow', lightssleetandthunder: 'storm', lightsnowandthunder: 'storm',
    sleet: 'sleet', sleetandthunder: 'storm', snow: 'snow', snowandthunder: 'storm',
    snowshowers: 'snow',
    heavyrainshowers: 'rain', heavysleetshowers: 'sleet', heavysnowshowers: 'snow',
    lightrainshowers: 'rain', lightsleetshowers: 'sleet', lightsnowshowers: 'snow',
    rainshowers: 'rain', sleetshowers: 'sleet',
  };
  return { kind: kinds[base] ?? 'partly', isDay };
}

/** Tiny hand-drawn SVG icons (viewBox 0 0 64 64, currentColor). */
function iconSvg(kind, isDay = true) {
  const S = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  const sun = () => '<circle cx="32" cy="32" r="11"/>' +
    [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
      const r = 19, x1 = 32 + r * Math.cos((a * Math.PI) / 180), y1 = 32 + r * Math.sin((a * Math.PI) / 180);
      const x2 = 32 + 25 * Math.cos((a * Math.PI) / 180), y2 = 32 + 25 * Math.sin((a * Math.PI) / 180);
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }).join('');
  const moon = () => '<path d="M40 12a20 20 0 1 0 12 30 20 20 0 0 1-12-30z"/>';
  const cloud = (dx = 0) => `<path transform="translate(${dx} 0)" d="M22 44a9 9 0 1 1 2.6-17.7A13 13 0 0 1 49 31a7.5 7.5 0 0 1-1 15z"/>`;
  const drops = (n) => [0, 1, 2].slice(0, n).map((i) => `<line x1="${24 + i * 8}" y1="${50}" x2="${20 + i * 8}" y2="${57}"/>`).join('');
  const flakes = (n) => [0, 1, 2].slice(0, n).map((i) => `<line x1="${24 + i * 8}" y1="47" x2="${24 + i * 8}" y2="58"/><line x1="${20 + i * 8}" y1="52.5" x2="${28 + i * 8}" y2="52.5"/>`).join('');

  switch (kind) {
    case 'clear': return S + (isDay ? sun() : moon()) + '</svg>';
    case 'partly': return S + (isDay ? '<circle cx="24" cy="22" r="8"/><path d="M24 8v-3M10.9 8.9l-2.2-2.2M8 22H5"/>' : moon()) + cloud(4) + '</svg>';
    case 'cloudy': return S + cloud(3) + cloud(-13).replace('stroke-width="3.5"', 'stroke-width="3"') + '</svg>';
    case 'fog': return S + cloud() + '<line x1="18" y1="50" x2="46" y2="51"/><line x1="20" y1="56" x2="44" y2="56"/>' + '</svg>';
    case 'rain': return S + cloud() + drops(3) + '</svg>';
    case 'sleet': return S + cloud() + drops(2) + flakes(1) + '</svg>';
    case 'snow': return S + cloud() + flakes(3) + '</svg>';
    case 'storm': return S + cloud() + drops(2) + '<path d="M32 50l-5 8h6l-4 7" class="bolt"/>' + '</svg>';
    default: return S + cloud() + '</svg>';
  }
}

/** Human text for a met.no symbol_code ("fair_day" -> "Fair"). */
function symbolToText(symbolCode = '') {
  const map = {
    clearsky: 'Clear sky', fair: 'Fair', partlycloudy: 'Partly cloudy',
    cloudy: 'Cloudy', fog: 'Fog', rain: 'Rain', lightrain: 'Light rain',
    heavyrain: 'Heavy rain', rainsnow: 'Rain and snow', sleet: 'Sleet',
    lightsleet: 'Light sleet', heavysleet: 'Heavy sleet', snow: 'Snow',
    lightsnow: 'Light snow', heavysnow: 'Heavy snow', snowshowers: 'Snow showers',
    rainshowers: 'Rain showers', lightrainshowers: 'Light rain showers',
    heavyrainshowers: 'Heavy rain showers', lightsnowshowers: 'Light snow showers',
    heavysnowshowers: 'Heavy snow showers', sleetshowers: 'Sleet showers',
    lightsleetshowers: 'Light sleet showers', heavysleetshowers: 'Heavy sleet showers',
    heavyrainandthunder: 'Heavy rain and thunder', rainandthunder: 'Rain and thunder',
    sleetandthunder: 'Sleet and thunder', snowandthunder: 'Snow and thunder',
    lightsnowandthunder: 'Light snow and thunder', lightrainandthunder: 'Light rain and thunder',
    heavysnowandthunder: 'Heavy snow and thunder', heavysleetandthunder: 'Heavy sleet and thunder',
    lightsleetandthunder: 'Light sleet and thunder', lightsnowandthunder: 'Light snow and thunder',
  };
  const base = symbolCode.split('_')[0];
  return map[base] ?? base;
}

function windChill(t, v) {
  const vc = Math.max(v, 1.0) ** 0.16;
  return 13.12 + 0.6215 * t - 11.37 * vc + 0.3965 * t * vc;
}

function compassFromDegrees(deg) {
  return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][
    Math.round(((deg % 360) / 22.5)) % 16
  ];
}

/** True when it is day at the given moment in the given IANA time zone. */
function isDaylightIn(tz, now = new Date()) {
  try {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false })
        .format(now)
    );
    return hour >= 7 && hour < 19;
  } catch {
    return true;
  }
}

class WeatherWidget extends BaseWidget {
  static id = 'newey.widget.weather';
  static name = 'Weather';
  static description = 'Current weather and hourly forecast from met.no.';
  static defaultWidth = 4;
  static defaultHeight = 3;
  static defaultConfig = {
    place: 'Oslo',        // geocoded via Open-Meteo geocoding
    lat: 59.9127,         // resolved coordinates (kept so pinned places survive)
    lon: 10.7461,
    timezone: 'Europe/Oslo',
    unit: 'c',            // c | f
    hours: 4,             // number of hourly slots to show
    showDetails: true,    // wind / humidity details under current conditions
    useCurrentLocation: false, // browser geolocation instead of the city
  };
  static configSchema = [
    { key: 'useCurrentLocation', label: 'Use my current location', type: 'checkbox',
      help: 'Uses browser geolocation (a permission prompt appears once); ignores the city below when enabled.' },
    { key: 'place', label: 'Location', type: 'search', placeholder: 'City name…',
      // suggest() powers the datalist autocomplete; picking an option also
      // stores lat/lon/timezone via the extra() mechanism of #buildForm
      suggest: (query) => (
        import('../js/utils.js').then(async ({ proxiedFetch }) => {
          const results = await proxiedFetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`
          );
          return (results?.results ?? []).map((r) => ({
            value: r.name,
            label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
            extra: { lat: r.latitude, lon: r.longitude, timezone: r.timezone || 'UTC' },
          }));
        })
      ) },
    { key: 'unit', label: 'Temperature unit', type: 'select', options: [
      { value: 'c', label: 'Celsius' }, { value: 'f', label: 'Fahrenheit' },
    ] },
    { key: 'hours', label: 'Forecast hours', type: 'select', options: [
      { value: '3', label: 'Next 3 hours' }, { value: '4', label: 'Next 4 hours' },
      { value: '6', label: 'Next 6 hours' }, { value: '8', label: 'Next 8 hours' },
    ] },
    { key: 'showDetails', label: 'Show wind/humidity details', type: 'checkbox' },
  ];

  async start() {
    this.#schedule(); // immediate first refresh
    this.every(() => this.#schedule(), 10 * 60 * 1000);
  }

  async #schedule() {
    try {
      await this.#refresh();
    } catch (err) {
      console.error('[Weather] refresh failed:', err);
      this.#showError(err);
    }
  }

  #buildURL({ lat, lon }) {
    return `${FORECAST_ENDPOINT}?lat=${encodeURIComponent(lat.toFixed(4))}&lon=${encodeURIComponent(lon.toFixed(4))}`;
  }

  #lastResolvedPlace = null;

  async #resolveLocation() {
    if (this.config.useCurrentLocation) {
      await this.#resolveViaGeolocation();
      return;
    }
    const wanted = (this.config.place || '').trim();
    if (!wanted) throw new Error('No location configured');

    // Re-geocode whenever the place name changes (or lat/lon were never set).
    if (this.#lastResolvedPlace !== wanted || !this.config.lat || !this.config.lon) {
      try {
        const results = await apiCache.get(`place:${wanted.toLowerCase()}`, 24 * 60 * 60 * 1000, () =>
          proxiedFetch(`${GEOCODE_ENDPOINT}?name=${encodeURIComponent(wanted)}&count=1&language=en&format=json`)
        );
        const hit = results?.results?.[0];
        if (hit) {
          this.config.lat = hit.latitude;
          this.config.lon = hit.longitude;
          this.config.timezone = hit.timezone || 'UTC';
        }
      } catch (err) {
        // fall through: keep previously stored coordinates if we have any
        if (!this.config.lat || !this.config.lon) throw err;
        console.warn('[Weather] geocoding failed, using stored coordinates:', err);
      }
      this.#lastResolvedPlace = wanted;
    }
    if (!this.config.lat || !this.config.lon) {
      throw new Error(`Could not find a place called "${wanted}"`);
    }
  }

  /** Read the browser's position (cached 10 min so tabs don't nag GPS). */
  async #resolveViaGeolocation() {
    const fresh =
      this.#geo && Date.now() - this.#geo.at < 10 * 60 * 1000;
    if (fresh) return;

    if (!navigator.geolocation) throw new Error('Geolocation is not available');
    const pos = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Geolocation request timed out')), 10000);
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(timer); resolve(p); },
        (err) => { clearTimeout(timer); reject(new Error(`Geolocation failed: ${err.message}`)); },
        { timeout: 8000, maximumAge: 10 * 60 * 1000 }
      );
    });
    this.#geo = { at: Date.now(), lat: pos.coords.latitude, lon: pos.coords.longitude };
  }

  #geo = null;

  async #refresh() {
    await this.#resolveLocation();
    const url = this.#buildURL(this.config);
    const cacheKey = `met:${url}`;

    const data = await apiCache.get(cacheKey, 5 * 60 * 1000, () =>
      proxiedFetch(url, { headers: { 'User-Agent': CONTACT } })
    );
    const series = data?.properties?.timeseries;
    if (!series?.length) throw new Error('met.no returned no forecast data');

    const now = Date.now();
    let index = series.findIndex((e) => new Date(e.time).getTime() >= now);
    if (index < 0) index = 0;

    const current = series[index];
    const slotCount = Math.min(12, Math.max(1, Number(this.config.hours) || 4));
    const hours = [];
    for (let i = index; i < series.length && hours.length < slotCount; i++) {
      const e = series[i];
      if (!e.data?.next_1_hours) continue; // only hourly-resolution slots
      hours.push(e);
    }

    this.#render(current, hours);
  }

  #render(current, hours) {
    if (!this.body) return;
    const instant = current.data.instant.details;
    const temp = instant.air_temperature;
    const symbol = current.data.next_1_hours?.summary?.symbol_code ?? current.data.next_12_hours?.summary?.symbol_code ?? '';
    const { kind } = symbolToIcon(symbol);

    const precipNext = hours.reduce((s, e) => s + (e.data.next_1_hours?.details?.precipitation_amount ?? 0), 0);
    const precipLabel = hours.length;

    const wind = instant.wind_speed ?? 0;
    const feel = windChill(temp, Math.min(wind, 30));

    const hourItems = hours.map((e) => {
      const sym = e.data.next_1_hours?.summary?.symbol_code ?? '';
      const ic = symbolToIcon(sym);
      const t = new Date(e.time);
      const label = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(t);
      const fallbackDay = isDaylightIn(this.config.timezone || 'UTC');
      return `<li class="weather-hour">
        <span class="weather-hour__time">${label}</span>
        <span class="weather-hour__icon">${iconSvg(ic.kind, ic.isDay ?? fallbackDay)}</span>
        <span class="weather-hour__temp">${formatTemp(e.data.instant.details.air_temperature, this.config.unit)}</span>
      </li>`;
    }).join('');

    const details = this.config.showDetails ? `
      <dl class="weather-details">
        <div><dt>Feels like</dt><dd>${formatTemp(feel, this.config.unit)}</dd></div>
        <div><dt>Wind</dt><dd>${wind.toFixed(1)} m/s ${compassFromDegrees(instant.wind_from_direction ?? 0)}</dd></div>
        <div><dt>Humidity</dt><dd>${Math.round(instant.relative_humidity ?? 0)}%</dd></div>
        <div><dt>Precip ${precipLabel}h</dt><dd>${precipNext.toFixed(1)} mm</dd></div>
      </dl>` : '';

    const placeLabel = this.config.useCurrentLocation
      ? 'My location'
      : this.config.place || '';
    const dayNow = this.config.useCurrentLocation
      ? isDaylightIn(Intl.DateTimeFormat().resolvedOptions().timeZone)
      : isDaylightIn(this.config.timezone || 'UTC');

    this.setBody(`
      <div class="weather-main">
        <span class="weather-main__icon">${iconSvg(kind, dayNow)}</span>
        <span class="weather-main__temp">${formatTemp(temp, this.config.unit)}</span>
      </div>
      <div class="weather-desc">${symbolToText(symbol)}</div>
      <div class="weather-place">${this.#escapeHtml(placeLabel)}</div>
      ${details}
      <ul class="weather-hours">${hourItems}</ul>
      <div class="weather-credit">Forecast: met.no</div>
    `);
  }

  #showError(err) {
    if (!this.body) return;
    this.setBody(`<div class="weather-error">Weather unavailable<br><small>${this.#escapeHtml(String(err?.message ?? err))}</small></div>`);
  }

  onRender() {
    this.container.classList.add('widget--weather');
    this.setBody('<div class="widget-loading">Loading weather…</div>');
  }

  onConfigUpdate(newConfig) {
    this.config = newConfig;
    this.#lastResolvedPlace = null; // force re-resolve on next refresh
    this.#schedule(); // refresh right away with the new settings
  }

  #escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }
}

export default defineWidget(WeatherWidget);
