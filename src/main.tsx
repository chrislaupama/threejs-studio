import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { EditorUIProvider } from './components/studio/EditorUIProvider';
import './globals.css';

const root = document.getElementById('root');

if (!root) throw new Error('ThreeJS Studio root element is missing');

createRoot(root).render(
  <StrictMode>
    <EditorUIProvider>
      <App />
    </EditorUIProvider>
  </StrictMode>,
);
