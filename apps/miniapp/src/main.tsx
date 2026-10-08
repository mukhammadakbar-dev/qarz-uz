import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { ApiClient } from './lib/api';
import { initTelegram } from './lib/telegram';
import { SessionProvider } from './state/session';
import '@fontsource-variable/onest';
import './styles.css';

const tg = initTelegram();
const api = new ApiClient({ getInitData: () => tg.initData });
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <SessionProvider api={api}>
          <App startParam={tg.startParam} />
        </SessionProvider>
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
