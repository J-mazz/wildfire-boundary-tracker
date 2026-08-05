import { AppCoordinator } from './app/AppCoordinator';
import type { FireBootstrap } from './types';
import '../styles.css';

/** The generic map always uses a live IRWIN catalog; the landing page owns fire selection. */
function catalogUrl(): string {
  const fire = new URLSearchParams(window.location.search).get('fire');
  if (fire && /^irwin:[0-9a-fA-F-]{20,40}$/.test(fire)) {
    return `./api/catalog?fire=${encodeURIComponent(fire)}`;
  }
  window.location.replace('./');
  return './api/catalog?fire=invalid';
}

function readBootstrap(): FireBootstrap | null {
  const node = document.getElementById('fire-bootstrap');
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as FireBootstrap;
  } catch {
    return null;
  }
}

new AppCoordinator(catalogUrl(), readBootstrap()).start();
