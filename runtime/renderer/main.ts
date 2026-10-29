import './style.css';
import type { AppSnapshot } from '../shared/contracts';
import { bridge, previewSnapshot, toast } from './ui';
import { startPetView } from './pet-view';
import { startNotebook } from './notebook';

const app = document.querySelector<HTMLDivElement>('#app')!;
const isPet = new URLSearchParams(location.search).get('view') === 'pet';
let render: ((snapshot: AppSnapshot) => void) | undefined;
let pending: AppSnapshot | undefined;
const show = (snapshot: AppSnapshot) => {
  if (!render) render = isPet ? startPetView(app, snapshot) : startNotebook(app, snapshot);
  else render(snapshot);
};
// A pushed snapshot is always newer than the initial fetch; never let the late invoke result overwrite it.
let pushed = false;
bridge.onSnapshot(snapshot => { pushed = true; show(snapshot); });
bridge.getSnapshot().then(snapshot => { if (!pushed) show(snapshot); }).catch(error => { toast(String(error), 'error'); if (!render) show(pending || previewSnapshot); });
