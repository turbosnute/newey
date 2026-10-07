/**
 * Digital clock widget — big clock with an optional date line.
 */

import { BaseWidget, defineWidget } from '../js/module-api.js';

class DigitalClock extends BaseWidget {
  static id = 'newey.widget.clock';
  static name = 'Digital clock';
  static description = 'Current time and date.';
  static defaultWidth = 4;
  static defaultHeight = 2;
  static defaultConfig = {
    fontSize: 'xl',      // lg | xl | xxl
    align: 'center',     // left | center
    seconds: false,
    hour12: false,
    showDate: true,
    dateFormat: 'long',  // long: "Wednesday, 7 October 2026" | short: "7 Oct"
  };
  static configSchema = [
    { key: 'fontSize', label: 'Font size', type: 'select', options: [
      { value: 'lg', label: 'Large' }, { value: 'xl', label: 'Extra large' }, { value: 'xxl', label: 'Colossal' },
    ] },
    { key: 'align', label: 'Alignment', type: 'select', options: [
      { value: 'center', label: 'Centered' }, { value: 'left', label: 'Left' },
    ] },
    { key: 'seconds', label: 'Show seconds', type: 'checkbox' },
    { key: 'hour12', label: '12-hour clock', type: 'checkbox' },
    { key: 'showDate', label: 'Show date', type: 'checkbox' },
    { key: 'dateFormat', label: 'Date format', type: 'select', options: [
      { value: 'long', label: 'Wednesday, 7 October 2026' }, { value: 'short', label: '7 Oct' },
    ] },
  ];

  async start() {
    this.#tick();
    // 250ms cadence keeps the minute edge crisp even when seconds are off
    this.every(() => this.#tick(), this.config.seconds ? 250 : 1000);
  }

  #tick() {
    if (!this.body) return;
    const now = new Date();

    const timeFormat = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      ...(this.config.seconds ? { second: '2-digit' } : {}),
      hour12: !!this.config.hour12,
    });

    const align = this.config.align === 'left' ? 'left' : 'center';
    let html = `<div class="clock clock--${align}">` +
      `<div class="clock-time clock-time--${this.config.fontSize || 'xl'}" aria-label="Current time">${timeFormat.format(now)}</div>`;

    if (this.config.showDate) {
      const options =
        this.config.dateFormat === 'short'
          ? { day: 'numeric', month: 'short' }
          : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
      html += `<div class="clock-date" aria-label="Current date">${new Intl.DateTimeFormat(undefined, options).format(now)}</div>`;
    }

    html += '</div>';
    this.setBody(html);
  }

  onRender() {
    this.#tick();
  }
}

export default defineWidget(DigitalClock);
