import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Tải font trước các token để --font-* có thể được giải quyết ngay lập tức (tránh FOUT).
// Inter được cung cấp dưới dạng một file biến duy nhất; Source Serif 4 cũng vậy.
// Plex Mono không có bản build biến nên chúng ta lấy ba trọng số thường dùng (400/500/600).
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource-variable/source-serif-4';
import './i18n';   // ← khởi tạo i18next trước khi bất kỳ thành phần nào render
import './ui';
import './index.css';
import App from './App.jsx';
import { installConsoleCapture } from './utils/consoleBuffer.js';

installConsoleCapture();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

import { Suspense, lazy } from 'react';
const CaptureWidget = lazy(() => import('./components/CaptureWidget.jsx'));

// Xác định cửa sổ Tauri nào đang được render.
// Biến thể WebviewUrl::App(PathBuf) của Tauri 2 không hỗ trợ query string —
// việc khai báo `"url": "/?window=widget"` trong tauri.conf.json đã âm thầm thất bại khi
// tạo cửa sổ widget. Vì vậy cả hai cửa sổ đều tải cùng một index.html và chúng ta
// phân biệt bằng nhãn cửa sổ (window label) thông qua Tauri JS API.
async function detectIsWidget() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow().label === 'widget';
  } catch {
    // Ngữ cảnh không phải Tauri (trình duyệt dev, Docker) — quay lại sử dụng URL query cho
    // các luồng công việc `bun dev:frontend` cũ có thể vẫn dựa vào nó.
    return window.location.search.includes('window=widget');
  }
}

export async function bootstrapApp() {
  const isWidget = await detectIsWidget();

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {isWidget ? (
          <Suspense
            fallback={
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(18, 18, 22, 0.88)',
                  backdropFilter: 'blur(24px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '100px',
                  color: 'rgba(255, 255, 255, 0.9)',
                  fontFamily: '"Inter Variable", "Inter", -apple-system, sans-serif',
                  fontSize: 13,
                  userSelect: 'none',
                }}
              >
                Loading dictation…
              </div>
            }
          >
            <CaptureWidget />
          </Suspense>
        ) : (
          <App />
        )}
      </QueryClientProvider>
    </StrictMode>,
  );
}
