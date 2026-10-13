import './global.css';
import '@playlarr/auth-web/styles.css';
import '@playlarr/settings-web/styles.css';
import '@playlarr/tidal-web/styles.css';

export const metadata = {
  title: 'Playlarr',
  description: 'Playlist acquisition and library orchestration',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
