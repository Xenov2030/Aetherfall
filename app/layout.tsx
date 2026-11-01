import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Aetherfall',
  description: 'Archivo privado y memoria de tu campaña de rol.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
