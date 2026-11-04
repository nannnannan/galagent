// One icon family for all UI chrome: 24-unit grid, 1.8 stroke, round caps — drawn for GalAgent.
// Collectible content (achievement badges) keeps its emoji; everything the user navigates by uses these.
const P: Record<string, string> = {
  chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5z"/><path d="M8.5 9.5h7M8.5 12.5h4"/>',
  persona: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/><path d="M18.5 3.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" stroke="none"/>',
  paw: '<ellipse cx="12" cy="15.5" rx="4.2" ry="3.5"/><circle cx="6.5" cy="10" r="1.7"/><circle cx="9.6" cy="6.6" r="1.7"/><circle cx="14.4" cy="6.6" r="1.7"/><circle cx="17.5" cy="10" r="1.7"/>',
  heart: '<path d="M12 19.5s-7-4.3-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.1c0 5.1-7 9.4-7 9.4z"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  alarm: '<circle cx="12" cy="13" r="6.5"/><path d="M12 9.8V13l2.2 1.6M5 4.5 3 6.5M19 4.5l2 2M8 20.5l-1 1.5M16 20.5l1 1.5"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  pin: '<path d="M9 3.5h6l-1 5 3 3v1.5H7V11.5l3-3z"/><path d="M12 13v7.5"/>',
  book: '<path d="M5 5.5A2 2 0 0 1 7 3.5h11v15H7a2 2 0 0 0-2 2z"/><path d="M5 20.5a2 2 0 0 1 2-2h11v2H7M9 8h5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5.5H5v1.5a3 3 0 0 0 3 3M16 5.5h3v1.5a3 3 0 0 1-3 3M12 13v3.5M8.5 20h7M9.5 16.5h5V20h-5z"/>',
  plug: '<path d="M9 3.5v4M15 3.5v4M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5v4"/>',
  sparkles: '<path d="M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6z"/><path d="M17.5 14.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>',
  walk: '<circle cx="13" cy="4.8" r="1.8"/><path d="m9.5 21 2-6 2.5 2.5V21M11.5 15l1-5.5-3 1.5L8 14M12.5 9.5l2 3 3 1"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 4.5 5M20.5 9.5 16 14.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5"/>',
  home: '<path d="M4 11 12 4.5l8 6.5"/><path d="M6 9.5V20h12V9.5M10 20v-5h4v5"/>',
  monitor: '<rect x="3.5" y="4.5" width="17" height="11.5" rx="2"/><path d="M9 20h6M12 16v4"/>',
  box: '<path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z"/><path d="M4 7.5 12 11l8-3.5M12 11v9"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  puzzle: '<path d="M5 8h3.5a2 2 0 1 1 4 0H16v3.5a2 2 0 1 1 0 4V19H5v-3.5a2 2 0 1 0 0-4z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sprout: '<path d="M12 20.5V12M12 12c0-4 2.5-6.5 7-6.5 0 4.5-2.5 6.5-7 6.5zM12 14.5C12 11 10 9 6 9c0 3.5 2 5.5 6 5.5z"/>',
  flame: '<path d="M12 21c3.6 0 6-2.4 6-5.8 0-3.4-2.6-5.2-3.5-8.7-.3 2-1.3 3.3-2.6 4C11.8 7.6 10.3 5 8 3.5c.4 3-2 5.5-2 9.7C6 18.6 8.4 21 12 21z"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  hand: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10V5a1.5 1.5 0 0 1 3 0v5.5M14 10.5V7a1.5 1.5 0 0 1 3 0v6.5c0 4-2.5 7-6.5 7-2.6 0-4.3-1.3-5.7-3.5L3 14a1.5 1.5 0 0 1 2.5-1.6L8 15"/>',
  zap: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  send: '<path d="m4 12 16-7.5-6 16-2.5-6.5z"/><path d="m11.5 14 8.5-9.5"/>',
  pointer: '<path d="M6 4v12.5l3.5-3 2.5 6 2.5-1-2.5-6H17z"/>',
  spiral: '<path d="M12 12a1.5 1.5 0 1 1 1.5 1.5A3 3 0 0 1 10.5 10.5a4.5 4.5 0 0 1 4.5-4.5 6 6 0 0 1 6 6"/><path d="M12 12c0 3.3-2.7 6-6 6"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14.5h8"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  undo: '<path d="M9 7.5 4.5 12 9 16.5"/><path d="M5 12h9a5 5 0 0 1 0 10h-2"/>',
  terminal: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  menu: '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  hush: '<path d="M6 16.5V11a6 6 0 0 1 9.5-4.9M18 11v5.5l1.5 2H8"/><path d="M10 20.5a2 2 0 0 0 4 0M4 4l16 16"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  diamond: '<path d="M12 3 21 12 12 21 3 12z" fill="currentColor" stroke="none"/><path d="M12 7.5 16.5 12 12 16.5 7.5 12z" fill="var(--icon-cut, #fff)" stroke="none" opacity=".9"/>',
};
/** Emoji used across the UI → icon name, so every existing call site draws the same family. */
const ALIAS: Record<string, string> = {
  '💬': 'chat', '🎭': 'persona', '🐾': 'paw', '🌙': 'moon', '⏰': 'alarm', '🛡️': 'shield', '📌': 'pin', '📔': 'book', '🏆': 'trophy', '🔌': 'plug',
  '🎉': 'sparkles', '🚶': 'walk', '🔇': 'mute', '🔒': 'lock', '🏠': 'home', '🖥️': 'monitor', '📦': 'box', '🧭': 'compass', '👀': 'eye', '🧩': 'puzzle', '🌐': 'globe',
  '+': 'plus', '✓': 'check', '!': 'alert', '🌱': 'sprout', '🔥': 'flame', '📅': 'calendar', '🤲': 'hand', '⚡': 'zap', '🪁': 'send', '👉': 'pointer', '😵': 'spiral', '⌨️': 'keyboard', '◆': 'diamond', '🎯': 'target', '☀️': 'sun', '🔔': 'bell', '🤫': 'hush',
};
export const iconName = (value: string) => P[value] ? value : ALIAS[value];
export function svgIcon(name: string, size = 18): SVGSVGElement | undefined {
  const key = iconName(name); if (!key) return undefined;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true'); svg.classList.add('icon'); svg.innerHTML = P[key];
  return svg;
}
export const iconNames = Object.keys(P);
