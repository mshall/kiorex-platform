import { render } from 'preact';
import { App } from './App';
import type { Boot } from './types';
import './styles.css';

const el = document.getElementById('kx-boot');
let boot: Boot | null = null;
try { boot = JSON.parse(el?.textContent ?? 'null') as Boot | null; } catch { boot = null; }
const root = document.getElementById('root');
if (boot) { // brand tokens through the CSSOM (the CSP forbids inline style attributes); values were validated and contrast-checked by the server
  const r = document.documentElement.style;
  r.setProperty('--kx-accent', boot.brand.accent); r.setProperty('--kx-on-accent', boot.brand.onAccent); r.setProperty('--kx-accent-text', boot.brand.accentText); r.setProperty('--kx-radius', `${boot.brand.radius}px`);
}
if (boot && root) render(<App boot={boot} />, root);
