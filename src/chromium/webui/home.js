import {addWebUiListener, sendWithPromise} from 'chrome://resources/js/cr.js';
import {setColorMode, setLanguage, t} from './i18n.js';

const hero = document.querySelector('.atrium-hero');
const icon = document.querySelector('#home-icon');
const description = hero.alt;

function applyAppearance(state) {
  if (!state.ready) return;

  setLanguage(state.language);
  setColorMode(state.colorMode);
  hero.alt = t(description);

  const edition = state.edition === 'pride' ? 'pride' : 'standard';
  if (document.documentElement.dataset.edition === edition) return;

  document.documentElement.dataset.edition = edition;
  const pride = edition === 'pride';
  hero.width = pride ? 1817 : 740;
  hero.height = pride ? 866 : 348;
  hero.src = `brand-${edition}-hero.png`;
  icon.href = `brand-${edition}-icon.png`;
}

hero.alt = t(description);
addWebUiListener('tai-state-changed', applyAppearance);
void sendWithPromise('taiGetState').then(applyAppearance);
