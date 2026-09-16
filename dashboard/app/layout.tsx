import type { Metadata } from 'next';
import Nav from '../components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'scalping-lab',
  description: 'BTCUSDT perp order flow — signal, paper trading, expectancy ròng sau phí',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <Nav />
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
