import './global.css';

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
