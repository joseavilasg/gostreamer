import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

import './App.css';

import '@vidstack/react/player/styles/base.css';
import '@vidstack/react/player/styles/plyr/theme.css';

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
